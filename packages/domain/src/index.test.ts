import { describe, expect, it } from "vitest";
import {
  addIncome,
  allocateFixedSavings,
  annualDueInCycle,
  applyExpense,
  assertState,
  available,
  closeCycle,
  closeDay,
  distribute,
  fundingStatus,
  nextScheduledStart,
  openCycle,
  splitInstallments,
  installmentSchedule,
  startDay,
  type BudgetState,
} from "./index";

const base = (
  S: bigint,
  overrides: Partial<BudgetState> = {},
): BudgetState => ({
  cycleId: "cycle",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  today: "2026-10-01",
  A: 0n,
  P: 0n,
  S,
  F: { "2026-10-02": 0n, "2026-10-03": 0n },
  insufficientFunds: false,
  version: 0,
  ...overrides,
});

describe("nonnegative funding", () => {
  it("uses exactly the remaining savings without insufficient funds", () => {
    const result = applyExpense({
      state: base(500n),
      amount: 500n,
      source: "lifestyle",
    });
    expect(result.state.S).toBe(0n);
    expect(result.fundedAmount).toBe(500n);
    expect(result.insufficientFunds).toBe(false);
  });

  it("keeps a full nominal expense when savings are short", () => {
    const result = applyExpense({
      state: base(500n),
      amount: 800n,
      source: "lifestyle",
    });
    expect(result.state.S).toBe(0n);
    expect(result.nominalAmount).toBe(800n);
    expect(result.fundedAmount).toBe(500n);
    expect(result.insufficientFunds).toBe(true);
    expect(result.state.insufficientFunds).toBe(true);
    assertState(result.state);
  });

  it("uses A then P then future F then S and does not change A for savings payment", () => {
    const initial = base(70n, {
      A: 10n,
      P: 20n,
      F: { "2026-10-02": 30n, "2026-10-03": 40n },
    });
    const ordinary = applyExpense({
      state: initial,
      amount: 120n,
      source: "lifestyle",
    });
    expect(ordinary.fundedAmount).toBe(120n);
    expect(ordinary.state).toMatchObject({ A: 0n, P: 0n, S: 50n });
    expect(Object.values(ordinary.state.F).reduce((a, b) => a + b, 0n)).toBe(
      0n,
    );
    expect(ordinary.events.reduce((a, e) => a + e.delta, 0n)).toBe(-120n);
    const savings = applyExpense({
      state: initial,
      amount: 80n,
      source: "savings",
    });
    expect(savings.state.A).toBe(10n);
    expect(savings.state.P).toBe(20n);
    expect(savings.state.F).toEqual(initial.F);
    expect(savings.state.S).toBe(0n);
    expect(savings.insufficientFunds).toBe(true);
  });

  it("caps every bucket when an ordinary expense exceeds all funds", () => {
    const initial = base(50n, {
      A: 10n,
      P: 20n,
      F: { "2026-10-02": 30n, "2026-10-03": 40n },
    });
    const result = applyExpense({
      state: initial,
      amount: 170n,
      source: "lifestyle",
    });
    expect(result.nominalAmount).toBe(170n);
    expect(result.fundedAmount).toBe(150n);
    expect(available(result.state)).toBe(0n);
    expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(
      -150n,
    );
    expect(fundingStatus(result.state)).toBe("insufficient_funds");
  });

  it("preserves nonnegative buckets and actual event conservation across varied amounts", () => {
    for (let seed = 0; seed < 100; seed++) {
      const initial = base(BigInt((seed * 7) % 43), {
        A: BigInt((seed * 3) % 19),
        P: BigInt((seed * 5) % 29),
        F: {
          "2026-10-02": BigInt((seed * 11) % 31),
          "2026-10-03": BigInt((seed * 13) % 37),
        },
      });
      const amount = BigInt(((seed * 17) % 127) + 1);
      const result = applyExpense({
        state: initial,
        amount,
        source: seed % 3 === 0 ? "savings" : "lifestyle",
      });
      assertState(result.state);
      expect(result.fundedAmount).toBe(
        amount < (seed % 3 === 0 ? initial.S : available(initial))
          ? amount
          : seed % 3 === 0
            ? initial.S
            : available(initial),
      );
      expect(result.events.reduce((sum, event) => sum + event.delta, 0n)).toBe(
        -result.fundedAmount,
      );
    }
  });
});

describe("cycle opening priority", () => {
  const open = (
    income: bigint,
    fixedExpenseTarget: bigint,
    fixedSavingsTarget: bigint,
    accumulatedSavings: bigint,
  ) =>
    openCycle({
      cycleId: "cycle",
      startDate: "2026-10-01",
      endDate: "2026-10-30",
      income,
      fixedExpenseTarget,
      fixedSavingsTarget,
      accumulatedSavings,
    });

  it("reduces fixed savings only in this cycle when income is short", () => {
    const result = open(30_000n, 20_000n, 15_000n, 0n);
    expect(result.snapshot).toMatchObject({
      fixedExpenseCovered: 20_000n,
      fixedSavingsTarget: 15_000n,
      fixedSavingsActual: 10_000n,
      lifestyleBudget: 0n,
    });
    expect(result.state.S).toBe(10_000n);
  });

  it("uses existing savings for the fixed expense gap", () => {
    const result = open(15_000n, 20_000n, 5_000n, 10_000n);
    expect(result.snapshot.fixedSavingsActual).toBe(0n);
    expect(result.snapshot.lifestyleBudget).toBe(0n);
    expect(result.snapshot.fixedExpenseCovered).toBe(20_000n);
    expect(result.state.S).toBe(5_000n);
    expect(result.state.insufficientFunds).toBe(false);
  });

  it("caps savings at zero when fixed expenses still cannot be covered", () => {
    const result = open(15_000n, 30_000n, 5_000n, 5_000n);
    expect(result.snapshot.fixedSavingsActual).toBe(0n);
    expect(result.snapshot.fixedExpenseCovered).toBe(20_000n);
    expect(result.state.S).toBe(0n);
    expect(result.state.insufficientFunds).toBe(true);
    assertState(result.state);
  });
});

