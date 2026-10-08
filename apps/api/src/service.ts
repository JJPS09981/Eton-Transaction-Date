import {
  allocateFixedSavings,
  annualDueInCycle,
  applyExpense,
  assertState,
  closeCycle,
  closeDay,
  nextScheduledStart,
  openCycle,
  shiftDate,
  startDay,
  addIncome,
  adjustSavings,
  installmentSchedule,
  type BudgetState,
} from "@budget/domain";
import type { Command } from "./contracts";
import { sha256, stableStringify } from "./contracts";
import {
  connect,
  encodeState,
  insertEvents,
  loadState,
  saveState,
  type Db,
  type Env,
  type EventEntry,
} from "./database";
import {
  expenseCategory,
  expenseSubcategory,
  reorderCategories,
  reorderSubcategories,
  saveCategory,
  saveSubcategory,
  saveFixedExpense,
  saveFixedIncome,
  seedCategories,
} from "./settings";
import { dueInstallments, postReservedInstallments } from "./installments";
import { correctTransaction } from "./transactions";
import { saveCycleBudget } from "./cycle-budget";
import { RequestError } from "./errors";
export { RequestError } from "./errors";

export interface RecurringRow {
  id: string;
  kind: "income" | "fixed_expense" | "fixed_savings";
  name: string;
  amount: string;
  category: string | null;
  frequency: "monthly" | "annual";
  due_month: number | null;
}

export function rowsForCycle(
  rows: RecurringRow[],
  startDate: string,
  endDate: string,
): RecurringRow[] {
  return rows.filter(
    (row) =>
      row.frequency === "monthly" ||
      (row.due_month !== null &&
        annualDueInCycle(startDate, endDate, row.due_month)),
  );
}

export function firstCycleRowsFromBudget(
  rows: RecurringRow[],
  budget: bigint,
): RecurringRow[] {
  return rows.map((row) => ({
    ...row,
    name: row.kind === "income" ? "首期可運用預算" : row.name,
    amount: row.kind === "income" ? budget.toString() : "0",
  }));
}

function sumKind(rows: RecurringRow[], kind: RecurringRow["kind"]): bigint {
  return rows
    .filter((row) => row.kind === kind)
    .reduce((sum, row) => sum + BigInt(row.amount), 0n);
}

async function recurringFor(db: Db, userId: string): Promise<RecurringRow[]> {
  const result = await db.query(
    `
    select id, kind, name, amount, category, frequency, due_month from public.recurring_items
    where user_id = $1 and active = true order by kind, id
  `,
    [userId],
  );
  return result.rows as RecurringRow[];
}

