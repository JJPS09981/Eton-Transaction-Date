import {
  adjustFixedExpense,
  adjustFixedIncome,
  annualDueInCycle,
  fixedExpenseTarget,
  fixedIncomeTarget,
  expenseCategoryDefaults,
  type BudgetState,
} from "@budget/domain";
import type { Command } from "./contracts";
import type { Db, EventEntry } from "./database";
import { RequestError } from "./errors";

export const defaultCategories = expenseCategoryDefaults.map(
  (item) => item.name,
);

export async function seedCategories(db: Db, userId: string): Promise<void> {
  for (const [index, item] of expenseCategoryDefaults.entries()) {
    const category = await db.query(
      `insert into public.categories(id,user_id,name,icon_key,sort_order,scope)
      values(gen_random_uuid(),$1,$2,$3,$4,'daily') on conflict(user_id,scope,lower(btrim(name))) do update set name=excluded.name returning id`,
      [userId, item.name, item.icon, index],
    );
    await db.query(
      `insert into public.subcategories(user_id,category_id,name,sort_order)
      select $1,$2,name,position-1 from unnest($3::text[]) with ordinality seed(name,position)
      on conflict(user_id,category_id,lower(btrim(name))) do nothing`,
      [userId, category.rows[0].id, item.items],
    );
  }
}

export async function saveCategory(
  db: Db,
  userId: string,
  command: Extract<Command, { type: "SaveCategory" }>,
) {
  const duplicate = await db.query(
    "select id from public.categories where user_id = $1 and lower(btrim(name)) = lower($2) and ($3::uuid is null or id <> $3) and scope=$4",
    [userId, command.name, command.categoryId ?? null, command.scope],
  );
  if (duplicate.rowCount)
    throw new RequestError(409, "已有同名分類；若已停用，可在設定中恢復。");
  const id = command.categoryId ?? crypto.randomUUID();
  if (command.categoryId) {
    const result = await db.query(
      "update public.categories set name = $3, hidden = $4 where user_id = $1 and id = $2 and scope=$5 returning id, name, hidden, sort_order, scope, icon_key",
      [userId, id, command.name, command.hidden, command.scope],
    );
    if (!result.rowCount) throw new RequestError(404, "找不到分類");
    if (command.scope === "fixed")
      await db.query(
        "update public.recurring_items set category=$3 where user_id=$1 and category_id=$2",
        [userId, id, command.name],
      );
    return result.rows[0];
  }
  const count = await db.query(
    "select count(*)::int as count from public.categories where user_id = $1",
    [userId],
  );
  if (count.rows[0].count >= 200)
    throw new RequestError(400, "最多可建立 200 個分類");
  const result = await db.query(
    `
    insert into public.categories (id, user_id, name, icon_key, sort_order, hidden, scope)
    values ($2, $1, $3, 'tag', (select coalesce(max(sort_order), -1) + 1 from public.categories where user_id = $1 and scope=$5), $4, $5)
    returning id, name, hidden, sort_order, scope, icon_key
  `,
    [userId, id, command.name, command.hidden, command.scope],
  );
  return result.rows[0];
}

export async function reorderCategories(
  db: Db,
  userId: string,
  ids: string[],
  scope = "daily",
): Promise<void> {
  const owned = await db.query(
    "select id from public.categories where user_id = $1 and scope=$2",
    [userId, scope],
  );
  const expected = new Set<string>(owned.rows.map((row) => row.id));
  if (ids.length !== expected.size || ids.some((id) => !expected.has(id)))
    throw new RequestError(409, "分類清單已變更，請重新整理後再排序");
  await db.query(
    `
    update public.categories c set sort_order = ordering.position - 1
    from unnest($2::uuid[]) with ordinality as ordering(id, position)
    where c.user_id = $1 and c.id = ordering.id
  `,
    [userId, ids],
  );
}

export async function expenseCategory(
  db: Db,
  userId: string,
  command: Extract<Command, { type: "RecordExpense" }>,
) {
  if (command.categoryId) {
    const result = await db.query(
      "select id, name from public.categories where user_id = $1 and id = $2 and hidden = false and scope='daily'",
      [userId, command.categoryId],
    );
    if (!result.rowCount)
      throw new RequestError(400, "分類已停用或不存在，請重新選擇");
    return result.rows[0] as { id: string; name: string };
  }
  if (!command.category) return null;
  const found = await db.query(
    "select id, name, hidden from public.categories where user_id = $1 and lower(btrim(name)) = lower($2) and scope='daily'",
    [userId, command.category],
  );
  if (found.rowCount) {
    if (found.rows[0].hidden)
      throw new RequestError(400, "分類已停用，請選擇其他分類");
    return found.rows[0] as { id: string; name: string };
  }
  return (await saveCategory(db, userId, {
    type: "SaveCategory",
    commandId: command.commandId,
    name: command.category,
    hidden: false,
    scope: "daily",
  })) as { id: string; name: string };
}

