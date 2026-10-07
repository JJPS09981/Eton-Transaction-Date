import { Client } from "pg";
import { fundingStatus, type BudgetState, type MoneyEvent } from "@budget/domain";

export type Db = Client;

export interface Env {
  GOOGLE_CLIENT_ID: string;
  APP_JWT_SECRET: string;
  FRONTEND_ORIGIN: string;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
}

export async function connect(env: Env): Promise<Db> {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) throw new Error("database connection is not configured");
  const db = new Client({ connectionString });
  await db.connect();
  return db;
}

const numeric = (value: string | number | bigint): bigint => BigInt(value);

export async function loadState(db: Db, userId: string, lock = false): Promise<BudgetState | null> {
  const stateResult = await db.query(`
    select s.cycle_id, s.today::text as today, s.a, s.p, s.s,
           s.insufficient_funds, s.version,
           c.start_date::text as start_date, c.end_date::text as end_date
    from public.budget_state s
    join public.cycles c on c.id = s.cycle_id and c.user_id = s.user_id
    where s.user_id = $1
    ${lock ? "for update of s" : ""}
  `, [userId]);
  if (stateResult.rowCount === 0) return null;
  const row = stateResult.rows[0];
  const allocationResult = await db.query(`
    select date::text as date, amount from public.day_allocations
    where user_id = $1 and cycle_id = $2 and date > $3::date order by date
  `, [userId, row.cycle_id, row.today]);
  return {
    cycleId: row.cycle_id,
    startDate: row.start_date,
    endDate: row.end_date,
    today: row.today,
    A: numeric(row.a), P: numeric(row.p), S: numeric(row.s),
    F: Object.fromEntries(allocationResult.rows.map((item) => [item.date, numeric(item.amount)])),
    insufficientFunds: row.insufficient_funds,
    version: Number(row.version),
  };
}

export async function saveState(db: Db, userId: string, state: BudgetState, previousVersion: number | null): Promise<void> {
  if (previousVersion === null) {
    await db.query(`
      insert into public.budget_state (user_id, cycle_id, today, a, p, s, insufficient_funds, version)
      values ($1, $2, $3, $4, $5, $6, $7, 1)
    `, [userId, state.cycleId, state.today, state.A.toString(), state.P.toString(), state.S.toString(), state.insufficientFunds]);
  } else {
    const result = await db.query(`
      update public.budget_state
      set cycle_id = $2, today = $3, a = $4, p = $5, s = $6,
          insufficient_funds = $7, version = version + 1, updated_at = now()
      where user_id = $1 and version = $8
    `, [userId, state.cycleId, state.today, state.A.toString(), state.P.toString(), state.S.toString(), state.insufficientFunds, previousVersion]);
    if (result.rowCount !== 1) throw new Error("budget state version conflict");
  }
  await db.query("delete from public.day_allocations where user_id = $1", [userId]);
  for (const [date, amount] of Object.entries(state.F)) {
    await db.query(`
      insert into public.day_allocations (user_id, cycle_id, date, amount)
      values ($1, $2, $3, $4)
    `, [userId, state.cycleId, date, amount.toString()]);
  }
}

export interface EventEntry {
  cycleId: string;
  transactionId?: string;
  recurringItemId?: string;
  note?: string;
  event: MoneyEvent;
}

export async function insertEvents(db: Db, userId: string, commandId: string, entries: EventEntry[]): Promise<void> {
  const payload = entries.filter(({ event }) => event.delta !== 0n).map(({ cycleId, transactionId, recurringItemId, note, event }) => ({
    cycle_id: cycleId,
    transaction_id: transactionId ?? null,
    bucket: event.bucket,
    allocation_date: event.date ?? null,
    delta: event.delta.toString(),
    reason: event.reason,
    recurring_item_id: recurringItemId ?? null,
    note: note ?? null,
  }));
  if (payload.length === 0) return;
  await db.query(`
    insert into public.budget_events
      (user_id, cycle_id, command_id, transaction_id, bucket, allocation_date, delta, reason, recurring_item_id, note)
    select $1, event.cycle_id, $2, event.transaction_id, event.bucket,
           event.allocation_date, event.delta, event.reason, event.recurring_item_id, event.note
    from jsonb_to_recordset($3::jsonb) as event(
      cycle_id uuid, transaction_id uuid, bucket text,
      allocation_date date, delta bigint, reason text, recurring_item_id uuid, note text
    )
  `, [userId, commandId, JSON.stringify(payload)]);
}

export function encodeState(state: BudgetState): Record<string, unknown> {
  return {
    cycleId: state.cycleId,
    startDate: state.startDate,
    endDate: state.endDate,
    today: state.today,
    A: state.A.toString(), P: state.P.toString(), S: state.S.toString(),
    F: Object.fromEntries(Object.entries(state.F).map(([date, amount]) => [date, amount.toString()])),
    insufficientFunds: state.insufficientFunds,
    fundingStatus: fundingStatus(state),
    version: state.version,
  };
}
