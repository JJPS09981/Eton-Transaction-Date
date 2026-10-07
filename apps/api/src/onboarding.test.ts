import { describe, expect, it } from "vitest";
import { openCycle } from "@budget/domain";
import { firstCycleRowsFromBudget, rowsForCycle, type RecurringRow } from "./service";

describe("first-cycle setup", () => {
  it("uses the entered net budget now and keeps monthly fixed expenses for future cycles", () => {
    const recurring: RecurringRow[] = [
      { id: "income", kind: "income", name: "月薪", amount: "30000", category: null, frequency: "monthly", due_month: null },
      { id: "utilities", kind: "fixed_expense", name: "水電費", amount: "1200", category: "水電瓦斯", frequency: "monthly", due_month: null },
      { id: "netflix", kind: "fixed_expense", name: "Netflix", amount: "390", category: "影音與音樂", frequency: "monthly", due_month: null },
      { id: "savings", kind: "fixed_savings", name: "固定存款", amount: "0", category: null, frequency: "monthly", due_month: null },
    ];
    const first = firstCycleRowsFromBudget(recurring, 8000n);
    expect(first).toEqual([
      { ...recurring[0], name: "首期可運用預算", amount: "8000" },
      { ...recurring[1], amount: "0" },
      { ...recurring[2], amount: "0" },
      { ...recurring[3], amount: "0" },
    ]);
    expect(recurring[1]!.amount).toBe("1200");
    const opened = openCycle({
      cycleId: "cycle", startDate: "2026-10-07", endDate: "2026-11-09",
      income: BigInt(first[0]!.amount), fixedExpenseTarget: 0n,
      fixedSavingsTarget: 0n, accumulatedSavings: 0n,
    });
    expect(opened.snapshot.lifestyleBudget).toBe(8000n);
    expect(opened.snapshot.fixedExpenseCovered).toBe(0n);
    expect(opened.state.S).toBe(0n);
    const next = openCycle({
      cycleId: "next", startDate: "2026-11-10", endDate: "2026-12-09",
      income: BigInt(recurring[0]!.amount),
      fixedExpenseTarget: BigInt(recurring[1]!.amount) + BigInt(recurring[2]!.amount),
      fixedSavingsTarget: 0n, accumulatedSavings: 0n,
    });
    expect(next.snapshot.fixedExpenseCovered).toBe(1590n);
    expect(next.snapshot.lifestyleBudget).toBe(28410n);
  });

  it("charges annual insurance and cloud subscriptions only in their billing cycle", () => {
    const rows: RecurringRow[] = [
      { id: "income", kind: "income", name: "月薪", amount: "30000", category: null, frequency: "monthly", due_month: null },
      { id: "insurance", kind: "fixed_expense", name: "醫療險", amount: "12000", category: "保險", frequency: "annual", due_month: 12 },
      { id: "cloud", kind: "fixed_expense", name: "iCloud+", amount: "1200", category: "數位服務", frequency: "annual", due_month: 1 },
      { id: "phone", kind: "fixed_expense", name: "手機費", amount: "500", category: "通訊網路", frequency: "monthly", due_month: null },
    ];
    expect(rowsForCycle(rows, "2026-11-10", "2026-12-09").map((row) => row.id)).toEqual(["income", "insurance", "phone"]);
    expect(rowsForCycle(rows, "2026-12-10", "2027-01-09").map((row) => row.id)).toEqual(["income", "cloud", "phone"]);
    expect(rowsForCycle(rows, "2027-01-10", "2027-02-09").map((row) => row.id)).toEqual(["income", "phone"]);
    const due = rowsForCycle(rows, "2026-11-10", "2026-12-09");
    const opened = openCycle({
      cycleId: "annual-due", startDate: "2026-11-10", endDate: "2026-12-09",
      income: 30000n, fixedExpenseTarget: due.filter((row) => row.kind === "fixed_expense").reduce((sum, row) => sum + BigInt(row.amount), 0n),
      fixedSavingsTarget: 0n, accumulatedSavings: 0n,
    });
    expect(opened.snapshot.fixedExpenseTarget).toBe(12500n);
    expect(opened.snapshot.lifestyleBudget).toBe(17500n);
  });
});
