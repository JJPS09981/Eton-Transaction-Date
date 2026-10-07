export interface BudgetStateView {
  cycleId: string;
  startDate: string;
  endDate: string;
  today: string;
  A: string;
  P: string;
  S: string;
  F: Record<string, string>;
  insufficientFunds: boolean;
  fundingStatus: "available" | "income_overspent" | "insufficient_funds";
  version: number;
}

export interface TransactionView {
  id: string;
  kind: "expense" | "income";
  revision?: number;
  cycle_id?: string;
  income_destination?: "pool" | "lifestyle" | null;
  funding_source: "lifestyle" | "savings" | null;
  amount: string;
  funded_amount: string;
  insufficient_funds: boolean;
  transaction_date: string;
  category: string | null;
  category_id?: string | null;
  subcategory_id?: string | null;
  subcategory?: string | null;
  description?: string | null;
  payment_type?: "immediate" | "installment";
  installment_no?: number | null;
  installment_count?: number | null;
  installment_total?: string | null;
  note: string | null;
  budget_applied_at: string;
}

export interface TransactionPage {
  items: TransactionView[];
  nextCursor: string | null;
  settlement?: Settlement | null;
}

export interface DashboardData {
  initialized: boolean;
  today?: string;
  state?: BudgetStateView;
  cycle?: {
    income: string;
    fixed_expense_target: string;
    fixed_expense_covered: string;
    fixed_savings_target: string;
    fixed_savings_actual: string;
    lifestyle_budget: string;
    initial_net_budget?: boolean;
  };
  transactions?: TransactionView[];
  recurring?: FixedItem[];
  fixedExpenseMonth?: { month: string; total: string };
  savingsEvents?: { id?: string; delta: string; reason: string; applied_at: string; note?: string | null }[];
  categories?: Category[];
  subcategories?: Subcategory[];
  settings?: { cycle_start_day: number };
  account?: { email: string | null; display_name: string | null };
  cycleItems?: { recurring_item_id: string; target_amount: string; actual_amount: string; included_amount: string }[];
}

export interface FixedItem {
  id: string; kind: string; name: string; amount: string; category: string | null;
  frequency: "monthly" | "annual"; due_month: number | null; active: boolean;
}
export interface Category { id: string; name: string; hidden: boolean; sort_order: number; icon_key?: string; scope: "daily" | "fixed" }
export interface Subcategory { id: string; category_id: string; name: string; hidden: boolean; sort_order: number }
export interface Settlement { date: string; remaining_amount: string | null; pool_amount: string | null; carried_amount: string | null }
export interface CalendarData {
  month: string; days: { date: string; amount: string; count: number }[]; settlements: Settlement[];
}
export interface SummaryData {
  cycleId: string; startDate: string; endDate: string; total: string; count: number;
  categories: { key: string; name: string; amount: string; count: number }[];
}
export type CommandHandler = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

const apiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");
const TOKEN_KEY = "dynamic-budget:token";

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* Storage may be unavailable in private browsing. */ }
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export interface AuthSession {
  userId: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!apiUrl) throw new Error("尚未設定 VITE_API_URL");
  const token = getToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json() as T & { error?: string };
  if (response.status === 401) setToken(null);
  if (!response.ok) throw new ApiError(response.status, body.error ?? "操作失敗，請稍後重試");
  return body;
}

export function getPublicConfig(): Promise<{ googleClientId: string }> {
  return call("/v1/config");
}

export function getSession(): Promise<AuthSession> {
  return call("/v1/auth/session");
}

export function exchangeGoogleToken(idToken: string): Promise<AuthSession & { token: string }> {
  return call("/v1/auth/google", { method: "POST", body: JSON.stringify({ idToken }) });
}

export function getDashboard(): Promise<DashboardData> {
  return call<DashboardData>("/v1/dashboard");
}

export function getTransactions(cursor: string | null = null, filter: { date?: string; cycleId?: string; category?: string; kind?: "expense" | "income" } = {}, signal?: AbortSignal): Promise<TransactionPage> {
  const query = new URLSearchParams(filter);
  if (cursor) query.set("cursor", cursor);
  return call<TransactionPage>(`/v1/transactions?${query}`, { signal });
}
export function getCalendar(month: string, signal?: AbortSignal): Promise<CalendarData> {
  return call(`/v1/calendar?month=${encodeURIComponent(month)}`, { signal });
}
export function getSummary(signal?: AbortSignal): Promise<SummaryData> {
  return call("/v1/summary", { signal });
}
export function getRecentDescriptions(category: string, subcategory?: string, signal?: AbortSignal): Promise<{items:string[]}> {
  const query = new URLSearchParams({category,...(subcategory ? {subcategory} : {})});
  return call(`/v1/recent-descriptions?${query}`,{signal});
}

export function sendCommand(command: Record<string, unknown>): Promise<Record<string, unknown>> {
  return call<Record<string, unknown>>("/v1/commands", { method: "POST", body: JSON.stringify(command) });
}

export function money(value: string | undefined): string {
  if (value === undefined) return "NT$ 0";
  return `NT$ ${new Intl.NumberFormat("zh-TW").format(BigInt(value))}`;
}

export function shortDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${year}/${month}/${day}`;
}
