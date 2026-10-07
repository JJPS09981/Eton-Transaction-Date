export type SwipeAxis = "horizontal" | "vertical" | null;

// Decide once after a small dead zone; vertical scrolling must win ambiguous drags.
export function transactionSwipeAxis(dx: number, dy: number): SwipeAxis {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.25 ? "horizontal" : "vertical";
}

export function transactionSwipeOffset(dx: number, initiallyOpen: boolean, width: number): number {
  return Math.max(-width, Math.min(0, (initiallyOpen ? -width : 0) + dx));
}

export function transactionSwipeSettlesOpen(offset: number, initiallyOpen: boolean, width: number): boolean {
  return initiallyOpen ? offset < -width * 0.6 : offset <= -Math.min(48, width * 0.4);
}
