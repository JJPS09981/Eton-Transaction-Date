import { useCallback, useEffect, useState } from "react";
import { DataView } from "./components/DataView";
import { Dashboard } from "./components/Dashboard";
import { GoogleSignIn } from "./components/GoogleSignIn";
import { ExpenseSheet } from "./components/ExpenseSheet";
import { DeleteTransactionSheet } from "./components/DeleteTransactionSheet";
import { RecordsView } from "./components/RecordsView";
import { SettingsView } from "./components/SettingsView";
import { SetupForm } from "./components/SetupForm";
import { Shell, type View } from "./components/Shell";
import { applyAppearance, readAppearance } from "./lib/appearance";
import { ApiError, getDashboard, getSession, getToken, sendCommand, setToken, type AuthSession, type DashboardData, type TransactionView } from "./lib/api";

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("today");
  const [dialog, setDialog] = useState<"expense" | "income" | null>(null);
  const [transactionAction, setTransactionAction] = useState<{ type: "edit" | "delete"; row: TransactionView } | null>(null);
  const [historyMonth, setHistoryMonth] = useState<string | null>(null);
  const [historyDate, setHistoryDate] = useState<string | null>(null);
  const [appearance, setAppearance] = useState(readAppearance);
  useEffect(() => {
    applyAppearance(appearance);
    const query = matchMedia("(prefers-color-scheme: dark)");
    const change = () => applyAppearance(appearance);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, [appearance]);
  useEffect(() => {
    if (!getToken()) { setAuthReady(true); return; }
    let active = true;
    void getSession().then((result) => { if (active) setSession(result); })
      .catch((caught: unknown) => {
        if (active && !(caught instanceof ApiError && caught.status === 401)) setError("無法確認登入狀態，請檢查網路連線");
      }).finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);
  const expireSession = useCallback(() => {
    setToken(null); setSession(null); setData(null); setDialog(null); setTransactionAction(null); setView("today");
    setHistoryMonth(null); setHistoryDate(null); setError(null);
  }, []);
  const reload = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try { setData(await getDashboard()); setError(null); }
    catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) expireSession();
      else setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally { setLoading(false); }
  }, [session, expireSession]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && !busy) void reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload, busy]);
  const command = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!session) throw new Error("請先登入");
    setBusy(true); setError(null);
    try {
      const result = await sendCommand(body);
      try { setData(await getDashboard()); }
      catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) expireSession();
        else setError("已儲存，但畫面更新失敗。請重新整理讀取最新資料。");
      }
      return result;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) expireSession();
      setError(caught instanceof Error ? caught.message : "儲存失敗");
      throw caught;
    } finally { setBusy(false); }
  };
  const onSignedIn = (next: AuthSession) => { setData(null); setError(null); setSession(next); };
  if (!authReady) return <div className="center-state">載入中…</div>;
  if (!session) return <GoogleSignIn onSignedIn={onSignedIn} />;
  if (!data && loading) return <div className="center-state">正在讀取預算…</div>;
  if (!data) return <div className="center-state"><p>{error ?? "無法讀取資料"}</p><button className="secondary-button" type="button" onClick={() => void reload()}>重新整理</button></div>;
  if (!data.initialized) return <><SetupForm onSubmit={(body) => command(body).then(() => undefined)} busy={busy} today={data.today!} />{error ? <p className="floating-message error-message" role="alert">{error}</p> : null}</>;
  const today = data.today ?? data.state!.today;
  const actions = { busy, onEdit: (row: TransactionView) => setTransactionAction({ type: "edit", row }), onDelete: (row: TransactionView) => setTransactionAction({ type: "delete", row }) };
  return <Shell view={view} onView={setView}>
    {error ? <div className="banner error-message" role="alert">{error}<div><button type="button" onClick={() => void reload()}>重整</button><button type="button" onClick={() => setError(null)} aria-label="關閉錯誤">×</button></div></div> : null}
    {view === "today" ? <Dashboard data={data} {...actions} onExpense={() => setDialog("expense")} onIncome={() => setDialog("income")} onViewTransactions={() => { setHistoryDate(null); setView("transactions"); }} /> : null}
    {view === "transactions" ? <RecordsView data={data} {...actions} month={historyMonth ?? today.slice(0, 7)} selectedDate={historyDate} onMonth={setHistoryMonth} onDate={setHistoryDate} onExpense={() => setDialog("expense")} /> : null}
    {view === "data" ? <DataView data={data} /> : null}
    {view === "settings" ? <SettingsView data={data} busy={busy} appearance={appearance} onAppearance={setAppearance} onSubmit={command} onSignOut={expireSession} /> : null}
    {dialog ? <ExpenseSheet kind={dialog} today={today} initialDate={view === "transactions" && historyDate ? historyDate : today} currentCycleStart={data.state!.startDate} categories={data.categories ?? []} subcategories={data.subcategories ?? []} busy={busy} onClose={() => setDialog(null)} onSubmit={command} /> : null}
    {transactionAction?.type === "edit" ? <ExpenseSheet key={transactionAction.row.id} kind={transactionAction.row.kind} transaction={transactionAction.row} today={today} currentCycleStart={data.state!.startDate} categories={data.categories ?? []} subcategories={data.subcategories ?? []} busy={busy} onClose={() => setTransactionAction(null)} onSubmit={command} /> : null}
    {transactionAction?.type === "delete" ? <DeleteTransactionSheet key={transactionAction.row.id} transaction={transactionAction.row} busy={busy} onClose={() => setTransactionAction(null)} onSubmit={command} /> : null}
  </Shell>;
}