export async function expenseSubcategory(
  db: Db,
  userId: string,
  categoryId: string | undefined,
  subcategoryId: string | undefined,
) {
  if (!subcategoryId) return null;
  const found = await db.query(
    "select id,name from public.subcategories where user_id=$1 and category_id=$2 and id=$3 and hidden=false",
    [userId, categoryId, subcategoryId],
  );
  if (!found.rowCount)
    throw new RequestError(400, "細項不屬於所選分類、已隱藏或不存在");
  return found.rows[0] as { id: string; name: string };
}

export async function saveSubcategory(
  db: Db,
  userId: string,
  command: Extract<Command, { type: "SaveSubcategory" }>,
) {
  const parent = await db.query(
    "select id from public.categories where user_id=$1 and id=$2 and scope='daily'",
    [userId, command.categoryId],
  );
  if (!parent.rowCount) throw new RequestError(404, "找不到日常分類");
  const duplicate = await db.query(
    "select id from public.subcategories where user_id=$1 and category_id=$2 and lower(btrim(name))=lower($3) and ($4::uuid is null or id<>$4)",
    [userId, command.categoryId, command.name, command.subcategoryId ?? null],
  );
  if (duplicate.rowCount)
    throw new RequestError(409, "已有同名細項；若已隱藏，可在設定中恢復。");
  if (command.subcategoryId) {
    const result = await db.query(
      "update public.subcategories set name=$4,hidden=$5 where user_id=$1 and category_id=$2 and id=$3 returning *",
      [
        userId,
        command.categoryId,
        command.subcategoryId,
        command.name,
        command.hidden,
      ],
    );
    if (!result.rowCount) throw new RequestError(404, "找不到細項");
    return result.rows[0];
  }
  const count = await db.query(
    "select count(*)::int as count from public.subcategories where user_id=$1 and category_id=$2",
    [userId, command.categoryId],
  );
  if (count.rows[0].count >= 100)
    throw new RequestError(400, "每個分類最多 100 個細項");
  return (
    await db.query(
      `insert into public.subcategories(user_id,category_id,name,hidden,sort_order)
    values($1,$2,$3,$4,(select coalesce(max(sort_order),-1)+1 from public.subcategories where user_id=$1 and category_id=$2)) returning *`,
      [userId, command.categoryId, command.name, command.hidden],
    )
  ).rows[0];
}

export async function reorderSubcategories(
  db: Db,
  userId: string,
  categoryId: string,
  ids: string[],
) {
  const owned = await db.query(
    "select id from public.subcategories where user_id=$1 and category_id=$2",
    [userId, categoryId],
  );
  const expected = new Set(owned.rows.map((row) => row.id));
  if (
    !expected.size ||
    ids.length !== expected.size ||
    ids.some((id) => !expected.has(id))
  )
    throw new RequestError(409, "細項清單已變更，請重新整理後再排序");
  await db.query(
    `update public.subcategories c set sort_order=ordering.position-1 from unnest($3::uuid[]) with ordinality ordering(id,position) where c.user_id=$1 and c.category_id=$2 and c.id=ordering.id`,
    [userId, categoryId, ids],
  );
}

