import { useState, type FormEvent } from "react";
import { money, shortDate, type CommandHandler, type DashboardData, type FixedItem } from "../lib/api";
import { CategoryManager } from "./CategoryManager";
import { useCommandDraft } from "../lib/command";
import type { Appearance } from "../lib/appearance";
import { APP_VERSION } from "../lib/version";
import { Sheet } from "./Sheet";
import { FixedExpensePicker, type FixedExpenseInput } from "./FixedExpensePicker";

function SavingsEditor({ data, busy, onSubmit, onClose }: EditorProps) {
  const [target, setTarget] = useState(data.state!.S);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    try { await onSubmit(draft.build({ type: "AdjustSavings", target, ...(note.trim() ? { note: note.trim() } : {}) })); draft.reset(); onClose(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "校正失敗"); }
  }
  return <Sheet title="校正累積存款" busy={busy} onClose={onClose}>
    <p className="sheet-description">目前為 {money(data.state!.S)}。填入實際存款總額，這次校正會保留調整紀錄。</p>
    <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy} className="plain-fieldset">
      <label className="field"><span>目前實際存款總額（TWD）</span><input autoFocus inputMode="numeric" pattern="0|[1-9][0-9]*" maxLength={19} value={target} onChange={(event) => setTarget(event.target.value)} required /></label>
      <label className="field"><span>調整原因</span><input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="選填，例如更新帳戶餘額" /></label>
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button sheet-save">{busy ? "儲存中…" : "儲存校正"}</button>
    </fieldset></form>
  </Sheet>;
}
type EditorProps = { data: DashboardData; busy: boolean; onSubmit: CommandHandler; onClose: () => void };

function FixedIncomeEditor({ item, data, busy, onSubmit, onClose }: EditorProps & { item: FixedItem }) {
  const [amount, setAmount] = useState(item.amount);
  const [apply, setApply] = useState<"next_cycle" | "current_cycle">("next_cycle");
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await onSubmit(draft.build({ type: "SaveFixedIncome", itemId: item.id, amount, apply }));
      draft.reset(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "儲存失敗"); }
  }
  return <Sheet title="固定收入" busy={busy} onClose={onClose}>
    <p className="sheet-description">設定每月通常收到的收入。預設下一期生效；立即套用只調整本期差額，過去日期的結算保留。</p>
    <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy} className="plain-fieldset">
      <label className="field"><span>每月固定收入（TWD）</span><input autoFocus inputMode="numeric" pattern="0|[1-9][0-9]*" maxLength={19} value={amount} onChange={event => setAmount(event.target.value)} required /></label>
      <fieldset className="apply-options"><legend>生效時間</legend>
        <label><input type="radio" name="income-apply" checked={apply === "next_cycle"} onChange={() => setApply("next_cycle")} /><span>下一期開始<small>更新每月收入設定，保留本期預算。</small></span></label>
        <label><input type="radio" name="income-apply" checked={apply === "current_cycle"} onChange={() => setApply("current_cycle")} /><span>立即套用本期<small>增額分配到今天與剩餘日期；減額從目前可用資金扣回。</small></span></label>
      </fieldset>
      {data.cycle?.initial_net_budget ? <p className="muted-note">本期是首次設定的剩餘淨預算，修改收入只調整差額，不會再加入整份月收入。</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <button type="submit" className="primary-button sheet-save">{busy ? "儲存中…" : "儲存設定"}</button>
    </fieldset></form>
  </Sheet>;
}

