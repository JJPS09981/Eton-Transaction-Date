export type Bucket = "A" | "P" | "S" | "F";
export type FundingSource = "lifestyle" | "savings";

export interface BudgetState {
  cycleId: string;
  startDate: string;
  endDate: string;
  today: string;
  A: bigint;
  P: bigint;
  S: bigint;
  F: Record<string, bigint>;
  insufficientFunds: boolean;
  version: number;
}

export interface MoneyEvent {
  bucket: Bucket;
  date?: string;
  delta: bigint;
  reason: string;
}

export interface Transition {
  state: BudgetState;
  events: MoneyEvent[];
}

export interface CycleOpening extends Transition {
  snapshot: {
    income: bigint;
    fixedExpenseTarget: bigint;
    fixedExpenseCovered: bigint;
    fixedSavingsTarget: bigint;
    fixedSavingsActual: bigint;
    lifestyleBudget: bigint;
  };
}

export interface ExpenseResult extends Transition {
  nominalAmount: bigint;
  fundedAmount: bigint;
  insufficientFunds: boolean;
}

function requireNonnegative(value: bigint, name: string): void {
  if (value < 0n) throw new RangeError(`${name} must be nonnegative`);
}

export function assertState(state: BudgetState): void {
  for (const [name, value] of [["A", state.A], ["P", state.P], ["S", state.S]] as const) {
    requireNonnegative(value, name);
  }
  for (const [date, value] of Object.entries(state.F)) {
    requireNonnegative(value, `F[${date}]`);
    if (date <= state.today || date > state.endDate) throw new RangeError(`invalid future date ${date}`);
  }
  if (state.today < state.startDate || state.today > state.endDate) throw new RangeError("today outside cycle");
}

export function datesInclusive(start: string, end: string): string[] {
  const result: string[] = [];
  let cursor = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(cursor) || !Number.isFinite(last) || cursor > last) throw new RangeError("invalid date range");
  while (cursor <= last) {
    result.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return result;
}

export function shiftDate(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) throw new RangeError("invalid date");
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

