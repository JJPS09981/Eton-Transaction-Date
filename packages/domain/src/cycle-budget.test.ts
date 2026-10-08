import { describe, expect, it } from "vitest";
import { adjustCycleBudget, assertState, available, type BudgetState } from "./index";

const state = (): BudgetState => ({ cycleId: "cycle", startDate: "2026-10-07", endDate: "2026-10-10", today: "2026-10-07",
  A: 1n, P: 900n, S: 12000n, F: { "2026-10-08": 100n, "2026-10-09": 100n, "2026-10-10": 100n }, version: 1, insufficientFunds: false });

describe("current-cycle budget adjustments", () => {
  it("adds only the difference to today and every future day, preserving previously spent amounts", () => {
    const before = state();
    const result = adjustCycleBudget({ state: before, previousTarget: 1000n, target: 1101n });
    expect(result.state).toMatchObject({ A: 27n, P: before.P, S: before.S,
      F: { "2026-10-08": 125n, "2026-10-09": 125n, "2026-10-10": 125n } });
    expect(available(result.state) - available(before)).toBe(101n);
    expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(101n);
    expect(before).toEqual(state());
  });
  it("caps low daily balances before distributing the remaining reduction without accumulated rounding bias", () => {
    const before = state();
    const result = adjustCycleBudget({ state: before, previousTarget: 1000n, target: 994n });
    expect(result.state).toMatchObject({ A: 0n, P: before.P, S: before.S,
      F: { "2026-10-08": 98n, "2026-10-09": 98n, "2026-10-10": 99n } });
    expect(available(before) - available(result.state)).toBe(6n);
    expect(result.events.every(event => event.delta < 0n && (event.bucket === "A" || event.bucket === "F"))).toBe(true);
  });
  it("rejects reductions beyond daily funds even when either savings bucket could cover them", () => {
    const before = state();
    expect(() => adjustCycleBudget({ state: before, previousTarget: 1000n, target: 698n })).toThrow("remaining daily budget");
    expect(before).toEqual(state());
    const all = adjustCycleBudget({ state: before, previousTarget: 1000n, target: 699n });
    expect(all.state).toMatchObject({ A: 0n, P: before.P, S: before.S });
    expect(Object.values(all.state.F)).toEqual([0n, 0n, 0n]);
  });
  it("handles no-op, zero target, last day, sparse allocations and very large integers", () => {
    expect(adjustCycleBudget({ state: state(), previousTarget: 1000n, target: 1000n }).events).toEqual([]);
    const last = { ...state(), today: "2026-10-10", A: 7n, F: {} };
    expect(adjustCycleBudget({ state: last, previousTarget: 7n, target: 0n }).state.A).toBe(0n);
    const huge = 9_223_372_036_854_775_807n;
    const empty = { ...state(), A: 0n, F: {}, insufficientFunds: true };
    const result = adjustCycleBudget({ state: empty, previousTarget: 0n, target: huge });
    expect(result.state.insufficientFunds).toBe(false);
    expect(available(result.state) - available(empty)).toBe(huge);
    expect(Object.keys(result.state.F)).toHaveLength(3);
    expect(() => adjustCycleBudget({ state: last, previousTarget: 0n, target: -1n })).toThrow();
  });
  it("preserves conservation, nonnegative buckets and daily direction across uneven balances", () => {
    for (let seed = 0; seed < 80; seed++) {
      const before: BudgetState = { ...state(), A: BigInt(seed % 9), F: { "2026-10-08": BigInt(seed % 5), "2026-10-09": BigInt(seed % 17), "2026-10-10": BigInt(seed % 11) } };
      const daily = before.A + Object.values(before.F).reduce((sum, value) => sum + value, 0n);
      const difference = seed % 2 ? -daily / 2n : BigInt(seed);
      const result = adjustCycleBudget({ state: before, previousTarget: 1000n, target: 1000n + difference });
      assertState(result.state);
      expect(available(result.state) - available(before)).toBe(difference);
      expect(result.state.P).toBe(before.P); expect(result.state.S).toBe(before.S);
      const deltas = [result.state.A - before.A, ...Object.keys(before.F).map(date => result.state.F[date]! - before.F[date]!)];
      expect(deltas.every(delta => difference < 0n ? delta <= 0n : delta >= 0n)).toBe(true);
    }
  });
});
