import { useEffect, useRef, useState, type FormEvent } from "react";
import { splitInstallments } from "@budget/domain";
import {
  getRecentDescriptions,
  money,
  type Category,
  type Subcategory,
  type CommandHandler,
  type TransactionView,
} from "../lib/api";
import { useCommandDraft } from "../lib/command";
import { Sheet } from "./Sheet";
import { CategoryIcon } from "./CategoryIcon";

type Props = {
  kind: "expense" | "income";
  today: string;
  initialDate?: string;
  currentCycleStart: string;
  categories: Category[];
  subcategories: Subcategory[];
  busy: boolean;
  onClose: () => void;
  onSubmit: CommandHandler;
  transaction?: TransactionView;
};
export function ExpenseSheet(props: Props) {
  return props.kind === "income" ? (
    <IncomeSheet {...props} />
  ) : (
    <QuickExpenseSheet {...props} />
  );
}
function IncomeSheet({ busy, onSubmit, onClose, transaction, today, currentCycleStart }: Props) {
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [destination, setDestination] = useState(transaction?.income_destination ?? "pool");
  const [note, setNote] = useState(transaction?.note ?? "");
  const [date, setDate] = useState(transaction?.transaction_date ?? today);
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await onSubmit(
        draft.build({
          type: transaction ? "UpdateTransaction" : "AddIncome",
          amount,
          ...(transaction ? { transactionId: transaction.id, expectedRevision: transaction.revision ?? 0,
            kind: "income", incomeDestination: destination, transactionDate: date } : { destination }),
          note: note.trim(),
        }),
      );
      draft.reset();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "儲存失敗");
    }
  }
  return (
    <Sheet title={transaction ? "編輯收入" : "新增額外收入"} busy={busy} onClose={onClose}>
      <form onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="plain-fieldset">
          <label className="field">
            <span>金額（TWD）</span>
            <input
              autoFocus
              inputMode="numeric"
              pattern="[1-9][0-9]*"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          {transaction ? <label className="field"><span>帳務日期</span><input aria-label="帳務日期" type="date" value={date} max={today} required onChange={event => setDate(event.target.value)} />
            <small>{date < currentCycleStart ? "已結算期的更正只調整目前累積存款。" : "預算調整從現在生效，保留已結算日期。"}</small></label> : null}
          <label className="field">
            <span>加入哪裡</span>
            <select
              value={destination}
              onChange={(event) => setDestination(event.target.value as "pool" | "lifestyle")}
            >
              <option value="pool">本期存款池</option>
              <option value="lifestyle">生活預算</option>
            </select>
          </label>
          <label className="field">
            <span>備註</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button sheet-save" type="submit">
            {busy ? "儲存中…" : "確認儲存"}
          </button>
        </fieldset>
      </form>
    </Sheet>
  );
}
function QuickExpenseSheet({
  today,
  initialDate,
  currentCycleStart,
  categories,
  subcategories,
  busy,
  onSubmit,
  onClose,
  transaction,
}: Props) {
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.category_id ?? "");
  const [subcategoryId, setSubcategoryId] = useState(transaction?.subcategory_id ?? "");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [note, setNote] = useState(transaction?.note ?? "");
  const [source, setSource] = useState<"lifestyle" | "savings">(transaction?.funding_source ?? "lifestyle");
  const [paymentType, setPaymentType] = useState<"immediate" | "installment">(
    transaction?.payment_type ?? "immediate",
  );
  const [count, setCount] = useState("3");
  const [date, setDate] = useState(transaction?.transaction_date ?? initialDate ?? today);
  const [showMore, setShowMore] = useState(false);
  const [showSettings, setShowSettings] = useState(Boolean(transaction));
  const [showNote, setShowNote] = useState(Boolean(transaction?.note));
  const [showDate, setShowDate] = useState(false);
  const [recentData, setRecentData] = useState<{
    key: string;
    items: string[];
  }>({ key: "", items: [] });
  const recentKey = `${categoryId}:${subcategoryId}`;
  const recent = recentData.key === recentKey ? recentData.items : [];
  const [error, setError] = useState<string | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const draft = useCommandDraft();
  const visible = categories.filter(item => item.scope === "daily" && (!item.hidden || item.id === transaction?.category_id))
    .map(item => item.id === transaction?.category_id ? { ...item, name: transaction.category ?? item.name } : item);
  const categoryChoices = !showMore && transaction?.category_id ? visible.filter((item, index) => index < 7 || item.id === transaction.category_id) : showMore ? visible : visible.slice(0, 7);
  const choices = subcategories.filter(
    (item) => item.category_id === categoryId && (!item.hidden || item.id === transaction?.subcategory_id),
  ).map(item => item.id === transaction?.subcategory_id ? { ...item, name: transaction.subcategory ?? item.name } : item);
  const historical = date < currentCycleStart;
  const effectiveSource = historical ? "savings" : source;
  let installments: bigint[] = [];
  if (
    /^[0-9]+$/.test(amount) &&
    Number.isInteger(Number(count)) &&
    Number(count) >= 2 &&
    Number(count) <= 60
  ) {
    try {
      installments = splitInstallments(BigInt(amount), Number(count));
    } catch {
      /* Invalid draft amounts are checked on submission. */
    }
  }
  useEffect(() => {
    if (!categoryId) return;
    const abort = new AbortController();
    void getRecentDescriptions(
      categoryId,
      subcategoryId || undefined,
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted)
          setRecentData({
            key: `${categoryId}:${subcategoryId}`,
            items: result.items,
          });
      })
      .catch(() => {});
    return () => abort.abort();
  }, [categoryId, subcategoryId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^[0-9]+$/.test(amount) || BigInt(amount) <= 0n) {
      setError("請輸入大於 0 的整數金額");
      return;
    }
    if (amount.length > 10) {
      setError("支出金額最多 10 位數");
      return;
    }
    if (!categoryId && !transaction) {
      setError("請選擇分類");
      return;
    }
    if (!transaction && paymentType === "installment" && !installments.length) {
      setError("請輸入有效期數（2–60 期，且不超過總金額）");
      return;
    }
    try {
      await onSubmit(
        draft.build({
          type: transaction ? "UpdateTransaction" : "RecordExpense",
          ...(transaction ? { transactionId: transaction.id, expectedRevision: transaction.revision ?? 0, kind: "expense" } : {}),
          amount: BigInt(amount).toString(),
          ...(categoryId ? { categoryId } : transaction ? { categoryId: null } : {}),
          ...(subcategoryId ? { subcategoryId } : transaction ? { subcategoryId: null } : {}),
          ...(transaction || description.trim() ? { description: description.trim() } : {}),
          ...(transaction || note.trim() ? { note: note.trim() } : {}),
          source: effectiveSource,
          transactionDate: date,
          ...(!transaction ? { paymentType } : {}),
          ...(!transaction && paymentType === "installment"
            ? { installmentCount: Number(count) }
            : {}),
        }),
      );
      draft.reset();
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "儲存失敗");
    }
  }
  return (
    <Sheet
      title={transaction ? "編輯支出" : "記一筆支出"}
      className="quick-sheet"
      busy={busy}
      onClose={onClose}
    >
      <form className="quick-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy} className="plain-fieldset quick-scroll">
          <label className="quick-amount">
            <span>花了多少？</span>
            <div>
              <span>NT$</span>
              <input
                ref={amountRef}
                aria-label="支出金額"
                className={amount.length > 7 ? "long-amount" : undefined}
                data-autofocus
                autoFocus
                inputMode="numeric"
                pattern="[0-9]{1,10}"
                maxLength={10}
                autoComplete="off"
                value={amount}
                onChange={(event) => {
                  if (/^[0-9]{0,10}$/.test(event.target.value))
                    setAmount(event.target.value);
                }}
                placeholder="0"
                required
              />
            </div>
          </label>
          <fieldset className="quick-section">
            <legend>分類</legend>
            <div className="expense-categories">
              {categoryChoices.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={
                    categoryId === item.id
                      ? "expense-category selected"
                      : "expense-category"
                  }
                  aria-pressed={categoryId === item.id}
                  onClick={() => {
                    amountRef.current?.blur();
                    setCategoryId(item.id);
                    setSubcategoryId("");
                  }}
                >
                  <CategoryIcon name={item.icon_key} />
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            {visible.length > 7 ? (
              <button
                className="inline-link category-more"
                type="button"
                aria-expanded={showMore}
                onClick={() => setShowMore(!showMore)}
              >
                {showMore ? "收起分類" : "更多分類"}
              </button>
            ) : null}
          </fieldset>
          {categoryId ? (
            <fieldset className="quick-section subcategory-section">
              <legend>
                細項 <span>選一個用途，之後更好找</span>
              </legend>
              {choices.length ? (
                <div className="expense-subcategories">
                  {choices.map((item) => (
                    <button
                      type="button"
                      className={
                        subcategoryId === item.id
                          ? "subcategory-choice selected"
                          : "subcategory-choice"
                      }
                      key={item.id}
                      aria-pressed={subcategoryId === item.id}
                      onClick={() =>
                        setSubcategoryId(
                          subcategoryId === item.id ? "" : item.id,
                        )
                      }
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted-note">可在設定中新增此分類的細項。</p>
              )}
            </fieldset>
          ) : null}
          <label className="quick-section merchant-field">
            <span>
              項目／商家 <small>選填</small>
            </span>
            <input
              value={description}
              maxLength={200}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如 全家、adidas"
              autoComplete="off"
            />
          </label>
          {recent.length ? (
            <div className="recent-items">
              <span>最近使用</span>
              <div>
                {recent.map((item) => (
                  <button
                    type="button"
                    key={item}
                    onClick={() => setDescription(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <section className="expense-other">
            <button
              className="other-toggle"
              type="button"
              aria-expanded={showSettings}
              onClick={() => setShowSettings(!showSettings)}
            >
              <span>
                其他設定
                <small>
                  {effectiveSource === "savings" ? "累積存款" : "生活預算"} ·{" "}
                  {paymentType === "immediate" ? "立即付款" : "分期付款"} ·{" "}
                  {date === today ? "今天" : date.slice(5).replace("-", "/")}
                </small>
              </span>
              <span aria-hidden="true">{showSettings ? "−" : "＋"}</span>
            </button>
            {showSettings ? (
              <div className="other-content">
                <fieldset className="quick-section">
                  <legend>這筆從哪裡出？</legend>
                  <div className="expense-segment">
                    {(["lifestyle", "savings"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        disabled={historical}
                        aria-pressed={effectiveSource === value}
                        className={effectiveSource === value ? "selected" : ""}
                        onClick={() => {
                          setSource(value);
                          if (!transaction && value === "savings") setPaymentType("immediate");
                        }}
                      >
                        {value === "lifestyle" ? "生活預算" : "累積存款"}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="quick-section">
                  <legend>付款方式</legend>
                  {transaction ? <p className="muted-note">{transaction.payment_type === "installment" ? `分期 ${transaction.installment_no}／${transaction.installment_count}；只編輯這一期，其他期數保留。` : "立即付款"}</p> : <><div className="expense-segment">
                    {(["immediate", "installment"] as const).map((value) => (
                      <button
                        type="button"
                        key={value}
                        disabled={
                          value === "installment" &&
                          (effectiveSource === "savings" || historical)
                        }
                        aria-pressed={paymentType === value}
                        className={paymentType === value ? "selected" : ""}
                        onClick={() => setPaymentType(value)}
                      >
                        {value === "immediate" ? "立即付款" : "分期付款"}
                      </button>
                    ))}
                  </div>
                  {effectiveSource === "savings" ? (
                    <small className="muted-note">
                      分期使用生活預算，累積存款採立即付款。
                    </small>
                  ) : null}
                  {paymentType === "installment" ? (
                    <div className="installment-fields">
                      <label>
                        分期期數
                        <input
                          inputMode="numeric"
                          pattern="[0-9]+"
                          value={count}
                          onChange={(event) => {
                            if (/^[0-9]*$/.test(event.target.value))
                              setCount(event.target.value);
                          }}
                          maxLength={2}
                          required
                        />
                      </label>
                      <div className="installment-preview">
                        <strong>
                          第一期：本期 {money(installments[0]?.toString())}
                        </strong>
                        {installments.length > 1 ? (
                          <span>
                            後續每期 {money(installments[1]!.toString())} · 共{" "}
                            {count} 期
                          </span>
                        ) : null}
                        <small>餘額放第一期；後續按收入週期認列。</small>
                      </div>
                    </div>
                  ) : null}
                  </>}
                </fieldset>
                <div className="expense-date">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDate(true);
                      try {
                        dateRef.current?.showPicker();
                      } catch {
                        /* The revealed date input remains available. */
                      }
                    }}
                  >
                    <span>帳務日期</span>
                    <strong>
                      {date === today
                        ? "今天"
                        : date.slice(5).replace("-", "/")}{" "}
                      <span aria-hidden="true">›</span>
                    </strong>
                  </button>
                  <input
                    ref={dateRef}
                    className={showDate ? "" : "concealed-date"}
                    aria-label="帳務日期"
                    type="date"
                    value={date}
                    max={today}
                    required
                    onChange={(event) => {
                      setDate(event.target.value);
                      if (!transaction && event.target.value < currentCycleStart)
                        setPaymentType("immediate");
                    }}
                  />
                  {date !== today ? (
                    <small>
                      {historical
                        ? "已結算期補登從目前累積存款支付，保留過去的每日結算。"
                        : transaction ? "更正從現在生效，保留已結算日期。" : "補登支出會從今天開始影響預算。"}
                    </small>
                  ) : null}
                </div>
                {!showNote ? (
                  <button
                    className="add-note"
                    type="button"
                    onClick={() => setShowNote(true)}
                  >
                    ＋ 加入備註
                  </button>
                ) : (
                  <label className="expense-note">
                    <span>
                      備註 <small>選填</small>
                    </span>
                    <textarea
                      value={note}
                      maxLength={500}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="例如 Boston 13 跑鞋"
                      rows={2}
                    />
                  </label>
                )}
              </div>
            ) : null}
          </section>
        </fieldset>
        <div className="quick-footer">
          {error ? (
            <p className="error-message" role="alert">
              {error}
            </p>
          ) : null}
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? "儲存中…" : transaction ? "儲存修改" : "儲存支出"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
