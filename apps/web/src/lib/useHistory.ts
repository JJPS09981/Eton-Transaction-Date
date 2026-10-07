import { useEffect, useRef, useState } from "react";
import { getTransactions, type Settlement, type TransactionView } from "./api";

export function useHistory(filter: { date?: string; cycleId?: string; category?: string; kind?: "expense" | "income" }, revision: number) {
  const { date, cycleId, category, kind } = filter;
  const [rows, setRows] = useState<TransactionView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const current = ++generation.current;
    pending.current = true;
    setRows([]); setCursor(null); setSettlement(null); setLoading(true); setLoaded(false); setError(null);
    void getTransactions(null, { ...(date ? { date } : {}), ...(cycleId ? { cycleId } : {}), ...(category ? { category } : {}), ...(kind ? { kind } : {}) }, abort.signal)
      .then((page) => { if (current === generation.current) {
        setRows(page.items); setCursor(page.nextCursor); setSettlement(page.settlement ?? null); setLoaded(true);
      } })
      .catch((caught: unknown) => { if (!abort.signal.aborted && current === generation.current) setError(caught instanceof Error ? caught.message : "讀取失敗"); })
      .finally(() => { if (current === generation.current) { pending.current = false; setLoading(false); } });
    return () => { abort.abort(); generation.current++; };
  }, [date, cycleId, category, kind, revision, retry]);
  async function more() {
    if (!loaded) { setRetry((value) => value + 1); return; }
    if (!cursor || pending.current) return;
    const current = generation.current;
    pending.current = true; setLoading(true); setError(null);
    try {
      const page = await getTransactions(cursor, { ...(date ? { date } : {}), ...(cycleId ? { cycleId } : {}), ...(category ? { category } : {}), ...(kind ? { kind } : {}) }, controller.current?.signal);
      if (current === generation.current) { setRows((previous) => [...previous, ...page.items]); setCursor(page.nextCursor); }
    } catch (caught) {
      if (current === generation.current) setError(caught instanceof Error ? caught.message : "讀取失敗");
    } finally { if (current === generation.current) { pending.current = false; setLoading(false); } }
  }
  return { rows, cursor, settlement, loading, loaded, error, more };
}
