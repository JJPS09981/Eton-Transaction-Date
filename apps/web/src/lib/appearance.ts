export type Appearance = { mode: "system" | "light" | "dark"; accent: "green" | "blue" | "rose" };
const key = "dynamic-budget:appearance:v1";
export function readAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "{}") as Partial<Appearance>;
    return { mode: raw.mode === "light" || raw.mode === "dark" ? raw.mode : "system", accent: raw.accent === "blue" || raw.accent === "rose" ? raw.accent : "green" };
  } catch { return { mode: "system", accent: "green" }; }
}
export function applyAppearance(appearance: Appearance) {
  const dark = appearance.mode === "dark" || (appearance.mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.accent = appearance.accent;
  try { localStorage.setItem(key, JSON.stringify(appearance)); } catch { /* Device preferences remain usable without storage. */ }
}
