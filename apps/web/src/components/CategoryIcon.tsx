import type { ReactNode } from "react";
const paths: Record<string, ReactNode> = {
  food: (
    <>
      <path d="M5 3v7M8 3v7M11 3v7M5 7h6M8 10v11M17 3c-2 3-3 6-3 9h4M18 3v18" />
    </>
  ),
  transport: (
    <>
      <rect x="5" y="3" width="14" height="16" rx="4" />
      <path d="M5 11h14M8 19l-2 3M16 19l2 3M9 6h6" />
      <circle cx="8" cy="15" r="1" />
      <circle cx="16" cy="15" r="1" />
    </>
  ),
  shopping: (
    <>
      <path d="M5 7h14l1 14H4zM9 8V5a3 3 0 0 1 6 0v3" />
    </>
  ),
  entertainment: (
    <>
      <path d="M7 7h10c3 0 5 9 3 11-1 1-3-2-4-3H8c-1 1-3 4-4 3-2-2 0-11 3-11zM7 10v4M5 12h4M15 11h.1M18 13h.1" />
    </>
  ),
  living: (
    <>
      <path d="m3 10 9-7 9 7M5 9v12h14V9" />
    </>
  ),
  medical: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  other: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M7 12h.1M12 12h.1M17 12h.1" />
    </>
  ),
  tag: (
    <>
      <path d="M3 3h8l10 10-8 8L3 11z" />
      <circle cx="7" cy="7" r="1" />
    </>
  ),
};
export function CategoryIcon({ name }: { name?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name ?? "tag"] ?? paths.tag}
    </svg>
  );
}
