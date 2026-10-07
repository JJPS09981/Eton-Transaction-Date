import { z } from "zod";
import { connect, loadState, type Env } from "./database";
import { RequestError } from "./errors";

export const historyQuery = z
  .object({
    cursor: z.string().max(256).optional(),
    date: z.iso.date().optional(),
    cycleId: z.uuid().optional(),
    category: z.union([z.literal("uncategorized"), z.uuid()]).optional(),
    kind: z.enum(["expense", "income"]).optional(),
  })
  .strict();
export const recentDescriptionQuery = z
  .object({ category: z.uuid(), subcategory: z.uuid().optional() })
  .strict();
export async function readRecentDescriptions(
  env: Env,
  userId: string,
  categoryId: string,
  subcategoryId?: string,
) {
  const db = await connect(env);
  try {
    const rows = await db.query(
      `select description from (
      select distinct on(lower(btrim(description))) description,subcategory_id,created_at,id from public.transactions
      where user_id=$1 and category_id=$2 and kind='expense' and deleted_at is null and description is not null and btrim(description)<>''
      order by lower(btrim(description)),(subcategory_id=$3::uuid) desc nulls last,created_at desc,id desc
    ) recent order by (subcategory_id=$3::uuid) desc nulls last,created_at desc,id desc limit 6`,
      [userId, categoryId, subcategoryId ?? null],
    );
    return { items: rows.rows.map((row) => row.description as string) };
  } finally {
    await db.end();
  }
}
export const calendarMonth = z
  .string()
  .regex(/^(19|[2-9][0-9])[0-9]{2}-(0[1-9]|1[0-2])$/)
  .refine((value) => Number(value.slice(0, 4)) < 9999, "月份超出範圍");

export async function readCalendar(env: Env, userId: string, month: string) {
  const start = month + "-01";
  const db = await connect(env);
  try {
    await db.query("begin isolation level repeatable read read only");
    const days = await db.query(
      `
      select transaction_date::text as date, sum(amount)::text as amount, count(*)::int as count
      from public.transactions where user_id = $1 and kind = 'expense' and deleted_at is null
        and transaction_date >= $2::date and transaction_date < ($2::date + interval '1 month')
      group by transaction_date order by transaction_date
    `,
      [userId, start],
    );
    const settlements = await db.query(
      `
      select date::text as date, remaining_amount, pool_amount, carried_amount
      from public.day_settlements where user_id = $1
        and date >= $2::date and date < ($2::date + interval '1 month') order by date
    `,
      [userId, start],
    );
    await db.query("commit");
    return { month, days: days.rows, settlements: settlements.rows };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}

export async function readSummary(env: Env, userId: string) {
  const db = await connect(env);
  try {
    await db.query("begin isolation level repeatable read read only");
    const state = await loadState(db, userId);
    if (!state) throw new RequestError(409, "請先完成首次設定");
    const result = await db.query(
      `
      select coalesce(t.category_id::text, 'uncategorized') as key,
        coalesce(c.name, '未分類') as name,
        sum(t.amount)::text as amount, count(*)::int as count
      from public.transactions t
      left join public.categories c on c.user_id = t.user_id and c.id = t.category_id
      where t.user_id = $1 and t.cycle_id = $2 and t.kind = 'expense' and t.deleted_at is null
      group by t.category_id, c.name order by sum(t.amount) desc, name, key
    `,
      [userId, state.cycleId],
    );
    const total = result.rows
      .reduce((sum, row) => sum + BigInt(row.amount), 0n)
      .toString();
    const count = result.rows.reduce((sum, row) => sum + Number(row.count), 0);
    await db.query("commit");
    return {
      cycleId: state.cycleId,
      startDate: state.startDate,
      endDate: state.endDate,
      categories: result.rows,
      total,
      count,
    };
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally {
    await db.end();
  }
}