async function createCycle(
  db: Db,
  userId: string,
  startDate: string,
  endDate: string,
  accumulatedSavings: bigint,
  rows: RecurringRow[],
  initialRows?: RecurringRow[],
): Promise<ReturnType<typeof openCycle>> {
  rows = rowsForCycle(rows, startDate, endDate);
  const dues = await dueInstallments(db, userId, startDate);
  const opened = openCycle({
    cycleId: crypto.randomUUID(),
    startDate,
    endDate,
    accumulatedSavings,
    income: sumKind(rows, "income"),
    fixedExpenseTarget:
      sumKind(rows, "fixed_expense") +
      dues.reduce((sum, due) => sum + BigInt(due.amount), 0n),
    fixedSavingsTarget: sumKind(rows, "fixed_savings"),
  });
  const snap = opened.snapshot;
  await db.query(
    `
    insert into public.cycles
      (id, user_id, start_date, end_date, income, fixed_expense_target,
       fixed_expense_covered, fixed_savings_target, fixed_savings_actual,
       lifestyle_budget, insufficient_funds, initial_net_budget)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  `,
    [
      opened.state.cycleId,
      userId,
      startDate,
      endDate,
      snap.income.toString(),
      snap.fixedExpenseTarget.toString(),
      snap.fixedExpenseCovered.toString(),
      snap.fixedSavingsTarget.toString(),
      snap.fixedSavingsActual.toString(),
      snap.lifestyleBudget.toString(),
      opened.state.insufficientFunds,
      Boolean(initialRows),
    ],
  );
  const fixedSavingsActuals = allocateFixedSavings(
    snap.fixedSavingsActual,
    rows
      .filter((row) => row.kind === "fixed_savings")
      .map((row) => ({ id: row.id, amount: BigInt(row.amount) })),
  );
  const fixedExpenseActuals = allocateFixedSavings(snap.fixedExpenseCovered, [
    ...rows
      .filter((row) => row.kind === "fixed_expense")
      .map((row) => ({ id: row.id, amount: BigInt(row.amount) })),
    ...dues.map((due) => ({ id: due.id, amount: BigInt(due.amount) })),
  ]);
  for (const item of rows) {
    const actual =
      item.kind === "income"
        ? item.amount
        : item.kind === "fixed_savings"
          ? fixedSavingsActuals[item.id]!.toString()
          : fixedExpenseActuals[item.id]!.toString();
    const included =
      item.kind === "fixed_expense"
        ? (initialRows?.find((row) => row.id === item.id)?.amount ?? "0")
        : "0";
    await db.query(
      `
      insert into public.cycle_items
        (id, user_id, cycle_id, recurring_item_id, kind, name, target_amount, actual_amount, category, frequency, due_month, included_amount, income_template_base, income_budget_base)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `,
      [
        crypto.randomUUID(),
        userId,
        opened.state.cycleId,
        item.id,
        item.kind,
        item.name,
        item.amount,
        actual,
        item.category,
        item.frequency,
        item.due_month,
        included,
        item.kind === "income" ? initialRows?.find(row => row.id === item.id)?.amount ?? item.amount : null,
        item.kind === "income" ? item.amount : null,
      ],
    );
  }
  await postReservedInstallments(
    db,
    userId,
    opened.state.cycleId,
    startDate,
    dues,
    fixedExpenseActuals,
  );
  return opened;
}

async function advance(
  db: Db,
  userId: string,
  stateBefore: BudgetState,
  today: string,
  commandId: string,
): Promise<{ state: BudgetState; entries: EventEntry[] }> {
  let state = stateBefore;
  const entries: EventEntry[] = [];
  if (state.today >= today) return { state, entries };
  const settingsResult = await db.query(
    "select cycle_start_day from public.user_settings where user_id = $1",
    [userId],
  );
  const cycleStartDay = settingsResult.rows[0].cycle_start_day as number;
  const recurring = await recurringFor(db, userId);
  const daySettlements: {
    cycle_id: string;
    date: string;
    remaining_amount: string;
    pool_amount: string;
    carried_amount: string;
  }[] = [];
  const cycleSettlements: string[] = [];
  while (state.today < today) {
    const currentCycle = state.cycleId;
    const closingDate = state.today;
    const day = closeDay(state);
    state = day.state;
    entries.push(
      ...day.events.map((event) => ({ cycleId: currentCycle, event })),
    );
    daySettlements.push({
      cycle_id: currentCycle,
      date: closingDate,
      remaining_amount: day.settlement.remaining.toString(),
      pool_amount: day.settlement.toPool.toString(),
      carried_amount: day.settlement.toTomorrow.toString(),
    });
    if (closingDate === state.endDate) {
      const closed = closeCycle(state);
      state = closed.state;
      entries.push(
        ...closed.events.map((event) => ({ cycleId: currentCycle, event })),
      );
      cycleSettlements.push(currentCycle);
      const startDate = shiftDate(closingDate, 1);
      const endDate = shiftDate(
        nextScheduledStart(startDate, cycleStartDay),
        -1,
      );
      const opened = await createCycle(
        db,
        userId,
        startDate,
        endDate,
        state.S,
        recurring,
      );
      state = { ...opened.state, version: state.version };
      entries.push(
        ...opened.events.map((event) => ({ cycleId: state.cycleId, event })),
      );
    } else {
      const next = startDay(state, shiftDate(closingDate, 1));
      state = next.state;
      entries.push(
        ...next.events.map((event) => ({ cycleId: currentCycle, event })),
      );
    }
  }
  if (daySettlements.length > 0)
    await db.query(
      `
    insert into public.day_settlements (user_id, cycle_id, date, command_id, remaining_amount, pool_amount, carried_amount)
    select $1, day_row.cycle_id, day_row.date, $2, day_row.remaining_amount, day_row.pool_amount, day_row.carried_amount
    from jsonb_to_recordset($3::jsonb) as day_row(cycle_id uuid, date date, remaining_amount bigint, pool_amount bigint, carried_amount bigint)
  `,
      [userId, commandId, JSON.stringify(daySettlements)],
    );
  if (cycleSettlements.length > 0) {
    await db.query(
      `
      insert into public.cycle_settlements (user_id, cycle_id, command_id)
      select $1, x.cycle_id, $2 from unnest($3::uuid[]) as x(cycle_id)
    `,
      [userId, commandId, cycleSettlements],
    );
    await db.query(
      "update public.cycles set closed_at = now() where user_id = $1 and id = any($2::uuid[])",
      [userId, cycleSettlements],
    );
  }
  assertState(state);
  return { state, entries };
}

