import type { DashboardData } from "../lib/api";
import { money, shortDate } from "../lib/api";
import { TransactionRows, type TransactionActions } from "./TransactionRows";

export { TransactionRows, type TransactionActions } from "./TransactionRows";

function daysLeft(today: string, endDate: string): number {
  return Math.max(0, Math.round((Date.parse(endDate + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000) + 1);
}

function cycleDate(date: string): string {
  const [year, month, day] = date.split("-");
  return year + "年" + Number(month) + "月" + Number(day) + "日";
}

export function Dashboard({ data, onExpense, onIncome, onViewTransactions, onEditBudget, onEdit, onDelete, busy }: {
  data: DashboardData;
  onExpense: () => void;
  onIncome: () => void;
  onViewTransactions: () => void;
  onEditBudget: () => void;
} & TransactionActions) {
  const state = data.state!;
  const cycle = data.cycle!;
  const today = data.today ?? state.today;
  const expenses = (data.transactions ?? []).filter(row => row.kind === "expense" && row.transaction_date === today);
  const status = state.fundingStatus;
  return <div className="dashboard-page">
    <header className="page-heading dashboard-heading"><div><h1>今天還能花多少</h1><p>以今天的預算，安心安排每一筆支出。</p></div><time dateTime={data.today ?? state.today}>{shortDate(data.today ?? state.today)}</time></header>
    <section className="hero-balance" aria-label="今日可用預算">
      <div className="hero-main">
        <button className="hero-cycle" type="button" onClick={onViewTransactions} aria-label="查看本期帳務紀錄">
          <span>{cycleDate(state.startDate)} – {cycleDate(state.endDate)}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button>
        <p className="hero-label">今天還能花多少</p>
        <strong className={"hero-amount" + (state.A.length > 8 ? " long-balance" : "")} aria-label={money(state.A)}><span aria-hidden="true">NT$</span><span aria-hidden="true">{money(state.A).slice(4)}</span></strong>
        <p className="hero-period">本期剩餘 {daysLeft(state.today, state.endDate)} 天</p>
        {status !== "available" && <p className={"funding-alert" + (status === "insufficient_funds" ? " danger" : "")}>{status === "insufficient_funds" ? "可用資金不足" : "本期收入已超支，可從累積存款支付"}</p>}
      </div>
      <div className="hero-actions"><button className="primary-button" type="button" disabled={busy} onClick={onExpense}>記一筆支出</button><button className="text-button" type="button" disabled={busy} onClick={onIncome}>新增額外收入 <span aria-hidden="true">›</span></button></div>
    </section>
    <section className="balance-strip" aria-label="資金摘要">
      <div><span>本期存款池</span><strong>{money(state.P)}</strong><small>每日結餘累積於此</small></div>
      <div><button className="budget-summary-button" type="button" disabled={busy} onClick={onEditBudget} aria-label="編輯本月可用預算" aria-haspopup="dialog">
        <span className="budget-summary-label">本月可用預算<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" /></svg></span>
        <strong>{money(cycle.lifestyle_budget)}</strong><small>扣除固定項目後</small>
      </button></div>
    </section>
    <section className="list-panel dashboard-transactions">
      <div className="section-title"><h2>今日花費</h2><button className="inline-link" type="button" onClick={onViewTransactions}>查看歷史紀錄 <span aria-hidden="true">›</span></button></div>
      <TransactionRows rows={expenses} categories={data.categories} onEdit={onEdit} onDelete={onDelete} busy={busy} emptyMessage="今天還沒有花費。記下第一筆支出後會顯示在這裡。" />
    </section>
  </div>;
}
