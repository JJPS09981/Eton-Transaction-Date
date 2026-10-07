import { useState } from "react";
import { money, shortDate, type TransactionView, type CommandHandler } from "../lib/api";
import { useCommandDraft } from "../lib/command";
import { Sheet } from "./Sheet";

export function DeleteTransactionSheet({ transaction, busy, onClose, onSubmit }: {
  transaction: TransactionView; busy: boolean; onClose: () => void; onSubmit: CommandHandler;
}) {
  const [cancelPending, setCancelPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  async function remove() {
    setError(null);
    try {
      await onSubmit(draft.build({ type: "DeleteTransaction", transactionId: transaction.id,
        expectedRevision: transaction.revision ?? 0, cancelPendingInstallments: cancelPending }));
      draft.reset(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "刪除失敗"); }
  }
  return <Sheet title="刪除這筆交易？" busy={busy} onClose={onClose}>
    <div className="delete-transaction-summary"><span>{shortDate(transaction.transaction_date)}</span>
      <strong>{transaction.description || transaction.category || (transaction.kind === "income" ? "額外收入" : "一般支出")}</strong><b>{money(transaction.amount)}</b></div>
    <p className="muted-note">{transaction.kind === "expense" ? "會退回這筆交易實際扣過的金額；未扣到的部分不退款。今天的生活支出退回每日預算、本期其他日期退回存款池；存款支付或已結算期退回累積存款。" : "會收回這筆收入，最多扣到目前可用資金為零，已結算期只調整目前累積存款。"} 刪除後不再列入交易清單與統計，修改紀錄仍保留。</p>
    {transaction.payment_type === "installment" ? <label className="delete-installments"><input type="checkbox" checked={cancelPending} disabled={busy} onChange={event => setCancelPending(event.target.checked)} />
      <span>一併取消尚未入帳的期數<small>已入帳的其他期仍保留；未勾選時，只刪除這一期。</small></span></label> : null}
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    <div className="delete-transaction-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onClose}>保留交易</button>
      <button className="primary-button destructive-button" type="button" disabled={busy} onClick={() => void remove()}>{busy ? "刪除中…" : "確認刪除"}</button></div>
  </Sheet>;
}
