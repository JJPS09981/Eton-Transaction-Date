import { useEffect, useState } from "react";
import { getCalendar, money, shortDate, type CalendarData, type DashboardData, type TransactionView } from "../lib/api";
import { useHistory } from "../lib/useHistory";
import { TransactionRows, type TransactionActions } from "./Dashboard";

function moveMonth(month: string, offset: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
function HistoryGroups({ rows, today, emptyMessage, categories, ...actions }: { rows: TransactionView[]; today: string; emptyMessage: string; categories?: DashboardData["categories"] } & TransactionActions) {
  const groups = new Map<string, TransactionView[]>();
  for (const row of rows) {
    const group = groups.get(row.transaction_date);
    if (group) group.push(row); else groups.set(row.transaction_date, [row]);
  }
  if (!rows.length) return <p className="empty-note">{emptyMessage}</p>;
  return <>{Array.from(groups, ([date, entries]) => <section className="history-group" key={date}>
    <h3>{shortDate(date)}{date === today ? <span>今天</span> : null}</h3><TransactionRows rows={entries} categories={categories} {...actions} />
  </section>)}</>;
}

export function RecordsView({ data, month, selectedDate, onMonth, onDate, onExpense, onEdit, onDelete, busy }: {
  data: DashboardData; month: string; selectedDate: string | null;
  onMonth: (month: string) => void; onDate: (date: string | null) => void; onExpense: () => void;
} & TransactionActions) {
  const today = data.today ?? data.state!.today;
  const revision = data.state!.version;
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const history = useHistory({ kind, ...(selectedDate ? { date: selectedDate } : {}) }, revision);
  const noun = kind === "expense" ? "花費" : "收入";
  const [calendar, setCalendar] = useState<CalendarData | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setCalendar(null); setCalendarError(null);
    void getCalendar(month, abort.signal).then(setCalendar).catch((caught: unknown) => {
      if (!abort.signal.aborted) setCalendarError(caught instanceof Error ? caught.message : "月曆讀取失敗");
    });
    return () => abort.abort();
  }, [month, revision, retry]);
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const padding = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const dayAmounts = new Map(calendar?.days.map((day) => [day.date, day]));
  const settled = new Set(calendar?.settlements.map((day) => day.date));
  return <div className="detail-page">
    <header className="page-heading"><div><h1>紀錄</h1><p>從今天往前，查看每一筆花費。</p></div><button className="secondary-button" type="button" onClick={onExpense}>記一筆</button></header>
    <section className="calendar-panel" aria-label="花費月曆">
      <div className="calendar-heading"><h2>{year} 年 {monthNumber} 月</h2><div className="calendar-actions">
        {month !== today.slice(0, 7) ? <button className="inline-link" type="button" onClick={() => onMonth(today.slice(0, 7))}>回到本月</button> : null}
        <button className="month-arrow" type="button" aria-label="上一個月" disabled={month === "1900-01"} onClick={() => onMonth(moveMonth(month, -1))}>‹</button>
        <button className="month-arrow" type="button" aria-label="下一個月" disabled={month >= today.slice(0, 7)} onClick={() => onMonth(moveMonth(month, 1))}>›</button>
      </div></div>
      <div className="calendar-weekdays" aria-hidden="true">{["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">
        {Array.from({ length: padding }, (_, index) => <span key={"empty-" + index} aria-hidden="true" />)}
        {Array.from({ length: days }, (_, index) => {
          const date = month + "-" + String(index + 1).padStart(2, "0");
          const amount = dayAmounts.get(date);
          return <button type="button" key={date} disabled={date > today}
            className={["calendar-day", date === today ? "is-today" : "", date === selectedDate ? "is-selected" : "", settled.has(date) ? "is-settled" : ""].join(" ")}
            aria-label={shortDate(date) + (amount ? "，支出 " + money(amount.amount) : "") + (settled.has(date) ? "，已結算" : "")}
            aria-pressed={date === selectedDate} onClick={() => onDate(date)}>
            <span>{index + 1}</span><small>{amount ? new Intl.NumberFormat("zh-TW").format(BigInt(amount.amount)) : ""}</small>
            {settled.has(date) ? <i aria-hidden="true" /> : null}
          </button>;
        })}
      </div>
      <div className="calendar-foot"><span><i /> 已結算</span><span>點日期查看當日紀錄</span></div>
      {!calendar && !calendarError ? <p className="muted-note" role="status">正在讀取月曆…</p> : null}
      {calendarError ? <div className="inline-error"><p className="error-message" role="alert">{calendarError}</p><button className="inline-link" type="button" onClick={() => setRetry((value) => value + 1)}>重新讀取</button></div> : null}
    </section>
    <section className="records-list" aria-live="polite">
      <div className="expense-segment history-kind" aria-label="紀錄類型"><button type="button" className={kind === "expense" ? "selected" : ""} aria-pressed={kind === "expense"} onClick={() => setKind("expense")}>花費</button><button type="button" className={kind === "income" ? "selected" : ""} aria-pressed={kind === "income"} onClick={() => setKind("income")}>收入</button></div>
      <div className="section-title"><h2>{selectedDate ? shortDate(selectedDate) + " 的" + noun : "歷史" + noun}</h2>{selectedDate ? <button type="button" className="inline-link" onClick={() => onDate(null)}>查看全部</button> : <span className="muted-note">由新到舊</span>}</div>
      {kind === "expense" && selectedDate && history.loaded ? history.settlement ? <p className="settlement-note">
        {history.settlement.pool_amount === null ? "本日已結算，入池金額未留存。" : "本日已結算 " + money(history.settlement.pool_amount) + " 進存款池。"}
      </p> : <p className="muted-note">{selectedDate >= today ? "本日尚未結算。" : "這一天沒有結算紀錄。"}</p> : null}
      {!history.loaded && !history.error ? <p className="empty-note" role="status">正在讀取{noun}…</p> : history.loaded ? selectedDate ? <TransactionRows rows={history.rows} categories={data.categories} onEdit={onEdit} onDelete={onDelete} busy={busy} emptyMessage={"這一天沒有記錄" + noun + "。"} /> : <HistoryGroups rows={history.rows} categories={data.categories} today={today} onEdit={onEdit} onDelete={onDelete} busy={busy} emptyMessage={"還沒有" + noun + "紀錄。"} /> : null}
      {history.error ? <p className="error-message" role="alert">{history.error}</p> : null}
      {history.cursor || history.error ? <button type="button" className="secondary-button history-more" disabled={history.loading} onClick={() => void history.more()}>{history.loading ? "載入中…" : history.error ? "重試" : "載入更多"}</button> : null}
    </section>
  </div>;
}
