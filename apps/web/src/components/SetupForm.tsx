import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";

type Submit = (command: Record<string, unknown>) => Promise<void>;

interface FixedExpenseInput {
  id: string;
  name: string;
  amount: string;
  category: string;
  frequency: "monthly" | "annual";
  dueMonth: string;
  custom: boolean;
}

const presetGroups = [
  { title: "住居", items: [
    { id: "housing", name: "房租／房貸", detail: "租金或每月房貸" },
    { id: "building", name: "管理費", detail: "社區或大樓管理費" },
    { id: "parking-rent", name: "停車位租金", detail: "固定租用的車位" },
  ] },
  { title: "水電瓦斯", items: [
    { id: "water", name: "水費", detail: "自來水帳單" },
    { id: "electricity", name: "電費", detail: "用電帳單" },
    { id: "gas", name: "瓦斯費", detail: "天然氣或桶裝瓦斯" },
  ] },
  { title: "通訊網路", items: [
    { id: "mobile", name: "手機費", detail: "電信月租" },
    { id: "internet", name: "家用網路費", detail: "寬頻網路" },
  ] },
  { title: "影音與音樂", items: [
    { id: "netflix", name: "Netflix", detail: "影音訂閱" },
    { id: "youtube", name: "YouTube Premium", detail: "影音訂閱" },
    { id: "disney", name: "Disney+", detail: "影音訂閱" },
    { id: "spotify", name: "Spotify", detail: "音樂訂閱" },
    { id: "apple-music", name: "Apple Music", detail: "音樂訂閱" },
    { id: "kkbox", name: "KKBOX", detail: "音樂訂閱" },
  ] },
  { title: "數位服務", items: [
    { id: "cloud-storage", name: "雲端空間", detail: "檔案與照片儲存" },
    { id: "icloud", name: "iCloud+", detail: "Apple 雲端服務" },
    { id: "google-one", name: "Google One", detail: "Google 雲端服務" },
    { id: "software", name: "軟體訂閱", detail: "工作或生活工具" },
    { id: "gaming", name: "遊戲會員", detail: "遊戲訂閱服務" },
  ] },
  { title: "AI 服務", items: [
    { id: "chatgpt", name: "ChatGPT", detail: "AI 訂閱" },
    { id: "claude", name: "Claude", detail: "AI 訂閱" },
    { id: "gemini", name: "Gemini", detail: "AI 訂閱" },
  ] },
  { title: "保險", items: [
    { id: "life-insurance", name: "壽險", detail: "定期壽險保費" },
    { id: "medical-insurance", name: "醫療險", detail: "醫療保險保費" },
    { id: "accident-insurance", name: "意外險", detail: "意外保險保費" },
    { id: "car-insurance", name: "車險", detail: "汽機車保險保費" },
  ] },
  { title: "交通", items: [
    { id: "transit-pass", name: "交通月票", detail: "公車或捷運定期票" },
    { id: "commute-parking", name: "通勤停車費", detail: "固定停車支出" },
  ] },
  { title: "家庭與健康", items: [
    { id: "family-support", name: "孝親費", detail: "每月家庭支援" },
    { id: "childcare", name: "托育費", detail: "托嬰或托育費" },
    { id: "gym", name: "健身房", detail: "運動會費" },
    { id: "care", name: "定期照護費", detail: "固定照護安排" },
  ] },
  { title: "貸款與其他", items: [
    { id: "personal-loan", name: "信貸還款", detail: "每月信貸支出" },
    { id: "student-loan", name: "學貸還款", detail: "每月學貸支出" },
  ] },
] as const;

const steps = ["收入與存款", "固定支出", "本期預算"] as const;

