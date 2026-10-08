import { useRef, useState } from "react";
import type { Category, CommandHandler, Subcategory } from "../lib/api";
import { useCommandDraft } from "../lib/command";

export function SubcategoryCreator({ id, category, busy, onSubmit, onSave, onCancel }: {
  id: string;
  category: Category;
  busy: boolean;
  onSubmit: CommandHandler;
  onSave: (subcategory: Subcategory) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const draft = useCommandDraft();

  async function save() {
    if (busy || submitting.current || !name.trim()) return;
    submitting.current = true;
    setError(null);
    try {
      const result = await onSubmit(draft.build({
        type: "SaveSubcategory", categoryId: category.id, name: name.trim(),
      }));
      const subcategory = result.subcategory as Subcategory;
      if (!subcategory?.id) throw new Error("細項已儲存，請重新整理後選用。");
      draft.reset();
      onSave(subcategory);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "新增失敗，請再試一次");
    } finally {
      submitting.current = false;
    }
  }

  return <div id={id} className="subcategory-create" role="group" aria-label={`新增${category.name}細項`}>
    <label className="field">
      <span>新增{category.name}細項</span>
      <input autoFocus aria-label="細項名稱" value={name} maxLength={80} disabled={busy}
        placeholder="例如 咖啡" onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); void save();
          } else if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); if (!busy) onCancel();
          }
        }} />
    </label>
    {error ? <p className="error-message" role="alert">{error}</p> : null}
    <div className="subcategory-create-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={onCancel}>取消</button>
      <button type="button" className="primary-button" disabled={busy || !name.trim()} onClick={() => void save()}>{busy ? "新增中…" : "新增細項"}</button>
    </div>
  </div>;
}