export async function executeCommand(
  env: Env,
  userId: string,
  command: Command,
  raw: unknown,
  today: string,
): Promise<Record<string, unknown>> {
  const requestHash = await sha256(stableStringify(raw));
  const db = await connect(env);
  try {
    await db.query("begin");
    await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      userId,
    ]);
    const previous = await db.query(
      "select request_hash, response from public.command_receipts where user_id = $1 and command_id = $2",
      [userId, command.commandId],
    );
    if (previous.rowCount) {
      if (previous.rows[0].request_hash !== requestHash)
        throw new RequestError(409, "同一 command_id 對應不同內容");
      await db.query("commit");
      return previous.rows[0].response as Record<string, unknown>;
    }
    await db.query(
      `
      insert into public.command_receipts (user_id, command_id, request_hash, response)
      values ($1, $2, $3, '{}'::jsonb)
    `,
      [userId, command.commandId, requestHash],
    );

    const existing = await loadState(db, userId, true);
    const previousVersion = existing?.version ?? null;
    let state: BudgetState;
    let entries: EventEntry[] = [];
    let response: Record<string, unknown> = {};
    if (command.type === "Initialize") {
      if (existing) throw new RequestError(409, "已完成首次設定");
      await db.query(
        "insert into public.user_settings (user_id, cycle_start_day) values ($1, $2)",
        [userId, command.cycleStartDay],
      );
      await seedCategories(db, userId);
      const templates = [
        {
          kind: "income",
          name: "月薪",
          amount: command.recurringIncome,
          category: null,
          frequency: "monthly",
          dueMonth: null,
        },
        ...command.fixedExpenses.map(
          ({ name, amount, category, frequency, dueMonth }) => ({
            kind: "fixed_expense" as const,
            name,
            amount,
            category: category ?? null,
            frequency,
            dueMonth: dueMonth ?? null,
          }),
        ),
        {
          kind: "fixed_savings",
          name: "固定存款",
          amount: 0n,
          category: null,
          frequency: "monthly",
          dueMonth: null,
        },
      ] as const;
      for (const item of templates) {
        await db.query(
          `
          insert into public.recurring_items (id, user_id, kind, name, amount, category, frequency, due_month)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
          [
            crypto.randomUUID(),
            userId,
            item.kind,
            item.name,
            item.amount.toString(),
            item.category,
            item.frequency,
            item.dueMonth,
          ],
        );
      }
      await db.query(
        `insert into public.categories(id,user_id,name,scope,icon_key,sort_order)
        select gen_random_uuid(),user_id,min(btrim(category)),'fixed','tag',100 from public.recurring_items
        where user_id=$1 and kind='fixed_expense' and category is not null group by user_id,lower(btrim(category))
        on conflict(user_id,scope,lower(btrim(name))) do nothing`,
        [userId],
      );
      await db.query(
        `update public.recurring_items r set category_id=c.id from public.categories c where r.user_id=$1 and r.user_id=c.user_id and c.scope='fixed' and lower(btrim(r.category))=lower(btrim(c.name))`,
        [userId],
      );
      const endDate = shiftDate(
        nextScheduledStart(today, command.cycleStartDay),
        -1,
      );
      const initialRows = await recurringFor(db, userId);
      const firstCycleRows = firstCycleRowsFromBudget(
        initialRows,
        command.firstCycleBudget,
      );
      const opened = await createCycle(
        db,
        userId,
        today,
        endDate,
        command.accumulatedSavings,
        firstCycleRows,
        initialRows,
      );
      state = opened.state;
      if (command.accumulatedSavings > 0n) entries.push({
        cycleId: state.cycleId, note: "首次設定的累積存款",
        event: { bucket: "S", delta: command.accumulatedSavings, reason: "opening_balance" },
      });
      entries.push(
        ...opened.events.map((event) => ({ cycleId: state.cycleId, event })),
      );
      response = {
        cycle: {
          fixedExpenseTarget: opened.snapshot.fixedExpenseTarget.toString(),
          fixedExpenseCovered: opened.snapshot.fixedExpenseCovered.toString(),
          fixedSavingsTarget: opened.snapshot.fixedSavingsTarget.toString(),
          fixedSavingsActual: opened.snapshot.fixedSavingsActual.toString(),
        },
      };
    } else {
      if (!existing) throw new RequestError(409, "請先完成首次設定");
      const advanced = await advance(
        db,
        userId,
        existing,
        today,
        command.commandId,
      );
      state = advanced.state;
      entries = advanced.entries;
      if (command.type === "RecordExpense") {
        if (command.transactionDate > today)
          throw new RequestError(400, "不可記錄未來日期支出");
        const cycleResult = await db.query(
          `
          select id from public.cycles
          where user_id = $1 and $2::date between start_date and end_date
          order by start_date desc limit 1
        `,
          [userId, command.transactionDate],
        );
        if (!cycleResult.rowCount)
          throw new RequestError(400, "交易日期早於帳本建立日期");
        const transactionId = crypto.randomUUID();
        const category = await expenseCategory(db, userId, command);
        const isHistorical = cycleResult.rows[0].id !== state.cycleId;
        if (command.paymentType === "installment" && isHistorical)
          throw new RequestError(400, "分期的帳務日期需在本期內");
        const subcategory = await expenseSubcategory(
          db,
          userId,
          category?.id,
          command.subcategoryId,
        );
        const settings =
          command.paymentType === "installment"
            ? await db.query(
                "select cycle_start_day from public.user_settings where user_id=$1",
                [userId],
              )
            : null;
        const schedule = settings
          ? installmentSchedule(
              command.amount,
              command.installmentCount!,
              state.startDate,
              settings.rows[0].cycle_start_day,
            )
          : null;
        const planId = schedule ? crypto.randomUUID() : null;
        if (planId)
          await db.query(
            `insert into public.installment_plans(id,user_id,start_cycle_id,total_amount,installment_count,category_id,category_snapshot,subcategory_id,subcategory_snapshot,description,note,transaction_date)
          values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [
              planId,
              userId,
              state.cycleId,
              command.amount.toString(),
              command.installmentCount,
              category?.id ?? null,
              category?.name ?? null,
              subcategory?.id ?? null,
              subcategory?.name ?? null,
              command.description || null,
              command.note ?? null,
              command.transactionDate,
            ],
          );
        const result = applyExpense({
          state,
          amount: schedule?.[0]!.amount ?? command.amount,
          source: isHistorical ? "savings" : command.source,
        });
        state = result.state;
        await db.query(
          `
          insert into public.transactions
            (id, user_id, cycle_id, kind, funding_source, amount, funded_amount,
             insufficient_funds, transaction_date, category, note, category_id,subcategory_id,subcategory,description,
             payment_type,installment_plan_id,installment_no,installment_count,installment_total)
          values ($1, $2, $3, 'expense', $4, $5, $6, $7, $8, $9, $10, $11,$12,$13,$14,$15,$16,$17,$18,$19)
        `,
          [
            transactionId,
            userId,
            cycleResult.rows[0].id,
            isHistorical ? "savings" : command.source,
            result.nominalAmount.toString(),
            result.fundedAmount.toString(),
            result.insufficientFunds,
            command.transactionDate,
            category?.name ?? null,
            command.note ?? null,
            category?.id ?? null,
            subcategory?.id ?? null,
            subcategory?.name ?? null,
            command.description || null,
            command.paymentType,
            planId,
            planId ? 1 : null,
            planId ? command.installmentCount : null,
            planId ? command.amount.toString() : null,
          ],
        );
        if (schedule)
          for (const [index, due] of schedule.entries())
            await db.query(
              `insert into public.installment_dues(id,user_id,plan_id,installment_no,due_cycle_start,amount,status,transaction_id,posted_at)
          values($1,$2,$3,$4,$5,$6,$7,$8,case when $8::uuid is not null then now() else null end)`,
              [
                crypto.randomUUID(),
                userId,
                planId,
                index + 1,
                due.date,
                due.amount.toString(),
                index === 0 ? "posted" : "pending",
                index === 0 ? transactionId : null,
              ],
            );
        entries.push(
          ...result.events.map((event) => ({
            cycleId: state.cycleId,
            transactionId,
            event,
          })),
        );
        response = {
          transactionId,
          ...(planId
            ? {
                planId,
                installments: schedule!.map((due) => ({
                  date: due.date,
                  amount: due.amount.toString(),
                })),
              }
            : {}),
          nominalAmount: result.nominalAmount.toString(),
          fundedAmount: result.fundedAmount.toString(),
          insufficientFunds: result.insufficientFunds,
        };
      } else if (command.type === "UpdateTransaction" || command.type === "DeleteTransaction") {
        const result = await correctTransaction(db, userId, state, command, today);
        state = result.state; entries.push(...result.entries); response = result.response;
      } else if (command.type === "AddIncome") {
        const transactionId = crypto.randomUUID();
        const result = addIncome(state, command.amount, command.destination);
        state = result.state;
        await db.query(
          `
          insert into public.transactions
            (id, user_id, cycle_id, kind, amount, funded_amount, transaction_date, note,income_destination)
          values ($1, $2, $3, 'income', $4, $4, $5, $6,$7)
        `,
          [
            transactionId,
            userId,
            state.cycleId,
            command.amount.toString(),
            today,
            command.note ?? null,
            command.destination,
          ],
        );
        entries.push(
          ...result.events.map((event) => ({
            cycleId: state.cycleId,
            transactionId,
            event,
          })),
        );
        response = { transactionId };
      } else if (command.type === "AdjustSavings") {
        const result = adjustSavings(state, command.target);
        state = result.state;
        entries.push(
          ...result.events.map((event) => ({
            cycleId: state.cycleId,
            note: command.note ?? "手動校正累積存款",
            event,
          })),
        );
        response = { target: command.target.toString() };
      } else if (command.type === "AdjustCycleBudget") {
        const result = await saveCycleBudget(db, userId, state, command);
        state = result.state; entries.push(...result.entries); response = result.response;
      } else if (command.type === "SaveFixedIncome") {
        const result = await saveFixedIncome(db, userId, state, command);
        state = result.state; entries.push(...result.entries); response = result.response;
      } else if (command.type === "SaveFixedExpense") {
        const result = await saveFixedExpense(db, userId, state, command);
        state = result.state;
        entries.push(...result.entries);
        response = result.response;
      } else if (command.type === "SaveCategory") {
        response = { category: await saveCategory(db, userId, command) };
      } else if (command.type === "ReorderCategories") {
        await reorderCategories(db, userId, command.categoryIds, command.scope);
      } else if (command.type === "SaveSubcategory") {
        response = { subcategory: await saveSubcategory(db, userId, command) };
      } else if (command.type === "ReorderSubcategories") {
        await reorderSubcategories(
          db,
          userId,
          command.categoryId,
          command.subcategoryIds,
        );
      }
    }
    state.version = (previousVersion ?? 0) + 1;
    await saveState(db, userId, state, previousVersion);
    response.state = encodeState(state);
    await insertEvents(db, userId, command.commandId, entries);
    await db.query(
      "update public.command_receipts set response = $3::jsonb where user_id = $1 and command_id = $2",
      [userId, command.commandId, JSON.stringify(response)],
    );
    await db.query("commit");
    return response;
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

