import { useEffect, useState } from "react";
import {
  getSummary,
  money,
  shortDate,
  type DashboardData,
  type SummaryData,
} from "../lib/api";
import { useHistory } from "../lib/useHistory";
import { TransactionRows } from "./Dashboard";

function CategoryDetail({
  category,
  summary,
  revision,
  categories,
  onBack,
}: {
  category: SummaryData["categories"][number];
  summary: SummaryData;
  revision: number;
  categories?: DashboardData["categories"];
  onBack: () => void;
}) {
  const history = useHistory(
    { cycleId: summary.cycleId, category: category.key },
    revision,
  );
  return (
    <section>
      <button className="inline-link back-link" type="button" onClick={onBack}>
        ‹ 返回分類摘要
      </button>
      <div className="category-detail-heading">
        <h2>{category.name}</h2>
        <strong>{money(category.amount)}</strong>
        <p>
          {category.count} 筆花費 · 本期 {shortDate(summary.startDate)} –{" "}
          {shortDate(summary.endDate)}
        </p>
      </div>
      {!history.loaded && !history.error ? (
        <p className="empty-note" role="status">
          正在讀取明細…
        </p>
      ) : history.loaded ? (
        <TransactionRows
          rows={history.rows}
          categories={categories}
          emptyMessage="本期沒有這個分類的花費。"
        />
      ) : null}
      {history.error ? (
        <p className="error-message" role="alert">
          {history.error}
        </p>
      ) : null}
      {history.cursor || history.error ? (
        <button
          className="secondary-button history-more"
          type="button"
          disabled={history.loading}
          onClick={() => void history.more()}
        >
          {history.loading ? "載入中…" : history.error ? "重試" : "載入更多"}
        </button>
      ) : null}
    </section>
  );
}

function Savings({ data }: { data: DashboardData }) {
  const labels: Record<string, string> = {
    fixed_savings: "固定存款轉入",
    fixed_expense_coverage: "固定支出補足",
    cycle_close: "本期存款池結算",
    opening_balance: "期初累積存款",
    expense: "從累積存款支付",
    savings_adjustment: "累積存款校正",
    fixed_expense_adjustment: "固定支出調整",
    fixed_income_adjustment: "固定收入調整",
    transaction_correction: "交易編輯／刪除",
    income_correction: "收入編輯／刪除",
  };
  return (
    <>
      <section className="savings-total">
        <span>目前累積存款</span>
        <strong>{money(data.state!.S)}</strong>
      </section>
      <div className="data-pool">
        <span>本期存款池</span>
        <strong>{money(data.state!.P)}</strong>
        <small>本期結束後轉入累積存款</small>
      </div>
      <section className="savings-list">
        <div className="section-title">
          <h2>存款動態</h2>
          <span className="muted-note">最近 20 筆變動</span>
        </div>
        {(data.savingsEvents ?? []).length === 0 ? (
          <p className="empty-note">
            還沒有存款變動。可到設定校正目前的累積存款。
          </p>
        ) : (
          data.savingsEvents!.map((row, index) => {
            const delta = BigInt(row.delta);
            return (
              <div
                className="savings-row"
                key={row.id ?? row.applied_at + index}
              >
                <div>
                  <span>{labels[row.reason] ?? "存款變動"}</span>
                  <small>
                    {new Date(row.applied_at).toLocaleString("zh-TW", {
                      timeZone: "Asia/Taipei",
                    })}
                  </small>
                  {row.note ? <small>{row.note}</small> : null}
                </div>
                <strong className={delta > 0n ? "positive" : ""}>
                  {delta > 0n ? "+" : "−"}
                  {money((delta < 0n ? -delta : delta).toString())}
                </strong>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}

export function DataView({ data }: { data: DashboardData }) {
  const [tab, setTab] = useState<"summary" | "savings">("summary");
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const revision = data.state!.version;
  useEffect(() => {
    const abort = new AbortController();
    setSummary(null);
    setError(null);
    void getSummary(abort.signal)
      .then(setSummary)
      .catch((caught: unknown) => {
        if (!abort.signal.aborted)
          setError(caught instanceof Error ? caught.message : "摘要讀取失敗");
      });
    return () => abort.abort();
  }, [revision, retry]);
  const category = summary?.categories.find((item) => item.key === selected);
  return (
    <div className="detail-page">
      <header className="page-heading">
        <div>
          <h1>數據</h1>
          <p>本期花費與存款，每一筆都看得清楚。</p>
        </div>
      </header>
      <div className="segment-tabs" role="group" aria-label="數據內容">
        <button
          type="button"
          aria-pressed={tab === "summary"}
          className={tab === "summary" ? "selected" : ""}
          onClick={() => setTab("summary")}
        >
          分類花費
        </button>
        <button
          type="button"
          aria-pressed={tab === "savings"}
          className={tab === "savings" ? "selected" : ""}
          onClick={() => setTab("savings")}
        >
          存款
        </button>
      </div>
      {tab === "savings" ? (
        <Savings data={data} />
      ) : !summary ? (
        <>
          {error ? (
            <div>
              <p className="error-message" role="alert">
                {error}
              </p>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setRetry((value) => value + 1)}
              >
                重新讀取
              </button>
            </div>
          ) : (
            <p className="empty-note" role="status">
              正在讀取本期摘要…
            </p>
          )}
        </>
      ) : category ? (
        <CategoryDetail
          key={category.key}
          category={category}
          summary={summary}
          revision={revision}
          categories={data.categories}
          onBack={() => setSelected(null)}
        />
      ) : (
        <>
          <div className="summary-total">
            <span>本期花費</span>
            <strong>{money(summary.total)}</strong>
            <p>
              {shortDate(summary.startDate)} – {shortDate(summary.endDate)} ·{" "}
              {summary.count} 筆
            </p>
          </div>
          <div className="section-title">
            <h2>分類花費</h2>
            <span className="muted-note">點分類查看明細</span>
          </div>
          {summary.categories.length === 0 ? (
            <p className="empty-note">
              本期還沒有花費。記下支出後會顯示分類摘要。
            </p>
          ) : (
            <div className="category-summary-list">
              {summary.categories.map((item) => {
                const share =
                  BigInt(summary.total) > 0n
                    ? Number(
                        (BigInt(item.amount) * 1000n) / BigInt(summary.total),
                      ) / 10
                    : 0;
                return (
                  <button
                    type="button"
                    className="category-summary-row"
                    key={item.key}
                    onClick={() => setSelected(item.key)}
                  >
                    <div className="category-summary-label">
                      <span>
                        {item.name}
                        <small>
                          {item.count} 筆 · {share}%
                        </small>
                      </span>
                      <strong>
                        {money(item.amount)}
                        <span aria-hidden="true">›</span>
                      </strong>
                    </div>
                    <span className="category-bar" aria-hidden="true">
                      <span style={{ width: share + "%" }} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          <p className="muted-note summary-footnote">
            依本期帳務日期統計已記錄的支出，包含從累積存款支付的花費。
          </p>
        </>
      )}
    </div>
  );
}
