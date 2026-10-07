import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsView } from "./SettingsView";
import { SetupForm } from "./SetupForm";
import type { DashboardData } from "../lib/api";

describe("financial settings and onboarding", () => {
  it("places editable fixed income above fixed expenses and displays the monthly template", () => {
    const data: DashboardData = { initialized: true,
      state: { cycleId: "cycle", startDate: "2026-10-07", endDate: "2026-10-09", today: "2026-10-07", A: "100", P: "0", S: "12000", F: {}, version: 1, insufficientFunds: false, fundingStatus: "available" },
      cycle: { income: "8000", fixed_expense_target: "0", fixed_expense_covered: "0", fixed_savings_target: "0", fixed_savings_actual: "0", lifestyle_budget: "8000" },
      recurring: [{ id: "income", kind: "income", name: "月薪", amount: "30000", active: true, frequency: "monthly", due_month: null, category: null }],
    };
    const html = renderToStaticMarkup(<SettingsView data={data} busy={false} appearance={{ mode: "light", accent: "green" }} onAppearance={() => {}} onSubmit={async () => ({})} onSignOut={() => {}} />);
    expect(html.indexOf("固定收入")).toBeLessThan(html.indexOf("固定支出"));
    expect(html).toContain("NT$ 30,000");
    const row = html.slice(html.indexOf("固定收入") - 120, html.indexOf("固定收入") + 190);
    expect(row).not.toContain('disabled=""');
  });
  it("offers an optional numeric opening savings amount and explains how to avoid counting the budget twice", () => {
    const html = renderToStaticMarkup(<SetupForm today="2026-10-08" busy={false} onSubmit={async () => {}} />);
    expect(html).toContain("每月固定收入"); expect(html).toContain("目前累積存款（選填）");
    expect(html).toContain("生活預算以外");
    const input = html.match(/<input[^>]+placeholder="未填為 0"[^>]*>/)?.[0];
    expect(input).toBeDefined(); expect(input).toContain('inputMode="numeric"'); expect(input).not.toContain("required");
  });
});