export function nextScheduledStart(after: string, startDay: number): string {
  if (!Number.isInteger(startDay) || startDay < 1 || startDay > 31) throw new RangeError("invalid cycle start day");
  const year = Number(after.slice(0, 4));
  const month = Number(after.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("invalid date");
  for (let offset = 0; offset <= 12; offset++) {
    const first = new Date(Date.UTC(year, month - 1 + offset, 1));
    const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const candidate = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(startDay, lastDay)).padStart(2, "0")}`;
    if (candidate > after) return candidate;
  }
  throw new RangeError("next cycle not found");
}

// With only a billing month (no billing day), charge the cycle that contains
// the first day of that month. Exactly one monthly cycle can contain it.
export function annualDueInCycle(startDate: string, endDate: string, dueMonth: number): boolean {
  if (!Number.isInteger(dueMonth) || dueMonth < 1 || dueMonth > 12) throw new RangeError("invalid annual billing month");
  if (startDate > endDate) throw new RangeError("invalid cycle dates");
  for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
    const billingDate = `${year}-${String(dueMonth).padStart(2, "0")}-01`;
    if (billingDate >= startDate && billingDate <= endDate) return true;
  }
  return false;
}

export function distribute(total: bigint, dates: string[]): Record<string, bigint> {
  requireNonnegative(total, "total");
  if (dates.length === 0) throw new RangeError("at least one day is required");
  const divisor = BigInt(dates.length);
  const quotient = total / divisor;
  const remainder = Number(total % divisor);
  return Object.fromEntries(dates.map((date, index) => [date, quotient + (index < remainder ? 1n : 0n)]));
}

function min(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

export function available(state: BudgetState): bigint {
  assertState(state);
  return state.A + state.P + state.S + Object.values(state.F).reduce((sum, value) => sum + value, 0n);
}

export function fundingStatus(state: BudgetState): "available" | "income_overspent" | "insufficient_funds" {
  assertState(state);
  if (state.insufficientFunds) return "insufficient_funds";
  const currentCycleFunds = state.A + state.P + Object.values(state.F).reduce((sum, value) => sum + value, 0n);
  return currentCycleFunds === 0n && state.S > 0n ? "income_overspent" : "available";
}

export function openCycle(input: {
  cycleId: string;
  startDate: string;
  endDate: string;
  income: bigint;
  fixedExpenseTarget: bigint;
  fixedSavingsTarget: bigint;
  accumulatedSavings: bigint;
  version?: number;
}): CycleOpening {
  for (const [name, value] of [["income", input.income], ["fixedExpenseTarget", input.fixedExpenseTarget], ["fixedSavingsTarget", input.fixedSavingsTarget], ["accumulatedSavings", input.accumulatedSavings]] as const) {
    requireNonnegative(value, name);
  }
  const days = datesInclusive(input.startDate, input.endDate);
  const fromIncome = min(input.income, input.fixedExpenseTarget);
  const fromSavings = min(input.fixedExpenseTarget - fromIncome, input.accumulatedSavings);
  const remainingIncome = input.income - fromIncome;
  const fixedSavingsActual = min(input.fixedSavingsTarget, remainingIncome);
  const lifestyleBudget = remainingIncome - fixedSavingsActual;
  const allocations = distribute(lifestyleBudget, days);
  const firstDay = days[0]!;
  const { [firstDay]: A, ...F } = allocations;
  const state: BudgetState = {
    cycleId: input.cycleId,
    startDate: input.startDate,
    endDate: input.endDate,
    today: input.startDate,
    A: A!, P: 0n,
    S: input.accumulatedSavings - fromSavings + fixedSavingsActual,
    F,
    insufficientFunds: fromIncome + fromSavings < input.fixedExpenseTarget,
    version: input.version ?? 0,
  };
  assertState(state);
  const events: MoneyEvent[] = [];
  if (fromSavings > 0n) events.push({ bucket: "S", delta: -fromSavings, reason: "fixed_expense_coverage" });
  if (fixedSavingsActual > 0n) events.push({ bucket: "S", delta: fixedSavingsActual, reason: "fixed_savings" });
  if (A! > 0n) events.push({ bucket: "A", delta: A!, reason: "cycle_open" });
  for (const [date, amount] of Object.entries(F)) {
    if (amount > 0n) events.push({ bucket: "F", date, delta: amount, reason: "cycle_open" });
  }
  return {
    state, events,
    snapshot: {
      income: input.income,
      fixedExpenseTarget: input.fixedExpenseTarget,
      fixedExpenseCovered: fromIncome + fromSavings,
      fixedSavingsTarget: input.fixedSavingsTarget,
      fixedSavingsActual,
      lifestyleBudget,
    },
  };
}

function reallocateFuture(state: BudgetState, remaining: bigint, reason: string): MoneyEvent[] {
  const dates = Object.keys(state.F).sort();
  if (dates.length === 0) {
    if (remaining !== 0n) throw new RangeError("cannot allocate without future days");
    return [];
  }
  const next = distribute(remaining, dates);
  const events = dates.flatMap((date): MoneyEvent[] => {
    const delta = next[date]! - state.F[date]!;
    return delta === 0n ? [] : [{ bucket: "F", date, delta, reason }];
  });
  state.F = next;
  return events;
}

export function applyExpense(input: {
  state: BudgetState;
  amount: bigint;
  source: FundingSource;
}): ExpenseResult {
  if (input.amount <= 0n) throw new RangeError("expense amount must be positive");
  assertState(input.state);
  const state: BudgetState = { ...input.state, F: { ...input.state.F } };
  const events: MoneyEvent[] = [];
  let unpaid = input.amount;
  const deduct = (bucket: "A" | "P" | "S") => {
    const paid = min(unpaid, state[bucket]);
    if (paid > 0n) {
      state[bucket] -= paid;
      unpaid -= paid;
      events.push({ bucket, delta: -paid, reason: "expense" });
    }
  };
  if (input.source === "savings") {
    deduct("S");
  } else {
    deduct("A");
    deduct("P");
    const future = Object.values(state.F).reduce((sum, value) => sum + value, 0n);
    const futurePaid = min(unpaid, future);
    if (futurePaid > 0n) {
      events.push(...reallocateFuture(state, future - futurePaid, "expense"));
      unpaid -= futurePaid;
    }
    deduct("S");
    if (unpaid > 0n) state.insufficientFunds = true;
  }
  if (unpaid > 0n && available(state) === 0n) state.insufficientFunds = true;
  assertState(state);
  return { state, events, nominalAmount: input.amount, fundedAmount: input.amount - unpaid, insufficientFunds: unpaid > 0n };
}

export function correctExpense(input: {
  state: BudgetState; previousAmount: bigint; previousFunded: bigint; amount: bigint;
  originalSource: FundingSource; source: FundingSource; reapply?: boolean;
  refundDestination?: "daily" | "pool";
}): ExpenseResult {
  requireNonnegative(input.amount, "corrected amount");
  if (input.previousAmount <= 0n || input.previousFunded < 0n || input.previousFunded > input.previousAmount)
    throw new RangeError("invalid original expense");
  assertState(input.state);
  let state = { ...input.state, F: { ...input.state.F } };
  const events: MoneyEvent[] = [];
  const refund = (amount: bigint) => {
    if (!amount) return;
    const bucket = input.originalSource === "savings" ? "S" : input.refundDestination === "daily" ? "A" : "P";
    state[bucket] += amount;
    events.push({ bucket, delta: amount, reason: "transaction_correction" });
  };
  let funded = input.previousFunded;
  if (input.reapply || input.originalSource !== input.source) {
    refund(funded);
    funded = 0n;
    if (input.amount > 0n) {
      const result = applyExpense({ state, amount: input.amount, source: input.source });
      state = result.state; funded = result.fundedAmount;
      events.push(...result.events);
    }
  } else if (input.amount > input.previousAmount) {
    const result = applyExpense({ state, amount: input.amount - input.previousAmount, source: input.source });
    state = result.state; funded += result.fundedAmount;
    events.push(...result.events);
  } else if (input.amount < funded) {
    refund(funded - input.amount);
    funded = input.amount;
  }
  if (available(state) > 0n) state.insufficientFunds = false;
  assertState(state);
  return { state, events: events.map(event => ({ ...event, reason: "transaction_correction" })),
    nominalAmount: input.amount, fundedAmount: funded, insufficientFunds: funded < input.amount };
}

export function correctIncome(input: {
  state: BudgetState; previousAmount: bigint; amount: bigint;
  originalDestination: "pool" | "lifestyle" | "savings";
  destination: "pool" | "lifestyle" | "savings"; reapply?: boolean;
}): Transition & { insufficientFunds: boolean } {
  if (input.previousAmount <= 0n) throw new RangeError("invalid original income");
  requireNonnegative(input.amount, "corrected income");
  assertState(input.state);
  let state = { ...input.state, F: { ...input.state.F } };
  const events: MoneyEvent[] = [];
  let insufficientFunds = false;
  const remove = (amount: bigint) => {
    if (input.originalDestination === "pool") {
      const paid = min(amount, state.P);
      state.P -= paid; amount -= paid;
      if (paid) events.push({ bucket: "P", delta: -paid, reason: "income_correction" });
    }
    if (amount) {
      const result = applyExpense({ state, amount, source: input.originalDestination === "savings" ? "savings" : "lifestyle" });
      state = result.state; insufficientFunds = result.insufficientFunds;
      events.push(...result.events);
    }
  };
  const add = (amount: bigint) => {
    if (!amount) return;
    if (input.destination === "savings") {
      state.S += amount;
      events.push({ bucket: "S", delta: amount, reason: "income_correction" });
    } else {
      const result = addIncome(state, amount, input.destination);
      state = result.state; events.push(...result.events);
    }
  };
  if (input.reapply || input.originalDestination !== input.destination) {
    remove(input.previousAmount); add(input.amount);
  } else if (input.amount > input.previousAmount) add(input.amount - input.previousAmount);
  else if (input.amount < input.previousAmount) remove(input.previousAmount - input.amount);
  if (available(state) > 0n) state.insufficientFunds = false;
  assertState(state);
  return { state, events: events.map(event => ({ ...event, reason: "income_correction" })), insufficientFunds };
}

export interface DayClosing extends Transition {
  settlement: { date: string; remaining: bigint; toPool: bigint; toTomorrow: bigint };
}

export function closeDay(stateBefore: BudgetState): DayClosing {
  assertState(stateBefore);
  const state = { ...stateBefore, F: { ...stateBefore.F } };
  const amount = state.A;
  const events: MoneyEvent[] = [];
  if (amount > 0n) {
    state.A = 0n;
    events.push({ bucket: "A", delta: -amount, reason: "day_close" });
    const toPool = state.today === state.endDate ? amount : (amount + 1n) / 2n;
    state.P += toPool;
    events.push({ bucket: "P", delta: toPool, reason: "day_close" });
    const toTomorrow = amount - toPool;
    if (toTomorrow > 0n) {
      const tomorrow = datesInclusive(state.today, state.endDate)[1];
      if (!tomorrow) throw new RangeError("missing next day");
      state.F[tomorrow] = (state.F[tomorrow] ?? 0n) + toTomorrow;
      events.push({ bucket: "F", date: tomorrow, delta: toTomorrow, reason: "day_close" });
    }
  }
  assertState(state);
  const toPool = state.today === state.endDate ? amount : (amount + 1n) / 2n;
  return { state, events, settlement: { date: state.today, remaining: amount, toPool, toTomorrow: amount - toPool } };
}

export function adjustSavings(stateBefore: BudgetState, target: bigint): Transition {
  requireNonnegative(target, "savings target");
  assertState(stateBefore);
  const delta = target - stateBefore.S;
  const state = { ...stateBefore, F: { ...stateBefore.F }, S: target };
  if (delta > 0n && available(state) > 0n) state.insufficientFunds = false;
  return { state, events: delta === 0n ? [] : [{ bucket: "S", delta, reason: "savings_adjustment" }] };
}

export function adjustCycleBudget(input: {
  state: BudgetState; previousTarget: bigint; target: bigint;
}): Transition {
  requireNonnegative(input.previousTarget, "previous budget");
  requireNonnegative(input.target, "budget target");
  assertState(input.state);
  const state = { ...input.state, F: { ...input.state.F } };
  const difference = input.target - input.previousTarget;
  if (difference === 0n) return { state, events: [] };
  const dates = datesInclusive(state.today, state.endDate);
  const before = Object.fromEntries(dates.map(date => [date, date === state.today ? state.A : state.F[date] ?? 0n]));
  const after = { ...before };
  if (difference > 0n) {
    const increments = distribute(difference, dates);
    for (const date of dates) after[date] = before[date]! + increments[date]!;
    state.insufficientFunds = false;
  } else {
    let remaining = -difference;
    if (remaining > Object.values(before).reduce((sum, value) => sum + value, 0n))
      throw new RangeError("budget reduction exceeds remaining daily budget");
    let active = dates.filter(date => after[date]! > 0n);
    while (remaining > 0n) {
      const deductions = distribute(remaining, active);
      const capped = active.filter(date => deductions[date]! > after[date]!);
      if (capped.length === 0) {
        for (const date of active) after[date] = after[date]! - deductions[date]!;
        remaining = 0n;
      } else {
        for (const date of capped) { remaining -= after[date]!; after[date] = 0n; }
        active = active.filter(date => after[date]! > 0n);
      }
    }
  }
  const events: MoneyEvent[] = [];
  for (const date of dates) {
    const delta = after[date]! - before[date]!;
    if (date === state.today) state.A = after[date]!;
    else state.F[date] = after[date]!;
    if (delta !== 0n) events.push({ bucket: date === state.today ? "A" : "F",
      ...(date === state.today ? {} : { date }), delta, reason: "budget_adjustment" });
  }
  assertState(state);
  return { state, events };
}

// The first cycle starts from a net budget, not the full monthly income.
// Frozen bases keep later template edits from changing the correction baseline.
export function fixedIncomeTarget(amount: bigint, templateBase: bigint, budgetBase: bigint): bigint {
  for (const value of [amount, templateBase, budgetBase]) requireNonnegative(value, "fixed income");
  const target = budgetBase + amount - templateBase;
  return target > 0n ? target : 0n;
}

export function adjustFixedIncome(input: {
  state: BudgetState; previousTarget: bigint; target: bigint;
}): Transition & { insufficientFunds: boolean } {
  requireNonnegative(input.previousTarget, "previous fixed income");
  requireNonnegative(input.target, "fixed income target");
  assertState(input.state);
  const difference = input.target - input.previousTarget;
  if (difference === 0n) return {
    state: { ...input.state, F: { ...input.state.F } }, events: [], insufficientFunds: false,
  };
  if (difference > 0n) {
    const result = addIncome(input.state, difference, "lifestyle");
    return { ...result, events: result.events.map(event => ({ ...event, reason: "fixed_income_adjustment" })), insufficientFunds: false };
  }
  const result = applyExpense({ state: input.state, amount: -difference, source: "lifestyle" });
  return { state: result.state, events: result.events.map(event => ({ ...event, reason: "fixed_income_adjustment" })), insufficientFunds: result.insufficientFunds };
}

// First-cycle bills already included in the opening net budget are exempt.
export function fixedExpenseTarget(amount: bigint, includedAmount = 0n): bigint {
  requireNonnegative(amount, "fixed expense amount");
  requireNonnegative(includedAmount, "included amount");
  return amount > includedAmount ? amount - includedAmount : 0n;
}

export function adjustFixedExpense(input: {
  state: BudgetState; previousTarget: bigint; previousFunded: bigint; target: bigint;
}): Transition & { funded: bigint; insufficientFunds: boolean } {
  for (const value of [input.previousTarget, input.previousFunded, input.target]) requireNonnegative(value, "fixed expense");
  if (input.previousFunded > input.previousTarget) throw new RangeError("funded exceeds target");
  assertState(input.state);
  if (input.target > input.previousTarget) {
    const result = applyExpense({ state: input.state, amount: input.target - input.previousTarget, source: "lifestyle" });
    const funded = input.previousFunded + result.fundedAmount;
    return { state: result.state, events: result.events.map((event) => ({ ...event, reason: "fixed_expense_adjustment" })), funded, insufficientFunds: funded < input.target };
  }
  const refund = input.previousFunded > input.target ? input.previousFunded - input.target : 0n;
  const state = { ...input.state, F: { ...input.state.F }, P: input.state.P + refund };
  if (refund > 0n && available(state) > 0n) state.insufficientFunds = false;
  assertState(state);
  return { state, events: refund === 0n ? [] : [{ bucket: "P", delta: refund, reason: "fixed_expense_adjustment" }], funded: input.previousFunded - refund, insufficientFunds: input.previousFunded - refund < input.target };
}

export function startDay(stateBefore: BudgetState, date: string): Transition {
  assertState(stateBefore);
  if (date <= stateBefore.today || date > stateBefore.endDate || !Object.hasOwn(stateBefore.F, date)) throw new RangeError("invalid next day");
  const state = { ...stateBefore, F: { ...stateBefore.F }, today: date };
  const amount = state.F[date]!;
  delete state.F[date];
  state.A = amount;
  assertState(state);
  return { state, events: amount === 0n ? [] : [
    { bucket: "F", date, delta: -amount, reason: "day_start" },
    { bucket: "A", delta: amount, reason: "day_start" },
  ] };
}

export function closeCycle(stateBefore: BudgetState): Transition {
  assertState(stateBefore);
  if (stateBefore.today !== stateBefore.endDate) throw new RangeError("cycle has not reached its last day");
  const state = { ...stateBefore, F: { ...stateBefore.F }, P: 0n, S: stateBefore.S + stateBefore.P };
  const events: MoneyEvent[] = stateBefore.P === 0n ? [] : [
    { bucket: "P", delta: -stateBefore.P, reason: "cycle_close" },
    { bucket: "S", delta: stateBefore.P, reason: "cycle_close" },
  ];
  assertState(state);
  return { state, events };
}

export function addIncome(stateBefore: BudgetState, amount: bigint, destination: "pool" | "lifestyle" = "pool"): Transition {
  if (amount <= 0n) throw new RangeError("income amount must be positive");
  assertState(stateBefore);
  const state = { ...stateBefore, F: { ...stateBefore.F } };
  let events: MoneyEvent[];
  if (destination === "pool") {
    state.P += amount;
    events = [{ bucket: "P", delta: amount, reason: "extra_income" }];
  } else {
    const dates = [state.today, ...Object.keys(state.F).sort()];
    const added = distribute(amount, dates);
    state.A += added[state.today]!;
    events = added[state.today]! === 0n ? [] : [{ bucket: "A", delta: added[state.today]!, reason: "extra_income" }];
    for (const date of dates.slice(1)) {
      const delta = added[date]!;
      if (delta !== 0n) events.push({ bucket: "F", date, delta, reason: "extra_income" });
      state.F[date] = (state.F[date] ?? 0n) + delta;
    }
  }
  if (available(state) > 0n) state.insufficientFunds = false;
  assertState(state);
  return { state, events };
}

export function splitInstallments(total: bigint, count: number): bigint[] {
  if (total <= 0n || !Number.isInteger(count) || count < 1 || BigInt(count) > total) throw new RangeError("invalid installment plan");
  const base = total / BigInt(count);
  return Array.from({ length: count }, (_, index) => index === 0 ? total - base * BigInt(count - 1) : base);
}

export function installmentSchedule(total: bigint, count: number, startDate: string, cycleStartDay: number): { date: string; amount: bigint }[] {
  let date = startDate;
  return splitInstallments(total, count).map((amount, index) => {
    if (index > 0) date = nextScheduledStart(date, cycleStartDay);
    return { date, amount };
  });
}

export const expenseCategoryDefaults = [
  { name: "餐飲", icon: "food", items: ["早餐", "午餐", "晚餐", "飲料", "超商", "宵夜", "其他"] },
  { name: "交通", icon: "transport", items: ["大眾運輸", "計程車", "加油", "停車", "其他"] },
  { name: "購物", icon: "shopping", items: ["服飾", "鞋包", "3C", "日用品", "美妝", "其他"] },
  { name: "娛樂", icon: "entertainment", items: ["遊戲", "電影", "活動", "訂閱", "其他"] },
  { name: "生活", icon: "living", items: ["美髮", "清潔", "寵物", "其他"] },
  { name: "醫療", icon: "medical", items: ["看診", "藥品", "健檢", "其他"] },
  { name: "其他", icon: "other", items: ["人情", "捐款", "手續費", "其他"] },
] as const;

export function allocateFixedSavings(actual: bigint, targets: { id: string; amount: bigint }[]): Record<string, bigint> {
  requireNonnegative(actual, "actual");
  for (const target of targets) requireNonnegative(target.amount, `target ${target.id}`);
  const total = targets.reduce((sum, item) => sum + item.amount, 0n);
  if (actual > total) throw new RangeError("actual exceeds fixed savings target");
  if (total === 0n) return Object.fromEntries(targets.map((item) => [item.id, 0n]));
  const rows = targets.map((item) => ({
    id: item.id,
    base: actual * item.amount / total,
    remainder: actual * item.amount % total,
  }));
  let extra = actual - rows.reduce((sum, row) => sum + row.base, 0n);
  rows.sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1);
  for (const row of rows) {
    if (extra === 0n) break;
    row.base += 1n;
    extra -= 1n;
  }
  return Object.fromEntries(rows.map((row) => [row.id, row.base]));
}
