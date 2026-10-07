import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TransactionView } from "../lib/api";
import { TransactionRows } from "./TransactionRows";
import { transactionSwipeAxis, transactionSwipeOffset, transactionSwipeSettlesOpen } from "./transaction-swipe";

const row: TransactionView = {
  id: "expense-1", kind: "expense", funding_source: "lifestyle", amount: "9999999999", funded_amount: "150",
  insufficient_funds: false, transaction_date: "2026-10-08", category_id: "food-id", category: "歷史餐飲名稱",
  subcategory: "午餐", description: "全家", note: "飯糰", budget_applied_at: "2026-10-08T00:00:00Z",
};

describe("transaction swipe rows", () => {
  it("keeps historical names and uses the category association for its icon", () => {
    const html = renderToStaticMarkup(<TransactionRows rows={[row]} categories={[{
      id: "food-id", name: "已改名", hidden: true, sort_order: 0, scope: "daily", icon_key: "food",
    }]} onEdit={() => {}} onDelete={() => {}} />);
    expect(html).toContain("歷史餐飲名稱 · 午餐");
    expect(html).not.toContain("已改名");
    expect(html).toContain("icon-food");
    expect(html).toContain('<time class="transaction-date" dateTime="2026-10-08"');
    expect(html).toContain("10/8");
    expect(html).toContain("週四");
    expect(html).toContain("9,999,999,999");
    expect(html).toContain("全家");
    expect(html).toContain("飯糰");
    expect(html).toContain('<span title="全家 · 飯糰">全家 · 飯糰</span>');
    expect(html).toContain("全家 · 飯糰，支出 NT$");
  });

  it("starts with actions hidden from touch and the tab order, and exposes a keyboard reveal", () => {
    const html = renderToStaticMarkup(<TransactionRows rows={[row]} onEdit={() => {}} onDelete={() => {}} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('class="transaction-actions" aria-hidden="true"');
    expect(html).toContain('class="edit-action" tabindex="-1"');
    expect(html).toContain('class="delete-action" tabindex="-1"');
    expect(html).toContain('aria-label="編輯 全家"');
    expect(html).toContain('aria-label="刪除 全家"');
  });

  it("keeps read-only lists noninteractive, and blocks actions while busy", () => {
    const readOnly = renderToStaticMarkup(<TransactionRows rows={[row]} />);
    expect(readOnly).not.toContain('role="button"');
    expect(readOnly).not.toContain("transaction-actions\"");
    const busy = renderToStaticMarkup(<TransactionRows rows={[row]} onEdit={() => {}} onDelete={() => {}} busy />);
    expect(busy).toContain('aria-disabled="true"');
    expect((busy.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it("announces direction, installment position and insufficient funding when the row has a custom label", () => {
    const installment = renderToStaticMarkup(<TransactionRows rows={[{ ...row, payment_type: "installment", installment_no: 1,
      installment_count: 3, insufficient_funds: true }]} onEdit={() => {}} />);
    expect(installment).toContain("支出 NT$ 9,999,999,999，分期 1／3，資金不足，顯示交易操作");
    const income = renderToStaticMarkup(<TransactionRows rows={[{ ...row, kind: "income", funding_source: null }]} onEdit={() => {}} />);
    expect(income).toContain("收入 NT$ 9,999,999,999，顯示交易操作");
  });

  it("gives vertical and diagonal scrolling priority instead of revealing destructive controls", () => {
    expect(transactionSwipeAxis(-3, 4)).toBe(null);
    expect(transactionSwipeAxis(-9, 10)).toBe("vertical");
    expect(transactionSwipeAxis(-14, 12)).toBe("vertical");
    expect(transactionSwipeAxis(-50, 6)).toBe("horizontal");
  });

  it("reveals only the action tray, never executes a full-swipe deletion, and supports right-swipe closing", () => {
    expect(transactionSwipeOffset(-500, false, 144)).toBe(-144);
    expect(transactionSwipeOffset(50, false, 144)).toBe(0);
    expect(transactionSwipeSettlesOpen(-20, false, 144)).toBe(false);
    expect(transactionSwipeSettlesOpen(-60, false, 144)).toBe(true);
    expect(transactionSwipeSettlesOpen(transactionSwipeOffset(70, true, 144), true, 144)).toBe(false);
    expect(transactionSwipeSettlesOpen(transactionSwipeOffset(20, true, 144), true, 144)).toBe(true);
  });
});
