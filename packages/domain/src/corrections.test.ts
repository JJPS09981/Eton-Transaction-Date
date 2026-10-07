import { describe, expect, it } from "vitest";
import { correctExpense, correctIncome, available, assertState, type BudgetState } from "./index";
const state = (): BudgetState => ({ cycleId: "cycle", startDate: "2026-10-07", endDate: "2026-10-09", today: "2026-10-07",
  A: 10n, P: 20n, S: 50n, F: { "2026-10-08": 30n, "2026-10-09": 40n }, insufficientFunds: false, version: 1 });
const expense = { previousAmount: 1000n, previousFunded: 500n, originalSource: "lifestyle" as const, source: "lifestyle" as const };
describe("transaction correction money rules", () => {
  it("returns today's actual lifestyle refunds to A while preserving future allocations and savings", () => {
    const before = state();
    const reduced = correctExpense({ ...expense, state: before, amount: 800n, refundDestination: "daily" });
    expect(reduced.state).toEqual(before); expect(reduced.events).toEqual([]);
    const refunded = correctExpense({ ...expense, state: before, amount: 400n, refundDestination: "daily" });
    expect(refunded.state).toMatchObject({ A: 110n, P: 20n, F: before.F, S: 50n });
    expect(refunded.events).toEqual([{ bucket: "A", delta: 100n, reason: "transaction_correction" }]);
    const deleted = correctExpense({ ...expense, state: before, amount: 0n, refundDestination: "daily" });
    expect(deleted.state.A).toBe(510n); expect(available(deleted.state) - available(before)).toBe(500n);
    expect(before.A).toBe(10n);
  });
  it("keeps savings refunds in S even for a transaction dated today", () => {
    const before = state();
    const result = correctExpense({ ...expense, state: before, amount: 400n, originalSource: "savings", source: "savings", refundDestination: "daily" });
    expect(result.state).toMatchObject({ A: before.A, P: before.P, F: before.F, S: 150n });
    expect(result.events).toEqual([{ bucket: "S", delta: 100n, reason: "transaction_correction" }]);
  });
  it("refunds only actual deductions rather than the nominal amount", () => {
    const before = state();
    const reduced = correctExpense({ ...expense, state: before, amount: 800n });
    expect(reduced.events).toEqual([]); expect(reduced.fundedAmount).toBe(500n);
    const refunded = correctExpense({ ...expense, state: before, amount: 400n });
    expect(refunded.state.P).toBe(120n); expect(refunded.fundedAmount).toBe(400n);
    const deleted = correctExpense({ ...expense, state: before, amount: 0n });
    expect(available(deleted.state) - available(before)).toBe(500n);
    expect(before.P).toBe(20n);
  });
  it("increases by nominal difference and caps every bucket at zero", () => {
    const result = correctExpense({ ...expense, state: state(), amount: 2000n });
    expect(result.fundedAmount).toBe(650n); expect(result.insufficientFunds).toBe(true);
    expect(available(result.state)).toBe(0n); assertState(result.state);
    expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(-150n);
  });
  it("moves sources by refunding actual money before applying the new full amount", () => {
    const before = state();
    const result = correctExpense({ ...expense, state: before, amount: 1000n, source: "savings" });
    expect(result.state).toMatchObject({ A: 10n, P: 520n, S: 0n, F: before.F });
    expect(result.fundedAmount).toBe(50n); expect(result.insufficientFunds).toBe(true);
    expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(450n);
  });
  it("uses current savings for closed-cycle corrections without replaying daily budgets", () => {
    const before = state();
    const result = correctExpense({ ...expense, state: before, amount: 400n, originalSource: "savings", source: "savings" });
    expect(result.state).toMatchObject({ A: before.A, P: before.P, F: before.F, S: 150n });
    expect(result.events).toEqual([{ bucket: "S", delta: 100n, reason: "transaction_correction" }]);
  });
  it("reduces pool income from P first and never creates money when already spent", () => {
    const before = state();
    const reduced = correctIncome({ state: before, previousAmount: 100n, amount: 90n, originalDestination: "pool", destination: "pool" });
    expect(reduced.state).toMatchObject({ A: 10n, P: 10n, S: 50n, F: before.F });
    const empty = { ...before, A: 0n, P: 0n, S: 0n, F: {} };
    const spent = correctIncome({ state: empty, previousAmount: 100n, amount: 50n, originalDestination: "pool", destination: "pool" });
    expect(available(spent.state)).toBe(0n); expect(spent.insufficientFunds).toBe(true);
    expect(spent.events).toEqual([]);
  });
  it("credits closed income only to S and conserves destination transfers", () => {
    const before = state();
    const result = correctIncome({ state: before, previousAmount: 100n, amount: 150n, originalDestination: "savings", destination: "savings" });
    expect(result.state).toMatchObject({ A: before.A, P: before.P, F: before.F, S: 100n });
    const moved = correctIncome({ state: before, previousAmount: 10n, amount: 10n, originalDestination: "pool", destination: "lifestyle" });
    expect(available(moved.state)).toBe(available(before));
    expect(moved.state.P).toBe(10n); expect(moved.state.A).toBe(14n);
  });
});
