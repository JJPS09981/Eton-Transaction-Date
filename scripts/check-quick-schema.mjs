import { readFileSync } from "node:fs";
import pg from "pg";
let connectionString=process.env.DATABASE_URL;
if (!connectionString) {
  const line=readFileSync(new URL("../apps/api/.dev.vars",import.meta.url),"utf8").split(/\r?\n/).find((line)=>line.startsWith("DATABASE_URL="));
  connectionString=line?.slice(13).trim().replace(/^(["'])(.*)\1$/,"$2");
}
const db=new pg.Client({connectionString,connectionTimeoutMillis:12000});
try {
  await db.connect();
  const result=await db.query(`select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='subcategory_id') as subcategories,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='transactions' and column_name='revision') as corrections,
    to_regclass('public.transaction_revisions') is not null as correction_history,
    (select count(*)::int from public.installment_plans) as installment_plans,
    (select count(*)::int from public.installment_dues where status='pending') as pending_installments`);
  console.log(JSON.stringify(result.rows[0]));
} catch(error) {
  console.error(JSON.stringify({error:error.code??"schema_check_failed"}));process.exitCode=1;
} finally {await db.end();}
