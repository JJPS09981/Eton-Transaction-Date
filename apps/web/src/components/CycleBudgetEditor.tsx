import { useState, type FormEvent } from "react";
import { money, shortDate, type DashboardData, type CommandHandler } from "../lib/api";
import { useCommandDraft } from "../lib/command";
import { Sheet } from "./Sheet";
import "./cycle-budget.css";

export function CycleBudgetEditor({ data, busy, onSubmit, onClose }: {
  data: DashboardData;
  busy: boolean;
  onSubmit: CommandHandler;
  onClose: () => void;
}) {
  const [original] = useState(() => ({
    target: data.cycle!.lifestyle_budget,
    cycleId: data.state!.cycleId,
    expectedVersion: data.state!.version,
    startDate: data.state!.startDate,
    endDate: data.state!.endDate,
  }));
  const [target, setTarget] = useState(original.target);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit(draft.build({ type: "AdjustCycleBudget", target, cycleId: original.cycleId, expectedVersion: original.expectedVersion,
        ...(note.trim() ? { note: note.trim() } : {}) }));
      draft.reset();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "儲存失敗");
    }
  }

  return <Sheet title="編輯本月可用預算" busy={busy} onClose={onClose}>
    <p className="sheet-description">本期 {shortDate(original.startDate)} – {shortDate(original.endDate)}，目前預算總額為 {money(original.target)}。</p>
    <p className="muted-note">增減差額分攤到今天與剩餘日期，只調整每日預算，存款池與累積存款不變。減額超過剩餘每日預算時無法儲存。</p>
    <form onSubmit={event => void save(event)}><fieldset disabled={busy} className="plain-fieldset">
      <label className="field"><span>本月可用預算（TWD）</span>
        <input autoFocus data-autofocus inputMode="numeric" pattern="0|[1-9][0-9]*" maxLength={19} value={target}
          onChange={event => setTarget(event.target.value)} required />
        <small>填入本期預算總額，已記錄的花費與過去結算保留。</small>
      </label>
      <label className="field"><span>調整原因（選填）</span><input value={note} maxLength={500}
        onChange={event => setNote(event.target.value)} placeholder="例如校正本期可用金額" /></label>
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button sheet-save">{busy ? "儲存中…" : "儲存預算"}</button>
    </fieldset></form>
  </Sheet>;
}
