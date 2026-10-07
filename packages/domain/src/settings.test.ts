import { describe, expect, it } from "vitest";
import { adjustFixedExpense, adjustFixedIncome, adjustSavings, assertState, available, closeDay, fixedExpenseTarget, fixedIncomeTarget, type BudgetState } from "./index";
const state = (): BudgetState => ({
  cycleId: "cycle", startDate: "2026-10-07", endDate: "2026-10-09", today: "2026-10-07",
  A: 10n, P: 20n, S: 50n, F: { "2026-10-08": 30n, "2026-10-09": 40n }, insufficientFunds: false, version: 1,
});
describe("settings money rules", () => {
  it("keeps first-cycle net income separate from the monthly template and bounds its target at zero", () => {
    expect(fixedIncomeTarget(35000n, 30000n, 8000n)).toBe(13000n);
    expect(fixedIncomeTarget(30000n, 30000n, 8000n)).toBe(8000n);
    expect(fixedIncomeTarget(15000n, 30000n, 8000n)).toBe(0n);
    expect(fixedIncomeTarget(0n, 30000n, 30000n)).toBe(0n);
    expect(() => fixedIncomeTarget(-1n, 30000n, 8000n)).toThrow();
  });
  it("distributes fixed income increases across today and remaining dates without changing P or S", () => {
    const before = state();
    const result = adjustFixedIncome({ state: before, previousTarget: 30000n, target: 30101n });
    expect(result.state).toMatchObject({ A: 44n, P: before.P, S: before.S, F: { "2026-10-08": 64n, "2026-10-09": 73n } });
    expect(available(result.state) - available(before)).toBe(101n);
    expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(101n);
    expect(result.events.every(event => event.reason === "fixed_income_adjustment")).toBe(true);
    expect(before.A).toBe(10n);
  });
  it("deducts fixed income decreases through existing spending rules and caps unavailable funds", () => {
    const before = state();
    const result = adjustFixedIncome({ state: before, previousTarget: 30000n, target: 29900n });
    expect(result.state).toMatchObject({ A: 0n, P: 0n, S: 50n, F: { "2026-10-08": 0n, "2026-10-09": 0n } });
    expect(result.insufficientFunds).toBe(false);
    const insufficient = adjustFixedIncome({ state: before, previousTarget: 30000n, target: 0n });
    expect(available(insufficient.state)).toBe(0n); expect(insufficient.insufficientFunds).toBe(true);
    expect(insufficient.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(-150n);
    assertState(insufficient.state);
    expect(adjustFixedIncome({ state: before, previousTarget: 0n, target: 0n }).events).toEqual([]);
  });
  it("corrects savings without touching the lifestyle budget and traces the actual difference", () => {
    const before = state();
    for (const target of [0n, 50n, 100n]) {
      const result = adjustSavings(before, target);
      expect(result.state).toMatchObject({ A: before.A, P: before.P, F: before.F, S: target });
      expect(available(result.state) - available(before)).toBe(target - before.S);
      expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(target - before.S);
    }
    expect(before.S).toBe(50n);
    expect(() => adjustSavings(before, -1n)).toThrow();
  });
  it("uses A, P, F, S for a fixed expense increase and preserves nonnegative funds", () => {
    const before = state();
    const result = adjustFixedExpense({ state: before, previousTarget: 1000n, previousFunded: 1000n, target: 1120n });
    expect(result.state).toMatchObject({ A: 0n, P: 0n, S: 30n, F: { "2026-10-08": 0n, "2026-10-09": 0n } });
    expect(result.funded).toBe(1120n);
    expect(available(before) - available(result.state)).toBe(120n);
    expect(result.events.every((event) => event.reason === "fixed_expense_adjustment")).toBe(true);
    assertState(result.state);
    expect(before.A).toBe(10n);
  });
  it("caps an underfunded increase, then refunds only prior actual coverage", () => {
    const raised = adjustFixedExpense({ state: state(), previousTarget: 1000n, previousFunded: 500n, target: 2000n });
    expect(raised.funded).toBe(650n);
    expect(raised.insufficientFunds).toBe(true);
    expect(available(raised.state)).toBe(0n);
    const reduced = adjustFixedExpense({ state: raised.state, previousTarget: 2000n, previousFunded: raised.funded, target: 800n });
    expect(reduced.state.P).toBe(0n);
    const refunded = adjustFixedExpense({ state: reduced.state, previousTarget: 800n, previousFunded: reduced.funded, target: 400n });
    expect(refunded.state.P).toBe(250n);
    expect(refunded.funded).toBe(400n);
    expect(refunded.state.A).toBe(0n);
    expect(refunded.state.insufficientFunds).toBe(false);
  });
  it("exempts original first-cycle bills without inventing refunds", () => {
    expect(fixedExpenseTarget(1000n, 1000n)).toBe(0n);
    expect(fixedExpenseTarget(1300n, 1000n)).toBe(300n);
    expect(fixedExpenseTarget(800n, 1000n)).toBe(0n);
    expect(fixedExpenseTarget(1300n)).toBe(1300n);
  });
  it("returns actual daily settlement amounts including odd yuan, zero and cycle-end amounts", () => {
    const before = { ...state(), A: 101n };
    expect(closeDay(before).settlement).toEqual({ date: before.today, remaining: 101n, toPool: 51n, toTomorrow: 50n });
    const last = { ...before, today: before.endDate, F: {} };
    expect(closeDay(last).settlement.toPool).toBe(101n);
    expect(closeDay({ ...before, A: 0n }).settlement.toPool).toBe(0n);
  });
});