export async function saveFixedIncome(
  db: Db, userId: string, state: BudgetState,
  command: Extract<Command, { type: "SaveFixedIncome" }>,
): Promise<{ state: BudgetState; entries: EventEntry[]; response: Record<string, unknown> }> {
  const found = await db.query(
    "select id,name,amount from public.recurring_items where user_id=$1 and id=$2 and kind='income' and active",
    [userId, command.itemId],
  );
  if (!found.rowCount) throw new RequestError(404, "找不到固定收入");
  const item = found.rows[0];
  const snapshots = await db.query(
    `select i.target_amount,i.income_template_base,i.income_budget_base,c.initial_net_budget
     from public.cycle_items i join public.cycles c on c.user_id=i.user_id and c.id=i.cycle_id
     where i.user_id=$1 and i.cycle_id=$2 and i.recurring_item_id=$3 and i.kind='income'`,
    [userId, state.cycleId, item.id],
  );
  if (!snapshots.rowCount) throw new RequestError(409, "找不到本期收入設定，請重新整理");
  const snapshot = snapshots.rows[0];
  const previousTarget = BigInt(snapshot.target_amount);
  const templateBase = BigInt(snapshot.income_template_base ?? (snapshot.initial_net_budget ? item.amount : snapshot.target_amount));
  const budgetBase = BigInt(snapshot.income_budget_base ?? snapshot.target_amount);
  // Old Workers can still open a cycle during the additive migration rollout.
  // Freeze any missing bases before changing the next-cycle template.
  await db.query(
    `update public.cycle_items set income_template_base=$4,income_budget_base=$5
     where user_id=$1 and cycle_id=$2 and recurring_item_id=$3`,
    [userId, state.cycleId, item.id, templateBase.toString(), budgetBase.toString()],
  );
  await db.query("update public.recurring_items set amount=$3 where user_id=$1 and id=$2", [userId, item.id, command.amount.toString()]);
  const response = { itemId: item.id, amount: command.amount.toString(), previousAmount: item.amount, applied: command.apply };
  if (command.apply === "next_cycle") return { state, entries: [], response };
  const target = fixedIncomeTarget(command.amount, templateBase, budgetBase);
  const cycle = await db.query("select income from public.cycles where user_id=$1 and id=$2", [userId, state.cycleId]);
  const nextIncome = BigInt(cycle.rows[0].income) + target - previousTarget;
  if (nextIncome < 0n || nextIncome > 9_223_372_036_854_775_807n || target > 9_223_372_036_854_775_807n)
    throw new RequestError(400, "本期收入超出可用範圍");
  const result = adjustFixedIncome({ state, previousTarget, target });
  await db.query(
    `update public.cycle_items set target_amount=$4,actual_amount=$4
     where user_id=$1 and cycle_id=$2 and recurring_item_id=$3`,
    [userId, state.cycleId, item.id, target.toString()],
  );
  await db.query(
    `update public.cycles set income=$3,lifestyle_budget=greatest(0,lifestyle_budget::numeric+$4::numeric),
     insufficient_funds=insufficient_funds or $5 where user_id=$1 and id=$2`,
    [userId, state.cycleId, nextIncome.toString(), (target - previousTarget).toString(), result.insufficientFunds],
  );
  return { state: result.state,
    entries: result.events.map(event => ({ cycleId: state.cycleId, recurringItemId: item.id, note: "固定收入調整", event })),
    response: { ...response, difference: (target - previousTarget).toString(), insufficientFunds: result.insufficientFunds },
  };
}

