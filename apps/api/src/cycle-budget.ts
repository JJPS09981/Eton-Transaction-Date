import { adjustCycleBudget, type BudgetState } from "@budget/domain";
import type { Command } from "./contracts";
import type { Db, EventEntry } from "./database";
import { RequestError } from "./errors";

export async function saveCycleBudget(db: Db, userId: string, state: BudgetState,
  command: Extract<Command, { type: "AdjustCycleBudget" }>,
): Promise<{ state: BudgetState; entries: EventEntry[]; response: Record<string, unknown> }> {
  if (state.cycleId !== command.cycleId || state.version !== command.expectedVersion)
    throw new RequestError(409, "本期預算已更新，請關閉視窗、重新整理後再開啟調整。");
  const found = await db.query("select lifestyle_budget from public.cycles where user_id=$1 and id=$2", [userId, state.cycleId]);
  if (!found.rowCount) throw new RequestError(409, "找不到本期預算，請重新整理。");
  const previousTarget = BigInt(found.rows[0].lifestyle_budget);
  let result;
  try { result = adjustCycleBudget({ state, previousTarget, target: command.target }); }
  catch (caught) {
    if (caught instanceof RangeError && caught.message === "budget reduction exceeds remaining daily budget")
      throw new RequestError(400, "減額超過今天與剩餘日期的每日預算，請提高預算總額；存款不會被扣款。");
    throw caught;
  }
  if ([result.state.A, ...Object.values(result.state.F)].some(value => value > 9_223_372_036_854_775_807n))
    throw new RequestError(400, "每日預算超出可用金額範圍。");
  await db.query("update public.cycles set lifestyle_budget=$3 where user_id=$1 and id=$2", [userId, state.cycleId, command.target.toString()]);
  return { state: result.state,
    entries: result.events.map(event => ({ cycleId: state.cycleId, note: command.note ?? "本月可用預算調整", event })),
    response: { target: command.target.toString(), previousTarget: previousTarget.toString(), difference: (command.target - previousTarget).toString() },
  };
}
