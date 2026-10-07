import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import type { Category, TransactionView } from "../lib/api";
import { money, shortDate } from "../lib/api";
import { CategoryIcon } from "./CategoryIcon";
import { transactionSwipeAxis, transactionSwipeOffset, transactionSwipeSettlesOpen } from "./transaction-swipe";
import type { SwipeAxis } from "./transaction-swipe";
import "./transaction-rows.css";

export type TransactionActions = {
  onEdit?: (row: TransactionView) => void;
  onDelete?: (row: TransactionView) => void;
  busy?: boolean;
};

const EMPTY_CATEGORIES: Category[] = [];
const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const CATEGORY_ICONS: Record<string, string> = {
  餐飲: "food", 早餐: "food", 午餐: "food", 晚餐: "food", 飲料: "food",
  交通: "transport", 購物: "shopping", 娛樂: "entertainment", 生活: "living",
  居家: "living", 醫療: "medical", 其他: "other",
};

function TransactionIcon({ icon, income }: { icon: string; income: boolean }) {
  return <span className={`transaction-category-icon icon-${income ? "income" : icon}`}>
    {income ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" /></svg> : <CategoryIcon name={icon} />}
  </span>;
}

type Gesture = { pointerId: number; x: number; y: number; axis: SwipeAxis; initiallyOpen: boolean; offset: number };

function SwipeTransactionRow({ row, icon, open, onReveal, onClose, onEdit, onDelete, busy }: {
  row: TransactionView;
  icon: string;
  open: boolean;
  onReveal: () => void;
  onClose: () => void;
} & TransactionActions) {
  const wrapper = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const actionsId = useId();
  const editable = Boolean(onEdit || onDelete);
  const actionWidth = (Number(Boolean(onEdit)) + Number(Boolean(onDelete))) * 72;
  const name = row.category || (row.kind === "income" ? "額外收入" : "一般支出");
  const label = row.description || row.category || "交易";
  const details = (row.description && row.note ? `${row.description} · ${row.note}` : row.description || row.note) || (row.kind === "income"
    ? row.income_destination === "lifestyle" ? "加入生活預算" : "加入存款池"
    : row.funding_source === "savings" ? "從累積存款支付" : "生活預算");
  const accessibleLabel = `${shortDate(row.transaction_date)} ${name}${row.subcategory ? ` · ${row.subcategory}` : ""}，${details}，${row.kind === "income" ? "收入" : "支出"} ${money(row.amount)}${row.payment_type === "installment" ? `，分期 ${row.installment_no}／${row.installment_count}` : ""}${row.insufficient_funds ? "，資金不足" : ""}`;
  const [, month = "", day = ""] = row.transaction_date.split("-");
  const weekday = WEEKDAYS[new Date(`${row.transaction_date}T12:00:00Z`).getUTCDay()] ?? "";

  function clearDrag() {
    surface.current?.style.removeProperty("transform");
    wrapper.current?.removeAttribute("data-dragging");
    gesture.current = null;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!editable || busy || !event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    gesture.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, axis: null, initiallyOpen: open, offset: open ? -actionWidth : 0 };
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (current.axis === null) {
      current.axis = transactionSwipeAxis(dx, dy);
      if (current.axis === "horizontal") {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        wrapper.current?.setAttribute("data-dragging", "true");
        suppressClick.current = true;
      } else if (current.axis === "vertical") {
        suppressClick.current = true;
        onClose();
      }
    }
    if (current.axis !== "horizontal") return;
    current.offset = transactionSwipeOffset(dx, current.initiallyOpen, actionWidth);
    if (surface.current) surface.current.style.transform = `translateX(${current.offset}px)`;
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.axis === "horizontal") {
      if (transactionSwipeSettlesOpen(current.offset, current.initiallyOpen, actionWidth)) onReveal();
      else onClose();
    }
    clearDrag();
  }

  function pointerCancel() {
    clearDrag();
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (busy) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) onClose(); else onReveal();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      onReveal();
    } else if (event.key === "Escape" || event.key === "ArrowRight") {
      event.preventDefault();
      onClose();
    }
  }

  function clickRow() {
    if (!editable || busy) return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (open) onClose(); else onReveal();
  }

  return <div ref={wrapper} className={`transaction-swipe-row${open ? " is-open" : ""}`} role="listitem" data-transaction-id={row.id}
    onKeyDown={event => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        surface.current?.focus({ preventScroll: true });
        onClose();
      }
    }}
    style={{ "--transaction-actions-width": `${actionWidth}px` } as CSSProperties}>
    <div ref={surface} className="transaction-row" role={editable ? "button" : undefined} tabIndex={editable && !busy ? 0 : undefined}
      aria-label={editable ? `${accessibleLabel}，${open ? "收起" : "顯示"}交易操作` : undefined}
      aria-expanded={editable ? open : undefined} aria-controls={editable ? actionsId : undefined} aria-disabled={editable && busy ? true : undefined}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel}
      onKeyDown={editable ? keyDown : undefined} onClick={clickRow}>
      <time className="transaction-date" dateTime={row.transaction_date} title={shortDate(row.transaction_date)}>
        <span>{Number(month)}/{Number(day)}</span><small>{weekday}</small>
      </time>
      <TransactionIcon icon={icon} income={row.kind === "income"} />
      <div className="transaction-name"><strong title={`${name}${row.subcategory ? ` · ${row.subcategory}` : ""}`}>{name}{row.subcategory ? ` · ${row.subcategory}` : ""}</strong>
        <span title={details}>{details}</span>
        {row.payment_type === "installment" ? <span title={`分期 ${row.installment_no}／${row.installment_count} · 原總額 ${money(row.installment_total ?? undefined)}`}>分期 {row.installment_no}／{row.installment_count}</span> : null}
      </div>
      <div className={`transaction-amount${row.kind === "income" ? " positive" : ""}`}>{row.kind === "income" ? "+" : "−"}{money(row.amount)}{row.insufficient_funds ? <small>資金不足</small> : null}</div>
    </div>
    {editable ? <div id={actionsId} className="transaction-actions" aria-hidden={!open}>
      {onEdit ? <button type="button" className="edit-action" disabled={busy} tabIndex={open ? 0 : -1}
        onClick={() => { surface.current?.focus({ preventScroll: true }); onClose(); onEdit(row); }} aria-label={`編輯 ${label}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg><span>編輯</span>
      </button> : null}
      {onDelete ? <button type="button" className="delete-action" disabled={busy} tabIndex={open ? 0 : -1}
        onClick={() => { surface.current?.focus({ preventScroll: true }); onClose(); onDelete(row); }} aria-label={`刪除 ${label}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg><span>刪除</span>
      </button> : null}
    </div> : null}
  </div>;
}

