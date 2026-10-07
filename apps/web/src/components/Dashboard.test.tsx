import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DashboardData, TransactionView } from "../lib/api";
import { Dashboard } from "./Dashboard";

const expense: TransactionView = {
  id: "today-expense", kind: "expense", funding_source: "lifestyle", amount: "150", funded_amount: "150",
  insufficient_funds: false, transaction_date: "2026-10-08", category: "餐飲", subcategory: "午餐",
  description: "全家", note: null, budget_applied_at: "2026-10-08T00:00:00Z",
};
const data: DashboardData = {
  initialized: true, today: "2026-10-08",
  state: { cycleId: "cycle", startDate: "2026-10-01", endDate: "2026-10-31", today: "2026-10-08",
    A: "600", P: "700", S: "8500", F: {}, insufficientFunds: false, fundingStatus: "available", version: 1 },
  cycle: { income: "30000", fixed_expense_target: "0", fixed_expense_covered: "0", fixed_savings_target: "0",
    fixed_savings_actual: "0", lifestyle_budget: "30000" },
};
const actions = { onExpense: () => {}, onIncome: () => {}, onViewTransactions: () => {}, onEdit: () => {}, onDelete: () => {} };

describe("today's dashboard", () => {
  it("shows every expense for today, excludes other dates and income, and keeps the extra-income entry", () => {
    const todayExpenses = Array.from({ length: 7 }, (_, index) => ({ ...expense, id: `today-${index}` }));
    const html = renderToStaticMarkup(<Dashboard {...actions} data={{ ...data, transactions: [
      ...todayExpenses,
      { ...expense, id: "yesterday", transaction_date: "2026-10-07", description: "昨日商家" },
      { ...expense, id: "future", transaction_date: "2026-10-09", description: "明日商家" },
      { ...expense, id: "income", kind: "income", funding_source: null, description: "當日收入" },
    ] }} />);
    expect(html).toContain("今日花費");
    expect((html.match(/data-transaction-id=/g) ?? []).length).toBe(7);
    expect(html).not.toContain("昨日商家");
    expect(html).not.toContain("明日商家");
    expect(html).not.toContain("當日收入");
    expect(html).toContain("新增額外收入");
    expect(html).toContain("記一筆支出");
  });

  it("uses the state date when the dashboard date is absent and keeps income accessible on an empty day", () => {
    const html = renderToStaticMarkup(<Dashboard {...actions} data={{ ...data, today: undefined,
      transactions: [{ ...expense, transaction_date: "2026-10-07" }] }} />);
    expect(html).toContain("今天還沒有花費");
    expect(html).not.toContain("data-transaction-id=");
    expect(html).toContain("新增額外收入");
  });
});
