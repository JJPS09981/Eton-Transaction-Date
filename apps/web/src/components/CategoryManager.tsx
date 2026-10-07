import { useState, type FormEvent } from "react";
import {
  type Category,
  type Subcategory,
  type DashboardData,
  type CommandHandler,
} from "../lib/api";
import { useCommandDraft } from "../lib/command";
import { Sheet } from "./Sheet";

function NameRow({
  item,
  parentId,
  busy,
  onSubmit,
}: {
  item: Category | Subcategory;
  parentId?: string;
  busy: boolean;
  onSubmit: CommandHandler;
}) {
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  async function save(hidden: boolean, value: string) {
    setError(null);
    try {
      await onSubmit(
        draft.build(
          parentId
            ? {
                type: "SaveSubcategory",
                categoryId: parentId,
                subcategoryId: item.id,
                name: value.trim(),
                hidden,
              }
            : {
                type: "SaveCategory",
                categoryId: item.id,
                scope: (item as Category).scope,
                name: value.trim(),
                hidden,
              },
        ),
      );
      draft.reset();
    } catch (error) {
      setError(error instanceof Error ? error.message : "儲存失敗");
    }
  }
  return (
    <div
      className={
        item.hidden ? "category-editor-row inactive" : "category-editor-row"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(item.hidden, name);
        }}
      >
        <input
          aria-label={`${parentId ? "細項" : "分類"}名稱：${item.name}`}
          maxLength={80}
          value={name}
          required
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
        />
        <button
          className="inline-link"
          type="submit"
          disabled={busy || !name.trim() || name.trim() === item.name}
        >
          儲存
        </button>
        <button
          className={item.hidden ? "inline-link" : "danger-link"}
          type="button"
          disabled={busy}
          onClick={() => void save(!item.hidden, item.name)}
        >
          {item.hidden ? "恢復" : "隱藏"}
        </button>
      </form>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function CategoryManager({
  data,
  busy,
  onSubmit,
  onClose,
}: {
  data: DashboardData;
  busy: boolean;
  onSubmit: CommandHandler;
  onClose: () => void;
}) {
  const [scope, setScope] = useState<"daily" | "fixed">("daily");
  const [parentId, setParentId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const draft = useCommandDraft();
  const parent = data.categories?.find((item) => item.id === parentId);
  const rows: (Category | Subcategory)[] = parent
    ? (data.subcategories ?? []).filter(
        (item) => item.category_id === parent.id,
      )
    : (data.categories ?? []).filter((item) => item.scope === scope);
  async function run(body: Record<string, unknown>) {
    setError(null);
    try {
      await onSubmit(draft.build(body));
      draft.reset();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "儲存失敗");
      return false;
    }
  }
  function move(index: number, offset: number) {
    const ids = rows.map((row) => row.id);
    [ids[index], ids[index + offset]] = [ids[index + offset]!, ids[index]!];
    void run(
      parent
        ? {
            type: "ReorderSubcategories",
            categoryId: parent.id,
            subcategoryIds: ids,
          }
        : { type: "ReorderCategories", scope, categoryIds: ids },
    );
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (
      await run(
        parent
          ? {
              type: "SaveSubcategory",
              categoryId: parent.id,
              name: name.trim(),
            }
          : { type: "SaveCategory", scope, name: name.trim() },
      )
    )
      setName("");
  }
  return (
    <Sheet
      title={parent ? `${parent.name}的細項` : "分類與細項管理"}
      busy={busy}
      onClose={onClose}
    >
      {parent ? (
        <button
          className="inline-link manager-back"
          type="button"
          disabled={busy}
          onClick={() => {
            setParentId(null);
            setName("");
            setError(null);
          }}
        >
          ‹ 返回分類
        </button>
      ) : (
        <div className="segment-tabs" role="group" aria-label="分類用途">
          {(["daily", "fixed"] as const).map((value) => (
            <button
              type="button"
              key={value}
              disabled={busy}
              className={scope === value ? "selected" : ""}
              aria-pressed={scope === value}
              onClick={() => {
                setScope(value);
                setName("");
                setError(null);
              }}
            >
              {value === "daily" ? "日常支出" : "固定支出"}
            </button>
          ))}
        </div>
      )}
      <p className="sheet-description">
        {parent
          ? "細項是用途，例如午餐；商家在記帳時另外填寫。"
          : "日常與固定支出各自管理。點日常分類的「管理細項」可設定用途。"}
        改名或隱藏後，歷史交易保留原名稱與關聯。
      </p>
      <div className="category-manager-list">
        {rows.map((item, index) => (
          <div className="category-management-item" key={item.id}>
            <div className="category-order-buttons">
              <button
                type="button"
                disabled={busy || index === 0}
                aria-label={`${item.name} 上移`}
                onClick={() => move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={busy || index === rows.length - 1}
                aria-label={`${item.name} 下移`}
                onClick={() => move(index, 1)}
              >
                ↓
              </button>
            </div>
            <div className="category-managed-body">
              <NameRow
                item={item}
                parentId={parent?.id}
                busy={busy}
                onSubmit={onSubmit}
              />
              {!parent && scope === "daily" ? (
                <button
                  type="button"
                  className="inline-link manage-subcategories"
                  disabled={busy}
                  onClick={() => {
                    setParentId(item.id);
                    setName("");
                    setError(null);
                  }}
                >
                  管理{item.name}細項 ·{" "}
                  {data.subcategories?.filter(
                    (sub) => sub.category_id === item.id && !sub.hidden,
                  ).length ?? 0}{" "}
                  項 ›
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      <form
        className="category-create-form"
        onSubmit={(event) => void create(event)}
      >
        <label className="field">
          <span>{parent ? "新增細項" : "新增分類"}</span>
          <input
            value={name}
            maxLength={80}
            required
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            placeholder={parent ? "例如 咖啡" : "例如 寵物"}
          />
        </label>
        <button
          className="secondary-button"
          type="submit"
          disabled={busy || !name.trim()}
        >
          {parent ? "新增細項" : "新增分類"}
        </button>
      </form>
      {error ? (
        <p className="error-message" role="alert">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}