describe("allocation, settlement and installments", () => {
  it("distributes integer remainders without loss", () => {
    const allocations = distribute(
      30_001n,
      Array.from(
        { length: 30 },
        (_, i) => `2026-04-${String(i + 1).padStart(2, "0")}`,
      ),
    );
    expect(Object.values(allocations)[0]).toBe(1_001n);
    expect(
      Object.values(allocations)
        .slice(1)
        .every((x) => x === 1_000n),
    ).toBe(true);
  });

  it("places the odd yuan in P and closes the cycle only once in persistence", () => {
    const first = closeDay(base(20n, { A: 101n }));
    expect(first.state.P).toBe(51n);
    expect(first.state.F["2026-10-02"]).toBe(50n);
    expect(closeDay(first.state)).toMatchObject({
      state: first.state,
      events: [],
      settlement: { remaining: 0n, toPool: 0n, toTomorrow: 0n },
    });
    const second = startDay(first.state, "2026-10-02");
    expect(second.state.A).toBe(50n);
    const third = startDay(closeDay(second.state).state, "2026-10-03");
    const last = closeDay(third.state);
    const closed = closeCycle(last.state);
    expect(closed.state.P).toBe(0n);
    expect(closed.state.S).toBe(121n);
    expect(available(closed.state)).toBe(121n);
    expect(closeCycle(closed.state)).toEqual({
      state: closed.state,
      events: [],
    });
  });

  it("splits installments with the remainder in the last due", () => {
    expect(splitInstallments(10_000n, 3)).toEqual([3_334n, 3_333n, 3_333n]);
  });

  it("clamps a 31st cycle start in short months", () => {
    expect(nextScheduledStart("2028-01-31", 31)).toBe("2028-02-29");
    expect(nextScheduledStart("2028-02-29", 31)).toBe("2028-03-31");
    expect(nextScheduledStart("2026-12-31", 31)).toBe("2027-01-31");
  });

  it("assigns an annual bill once to the cycle containing the billing month's first day", () => {
    expect(annualDueInCycle("2026-11-10", "2026-12-09", 12)).toBe(true);
    expect(annualDueInCycle("2026-12-10", "2027-01-09", 12)).toBe(false);
    expect(annualDueInCycle("2026-12-10", "2027-01-09", 1)).toBe(true);
    expect(annualDueInCycle("2027-11-10", "2027-12-09", 12)).toBe(true);
    expect(annualDueInCycle("2028-01-31", "2028-02-28", 2)).toBe(true);
    expect(() => annualDueInCycle("2026-01-01", "2026-01-31", 13)).toThrow();
  });

  it("clears the overall shortage flag after new funds arrive", () => {
    const short = applyExpense({
      state: base(0n),
      amount: 1n,
      source: "lifestyle",
    });
    expect(addIncome(short.state, 100n).state.insufficientFunds).toBe(false);
  });

  it("adds lifestyle income without lowering today's existing budget", () => {
    const initial = base(0n, {
      A: 100n,
      F: { "2026-10-02": 0n, "2026-10-03": 0n },
    });
    const result = addIncome(initial, 3n, "lifestyle");
    expect(result.state.A).toBe(101n);
    expect(result.state.F).toEqual({ "2026-10-02": 1n, "2026-10-03": 1n });
  });

  it("keeps named fixed savings targets and allocates only the actual amount", () => {
    expect(
      allocateFixedSavings(5n, [
        { id: "a", amount: 5n },
        { id: "b", amount: 5n },
      ]),
    ).toEqual({ a: 3n, b: 2n });
  });

  it("distinguishes exhausted cycle income from insufficient total funds", () => {
    expect(fundingStatus(base(500n))).toBe("income_overspent");
    expect(fundingStatus(base(0n))).toBe("available");
  });
});

describe("installment scheduling", () => {
  it("puts all remainder in the first installment and preserves the total", () => {
    expect(splitInstallments(11n, 3)).toEqual([5n, 3n, 3n]);
    for (let count = 2; count <= 60; count++) {
      const values = splitInstallments(10_001n, count);
      expect(values.reduce((sum, value) => sum + value, 0n)).toBe(10_001n);
      expect(values.every((value) => value > 0n)).toBe(true);
      expect(new Set(values.slice(1)).size).toBe(1);
    }
  });
  it("schedules each income cycle, including partial first cycles and short months", () => {
    expect(installmentSchedule(10_000n, 3, "2026-10-07", 10)).toEqual([
      { date: "2026-10-07", amount: 3334n },
      { date: "2026-10-10", amount: 3333n },
      { date: "2026-11-10", amount: 3333n },
    ]);
    expect(
      installmentSchedule(100n, 3, "2027-01-31", 31).map((due) => due.date),
    ).toEqual(["2027-01-31", "2027-02-28", "2027-03-31"]);
  });
});