export async function readDashboard(
  env: Env,
  userId: string,
  today: string,
): Promise<Record<string, unknown>> {
  const initialDb = await connect(env);
  let before: BudgetState | null;
  try {
    before = await loadState(initialDb, userId);
  } finally {
    await initialDb.end();
  }
  if (!before) return { initialized: false, today };
  if (before.today < today) {
    const command = {
      type: "AdvanceToToday" as const,
      commandId: crypto.randomUUID(),
    };
    await executeCommand(env, userId, command, command, today);
  }
  const db = await connect(env);
  try {
    await db.query("begin isolation level repeatable read read only");
    const state = await loadState(db, userId);
    if (!state) {
      await db.query("commit");
      return { initialized: false, today };
    }
    const cycle = await db.query(
      `
      select income, fixed_expense_target, fixed_expense_covered,
             fixed_savings_target, fixed_savings_actual, lifestyle_budget, initial_net_budget
      from public.cycles where user_id = $1 and id = $2
    `,
      [userId, state.cycleId],
    );
    const transactions = await db.query(
      `
      select id, kind, funding_source, amount, funded_amount, insufficient_funds,
             transaction_date::text as transaction_date, category,category_id,subcategory_id,subcategory,description,payment_type,installment_no,installment_count,installment_total, note,
             budget_applied_at,revision,income_destination,cycle_id
      from public.transactions where user_id = $1 and transaction_date = $2::date and deleted_at is null
      order by created_at desc, id desc
    `,
      [userId, today],
    );
    const recurring = await db.query<RecurringRow & { active: boolean }>(
      `
      select id, kind, name, amount, category, frequency, due_month, active from public.recurring_items
      where user_id = $1 order by kind, active desc, name
    `,
      [userId],
    );
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthEnd = shiftDate(nextScheduledStart(monthStart, 1), -1);
    const fixedExpenseMonth = {
      month: today.slice(0, 7),
      total: sumKind(
        rowsForCycle(
          recurring.rows.filter((item) => item.active),
          monthStart,
          monthEnd,
        ),
        "fixed_expense",
      ).toString(),
    };
    const savingsEvents = await db.query(
      `
      select id::text, delta, reason, applied_at, note from public.budget_events
      where user_id = $1 and bucket = 'S'
      order by applied_at desc, id desc limit 20
    `,
      [userId],
    );
    const categories = await db.query(
      "select id, name, icon_key, sort_order, hidden,scope from public.categories where user_id = $1 order by sort_order, created_at, id",
      [userId],
    );
    const subcategories = await db.query(
      "select id,category_id,name,sort_order,hidden from public.subcategories where user_id=$1 order by sort_order,created_at,id",
      [userId],
    );
    const settings = await db.query(
      "select cycle_start_day from public.user_settings where user_id = $1",
      [userId],
    );
    const account = await db.query(
      "select email, display_name from public.app_users where id = $1",
      [userId],
    );
    const cycleItems = await db.query(
      "select recurring_item_id, target_amount, actual_amount, included_amount from public.cycle_items where user_id = $1 and cycle_id = $2 and kind = 'fixed_expense'",
      [userId, state.cycleId],
    );
    await db.query("commit");
    return {
      initialized: true,
      today,
      state: encodeState(state),
      cycle: cycle.rows[0],
      transactions: transactions.rows,
      recurring: recurring.rows,
      fixedExpenseMonth,
      savingsEvents: savingsEvents.rows,
      categories: categories.rows,
      subcategories: subcategories.rows,
      settings: settings.rows[0],
      account: account.rows[0],
      cycleItems: cycleItems.rows,
    };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

const historyPageSize = 30;

function parseHistoryCursor(
  cursor: string | null,
): [string, string, string] | null {
  if (!cursor) return null;
  if (cursor.length > 256) throw new RequestError(400, "帳務分頁參數不正確");
  try {
    const parts: unknown = JSON.parse(cursor);
    if (
      !Array.isArray(parts) ||
      parts.length !== 3 ||
      parts.some((part) => typeof part !== "string")
    )
      throw new Error("invalid cursor");
    const [date, createdAt, id] = parts as [string, string, string];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,6}Z$/.test(createdAt) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      new Date(createdAt).toISOString() !==
        createdAt.replace(/\.(\d{3})\d{0,3}Z$/, ".$1Z") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new Error("invalid cursor");
    return [date, createdAt, id];
  } catch {
    throw new RequestError(400, "帳務分頁參數不正確");
  }
}

export interface HistoryFilter {
  date?: string;
  cycleId?: string;
  category?: string;
  kind?: "expense" | "income";
}
export async function readTransactions(
  env: Env,
  userId: string,
  cursor: string | null,
  filter: HistoryFilter = {},
): Promise<Record<string, unknown>> {
  const after = parseHistoryCursor(cursor);
  const db = await connect(env);
  try {
    const params: unknown[] = [userId, filter.kind ?? "expense"];
    const clauses = ["user_id = $1", "kind = $2", "deleted_at is null"];
    if (filter.date) {
      params.push(filter.date);
      clauses.push(`transaction_date = $${params.length}::date`);
    }
    if (filter.cycleId) {
      params.push(filter.cycleId);
      clauses.push(`cycle_id = $${params.length}::uuid`);
    }
    if (filter.category === "uncategorized")
      clauses.push("category_id is null");
    else if (filter.category) {
      params.push(filter.category);
      clauses.push(`category_id = $${params.length}::uuid`);
    }
    if (after) {
      const offset = params.length;
      params.push(...after);
      clauses.push(
        `(transaction_date, created_at, id) < ($${offset + 1}::date, $${offset + 2}::timestamptz, $${offset + 3}::uuid)`,
      );
    }
    const result = await db.query(
      `
      select id, kind, funding_source, amount, funded_amount, insufficient_funds,
             transaction_date::text as transaction_date, category, category_id, subcategory_id,subcategory,description,payment_type,installment_no,installment_count,installment_total, note,
             budget_applied_at,revision,income_destination,cycle_id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
      from public.transactions
      where ${clauses.join(" and ")}
      order by transaction_date desc, created_at desc, id desc
      limit ${historyPageSize + 1}
    `,
      params,
    );
    const page = result.rows.slice(0, historyPageSize);
    const last = page.at(-1);
    const settlement = filter.date
      ? await db.query(
          "select date::text as date, remaining_amount, pool_amount, carried_amount from public.day_settlements where user_id = $1 and date = $2::date",
          [userId, filter.date],
        )
      : null;
    return {
      items: page,
      settlement: settlement?.rows[0] ?? null,
      nextCursor:
        result.rows.length > historyPageSize && last
          ? JSON.stringify([last.transaction_date, last.created_at, last.id])
          : null,
    };
  } finally {
    await db.end();
  }
}
