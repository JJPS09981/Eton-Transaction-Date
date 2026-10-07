import type { DashboardData, TransactionView } from "../lib/api";
import { money, shortDate } from "../lib/api";

function daysLeft(today: string, endDate: string): number {
  return Math.max(0, Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) + 1);
}

export type TransactionActions = { onEdit?: (row: TransactionView) => void; onDelete?: (row: TransactionView) => void; busy?: boolean };
export function TransactionRows({ rows, emptyMessage = "還沒有交易紀錄。", onEdit, onDelete, busy }: { rows: TransactionView[]; emptyMessage?: string } & TransactionActions) {
  if (!rows.length) return <p className="empty-note">{emptyMessage}</p>;
  return <div className="transaction-list">
    {rows.map((row) => <div className="transaction-row" key={row.id}>
      <time dateTime={row.transaction_date}>{shortDate(row.transaction_date)}</time>
      <div className="transaction-name"><strong>{row.category || (row.kind === "income" ? "額外收入" : "一般支出")}{row.subcategory ? " · " + row.subcategory : ""}</strong><span>{row.description || row.note || (row.kind === "income" ? row.income_destination === "lifestyle" ? "加入生活預算" : "加入存款池" : row.funding_source === "savings" ? "從累積存款支付" : "生活預算")}</span>{row.description && row.note ? <span>{row.note}</span> : null}{row.payment_type === "installment" ? <span>分期 {row.installment_no}／{row.installment_count} · 原總額 {money(row.installment_total ?? undefined)}</span> : null}</div>
      <div className={`transaction-amount ${row.kind === "income" ? "positive" : ""}`}>{row.kind === "income" ? "+" : "−"}{money(row.amount)}{row.insufficient_funds && <small>資金不足</small>}</div>
      {onEdit || onDelete ? <div className="transaction-actions">{onEdit ? <button type="button" disabled={busy} onClick={() => onEdit(row)} aria-label={`編輯 ${row.description || row.category || "交易"}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg>編輯</button> : null}
        {onDelete ? <button type="button" disabled={busy} className="delete-action" onClick={() => onDelete(row)} aria-label={`刪除 ${row.description || row.category || "交易"}`}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>刪除</button> : null}</div> : null}
    </div>)}
  </div>;
}

export function Dashboard({ data, onExpense, onIncome, onViewTransactions, onEdit, onDelete, busy }: {
  data: DashboardData;
  onExpense: () => void;
  onIncome: () => void;
  onViewTransactions: () => void;
} & TransactionActions) {
  const state = data.state!;
  const cycle = data.cycle!;
  const status = state.fundingStatus;
  return <>
    <header className="page-heading dashboard-heading"><div><h1>今天還能花多少</h1><p>以今天的預算，安心安排每一筆支出。</p></div><time dateTime={data.today ?? state.today}>{shortDate(data.today ?? state.today)}</time></header>
    <section className="hero-balance" aria-label="今日可用預算">
      <div className="hero-main"><p className="hero-label">今天還能花多少</p><strong className="hero-amount">{money(state.A)}</strong><p className="hero-period">本期 {shortDate(state.startDate)} – {shortDate(state.endDate)}　剩餘 {daysLeft(state.today, state.endDate)} 天</p>
        {status !== "available" && <p className={`funding-alert ${status === "insufficient_funds" ? "danger" : ""}`}>{status === "insufficient_funds" ? "可用資金不足" : "本期收入已超支，可從累積存款支付"}</p>}
      </div>
      <div className="hero-actions"><button className="primary-button" type="button" onClick={onExpense}>記一筆支出</button><button className="text-button" type="button" onClick={onIncome}>新增額外收入 <span aria-hidden="true">›</span></button></div>
    </section>
    <section className="balance-strip" aria-label="資金摘要">
      <div><span>本期存款池</span><strong>{money(state.P)}</strong><small>每日結餘累積於此</small></div>
      <div><span>累積存款</span><strong>{money(state.S)}</strong><small>可支應本期超支</small></div>
      <div><span>本期生活預算</span><strong>{money(cycle.lifestyle_budget)}</strong><small>扣除固定項目後</small></div>
    </section>
    <section className="list-panel dashboard-transactions"><div className="section-title"><h2>本日交易</h2><button className="inline-link" type="button" onClick={onViewTransactions}>查看紀錄 <span aria-hidden="true">›</span></button></div><TransactionRows rows={(data.transactions ?? []).filter((row) => row.transaction_date === (data.today ?? state.today))} onEdit={onEdit} onDelete={onDelete} busy={busy} emptyMessage="今天還沒有交易。記下第一筆支出後會顯示在這裡。" /></section>
  </>;
}
