import { useRef } from "react";
export function useCommandDraft() {
  const pending = useRef<{ key: string; id: string } | null>(null);
  return {
    build(body: Record<string, unknown>) {
      const key = JSON.stringify(body);
      if (pending.current?.key !== key) pending.current = { key, id: crypto.randomUUID() };
      return { ...body, commandId: pending.current.id };
    },
    reset() { pending.current = null; },
  };
}