export function TransactionRows({ rows, categories = EMPTY_CATEGORIES, emptyMessage = "還沒有交易紀錄。", onEdit, onDelete, busy }: {
  rows: TransactionView[];
  categories?: Category[];
  emptyMessage?: string;
} & TransactionActions) {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const icons = useMemo(() => new Map(categories.map(category => [category.id, category.icon_key])), [categories]);

  useEffect(() => { setOpenId(null); }, [rows, busy]);
  useEffect(() => {
    if (!openId) return;
    const close = () => setOpenId(null);
    const outside = (event: Event) => {
      if (!list.current?.querySelector(".is-open")?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", outside, { capture: true, passive: true });
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", close, { capture: true, passive: true });
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", close, true);
    };
  }, [openId]);

  if (!rows.length) return <p className="empty-note">{emptyMessage}</p>;
  return <div ref={list} className="transaction-list transaction-swipe-list" role="list">
    {rows.map(row => <SwipeTransactionRow key={row.id} row={row}
      icon={(row.category_id ? icons.get(row.category_id) : undefined) || CATEGORY_ICONS[row.category ?? ""] || "tag"}
      open={openId === row.id} onReveal={() => setOpenId(row.id)} onClose={() => setOpenId(null)}
      onEdit={onEdit} onDelete={onDelete} busy={busy} />)}
  </div>;
}