function FixedEditor({ item, preset, data, busy, onSubmit, onClose, onSaved }: EditorProps & { item: FixedItem | null; preset?: FixedExpenseInput; onSaved: () => void }) {
  const [name, setName] = useState(item?.name ?? preset?.name ?? "");
  const [amount, setAmount] = useState(item?.amount ?? "");
  const [category, setCategory] = useState(item?.category ?? preset?.category ?? "");
  const [frequency, setFrequency] = useState<"monthly" | "annual">(item?.frequency ?? "monthly");
  const [dueMonth, setDueMonth] = useState(item?.due_month ?? Number(data.state!.today.slice(5, 7)));
  const [active, setActive] = useState(item?.active ?? true);
  const [apply, setApply] = useState<"next_cycle" | "current_cycle">("next_cycle");
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  const snapshot = data.cycleItems?.find((row) => row.recurring_item_id === item?.id);
  const categories = data.categories?.filter((row) => row.scope === "fixed" && !row.hidden) ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    try {
      await onSubmit(draft.build({ type: "SaveFixedExpense", ...(item ? { itemId: item.id } : {}), name: name.trim(), amount,
        ...(category ? { category } : {}), frequency, ...(frequency === "annual" ? { dueMonth } : {}), active, apply }));
      draft.reset(); onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "儲存失敗"); }
  }
  return <Sheet title={item ? "編輯固定支出" : "新增固定支出"} busy={busy} onClose={onClose}>
    <form onSubmit={(event) => void submit(event)}><fieldset disabled={busy} className="plain-fieldset">
      <label className="field"><span>項目名稱</span><input autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="例如 房租、Netflix" required /></label>
      <label className="field"><span>{frequency === "annual" ? "全年金額（TWD）" : "每月金額（TWD）"}</span><input inputMode="numeric" pattern="[1-9][0-9]*" maxLength={19} value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
      <label className="field"><span>分類</span><select value={category} onChange={(event) => setCategory(event.target.value)}>
        <option value="">不分類</option>{category && !categories.some((row) => row.name === category) ? <option value={category}>{category}</option> : null}
        {categories.map((row) => <option key={row.id} value={row.name}>{row.name}</option>)}
      </select></label>
      <label className="field"><span>繳費頻率</span><select value={frequency} onChange={(event) => setFrequency(event.target.value as typeof frequency)}><option value="monthly">月繳</option><option value="annual">年繳</option></select></label>
      {frequency === "annual" ? <label className="field"><span>繳費月份</span><select value={dueMonth} onChange={(event) => setDueMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>{index + 1} 月</option>)}</select><small>全年金額計入包含該月 1 日的收入週期。</small></label> : null}
      <fieldset className="apply-options"><legend>生效時間</legend>
        <label><input type="radio" name="apply" checked={apply === "next_cycle"} onChange={() => setApply("next_cycle")} /><span>下一期開始<small>保留本期預算，更新下期設定。</small></span></label>
        <label><input type="radio" name="apply" checked={apply === "current_cycle"} onChange={() => setApply("current_cycle")} /><span>立即套用本期<small>增加時依支出順序扣款，實際退款回到本期存款池。</small></span></label>
      </fieldset>
      {snapshot ? <p className="muted-note">本期已預留 {money(snapshot.actual_amount)}{BigInt(snapshot.included_amount) > 0n ? "；首期原帳單已反映在淨預算，只調整新增差額。" : "。"} </p> : null}
      {!active ? <p className="muted-note">儲存後此項目將停用，歷史紀錄保留。</p> : null}
      {error ? <p className="error-message" role="alert">{error}</p> : null}
      <div className="sheet-actions">{item ? <button type="button" className={active ? "danger-link" : "inline-link"} onClick={() => setActive(!active)}>{active ? "停用此項目" : "恢復此項目"}</button> : null}<button type="submit" className="primary-button">{busy ? "儲存中…" : active ? "儲存設定" : "儲存停用設定"}</button></div>
    </fieldset></form>
  </Sheet>;
}

