import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type View = "today" | "transactions" | "data" | "settings";

const items: { id: View; label: string; icon: ReactNode }[] = [
  { id: "today", label: "記帳", icon: <><path d="M5 4h10v16H5zM9 8h3M9 12h3M9 16h3"/><path d="m16 9 4-4 2 2-4 4-3 1z"/></> },
  { id: "transactions", label: "紀錄", icon: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18M7 15h2M13 15h4"/></> },
  { id: "data", label: "數據", icon: <><path d="M4 3v18h17M8 17v-5M13 17V7M18 17v-8"/></> },
  { id: "settings", label: "設定", icon: <><path d="M12 2.5 14 5l3.1-.3.8 3 2.8 1.4-1 2.9 1 2.9-2.8 1.4-.8 3L14 19l-2 2.5L10 19l-3.1.3-.8-3-2.8-1.4 1-2.9-1-2.9 2.8-1.4.8-3L10 5z" /><circle cx="12" cy="12" r="3" /></> },
];

function NavIcon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

export function Shell({ view, onView, children }: { view: View; onView: (view: View) => void; children: ReactNode }) {
  const [standalone] = useState(() =>
    matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && navigator.standalone === true),
  );
  const contentRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [view]);
  return <div className={`app-shell${standalone ? " standalone" : ""}`}>
    <aside className="sidebar">
      <div className="brand">日日花</div>
      <nav aria-label="主要導覽">
        {items.map((item) => <button key={item.id} type="button" className={`nav-item ${view === item.id ? "active" : ""}`} onClick={() => onView(item.id)} aria-current={view === item.id ? "page" : undefined}>
          <NavIcon>{item.icon}</NavIcon><span>{item.label}</span>
        </button>)}
      </nav>
    </aside>
    <main ref={contentRef} className="main-content">{children}</main>
    <nav className="mobile-nav" aria-label="手機導覽">
      {items.map((item) => <button key={item.id} type="button" className={view === item.id ? "active" : ""} onClick={() => onView(item.id)} aria-current={view === item.id ? "page" : undefined}>
        <NavIcon>{item.icon}</NavIcon><span>{item.label}</span>
      </button>)}
    </nav>
  </div>;
}
