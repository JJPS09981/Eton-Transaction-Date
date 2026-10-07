import type { Db } from "./database";

export interface DueInstallment {
  id: string;
  plan_id: string;
  installment_no: number;
  amount: string;
  total_amount: string;
  installment_count: number;
  category_id: string | null;
  category_snapshot: string | null;
  subcategory_id: string | null;
  subcategory_snapshot: string | null;
  description: string | null;
  note: string | null;
}
export async function dueInstallments(
  db: Db,
  userId: string,
  startDate: string,
): Promise<DueInstallment[]> {
  return (
    await db.query<DueInstallment>(
      `select d.id,d.plan_id,d.installment_no,d.amount,p.total_amount,p.installment_count,
    p.category_id,p.category_snapshot,p.subcategory_id,p.subcategory_snapshot,p.description,p.note
    from public.installment_dues d join public.installment_plans p on p.user_id=d.user_id and p.id=d.plan_id
    where d.user_id=$1 and d.due_cycle_start=$2::date and d.status='pending' and p.canceled_at is null
    order by d.id`,
      [userId, startDate],
    )
  ).rows;
}
export async function postReservedInstallments(
  db: Db,
  userId: string,
  cycleId: string,
  startDate: string,
  dues: DueInstallment[],
  funded: Record<string, bigint>,
) {
  for (const due of dues) {
    const transactionId = crypto.randomUUID();
    const amount = funded[due.id]!;
    await db.query(
      `insert into public.transactions(id,user_id,cycle_id,kind,funding_source,amount,funded_amount,insufficient_funds,
      transaction_date,category_id,category,subcategory_id,subcategory,description,note,payment_type,installment_plan_id,installment_no,installment_count,installment_total)
      values($1,$2,$3,'expense','lifestyle',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'installment',$14,$15,$16,$17)`,
      [
        transactionId,
        userId,
        cycleId,
        due.amount,
        amount.toString(),
        amount < BigInt(due.amount),
        startDate,
        due.category_id,
        due.category_snapshot,
        due.subcategory_id,
        due.subcategory_snapshot,
        due.description,
        due.note,
        due.plan_id,
        due.installment_no,
        due.installment_count,
        due.total_amount,
      ],
    );
    await db.query(
      "update public.installment_dues set status='posted',transaction_id=$3,posted_at=now() where user_id=$1 and id=$2 and status='pending'",
      [userId, due.id, transactionId],
    );
  }
}
