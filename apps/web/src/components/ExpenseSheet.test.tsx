import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpenseSheet } from "./ExpenseSheet";
import { expenseCategoryDefaults } from "@budget/domain";
import { DeleteTransactionSheet } from "./DeleteTransactionSheet";
import { TransactionRows } from "./Dashboard";
import type { TransactionView } from "../lib/api";
const categories = expenseCategoryDefaults.map((item, index) => ({
  id: String(index),
  name: item.name,
  scope: "daily" as const,
  hidden: false,
  sort_order: index,
  icon_key: item.icon,
}));
describe("quick expense initial state", () => {
  const props = {
    kind: "expense" as const,
    today: "2026-10-08",
    currentCycleStart: "2026-10-01",
    categories,
    subcategories: [],
    busy: false,
    onClose: () => {},
    onSubmit: async () => ({}),
  };
  it("keeps fixed and hidden categories out of the expense choices", () => {
    const html = renderToStaticMarkup(
      <ExpenseSheet
        {...props}
        categories={[
          ...categories,
          { ...categories[0]!, id: "fixed", name: "固定專用", scope: "fixed" },
          { ...categories[0]!, id: "hidden", name: "已隱藏", hidden: true },
        ]}
      />,
    );
    expect(html).not.toContain("固定專用");
    expect(html).not.toContain("已隱藏");
    expect((html.match(/class="expense-category"/g) ?? []).length).toBe(7);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('pattern="[0-9]{1,10}"');
    expect(html).toContain('maxLength="10"');
    expect(html).toContain('autofocus=""');
    expect(html).toContain("儲存支出");
  });
  it("keeps secondary settings collapsed and income separate from expense metadata", () => {
    const html = renderToStaticMarkup(<ExpenseSheet {...props} />);
    expect(html).toContain("生活預算 · 立即付款 · 今天");
    expect(html).not.toContain("分期期數");
    expect(html).not.toContain("最近使用");
    const income = renderToStaticMarkup(
      <ExpenseSheet {...props} kind="income" />,
    );
    expect(income).toContain("加入哪裡");
    expect(income).not.toContain("項目／商家");
  });
  it("prefills an installment edit with historical hidden names while preserving its payment mode", () => {
    const transaction: TransactionView = { id: "old", revision: 2, kind: "expense", funding_source: "lifestyle", amount: "3334", funded_amount: "3334",
      insufficient_funds: false, transaction_date: "2026-10-08", category_id: "0", category: "原餐飲", subcategory_id: "sub", subcategory: "原午餐",
      description: "全家", note: "飯糰", budget_applied_at: "2026-10-08T00:00:00Z", payment_type: "installment", installment_no: 1, installment_count: 3 };
    const html = renderToStaticMarkup(<ExpenseSheet {...props} transaction={transaction} categories={categories.map(item => ({ ...item, hidden: true }))}
      subcategories={[{ id: "sub", name: "已改名", category_id: "0", sort_order: 0, hidden: true }]} />);
    expect(html).toContain("編輯支出"); expect(html).toContain('value="3334"'); expect(html).toContain("原餐飲"); expect(html).toContain("原午餐");
    expect(html).toContain('value="全家"'); expect(html).toContain("只編輯這一期"); expect(html).toContain("儲存修改"); expect(html).not.toContain("分期期數");
  });
  it("offers explicit per-row actions and a separate deletion confirmation with optional future cancellation", () => {
    const transaction: TransactionView = { id: "old", kind: "expense", funding_source: "lifestyle", amount: "150", funded_amount: "100", insufficient_funds: true,
      transaction_date: "2026-10-08", category: "餐飲", description: "全家", note: null, budget_applied_at: "2026-10-08T00:00:00Z", payment_type: "installment" };
    const html = renderToStaticMarkup(<TransactionRows rows={[transaction]} onEdit={() => {}} onDelete={() => {}} busy />);
    expect(html).toContain('aria-label="編輯 全家"'); expect(html).toContain('aria-label="刪除 全家"'); expect(html).toContain('disabled=""');
    const confirmation = renderToStaticMarkup(<DeleteTransactionSheet transaction={transaction} busy={false} onClose={() => {}} onSubmit={async () => ({})} />);
    expect(confirmation).toContain("確認刪除"); expect(confirmation).toContain("未扣到的部分不退款"); expect(confirmation).toContain("一併取消尚未入帳");
    expect(confirmation).not.toContain('checked=""');
  });
});