function FixedExpenseDialog({ item, saved, onClose, onSave, onRemove }: {
  item: FixedExpenseInput;
  saved: boolean;
  onClose: () => void;
  onSave: (item: FixedExpenseInput) => void;
  onRemove: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(item.amount);
  const [frequency, setFrequency] = useState<FixedExpenseInput["frequency"]>(item.frequency);
  const [dueMonth, setDueMonth] = useState(item.dueMonth);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    (item.custom ? nameRef : amountRef).current?.focus({ preventScroll: true });
    return () => { if (dialog?.open) dialog.close(); };
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave({ ...item, name: name.trim(), amount, frequency, dueMonth: frequency === "annual" ? dueMonth : "" });
  };

  return createPortal(<dialog ref={dialogRef} className="custom-expense-dialog" aria-labelledby="fixed-expense-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id="fixed-expense-title">{saved ? `編輯 ${item.name}` : item.custom ? `新增${item.category}項目` : `設定 ${item.name}`}</h2><button type="button" className="close-button" onClick={onClose} aria-label="關閉">×</button></div>
    <form onSubmit={submit}>
      {item.custom ? <label className="field"><span>項目名稱</span><input ref={nameRef} value={name} onChange={(event) => setName(event.target.value)} placeholder="輸入項目名稱" maxLength={80} required /></label> : <p className="fixed-expense-dialog-category">{item.category} · {item.name}</p>}
      <label className="field"><span>繳費頻率</span><select value={frequency} onChange={(event) => { setFrequency(event.target.value as FixedExpenseInput["frequency"]); setDueMonth(""); }}><option value="monthly">每月</option><option value="annual">每年</option></select></label>
      {frequency === "annual" && <label className="field"><span>繳費月份</span><select value={dueMonth} onChange={(event) => setDueMonth(event.target.value)} required><option value="">請選擇月份</option>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1} 月</option>)}</select></label>}
      <label className="field"><span>{frequency === "annual" ? "每年金額" : "每月金額"}</span><div className="money-input"><span>NT$</span><input ref={amountRef} inputMode="numeric" pattern="[1-9][0-9]*" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如 1200" required /></div></label>
      <div className="custom-dialog-actions">{saved && <button className="remove-expense-button" type="button" onClick={onRemove}>移除項目</button>}<button className="secondary-button" type="button" onClick={onClose}>取消</button><button className="primary-button" type="submit">{saved ? "儲存修改" : "加入固定支出"}</button></div>
    </form>
  </dialog>, document.body);
}