type SettingsDialog = { type: "savings" | "categories" | "fixed-list" | "fixed-income" | "fixed-add" } | { type: "fixed-edit"; item: FixedItem | null; preset?: FixedExpenseInput };
export function SettingsView({ data, busy, appearance, onAppearance, onSubmit, onSignOut }: {
  data: DashboardData; busy: boolean; appearance: Appearance; onAppearance: (value: Appearance) => void;
  onSubmit: CommandHandler; onSignOut: () => void;
}) {
  const [dialog, setDialog] = useState<SettingsDialog | null>(null);
  const fixed = data.recurring?.filter((item) => item.kind === "fixed_expense") ?? [];
  const income = data.recurring?.find(item => item.kind === "income" && item.active);
  const modes = [{ key: "system", label: "跟隨系統" }, { key: "light", label: "淺色" }, { key: "dark", label: "深色" }] as const;
  const accents = [{ key: "green", label: "森林綠" }, { key: "blue", label: "湖水藍" }, { key: "rose", label: "莓果紅" }] as const;
  const editorProps = { data, busy, onSubmit, onClose: () => setDialog(null) };
  return <div className="detail-page settings-page">
    <header className="page-heading"><div><h1>設定</h1><p>把財務與介面調整成習慣的樣子。</p></div></header>
    <section className="settings-group"><h2>財務</h2>
      <button type="button" className="setting-row" disabled={busy} onClick={() => setDialog({ type: "savings" })}><span>累積存款<small>校正目前總額，保留調整紀錄</small></span><strong>{money(data.state!.S)} <i>›</i></strong></button>
      <button type="button" className="setting-row" disabled={busy || !income} onClick={() => setDialog({ type: "fixed-income" })}><span>固定收入<small>每月金額與生效時間</small></span><strong>{money(income?.amount)} <i>›</i></strong></button>
      <button type="button" className="setting-row" disabled={busy} onClick={() => setDialog({ type: "fixed-list" })}><span>固定支出<small>月繳、年繳與生效時間</small></span><strong className="fixed-expense-summary"><span>{data.fixedExpenseMonth ? `本月 ${money(data.fixedExpenseMonth.total)}` : "本月 —"}<small>{fixed.filter((item) => item.active).length} 個項目</small></span><i aria-hidden="true">›</i></strong></button>
      <div className="setting-row"><span>本期週期</span><strong>{shortDate(data.state!.startDate)} – {shortDate(data.state!.endDate)}</strong></div>
      <div className="setting-row"><span>每月重置日</span><strong>{data.settings?.cycle_start_day ?? "—"} 日</strong></div>
      <div className="setting-row"><span>本期固定支出<small>已預留／目標</small></span><strong>{money(data.cycle!.fixed_expense_covered)} ／ {money(data.cycle!.fixed_expense_target)}</strong></div>
    </section>
    <section className="settings-group"><h2>分類管理</h2>
      <button type="button" className="setting-row" disabled={busy} onClick={() => setDialog({ type: "categories" })}><span>分類與細項<small>日常、固定分類分開管理</small></span><strong>{data.categories?.filter((item) => item.scope === "daily" && !item.hidden).length ?? 0} 個日常分類 <i>›</i></strong></button>
    </section>
    <section className="settings-group"><h2>外觀</h2>
      <div className="appearance-row"><span>深淺模式</span><div className="category-chips">{modes.map((mode) => <button type="button" key={mode.key} aria-pressed={appearance.mode === mode.key} className={appearance.mode === mode.key ? "chip selected" : "chip"} onClick={() => onAppearance({ ...appearance, mode: mode.key })}>{mode.label}</button>)}</div></div>
      <div className="appearance-row"><span>主題色</span><div className="category-chips">{accents.map((accent) => <button type="button" key={accent.key} aria-pressed={appearance.accent === accent.key} className={appearance.accent === accent.key ? "chip selected" : "chip"} onClick={() => onAppearance({ ...appearance, accent: accent.key })}><i className={"color-dot " + accent.key} />{accent.label}</button>)}</div></div>
    </section>
    <section className="settings-group"><h2>帳號</h2>
      <div className="account-profile"><strong>{data.account?.display_name ?? "Google 帳號"}</strong>{data.account?.email ? <span>{data.account.email}</span> : null}</div>
      <button className="secondary-button signout-button" type="button" disabled={busy} onClick={onSignOut}>登出</button>
      <div className="setting-row"><span>版本</span><strong>v{APP_VERSION}</strong></div>
    </section>
    {dialog?.type === "savings" ? <SavingsEditor {...editorProps} /> : null}
    {dialog?.type === "fixed-income" && income ? <FixedIncomeEditor {...editorProps} item={income} /> : null}
    {dialog?.type === "categories" ? <CategoryManager {...editorProps} /> : null}
    {dialog?.type === "fixed-list" ? <Sheet title="固定支出" busy={busy} onClose={() => setDialog(null)}>
      <p className="sheet-description">點項目編輯。每次修改預設下一期生效，也可選擇立即套用。</p>
      <div className="fixed-items-list">{fixed.length === 0 ? <p className="empty-note">還沒有固定支出。新增房租、帳單或訂閱項目。</p> : fixed.map((item) => <button className={item.active ? "setting-row" : "setting-row inactive"} type="button" key={item.id} disabled={busy} onClick={() => setDialog({ type: "fixed-edit", item })}><span>{item.name}<small>{item.active ? item.frequency === "annual" ? "年繳 · " + item.due_month + " 月" : "月繳" : "已停用"}</small></span><strong>{money(item.amount)} <i>›</i></strong></button>)}</div>
      <button className="secondary-button sheet-save" type="button" disabled={busy} onClick={() => setDialog({ type: "fixed-add" })}>＋ 新增固定支出</button>
    </Sheet> : null}
    {dialog?.type === "fixed-add" ? <Sheet title="新增固定支出" className="fixed-expense-picker-sheet" busy={busy} onClose={() => setDialog({ type: "fixed-list" })}>
      <p className="sheet-description">選擇常見項目，再填入金額與繳費頻率；也可以在各分類新增其他項目。</p>
      <FixedExpensePicker disabled={busy} onSelect={(preset) => setDialog({ type: "fixed-edit", item: null, preset })} />
    </Sheet> : null}
    {dialog?.type === "fixed-edit" ? <FixedEditor key={dialog.item?.id ?? dialog.preset?.id ?? "new"} {...editorProps} item={dialog.item} preset={dialog.preset} onClose={() => setDialog({ type: dialog.item ? "fixed-list" : "fixed-add" })}
      onSaved={() => setDialog({ type: "fixed-list" })} /> : null}
  </div>;
}