export async function saveFixedExpense(
  db: Db,
  userId: string,
  state: BudgetState,
  command: Extract<Command, { type: "SaveFixedExpense" }>,
): Promise<{
  state: BudgetState;
  entries: EventEntry[];
  response: Record<string, unknown>;
}> {
  const found = command.itemId
    ? await db.query(
        "select id, name, amount, active, category, frequency, due_month from public.recurring_items where user_id = $1 and id = $2 and kind = 'fixed_expense'",
        [userId, command.itemId],
      )
    : null;
  if (command.itemId && !found?.rowCount)
    throw new RequestError(404, "找不到固定支出");
  const old = found?.rows[0];
  let fixedCategoryId: string | null = null;
  if (command.category) {
    const category = await db.query(
      "select id,hidden from public.categories where user_id=$1 and scope='fixed' and lower(btrim(name))=lower($2)",
      [userId, command.category],
    );
    if (category.rowCount) {
      if (category.rows[0].hidden && command.category !== old?.category)
        throw new RequestError(400, "固定支出分類已隱藏");
      fixedCategoryId = category.rows[0].id;
    } else
      fixedCategoryId = (
        await saveCategory(db, userId, {
          type: "SaveCategory",
          commandId: command.commandId,
          scope: "fixed",
          name: command.category,
          hidden: false,
        })
      ).id;
  }
  const id = command.itemId ?? crypto.randomUUID();
  const total = await db.query(
    "select count(*)::int as count, coalesce(sum(amount), 0)::text as total from public.recurring_items where user_id = $1 and kind = 'fixed_expense' and active and id <> $2",
    [userId, id],
  );
  if (command.active && total.rows[0].count >= 60)
    throw new RequestError(400, "最多可啟用 60 筆固定支出");
  if (
    BigInt(total.rows[0].total) + (command.active ? command.amount : 0n) >
    9_223_372_036_854_775_807n
  )
    throw new RequestError(400, "固定支出總額超出可用範圍");
  const cycle = await db.query(
    "select initial_net_budget from public.cycles where user_id = $1 and id = $2",
    [userId, state.cycleId],
  );
  const snapshot = await db.query(
    "select target_amount, actual_amount, included_amount from public.cycle_items where user_id = $1 and cycle_id = $2 and recurring_item_id = $3",
    [userId, state.cycleId, id],
  );
  const oldDue =
    old?.active &&
    (old.frequency === "monthly" ||
      annualDueInCycle(state.startDate, state.endDate, old.due_month));
  const included = snapshot.rowCount
    ? BigInt(snapshot.rows[0].included_amount)
    : cycle.rows[0].initial_net_budget && oldDue
      ? BigInt(old.amount)
      : 0n;
  // Capture a missing first-cycle baseline BEFORE changing next-cycle settings.
  if (!old)
    await db.query(
      `
    insert into public.recurring_items (id, user_id, kind, name, amount, category, frequency, due_month, active)
    values ($2, $1, 'fixed_expense', $3, $4, $5, $6, $7, $8)
  `,
      [
        userId,
        id,
        command.name,
        command.amount.toString(),
        command.category ?? null,
        command.frequency,
        command.dueMonth ?? null,
        command.active,
      ],
    );
  await db.query(
    "update public.recurring_items set category_id=$3 where user_id=$1 and id=$2",
    [userId, id, fixedCategoryId],
  );
  if (!snapshot.rowCount)
    await db.query(
      `
    insert into public.cycle_items
      (id, user_id, cycle_id, recurring_item_id, kind, name, target_amount, actual_amount, included_amount, category, frequency, due_month)
    values ($1, $2, $3, $4, 'fixed_expense', $5, 0, 0, $6, $7, $8, $9)
  `,
      [
        crypto.randomUUID(),
        userId,
        state.cycleId,
        id,
        old?.name ?? command.name,
        included.toString(),
        old?.category ?? command.category ?? null,
        old?.frequency ?? command.frequency,
        old?.due_month ?? command.dueMonth ?? null,
      ],
    );
  await db.query(
    `
    update public.recurring_items set name = $3, amount = $4, category = $5, frequency = $6, due_month = $7, active = $8
    where user_id = $1 and id = $2
  `,
    [
      userId,
      id,
      command.name,
      command.amount.toString(),
      command.category ?? null,
      command.frequency,
      command.dueMonth ?? null,
      command.active,
    ],
  );
  if (command.apply === "next_cycle")
    return {
      state,
      entries: [],
      response: { itemId: id, applied: "next_cycle" },
    };
  const due =
    command.active &&
    (command.frequency === "monthly" ||
      annualDueInCycle(state.startDate, state.endDate, command.dueMonth!));
  const target = fixedExpenseTarget(due ? command.amount : 0n, included);
  const previousTarget = snapshot.rowCount
    ? BigInt(snapshot.rows[0].target_amount)
    : 0n;
  const previousFunded = snapshot.rowCount
    ? BigInt(snapshot.rows[0].actual_amount ?? "0")
    : 0n;
  const result = adjustFixedExpense({
    state,
    previousTarget,
    previousFunded,
    target,
  });
  await db.query(
    `
    update public.cycle_items set name = $4, target_amount = $5, actual_amount = $6, category = $7, frequency = $8, due_month = $9
    where user_id = $1 and cycle_id = $2 and recurring_item_id = $3
  `,
    [
      userId,
      state.cycleId,
      id,
      command.name,
      target.toString(),
      result.funded.toString(),
      command.category ?? null,
      command.frequency,
      command.dueMonth ?? null,
    ],
  );
  await db.query(
    `
    update public.cycles set fixed_expense_target = fixed_expense_target + $3::bigint,
      fixed_expense_covered = fixed_expense_covered + $4::bigint,
      insufficient_funds = insufficient_funds or $5
    where user_id = $1 and id = $2
  `,
    [
      userId,
      state.cycleId,
      (target - previousTarget).toString(),
      (result.funded - previousFunded).toString(),
      result.insufficientFunds,
    ],
  );
  return {
    state: result.state,
    entries: result.events.map((event) => ({
      cycleId: state.cycleId,
      recurringItemId: id,
      note: command.name,
      event,
    })),
    response: {
      itemId: id,
      applied: "current_cycle",
      target: target.toString(),
      funded: result.funded.toString(),
      insufficientFunds: result.insufficientFunds,
    },
  };
}