export function SetupForm({ onSubmit, busy, today }: { onSubmit: Submit; busy: boolean; today: string }) {
  const [step, setStep] = useState(0);
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [accumulatedSavings, setAccumulatedSavings] = useState("");
  const [fixedExpenses, setFixedExpenses] = useState<FixedExpenseInput[]>([]);
  const [firstCycleBudget, setFirstCycleBudget] = useState("");
  const [cycleStartDay, setCycleStartDay] = useState(String(Number(today.slice(8, 10))));
  const [editingExpense, setEditingExpense] = useState<FixedExpenseInput | null>(null);
  const dialogOpener = useRef<HTMLButtonElement | null>(null);
  const pendingId = useRef<string | null>(null);
  const changed = () => { pendingId.current = null; };
  const openExpense = (item: FixedExpenseInput, opener: HTMLButtonElement) => {
    dialogOpener.current = opener;
    setEditingExpense(item);
  };
  const closeExpenseDialog = () => {
    setEditingExpense(null);
    requestAnimationFrame(() => dialogOpener.current?.focus({ preventScroll: true }));
  };
  const saveExpense = (item: FixedExpenseInput) => {
    changed();
    setFixedExpenses((current) => current.some((saved) => saved.id === item.id)
      ? current.map((saved) => saved.id === item.id ? item : saved)
      : [...current, item]);
    closeExpenseDialog();
  };
  const removeExpense = (id: string) => {
    changed();
    setFixedExpenses((current) => current.filter((item) => item.id !== id));
    closeExpenseDialog();
  };
  const expenseSummary = (item: FixedExpenseInput) => `${item.frequency === "annual" ? `每年 ${item.dueMonth} 月` : "每月"} · NT$${Number(item.amount).toLocaleString("zh-TW")}`;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (!pendingId.current) pendingId.current = crypto.randomUUID();
    await onSubmit({
      type: "Initialize",
      commandId: pendingId.current,
      cycleStartDay: Number(cycleStartDay),
      recurringIncome: monthlyIncome,
      fixedExpenses: fixedExpenses.map(({ name, amount, category, frequency, dueMonth }) => ({
        name: name.trim(), amount, category, frequency,
        ...(frequency === "annual" ? { dueMonth: Number(dueMonth) } : {}),
      })),
      firstCycleBudget,
      accumulatedSavings: accumulatedSavings || "0",
    });
  };
  return <div className="setup-wrap"><div className="setup-intro"><p className="brand">日日花</p><h1>開始設定你的預算</h1><p>分三步完成。先記下每月收入，再選固定支出，最後設定目前這一期可以使用的金額。</p></div>
    <div className="setup-progress" aria-label={`設定進度：第 ${step + 1} 步，共 3 步`}>
      {steps.map((label, index) => <div className={index === step ? "current" : index < step ? "complete" : ""} key={label}>
        <span>{index + 1}</span><strong>{label}</strong>
      </div>)}
    </div>
    <form className="setup-form" onSubmit={submit}>
      {step === 0 && <section className="setup-step">
        <span className="setup-step-count">步驟 1／3</span>
        <h2>設定收入與目前存款</h2>
        <p className="setup-step-description">填入通常每個月會收到的固定收入。下一期開始，會用這個金額計算預算。</p>
        <label className="field setup-main-field"><span>每月固定收入</span><div className="money-input"><span>NT$</span><input autoFocus inputMode="numeric" pattern="(0|[1-9][0-9]*)" maxLength={19} value={monthlyIncome} onChange={(event) => { changed(); setMonthlyIncome(event.target.value); }} placeholder="例如 30000" required /></div></label>
        <label className="field"><span>目前累積存款（選填）</span><div className="money-input"><span>NT$</span><input inputMode="numeric" pattern="(0|[1-9][0-9]*)" maxLength={19} value={accumulatedSavings} onChange={event => { changed(); setAccumulatedSavings(event.target.value); }} placeholder="未填為 0" /></div><small>填入生活預算以外的存款總額，避免重複計入。之後可在設定校正。</small></label>
      </section>}

      {step === 1 && <section className="setup-step">
        <span className="setup-step-count">步驟 2／3</span>
        <h2>有哪些固定支出？</h2>
        <p className="setup-step-description">點選項目後，在視窗中填入金額與繳費頻率；再點已選項目可以修改或移除。年繳請填全年金額與繳費月份，只在應繳週期計入一次。固定支出從下一個完整週期開始計算。</p>
        <div className="preset-groups">{presetGroups.map((group) => <div className="preset-group" key={group.title}>
          <h3>{group.title}</h3>
          <div className="preset-grid">{group.items.map((preset) => {
            const selected = fixedExpenses.find((item) => item.id === preset.id);
            return <button className={`preset-option${selected ? " selected" : ""}`} type="button" aria-pressed={Boolean(selected)} disabled={!selected && fixedExpenses.length >= 60} key={preset.id}
              onClick={(event) => openExpense(selected ?? { id: preset.id, name: preset.name, amount: "", category: group.title, frequency: "monthly", dueMonth: "", custom: false }, event.currentTarget)}>
              <span className="preset-check" aria-hidden="true">{selected ? "✓" : "+"}</span>
              <span><strong>{preset.name}</strong><small>{selected ? expenseSummary(selected) : preset.detail}</small></span>
            </button>;
          })}{fixedExpenses.filter((item) => item.custom && item.category === group.title).map((item) => <button className="preset-option selected" type="button" aria-pressed="true" key={item.id}
            onClick={(event) => openExpense(item, event.currentTarget)}>
            <span className="preset-check" aria-hidden="true">✓</span><span><strong>{item.name}</strong><small>{expenseSummary(item)}</small></span>
          </button>)}<button className="preset-option preset-add-option" type="button" disabled={fixedExpenses.length >= 60}
            aria-label={`在${group.title}新增固定支出`} onClick={(event) => openExpense({ id: crypto.randomUUID(), name: "", amount: "", category: group.title, frequency: "monthly", dueMonth: "", custom: true }, event.currentTarget)}>
            <span className="preset-check" aria-hidden="true">＋</span><span><strong>新增其他項目</strong><small>自行填寫名稱與金額</small></span>
          </button></div>
        </div>)}</div>
      </section>}

      {step === 2 && <section className="setup-step">
        <span className="setup-step-count">步驟 3／3</span>
        <h2>到下次重置前，還能用多少？</h2>
        <p className="setup-step-description">請填今天起到下次重置前，扣除這段時間仍須支付的固定帳單後，真正可以運用的預算。系統從今天開始分配，不回算過去日期。</p>
        <label className="field setup-main-field"><span>本期剩餘可用預算</span><div className="money-input"><span>NT$</span><input autoFocus inputMode="numeric" pattern="(0|[1-9][0-9]*)" value={firstCycleBudget} onChange={(event) => { changed(); setFirstCycleBudget(event.target.value); }} placeholder="例如 12000" required /></div></label>
        <label className="field setup-reset-field"><span>每月幾號重置預算？</span><input type="number" min="1" max="31" value={cycleStartDay} onChange={(event) => { changed(); setCycleStartDay(event.target.value); }} required /><small>通常選發薪日；短月會使用當月最後一天。</small></label>
        <p className="setup-next-cycle-note">下個完整週期會依你填的月薪，以及該期應繳的固定支出重新計算。</p>
      </section>}

      <div className="setup-actions">
        {step > 0 && <button className="secondary-button" type="button" disabled={busy} onClick={() => { setStep(step - 1); window.scrollTo({ top: 0, behavior: "smooth" }); }}>上一步</button>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "建立中…" : step === 2 ? "開始使用" : "下一步"}</button>
      </div>
    </form>
    {editingExpense && <FixedExpenseDialog item={editingExpense} saved={fixedExpenses.some((item) => item.id === editingExpense.id)}
      onClose={closeExpenseDialog} onSave={saveExpense} onRemove={() => removeExpense(editingExpense.id)} />}
  </div>;
}
