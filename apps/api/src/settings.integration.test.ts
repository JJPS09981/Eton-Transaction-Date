import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connect, type Env } from "./database";
import { parseCommand } from "./contracts";
import { executeCommand, readDashboard, readTransactions } from "./service";
import { readCalendar, readSummary, readRecentDescriptions } from "./reports";
vi.mock("./database", async (original) => ({
  ...(await original<typeof import("./database")>()),
  connect: vi.fn(),
}));
const user = "75a585b7-cf24-4d08-b740-bcc861118c53";
const other = "05bc61f4-2b3f-4d73-8098-2ab3c908b1a5";
const env = {} as Env;
let pg: PGlite;
async function command(
  body: Record<string, unknown>,
  today = "2026-10-07",
  userId = user,
) {
  const raw = { commandId: crypto.randomUUID(), ...body };
  return executeCommand(env, userId, parseCommand(raw), raw, today);
}
async function initialize(userId = user, extra: Record<string, unknown> = {}) {
  return command(
    {
      type: "Initialize",
      cycleStartDay: 10,
      recurringIncome: "30000",
      firstCycleBudget: "8000",
      fixedExpenses: [{ name: "房租", amount: "1000", category: "居家" }],
      ...extra,
    },
    "2026-10-07",
    userId,
  );
}
async function rent() {
  return (
    await pg.query<{ id: string }>(
      "select id from public.recurring_items where user_id = $1 and kind = 'fixed_expense'",
      [user],
    )
  ).rows[0]!.id;
}
beforeAll(async () => {
  pg = await PGlite.create({
    parsers: { [types.INT8]: (value: string) => value },
  });
  await pg.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz);
    create table auth.identities(user_id uuid, provider_id text, provider text, created_at timestamptz);
    create function auth.uid() returns uuid language sql as 'select null::uuid';
  `);
  const directory = resolve(
    import.meta.dirname,
    "../../../supabase/migrations",
  );
  for (const name of (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pg.exec(await readFile(resolve(directory, name), "utf8"));
  const client = {
    async query(sql: string, params?: unknown[]) {
      const result = await pg.query(sql, params);
      return {
        rows: result.rows,
        rowCount: result.rows.length || result.affectedRows,
      };
    },
    async end() {},
  };
  vi.mocked(connect).mockResolvedValue(
    client as Awaited<ReturnType<typeof connect>>,
  );
}, 30000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await pg.exec("truncate public.app_users cascade");
  await pg.query(
    "insert into public.app_users(id, display_name) values ($1, '測試帳號'), ($2, '另一帳號')",
    [user, other],
  );
  await initialize();
});

describe("manual current-cycle budget on isolated PostgreSQL", () => {
  const dashboard = async (today = "2026-10-07") => await readDashboard(env, user, today) as Record<string, any>;
  const adjust = (data: Record<string, any>, target: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: "AdjustCycleBudget", cycleId: data.state.cycleId, expectedVersion: data.state.version, target, ...extra,
  });
  const daily = (data: Record<string, any>) => BigInt(data.state.A) + Object.values(data.state.F).reduce<bigint>((sum, value) => sum + BigInt(value as string), 0n);

  it("adjusts the persisted total only by its difference, preserves expenses and both savings, and retries once", async () => {
    await command({ type: "AdjustSavings", target: "12000" });
    await command({ type: "AddIncome", amount: "900", destination: "pool" });
    await command({ type: "RecordExpense", amount: "150", source: "lifestyle", transactionDate: "2026-10-07" });
    const before = await dashboard();
    const raw = adjust(before, "8101", { commandId: crypto.randomUUID(), note: "校正生活預算" });
    const result = await command(raw);
    expect(result.difference).toBe("101");
    expect(await command(raw)).toEqual(result);
    const after = await dashboard();
    expect(after.cycle).toMatchObject({ lifestyle_budget: "8101", income: "8000" });
    expect(daily(after) - daily(before)).toBe(101n);
    expect(after.state).toMatchObject({ P: before.state.P, S: before.state.S });
    const events = (await pg.query<Record<string, any>>("select bucket,delta,note,reason from public.budget_events where command_id=$1", [raw.commandId])).rows;
    expect(events).toHaveLength(3);
    expect(events.every(event => (event.bucket === "A" || event.bucket === "F") && event.reason === "budget_adjustment" && event.note === "校正生活預算")).toBe(true);
    const reduced = await command(adjust(after, "8040"));
    expect(reduced.difference).toBe("-61");
    const final = await dashboard();
    expect(daily(final)).toBe(7890n);
    expect(final.state).toMatchObject({ P: "900", S: "12000" });
    expect((await readTransactions(env, user, null)).items).toHaveLength(1);
    const unchanged = await command(adjust(final, "8040", { commandId: crypto.randomUUID() }));
    expect(unchanged.difference).toBe("0");
    expect(daily(await dashboard())).toBe(daily(final));
  });

  it("atomically rejects excessive reductions and preserves the target, daily funds, receipts and savings", async () => {
    await command({ type: "RecordExpense", amount: "8000", source: "lifestyle", transactionDate: "2026-10-07" });
    await command({ type: "AdjustSavings", target: "12000" });
    await command({ type: "AddIncome", amount: "900", destination: "pool" });
    const before = await dashboard();
    const raw = adjust(before, "7999", { commandId: crypto.randomUUID() });
    await expect(command(raw)).rejects.toThrow("減額超過");
    const after = await dashboard();
    expect(after.state).toEqual(before.state); expect(after.cycle).toEqual(before.cycle);
    expect((await pg.query("select command_id from public.command_receipts where command_id=$1", [raw.commandId])).rows).toEqual([]);
  });

  it("rejects another account's cycle and a second edit from the same version", async () => {
    await initialize(other);
    const otherData = await readDashboard(env, other, "2026-10-07") as Record<string, any>;
    const before = await dashboard();
    await expect(command(adjust(before, "9000", { cycleId: otherData.state.cycleId }))).rejects.toThrow("本期預算已更新");
    await command(adjust(before, "9000"));
    await expect(command(adjust(before, "10000"))).rejects.toThrow("本期預算已更新");
    expect((await dashboard()).cycle.lifestyle_budget).toBe("9000");
  });

  it("persists exact bigint targets and permits zero when the daily funds cover the reduction", async () => {
    const maximum = "9223372036854775807";
    await command(adjust(await dashboard(), maximum));
    const large = await dashboard();
    expect(large.cycle.lifestyle_budget).toBe(maximum);
    expect(daily(large)).toBe(BigInt(maximum));
    await command(adjust(large, "0"));
    const zero = await dashboard();
    expect(zero.cycle.lifestyle_budget).toBe("0"); expect(daily(zero)).toBe(0n);
    expect(zero.state).toMatchObject({ P: "0", S: "0" });
  });

  it("keeps template adjustments separate, never carries the manual target into the next cycle, and preserves settlement history", async () => {
    await command(adjust(await dashboard(), "9000"));
    const income = (await pg.query<{ id: string }>("select id from public.recurring_items where user_id=$1 and kind='income'", [user])).rows[0]!;
    await command({ type: "SaveFixedIncome", itemId: income.id, amount: "35000", apply: "current_cycle" });
    expect((await dashboard()).cycle.lifestyle_budget).toBe("14000");
    const before = await dashboard();
    expect((await command(adjust(before, "14500"))).difference).toBe("500");
    const stale = adjust(await dashboard(), "15000");
    const next = await dashboard("2026-10-10");
    expect(next.cycle.lifestyle_budget).toBe("34000");
    const settlements = (await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows;
    await expect(command(stale, "2026-10-10")).rejects.toThrow("本期預算已更新");
    expect((await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows).toEqual(settlements);
    expect((await dashboard("2026-10-10")).cycle.lifestyle_budget).toBe("34000");
  });
});
describe("fixed income and starting savings on isolated PostgreSQL", () => {
  async function dashboard(today = "2026-10-07", userId = user) {
    return await readDashboard(env, userId, today) as Record<string, any>;
  }
  async function incomeItem() {
    return (await pg.query<Record<string, any>>("select id,amount from public.recurring_items where user_id=$1 and kind='income'", [user])).rows[0]!;
  }
  const total = (state: Record<string, any>) => BigInt(state.A) + BigInt(state.P) + BigInt(state.S) + Object.values(state.F).reduce<bigint>((sum, value) => sum + BigInt(value as string), 0n);
  it("defaults starting savings to zero and credits an optional opening balance exactly once", async () => {
    expect((await dashboard()).state.S).toBe("0");
    const raw = { commandId: crypto.randomUUID(), type: "Initialize", cycleStartDay: 10, recurringIncome: "30000", firstCycleBudget: "8000", fixedExpenses: [], accumulatedSavings: "12000" };
    const result = await command(raw, "2026-10-07", other);
    expect(await command(raw, "2026-10-07", other)).toEqual(result);
    const data = await dashboard("2026-10-07", other);
    expect(data.state.S).toBe("12000"); expect(total(data.state)).toBe(20000n);
    expect(data.cycle).toMatchObject({ income: "8000", fixed_expense_target: "0", initial_net_budget: true });
    expect(data.savingsEvents).toEqual([expect.objectContaining({ delta: "12000", reason: "opening_balance" })]);
    await expect(command({ ...raw, commandId: crypto.randomUUID() }, "2026-10-07", other)).rejects.toThrow("已完成首次設定");
    expect((await dashboard("2026-10-07", other)).state.S).toBe("12000");
  });
  it("changes the next-cycle income template without changing today's funds", async () => {
    const item = await incomeItem(); const before = await dashboard();
    await command({ type: "SaveFixedIncome", itemId: item.id, amount: "35000" });
    const after = await dashboard();
    expect(after.state).toMatchObject({ A: before.state.A, P: before.state.P, S: before.state.S, F: before.state.F });
    expect(after.cycle.income).toBe("8000"); expect((await incomeItem()).amount).toBe("35000");
    const next = await dashboard("2026-10-10");
    expect(next.cycle).toMatchObject({ income: "35000", fixed_expense_target: "1000", lifestyle_budget: "34000" });
    expect((await pg.query<Record<string, any>>("select income_template_base,income_budget_base from public.cycle_items where cycle_id=$1 and kind='income'", [next.state.cycleId])).rows[0]).toEqual({ income_template_base: "35000", income_budget_base: "35000" });
  });
  it("uses frozen first-cycle bases after a next-cycle edit, records the difference, and retries once", async () => {
    const item = await incomeItem(); const before = await dashboard();
    await command({ type: "SaveFixedIncome", itemId: item.id, amount: "40000" });
    const raw = { commandId: crypto.randomUUID(), type: "SaveFixedIncome", itemId: item.id, amount: "35000", apply: "current_cycle" };
    const result = await command(raw); expect(result.difference).toBe("5000"); expect(await command(raw)).toEqual(result);
    const after = await dashboard();
    expect(after.cycle).toMatchObject({ income: "13000", lifestyle_budget: "13000", fixed_expense_target: "0" });
    expect(after.state).toMatchObject({ A: "4334", P: before.state.P, S: before.state.S, F: { "2026-10-08": "4334", "2026-10-09": "4332" } });
    expect(total(after.state) - total(before.state)).toBe(5000n);
    const events = await pg.query<Record<string, any>>("select sum(delta)::bigint as total from public.budget_events where user_id=$1 and command_id=$2 and reason='fixed_income_adjustment'", [user, raw.commandId]);
    expect(events.rows[0]?.total).toBe("5000");
    expect((await pg.query<Record<string, any>>("select income_template_base,income_budget_base from public.cycle_items where cycle_id=$1 and kind='income'", [after.state.cycleId])).rows[0]).toEqual({ income_template_base: "30000", income_budget_base: "8000" });
    const same = await command({ ...raw, commandId: crypto.randomUUID() }); expect(same.difference).toBe("0");
    expect(total((await dashboard()).state)).toBe(total(after.state));
  });
  it("bounds first-cycle reductions at the net budget and can restore the original monthly amount", async () => {
    const item = await incomeItem();
    const result = await command({ type: "SaveFixedIncome", itemId: item.id, amount: "15000", apply: "current_cycle" });
    expect(result.difference).toBe("-8000"); expect(result.insufficientFunds).toBe(false);
    expect(total((await dashboard()).state)).toBe(0n); expect((await dashboard()).cycle.income).toBe("0");
    await command({ type: "SaveFixedIncome", itemId: item.id, amount: "30000", apply: "current_cycle" });
    const restored = await dashboard(); expect(total(restored.state)).toBe(8000n); expect(restored.cycle.income).toBe("8000");
  });
  it("adjusts an open full cycle while preserving closed cycles, fixed reservations, and settlements", async () => {
    const before = await dashboard("2026-10-10"); const item = await incomeItem();
    const closed = (await pg.query("select * from public.cycles where user_id=$1 and closed_at is not null", [user])).rows;
    const settled = (await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows;
    await command({ type: "SaveFixedIncome", itemId: item.id, amount: "33000", apply: "current_cycle" }, "2026-10-10");
    const after = await dashboard("2026-10-10");
    expect(total(after.state) - total(before.state)).toBe(3000n);
    expect(BigInt(after.state.A) - BigInt(before.state.A)).toBe(97n);
    expect(after.cycle).toMatchObject({ income: "33000", lifestyle_budget: "32000", fixed_expense_covered: before.cycle.fixed_expense_covered, fixed_savings_actual: before.cycle.fixed_savings_actual });
    expect((await pg.query("select * from public.cycles where user_id=$1 and closed_at is not null", [user])).rows).toEqual(closed);
    expect((await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows).toEqual(settled);
  });
  it("allows zero income and caps an immediate decrease after money has been spent", async () => {
    await dashboard("2026-10-10"); const item = await incomeItem();
    await command({ type: "RecordExpense", amount: "9999999999", source: "lifestyle", transactionDate: "2026-10-10" }, "2026-10-10");
    const result = await command({ type: "SaveFixedIncome", itemId: item.id, amount: "0", apply: "current_cycle" }, "2026-10-10");
    expect(result.insufficientFunds).toBe(true); const after = await dashboard("2026-10-10");
    expect(total(after.state)).toBe(0n); expect(after.cycle).toMatchObject({ income: "0", lifestyle_budget: "0" });
  });
  it("rejects another user's income and rolls back out-of-range immediate corrections", async () => {
    await initialize(other); const item = await incomeItem(); const before = await dashboard();
    await expect(command({ type: "SaveFixedIncome", itemId: item.id, amount: "1" }, "2026-10-07", other)).rejects.toThrow("找不到固定收入");
    expect(total((await dashboard()).state)).toBe(total(before.state));
    await pg.query("update public.recurring_items set amount=0 where user_id=$1 and id=$2", [user, item.id]);
    await pg.query("update public.cycle_items set income_template_base=0 where user_id=$1 and recurring_item_id=$2", [user, item.id]);
    const raw = { commandId: crypto.randomUUID(), type: "SaveFixedIncome", itemId: item.id, amount: "9223372036854775807", apply: "current_cycle" };
    await expect(command(raw)).rejects.toThrow("本期收入超出可用範圍");
    expect((await incomeItem()).amount).toBe("0"); expect(total((await dashboard()).state)).toBe(total(before.state));
    expect((await pg.query("select command_id from public.command_receipts where user_id=$1 and command_id=$2", [user, raw.commandId])).rows).toEqual([]);
  });
});

describe("transaction corrections on isolated PostgreSQL", () => {
  async function expense(amount = "150", extra: Record<string, unknown> = {}) {
    return command({ type: "RecordExpense", amount, source: "lifestyle", transactionDate: "2026-10-07", ...extra });
  }
  async function tx(id: unknown) {
    return (await pg.query<Record<string, any>>("select *,transaction_date::text as transaction_date from public.transactions where user_id=$1 and id=$2", [user, id])).rows[0]!;
  }
  async function state(today = "2026-10-07") { return (await readDashboard(env, user, today)).state as Record<string, any>; }
  const total = (value: Record<string, any>) => BigInt(value.A) + BigInt(value.P) + BigInt(value.S) + Object.values(value.F).reduce<bigint>((sum, amount) => sum + BigInt(amount as string), 0n);
  function edit(row: Record<string, any>, changes: Record<string, unknown> = {}) {
    return { type: "UpdateTransaction", transactionId: row.id, expectedRevision: row.revision, kind: row.kind,
      amount: row.amount, transactionDate: row.transaction_date,
      ...(row.kind === "expense" ? { source: row.funding_source, categoryId: row.category_id, subcategoryId: row.subcategory_id,
        description: row.description ?? "" } : { incomeDestination: row.income_destination }), note: row.note ?? "", ...changes };
  }
  it("updates money and metadata atomically and preserves immutable snapshots and application time", async () => {
    const added = await expense(); const old = await tx(added.transactionId); const before = await state();
    const parent = (await pg.query<Record<string, any>>("select id from public.categories where user_id=$1 and name='購物' and scope='daily'", [user])).rows[0]!.id;
    const sub = (await pg.query<Record<string, any>>("select id from public.subcategories where user_id=$1 and category_id=$2 and name='鞋包'", [user, parent])).rows[0]!.id;
    await command(edit(old, { amount: "200", categoryId: parent, subcategoryId: sub, description: "adidas", note: "跑鞋" }));
    const changed = await tx(old.id);
    expect(changed).toMatchObject({ amount: "200", funded_amount: "200", revision: 1, category: "購物", subcategory: "鞋包", description: "adidas", note: "跑鞋" });
    expect(changed.budget_applied_at).toEqual(old.budget_applied_at); expect(total(before) - total(await state())).toBe(50n);
    const audit = (await pg.query<Record<string, any>>("select before_snapshot,after_snapshot from public.transaction_revisions where transaction_id=$1", [old.id])).rows[0]!;
    expect(audit.before_snapshot.amount).toBe(150); expect(audit.after_snapshot.amount).toBe(200);
    expect((await readSummary(env, user)).total).toBe("200");
    expect((await readCalendar(env, user, "2026-10")).days).toMatchObject([{ amount: "200" }]);
  });
  it("preserves hidden historical names and rejects stale revisions and other users without money changes", async () => {
    const parent = (await pg.query<Record<string, any>>("select id from public.categories where user_id=$1 and name='餐飲' and scope='daily'", [user])).rows[0]!.id;
    const sub = (await pg.query<Record<string, any>>("select id from public.subcategories where user_id=$1 and category_id=$2 and name='午餐'", [user, parent])).rows[0]!.id;
    const added = await expense("150", { categoryId: parent, subcategoryId: sub }); const old = await tx(added.transactionId);
    await command({ type: "SaveCategory", categoryId: parent, name: "吃飯", hidden: true });
    await command({ type: "SaveSubcategory", categoryId: parent, subcategoryId: sub, name: "中餐", hidden: true });
    const before = total(await state()); await command(edit(old, { description: "全家" }));
    expect(await tx(old.id)).toMatchObject({ category: "餐飲", subcategory: "午餐", description: "全家", revision: 1 });
    await expect(command(edit(old, { amount: "100" }))).rejects.toThrow("已變更");
    await initialize(other);
    await expect(command(edit(await tx(old.id)), "2026-10-07", other)).rejects.toThrow("找不到這筆交易");
    await expect(command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: 1 }, "2026-10-07", other)).rejects.toThrow("找不到這筆交易");
    await expect(command(edit(await tx(old.id), { transactionDate: "2026-10-08" }))).rejects.toThrow("不可記錄未來日期");
    await expect(command(edit(await tx(old.id), { categoryId: other, subcategoryId: null }))).rejects.toThrow("分類已停用或不存在");
    expect(total(await state())).toBe(before);
  });
  it("caps refunds at actual funding, filters deletion from all reports, and retries deletion exactly once", async () => {
    await pg.query<Record<string, any>>("update public.budget_state set a=500,p=0,s=0 where user_id=$1", [user]);
    await pg.query<Record<string, any>>("delete from public.day_allocations where user_id=$1", [user]);
    const parent = (await pg.query<Record<string, any>>("select id from public.categories where user_id=$1 and name='餐飲' and scope='daily'", [user])).rows[0]!.id;
    const added = await expense("1000", { categoryId: parent, description: "測試商家" }); let old = await tx(added.transactionId);
    expect(old.funded_amount).toBe("500"); await command(edit(old, { amount: "800" })); expect((await state()).P).toBe("0");
    old = await tx(old.id); await command(edit(old, { amount: "400" })); expect(await state()).toMatchObject({ A: "100", P: "0" });
    const body = { commandId: crypto.randomUUID(), type: "DeleteTransaction", transactionId: old.id, expectedRevision: 2 };
    const removed = await command(body); expect(await command(body)).toEqual(removed);
    expect(await state()).toMatchObject({ A: "500", P: "0", insufficientFunds: false });
    expect((await readTransactions(env, user, null)).items).toEqual([]);
    expect((await readDashboard(env, user, "2026-10-07")).transactions).toEqual([]);
    expect((await readSummary(env, user)).total).toBe("0"); expect((await readCalendar(env, user, "2026-10")).days).toEqual([]);
    expect((await readRecentDescriptions(env, user, parent)).items).toEqual([]);
    expect(await tx(old.id)).toMatchObject({ revision: 3, amount: "400" });
    expect((await pg.query<Record<string, any>>("select count(*)::int as count from public.transaction_revisions where transaction_id=$1", [old.id])).rows[0]!.count).toBe(3);
    await expect(command({ ...body, commandId: crypto.randomUUID() })).rejects.toThrow("已變更或刪除"); expect((await state()).A).toBe("500");
  });
  it("corrects closed expenses through current S while preserving every daily settlement", async () => {
    const added = await expense(); const old = await tx(added.transactionId); const before = await state("2026-10-10");
    const settled = (await pg.query<Record<string, any>>("select * from public.day_settlements where user_id=$1 order by date", [user])).rows;
    await command(edit(old, { amount: "200" }), "2026-10-10");
    expect(await state("2026-10-10")).toMatchObject({ A: before.A, P: before.P, F: before.F, S: (BigInt(before.S) - 50n).toString() });
    expect((await pg.query<Record<string, any>>("select * from public.day_settlements where user_id=$1 order by date", [user])).rows).toEqual(settled);
    await command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: 1 }, "2026-10-10");
    expect((await state("2026-10-10")).S).toBe((BigInt(before.S) + 150n).toString());
  });
  it("refunds actual money then reapplies expenses when moving funding source or accounting cycle", async () => {
    await command({ type: "AdjustSavings", target: "1000" });
    const added = await expense(); let old = await tx(added.transactionId); const before = await state();
    await command(edit(old, { source: "savings" }));
    expect(await state()).toMatchObject({ P: before.P, S: "850", A: (BigInt(before.A) + 150n).toString() });
    await state("2026-10-10");
    const fresh = await command({ type: "RecordExpense", amount: "100", source: "lifestyle", transactionDate: "2026-10-10" }, "2026-10-10");
    old = await tx(fresh.transactionId); const cycleBefore = await state("2026-10-10");
    await command(edit(old, { transactionDate: "2026-10-07" }), "2026-10-10");
    const moved = await tx(old.id); expect(moved.cycle_id).not.toBe(old.cycle_id); expect(moved.funding_source).toBe("savings");
    expect(await state("2026-10-10")).toMatchObject({ A: (BigInt(cycleBefore.A) + 100n).toString(), P: cycleBefore.P, S: (BigInt(cycleBefore.S) - 100n).toString() });
  });
  it("refunds older open-cycle transactions into P and keeps settled days unchanged", async () => {
    const added = await expense(); let old = await tx(added.transactionId);
    const before = await state("2026-10-08");
    const settlements = (await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows;
    await command(edit(old, { amount: "100" }), "2026-10-08");
    expect(await state("2026-10-08")).toMatchObject({ A: before.A, F: before.F, P: (BigInt(before.P) + 50n).toString(), S: before.S });
    old = await tx(old.id);
    await command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: old.revision }, "2026-10-08");
    expect(await state("2026-10-08")).toMatchObject({ A: before.A, F: before.F, P: (BigInt(before.P) + 150n).toString(), S: before.S });
    expect((await pg.query("select * from public.day_settlements where user_id=$1 order by date", [user])).rows).toEqual(settlements);
  });
  it("refunds today's savings expense only to S and returns today's lifestyle money to the displayed daily amount", async () => {
    const original = await state();
    const added = await expense("150"); let old = await tx(added.transactionId);
    expect((await state()).A).toBe((BigInt(original.A) - 150n).toString());
    await command(edit(old, { amount: "100" }));
    expect(await state()).toMatchObject({ A: (BigInt(original.A) - 100n).toString(), P: original.P, F: original.F, S: original.S });
    old = await tx(old.id); await command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: old.revision });
    expect(await state()).toMatchObject({ A: original.A, P: original.P, F: original.F, S: original.S });
    await command({ type: "AdjustSavings", target: "1000" });
    const savings = await expense("150", { source: "savings" }); old = await tx(savings.transactionId);
    await command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: old.revision });
    expect(await state()).toMatchObject({ A: original.A, P: original.P, F: original.F, S: "1000" });
  });
  it("edits and deletes income, conserves destination transfers and credits historical differences only to S", async () => {
    const added = await command({ type: "AddIncome", amount: "1000", destination: "pool", note: "加班" }); let old = await tx(added.transactionId);
    expect(old.income_destination).toBe("pool"); await command(edit(old, { amount: "600", note: "更正" })); expect((await state()).P).toBe("600");
    old = await tx(old.id); const before = total(await state()); await command(edit(old, { incomeDestination: "lifestyle" }));
    expect((await state()).P).toBe("0"); expect(total(await state())).toBe(before);
    old = await tx(old.id); await command({ type: "DeleteTransaction", transactionId: old.id, expectedRevision: old.revision });
    expect(total(await state())).toBe(8000n);
    const history = await command({ type: "AddIncome", amount: "100", destination: "pool" }); old = await tx(history.transactionId);
    const future = await state("2026-10-10"); await command(edit(old, { amount: "150" }), "2026-10-10");
    expect((await state("2026-10-10")).S).toBe((BigInt(future.S) + 50n).toString());
    expect((await readTransactions(env, user, null, { kind: "income" })).items).toEqual([expect.objectContaining({ id: old.id, amount: "150", note: null })]);
    expect((await readTransactions(env, user, null)).items).toEqual([]);
  });
  it("edits one installment and cancels only future pending installments when explicitly requested", async () => {
    const added = await expense("10000", { paymentType: "installment", installmentCount: 3 }); const old = await tx(added.transactionId);
    await command(edit(old, { amount: "3000", description: "單期更正" }));
    expect((await pg.query<Record<string, any>>("select amount from public.installment_dues where plan_id=$1 order by installment_no", [added.planId])).rows).toEqual([{ amount: "3000" }, { amount: "3333" }, { amount: "3333" }]);
    const raw = { commandId: crypto.randomUUID(), type: "DeleteTransaction", transactionId: old.id, expectedRevision: 1, cancelPendingInstallments: true };
    const removed = await command(raw); expect(removed.canceledInstallments).toBe(2); expect(await command(raw)).toEqual(removed);
    expect((await pg.query<Record<string, any>>("select status from public.installment_dues where plan_id=$1", [added.planId])).rows.every(row => row.status === "canceled")).toBe(true);
    expect((await readDashboard(env, user, "2026-10-10")).cycle).toMatchObject({ fixed_expense_target: "1000" });
    expect((await readTransactions(env, user, null)).items).toEqual([]);
  });
  it("deletes one posted installment without canceling others or posting deleted installments twice", async () => {
    const added = await expense("10000", { paymentType: "installment", installmentCount: 3 });
    await command({ type: "DeleteTransaction", transactionId: added.transactionId, expectedRevision: 0 });
    await state("2026-10-10");
    const second = (await pg.query<Record<string, any>>("select id from public.transactions where user_id=$1 and installment_plan_id=$2 and installment_no=2", [user, added.planId])).rows[0]!.id;
    await command({ type: "DeleteTransaction", transactionId: second, expectedRevision: 0 }, "2026-10-10");
    await state("2026-11-10"); const remaining = (await readTransactions(env, user, null)).items;
    expect(remaining).toEqual([expect.objectContaining({ installment_no: 3, amount: "3333" })]);
    expect((await pg.query<Record<string, any>>("select count(*)::int as count from public.transactions where installment_plan_id=$1", [added.planId])).rows[0]!.count).toBe(3);
  });
  it("canceling pending installments preserves other already-posted transactions and cycle reservations", async () => {
    const added = await expense("10000", { paymentType: "installment", installmentCount: 3 });
    await state("2026-10-10");
    const posted = (await readTransactions(env, user, null)).items;
    const raw = { type: "DeleteTransaction", transactionId: added.transactionId, expectedRevision: 0, cancelPendingInstallments: true };
    const result = await command(raw, "2026-10-10"); expect(result.canceledInstallments).toBe(1);
    const second = (await readTransactions(env, user, null)).items;
    expect(second).toEqual([expect.objectContaining({ installment_no: 2, amount: "3333", revision: 0 })]);
    expect((posted as Record<string, unknown>[]).find(row=>row.installment_no===2)).toEqual((second as unknown[])[0]);
    expect((await readDashboard(env, user, "2026-10-10")).cycle).toMatchObject({ fixed_expense_target: "4333" });
    expect((await readDashboard(env, user, "2026-11-10")).cycle).toMatchObject({ fixed_expense_target: "1000" });
  });
});

describe("settings and reports on isolated PostgreSQL", () => {
  async function category(name: string, scope = "daily") {
    return (
      await pg.query<{ id: string }>(
        "select id from public.categories where user_id=$1 and name=$2 and scope=$3",
        [user, name, scope],
      )
    ).rows[0]!.id;
  }
  async function subcategory(parent: string, name: string) {
    return (
      await pg.query<{ id: string }>(
        "select id from public.subcategories where user_id=$1 and category_id=$2 and name=$3",
        [user, parent, name],
      )
    ).rows[0]!.id;
  }
  async function transactions() {
    return (await readTransactions(env, user, null)).items as {
      funded_amount: string;
      [key: string]: unknown;
    }[];
  }
  it("preserves category, subcategory and merchant snapshots while managing both independent category scopes", async () => {
    const food = await category("餐飲");
    const lunch = await subcategory(food, "午餐");
    const before = await readDashboard(env, user, "2026-10-07");
    await command({
      type: "RecordExpense",
      amount: "150",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: food,
      subcategoryId: lunch,
      description: "全家",
      note: "飯糰與咖啡",
    });
    await command({ type: "SaveCategory", categoryId: food, name: "吃飯" });
    await command({
      type: "SaveSubcategory",
      categoryId: food,
      subcategoryId: lunch,
      name: "中餐",
      hidden: true,
    });
    const transaction = (await transactions())[0]!;
    expect(transaction).toMatchObject({
      category: "餐飲",
      subcategory: "午餐",
      description: "全家",
      note: "飯糰與咖啡",
      category_id: food,
      subcategory_id: lunch,
    });
    await expect(
      command({
        type: "RecordExpense",
        amount: "1",
        source: "lifestyle",
        transactionDate: "2026-10-07",
        categoryId: food,
        subcategoryId: lunch,
      }),
    ).rejects.toThrow("細項不屬於");
    await command({
      type: "SaveSubcategory",
      categoryId: food,
      subcategoryId: lunch,
      name: "中餐",
      hidden: false,
    });
    const subs = (
      await pg.query<{ id: string }>(
        "select id from public.subcategories where user_id=$1 and category_id=$2 order by sort_order",
        [user, food],
      )
    ).rows.map((row) => row.id);
    await command({
      type: "ReorderSubcategories",
      categoryId: food,
      subcategoryIds: [...subs].reverse(),
    });
    expect(
      (
        await pg.query<{ id: string }>(
          "select id from public.subcategories where user_id=$1 and category_id=$2 order by sort_order",
          [user, food],
        )
      ).rows[0]!.id,
    ).toBe(subs.at(-1));
    const fixed = (
      await command({ type: "SaveCategory", scope: "fixed", name: "吃飯" })
    ).category as { id: string };
    await expect(
      command({
        type: "RecordExpense",
        amount: "1",
        source: "lifestyle",
        transactionDate: "2026-10-07",
        categoryId: fixed.id,
      }),
    ).rejects.toThrow("分類已停用");
    const traffic = await category("交通");
    await expect(
      command({
        type: "RecordExpense",
        amount: "1",
        source: "lifestyle",
        transactionDate: "2026-10-07",
        categoryId: traffic,
        subcategoryId: lunch,
      }),
    ).rejects.toThrow("細項不屬於");
    const after = await readDashboard(env, user, "2026-10-07");
    expect(
      BigInt((before.state as { A: string }).A) -
        BigInt((after.state as { A: string }).A),
    ).toBe(150n);
    await command({
      type: "RecordExpense",
      amount: "1",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: food,
    });
    expect((await transactions())[0]).toMatchObject({
      subcategory_id: null,
      description: null,
    });
  });
  it("queries recent merchants by category, prefers the selected purpose, deduplicates and isolates users", async () => {
    const food = await category("餐飲");
    const lunch = await subcategory(food, "午餐");
    const dinner = await subcategory(food, "晚餐");
    const shopping = await category("購物");
    for (const item of [
      { description: "全家", subcategoryId: lunch },
      { description: "麥當勞", subcategoryId: dinner },
      { description: "全家", subcategoryId: lunch },
    ])
      await command({
        type: "RecordExpense",
        amount: "1",
        source: "lifestyle",
        transactionDate: "2026-10-07",
        categoryId: food,
        ...item,
      });
    await command({
      type: "RecordExpense",
      amount: "1",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: shopping,
      description: "adidas",
    });
    expect(
      (await readRecentDescriptions(env, user, food, lunch)).items,
    ).toEqual(["全家", "麥當勞"]);
    expect((await readRecentDescriptions(env, user, shopping)).items).toEqual([
      "adidas",
    ]);
    expect((await readRecentDescriptions(env, other, food)).items).toEqual([]);
  });
  it("posts first-remainder installments once, then recognizes future installments through cycle reservation without double deductions", async () => {
    const shopping = await category("購物");
    const shoes = await subcategory(shopping, "鞋包");
    const raw = {
      type: "RecordExpense",
      commandId: crypto.randomUUID(),
      amount: "10000",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: shopping,
      subcategoryId: shoes,
      description: "adidas",
      paymentType: "installment",
      installmentCount: 3,
    };
    const first = await command(raw);
    expect(await command(raw)).toEqual(first);
    expect((await readSummary(env, user)).total).toBe("3334");
    expect(
      (
        await pg.query<{ amount: string }>(
          "select amount from public.installment_dues where user_id=$1 order by installment_no",
          [user],
        )
      ).rows.map((row) => row.amount),
    ).toEqual(["3334", "3333", "3333"]);
    const october = await readDashboard(env, user, "2026-10-10");
    expect(october.cycle).toMatchObject({
      fixed_expense_target: "4333",
      fixed_expense_covered: "4333",
      lifestyle_budget: "25667",
    });
    expect((await readSummary(env, user)).total).toBe("3333");
    const same = await readDashboard(env, user, "2026-10-10");
    expect(same.state).toEqual(october.state);
    const future = (await transactions())[0]!;
    expect(future).toMatchObject({
      subcategory: "鞋包",
      description: "adidas",
      payment_type: "installment",
      installment_no: 2,
      installment_total: "10000",
      transaction_date: "2026-10-10",
    });
    await command(
      {
        type: "SaveSubcategory",
        categoryId: shopping,
        subcategoryId: shoes,
        name: "鞋子",
        hidden: true,
      },
      "2026-10-10",
    );
    const november = await readDashboard(env, user, "2026-11-10");
    expect(november.cycle).toMatchObject({ fixed_expense_target: "4333" });
    expect(
      (
        await pg.query(
          "select sum(amount)::text as total,count(*)::int as count from public.transactions where user_id=$1 and payment_type='installment'",
          [user],
        )
      ).rows[0],
    ).toEqual({ total: "10000", count: 3 });
    expect((await transactions())[0]).toMatchObject({
      subcategory: "鞋包",
      installment_no: 3,
    });
    const after = await readDashboard(env, user, "2026-12-10");
    expect(after.cycle).toMatchObject({ fixed_expense_target: "1000" });
    await expect(
      command({ ...raw, commandId: crypto.randomUUID() }, "2026-12-10"),
    ).rejects.toThrow("分期的帳務日期需在本期");
  });
  it("keeps all buckets nonnegative when installments exceed the cycle's funds", async () => {
    await command({
      type: "RecordExpense",
      amount: "100000",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      paymentType: "installment",
      installmentCount: 2,
    });
    const first = await readDashboard(env, user, "2026-10-07");
    expect(first.state).toMatchObject({
      A: "0",
      P: "0",
      S: "0",
      insufficientFunds: true,
    });
    const future = await readDashboard(env, user, "2026-10-10");
    expect(future.cycle).toMatchObject({
      fixed_expense_target: "51000",
      fixed_expense_covered: "30000",
      lifestyle_budget: "0",
    });
    expect(future.state).toMatchObject({
      A: "0",
      P: "0",
      S: "0",
      insufficientFunds: true,
    });
    expect(
      BigInt((await transactions())[0]!.funded_amount),
    ).toBeLessThanOrEqual(50000n);
  });
  it("summarizes only active fixed expenses due in the calendar month, independently of the income cycle", async () => {
    await initialize(other);
    await command({
      type: "SaveFixedExpense",
      name: "十月年費",
      amount: "1200",
      frequency: "annual",
      dueMonth: 10,
    });
    await command({
      type: "SaveFixedExpense",
      name: "十一月年費",
      amount: "2400",
      frequency: "annual",
      dueMonth: 11,
    });
    await command({
      type: "SaveFixedExpense",
      name: "停用帳單",
      amount: "500",
      active: false,
    });
    await command(
      { type: "SaveFixedExpense", name: "其他帳號帳單", amount: "50000" },
      "2026-10-07",
      other,
    );
    const before = await readDashboard(env, user, "2026-10-07");
    expect(before.fixedExpenseMonth).toEqual({
      month: "2026-10",
      total: "2200",
    });
    const reread = await readDashboard(env, user, "2026-10-07");
    expect(reread.state).toEqual(before.state);
    expect(reread.cycle).toEqual(before.cycle);
    const octoberCycle = await readDashboard(env, user, "2026-10-10");
    expect(octoberCycle.fixedExpenseMonth).toEqual({
      month: "2026-10",
      total: "2200",
    });
    expect(octoberCycle.cycle).toMatchObject({ fixed_expense_target: "3400" });
    const november = await readDashboard(env, user, "2026-11-10");
    expect(november.fixedExpenseMonth).toEqual({
      month: "2026-11",
      total: "3400",
    });
  });
  it("corrects S atomically and retries the same command without duplicating the adjustment", async () => {
    const body = {
      type: "AdjustSavings",
      target: "5000",
      note: "核對餘額",
      commandId: crypto.randomUUID(),
    };
    const before = await readDashboard(env, user, "2026-10-07");
    const result = await command(body);
    expect(await command(body)).toEqual(result);
    const after = await readDashboard(env, user, "2026-10-07");
    expect(after.state).toMatchObject({
      S: "5000",
      A: (before.state as { A: string }).A,
      F: (before.state as { F: unknown }).F,
    });
    expect(after.savingsEvents).toEqual([
      expect.objectContaining({
        delta: "5000",
        reason: "savings_adjustment",
        note: "核對餘額",
      }),
    ]);
  });
  it("preserves the first-cycle baseline across next-cycle edits and only deducts the increase", async () => {
    const id = await rent();
    const before = await readDashboard(env, user, "2026-10-07");
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "1200",
    });
    expect((await readDashboard(env, user, "2026-10-07")).state).toMatchObject({
      A: (before.state as { A: string }).A,
    });
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "1300",
      apply: "current_cycle",
    });
    const after = await readDashboard(env, user, "2026-10-07");
    expect(after.cycle).toMatchObject({
      fixed_expense_target: "300",
      fixed_expense_covered: "300",
    });
    expect((after.state as { A: string }).A).toBe(
      (BigInt((before.state as { A: string }).A) - 300n).toString(),
    );
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "800",
      apply: "current_cycle",
    });
    expect((await readDashboard(env, user, "2026-10-07")).state).toMatchObject({
      P: "300",
    });
  });
  it("compares the full current-cycle snapshot rather than the latest future template", async () => {
    await command({ type: "AdvanceToToday" }, "2026-10-10");
    const before = await readDashboard(env, user, "2026-10-10");
    const id = await rent();
    await command(
      { type: "SaveFixedExpense", itemId: id, name: "房租", amount: "1200" },
      "2026-10-10",
    );
    await command(
      {
        type: "SaveFixedExpense",
        itemId: id,
        name: "房租",
        amount: "1300",
        apply: "current_cycle",
      },
      "2026-10-10",
    );
    const after = await readDashboard(env, user, "2026-10-10");
    expect(after.cycle).toMatchObject({
      fixed_expense_target: "1300",
      fixed_expense_covered: "1300",
    });
    expect((after.state as { A: string }).A).toBe(
      (BigInt((before.state as { A: string }).A) - 300n).toString(),
    );
  });
  it("never refunds an unfunded nominal amount", async () => {
    const id = await rent();
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "10000",
      apply: "current_cycle",
    });
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "9000",
      apply: "current_cycle",
    });
    expect((await readDashboard(env, user, "2026-10-07")).state).toMatchObject({
      A: "0",
      P: "0",
      S: "0",
    });
    await command({
      type: "SaveFixedExpense",
      itemId: id,
      name: "房租",
      amount: "8500",
      apply: "current_cycle",
    });
    expect((await readDashboard(env, user, "2026-10-07")).state).toMatchObject({
      P: "500",
    });
  });
  it("adjusts annual coverage by the month's first day and refunds only the current reservation", async () => {
    await command({ type: "AdvanceToToday" }, "2026-10-10");
    const id = await rent();
    await command(
      {
        type: "SaveFixedExpense",
        itemId: id,
        name: "年繳租金",
        amount: "1200",
        frequency: "annual",
        dueMonth: 11,
        apply: "current_cycle",
      },
      "2026-10-10",
    );
    expect((await readDashboard(env, user, "2026-10-10")).cycle).toMatchObject({
      fixed_expense_target: "1200",
      fixed_expense_covered: "1200",
    });
    await command(
      {
        type: "SaveFixedExpense",
        itemId: id,
        name: "年繳租金",
        amount: "1200",
        frequency: "annual",
        dueMonth: 12,
        apply: "current_cycle",
      },
      "2026-10-10",
    );
    const after = await readDashboard(env, user, "2026-10-10");
    expect(after.cycle).toMatchObject({
      fixed_expense_target: "0",
      fixed_expense_covered: "0",
    });
    expect(after.state).toMatchObject({ P: "1200" });
    await command(
      {
        type: "SaveFixedExpense",
        itemId: id,
        name: "年繳租金",
        amount: "1200",
        frequency: "annual",
        dueMonth: 12,
      },
      "2026-10-10",
    );
    expect((await readDashboard(env, user, "2026-10-10")).state).toEqual(
      after.state && {
        ...(after.state as object),
        version: (after.state as { version: number }).version + 1,
      },
    );
  });
  it("persists each actual day settlement during a multi-day, cross-cycle advance, once", async () => {
    const body = { type: "AdvanceToToday", commandId: crypto.randomUUID() };
    await command(body, "2026-10-10");
    await command(body, "2026-10-10");
    const calendar = await readCalendar(env, user, "2026-10");
    expect(calendar.settlements).toMatchObject([
      { date: "2026-10-07", pool_amount: "1334", carried_amount: "1333" },
      { date: "2026-10-08", pool_amount: "2000", carried_amount: "2000" },
      { date: "2026-10-09", pool_amount: "4666", carried_amount: "0" },
    ]);
    expect(calendar.settlements.length).toBe(3);
    expect(
      (await readTransactions(env, user, null, { date: "2026-10-08" }))
        .settlement,
    ).toMatchObject({ pool_amount: "2000" });
  });
  it("keeps category identity and historical names after rename, hiding and restoration", async () => {
    const category = (
      await pg.query<{ id: string }>(
        "select id from public.categories where user_id = $1 and name = '餐飲'",
        [user],
      )
    ).rows[0]!.id;
    await command({
      type: "RecordExpense",
      amount: "150",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: category,
    });
    await command({
      type: "SaveCategory",
      categoryId: category,
      name: "吃飯",
      hidden: true,
    });
    await expect(
      command({
        type: "RecordExpense",
        amount: "50",
        source: "lifestyle",
        transactionDate: "2026-10-07",
        categoryId: category,
      }),
    ).rejects.toThrow("分類已停用");
    expect((await readTransactions(env, user, null)).items).toMatchObject([
      { category: "餐飲", category_id: category },
    ]);
    expect((await readSummary(env, user)).categories).toMatchObject([
      { key: category, name: "吃飯", amount: "150" },
    ]);
    await command({
      type: "SaveCategory",
      categoryId: category,
      name: "吃飯",
      hidden: false,
    });
    await command({
      type: "RecordExpense",
      amount: "50",
      source: "lifestyle",
      transactionDate: "2026-10-07",
      categoryId: category,
    });
    expect((await readSummary(env, user)).total).toBe("200");
  });
  it("uses the whole cycle for summary and calendar while paginating history without duplicate rows", async () => {
    const dashboard = await readDashboard(env, user, "2026-10-07");
    const cycleId = (dashboard.state as { cycleId: string }).cycleId;
    await pg.query(
      `
      insert into public.transactions(id, user_id, cycle_id, kind, funding_source, amount, funded_amount, transaction_date, created_at)
      select gen_random_uuid(), $1, $2, 'expense', 'lifestyle', 10, 10, '2026-10-07', '2026-10-07T12:00:00.123456Z' from generate_series(1, 35)
    `,
      [user, cycleId],
    );
    const first = await readTransactions(env, user, null);
    const second = await readTransactions(
      env,
      user,
      first.nextCursor as string,
    );
    const firstRows = first.items as { id: string }[];
    const secondRows = second.items as { id: string }[];
    expect(firstRows.length).toBe(30);
    expect(secondRows.length).toBe(5);
    expect(
      new Set([...firstRows, ...secondRows].map((row) => row.id)).size,
    ).toBe(35);
    expect(await readSummary(env, user)).toMatchObject({
      total: "350",
      count: 35,
    });
    expect((await readCalendar(env, user, "2026-10")).days).toMatchObject([
      { amount: "350", count: 35 },
    ]);
    expect(
      (await readTransactions(env, user, null, { date: "2026-10-06" })).items,
    ).toEqual([]);
    expect(
      (
        await readTransactions(env, user, null, {
          cycleId,
          category: "uncategorized",
        })
      ).items,
    ).toHaveLength(30);
  });
  it("rejects cross-account settings writes and category ordering", async () => {
    await initialize(other);
    const foreign = (
      await pg.query<{ id: string }>(
        "select id from public.categories where user_id = $1 limit 1",
        [other],
      )
    ).rows[0]!.id;
    await expect(
      command({ type: "SaveCategory", categoryId: foreign, name: "不允許" }),
    ).rejects.toThrow("找不到分類");
    await expect(
      command({ type: "ReorderCategories", categoryIds: [foreign] }),
    ).rejects.toThrow("分類清單已變更");
    const foreignRent = (
      await pg.query<{ id: string }>(
        "select id from public.recurring_items where user_id = $1 and kind = 'fixed_expense'",
        [other],
      )
    ).rows[0]!.id;
    await expect(
      command({
        type: "SaveFixedExpense",
        itemId: foreignRent,
        name: "不允許",
        amount: "100",
        apply: "current_cycle",
      }),
    ).rejects.toThrow("找不到固定支出");
    expect((await readSummary(env, other)).total).toBe("0");
  });
});
