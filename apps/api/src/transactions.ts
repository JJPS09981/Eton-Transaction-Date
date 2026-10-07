import { correctExpense, correctIncome, available, type BudgetState } from "@budget/domain";
import type { Command } from "./contracts";
import type { Db, EventEntry } from "./database";
import { RequestError } from "./errors";
import { expenseCategory, expenseSubcategory } from "./settings";

type Correction = Extract<Command, { type: "UpdateTransaction" | "DeleteTransaction" }>;
export async function correctTransaction(db: Db, userId: string, state: BudgetState, command: Correction, today: string) {
  const found = await db.query(`select t.*,t.transaction_date::text as transaction_date,to_jsonb(t) as snapshot
    from public.transactions t where t.user_id=$1 and t.id=$2 for update`, [userId, command.transactionId]);
  const old = found.rows[0];
  if (!old) throw new RequestError(404, "找不到這筆交易");
  if (old.deleted_at || old.revision !== command.expectedRevision)
    throw new RequestError(409, "這筆交易已變更或刪除，請重新整理後再操作");
  const deleting = command.type === "DeleteTransaction";
  if (!deleting && old.kind !== command.kind) throw new RequestError(400, "不可變更交易類型");
  const date = deleting ? old.transaction_date : command.transactionDate;
  if (date > today) throw new RequestError(400, "不可記錄未來日期交易");
  const cycles = await db.query("select id from public.cycles where user_id=$1 and $2::date between start_date and end_date order by start_date desc limit 1", [userId, date]);
  if (!cycles.rowCount) throw new RequestError(400, "交易日期早於帳本建立日期");
  const cycleId = cycles.rows[0].id as string;
  const oldClosed = old.cycle_id !== state.cycleId;
  const newClosed = cycleId !== state.cycleId;
  const amount = deleting ? 0n : command.amount;
  const reapply = old.cycle_id !== cycleId;
  let funded = BigInt(old.funded_amount);
  let insufficientFunds = false;
  let events: EventEntry["event"][];
  let source = old.funding_source;
  let category = old.category, categoryId = old.category_id;
  let subcategory = old.subcategory, subcategoryId = old.subcategory_id;
  let destination = old.income_destination;
  if (old.kind === "expense") {
    source = deleting ? old.funding_source : newClosed ? "savings" : command.source;
    if (!deleting) {
      const selectedCategory = command.categoryId ?? null;
      const selectedSubcategory = command.subcategoryId ?? null;
      if (selectedCategory !== old.category_id) {
        const selected = await expenseCategory(db, userId, {
          type: "RecordExpense", commandId: command.commandId, amount,
          source, transactionDate: date, paymentType: "immediate", categoryId: selectedCategory ?? undefined,
        });
        categoryId = selected?.id ?? null; category = selected?.name ?? null;
      }
      if (selectedSubcategory !== old.subcategory_id || selectedCategory !== old.category_id) {
        const selected = await expenseSubcategory(db, userId, categoryId ?? undefined, selectedSubcategory ?? undefined);
        subcategoryId = selected?.id ?? null; subcategory = selected?.name ?? null;
      }
      if (old.payment_type === "installment" && amount > BigInt(old.installment_total))
        throw new RequestError(400, "單期金額不可超過原分期總額");
    }
    const result = correctExpense({ state, previousAmount: BigInt(old.amount), previousFunded: funded, amount,
      originalSource: oldClosed ? "savings" : old.funding_source ?? "lifestyle", source: newClosed ? "savings" : source, reapply,
      refundDestination: old.transaction_date === today ? "daily" : "pool" });
    state = result.state; funded = result.fundedAmount; insufficientFunds = result.insufficientFunds; events = result.events;
  } else {
    destination = deleting ? old.income_destination ?? "pool" : command.incomeDestination;
    const result = correctIncome({ state, previousAmount: BigInt(old.amount), amount,
      originalDestination: oldClosed ? "savings" : old.income_destination ?? "pool",
      destination: newClosed ? "savings" : destination, reapply });
    state = result.state; funded = amount; insufficientFunds = result.insufficientFunds; events = result.events;
  }
  let canceledInstallments = 0;
  if (deleting) {
    await db.query("update public.transactions set deleted_at=now(),updated_at=now(),revision=revision+1 where user_id=$1 and id=$2", [userId, old.id]);
    if (old.installment_plan_id) {
      await db.query("update public.installment_dues set status='canceled' where user_id=$1 and transaction_id=$2", [userId, old.id]);
      if (command.cancelPendingInstallments) {
        const canceled = await db.query("update public.installment_dues set status='canceled' where user_id=$1 and plan_id=$2 and status='pending' returning id", [userId, old.installment_plan_id]);
        canceledInstallments = canceled.rowCount ?? 0;
        await db.query("update public.installment_plans set canceled_at=now() where user_id=$1 and id=$2", [userId, old.installment_plan_id]);
      }
    }
  } else {
    await db.query(`update public.transactions set amount=$3,funded_amount=$4,insufficient_funds=$5,cycle_id=$6,transaction_date=$7,
      funding_source=$8,category_id=$9,category=$10,subcategory_id=$11,subcategory=$12,description=$13,note=$14,
      income_destination=$15,updated_at=now(),revision=revision+1 where user_id=$1 and id=$2`,
      [userId, old.id, amount.toString(), funded.toString(), insufficientFunds, cycleId, date, source,
        categoryId, category, subcategoryId, subcategory, command.description?.trim() || null, command.note?.trim() || null, destination]);
    if (old.installment_plan_id) await db.query("update public.installment_dues set amount=$3 where user_id=$1 and transaction_id=$2", [userId, old.id, amount.toString()]);
  }
  await db.query(`insert into public.transaction_revisions(user_id,transaction_id,command_id,action,before_snapshot,after_snapshot)
    select $1,$2,$3,$4,$5::jsonb,to_jsonb(t) from public.transactions t where t.user_id=$1 and t.id=$2`,
    [userId, old.id, command.commandId, deleting ? "delete" : "edit", JSON.stringify(old.snapshot)]);
  if (available(state) > 0n) state.insufficientFunds = false;
  else {
    const shortages = await db.query(`select exists(select 1 from public.transactions where user_id=$1 and cycle_id=$2
      and deleted_at is null and insufficient_funds=true) or exists(select 1 from public.cycles where user_id=$1 and id=$2
      and insufficient_funds=true) as shortage`, [userId, state.cycleId]);
    state.insufficientFunds = shortages.rows[0].shortage;
  }
  return { state, entries: events.map(event => ({ cycleId: state.cycleId, transactionId: old.id, event,
    note: deleting ? "刪除交易" : "編輯交易" })), response: { transactionId: old.id, deleted: deleting,
      revision: old.revision + 1, insufficientFunds, canceledInstallments } };
}
