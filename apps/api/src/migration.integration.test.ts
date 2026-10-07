import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite, types } from "@electric-sql/pglite";
import { expect, it } from "vitest";

it("freezes existing first-cycle and full-cycle income bases without changing any money", async () => {
  const db = await PGlite.create({ parsers: { [types.INT8]: (value: string) => value } });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz);
      create table auth.identities(user_id uuid, provider_id text, provider text, created_at timestamptz);
      create function auth.uid() returns uuid language sql as 'select null::uuid';`);
    const directory = resolve(import.meta.dirname, "../../../supabase/migrations");
    const files = (await readdir(directory)).filter(name => name.endsWith(".sql")).sort();
    const migration = files.indexOf("202610080003_fixed_income.sql");
    expect(migration).toBeGreaterThan(0);
    for (const name of files.slice(0, migration)) await db.exec(await readFile(resolve(directory, name), "utf8"));
    const one = crypto.randomUUID(), two = crypto.randomUUID(), first = crypto.randomUUID(), full = crypto.randomUUID();
    const firstItem = crypto.randomUUID(), fullItem = crypto.randomUUID();
    await db.query("insert into public.app_users(id) values ($1),($2)", [one, two]);
    await db.query(`insert into public.recurring_items(id,user_id,kind,name,amount) values
      ($1,$2,'income','月薪',30000),($3,$4,'income','月薪',35000)`, [firstItem, one, fullItem, two]);
    await db.query(`insert into public.cycles(id,user_id,start_date,end_date,income,fixed_expense_target,fixed_expense_covered,fixed_savings_target,fixed_savings_actual,lifestyle_budget,initial_net_budget) values
      ($1,$2,'2026-10-07','2026-10-09',8000,0,0,0,0,8000,true),
      ($3,$4,'2026-10-01','2026-10-31',30000,0,0,0,0,30000,false)`, [first, one, full, two]);
    await db.query(`insert into public.cycle_items(id,user_id,cycle_id,recurring_item_id,kind,name,target_amount,actual_amount) values
      (gen_random_uuid(),$1,$2,$3,'income','首期可運用預算',8000,8000),
      (gen_random_uuid(),$4,$5,$6,'income','月薪',30000,30000)`, [one, first, firstItem, two, full, fullItem]);
    await db.query(`insert into public.budget_state(user_id,cycle_id,today,a,p,s) values
      ($1,$2,'2026-10-07',123,456,789),($3,$4,'2026-10-07',10,20,30)`, [one, first, two, full]);
    const before = (await db.query("select * from public.budget_state order by user_id")).rows;
    for (const name of files.slice(migration)) await db.exec(await readFile(resolve(directory, name), "utf8"));
    expect((await db.query("select * from public.budget_state order by user_id")).rows).toEqual(before);
    expect((await db.query("select income_template_base,income_budget_base,target_amount from public.cycle_items where cycle_id=$1", [first])).rows[0]).toEqual({ income_template_base: "30000", income_budget_base: "8000", target_amount: "8000" });
    expect((await db.query("select income_template_base,income_budget_base,target_amount from public.cycle_items where cycle_id=$1", [full])).rows[0]).toEqual({ income_template_base: "30000", income_budget_base: "30000", target_amount: "30000" });
    await expect(db.query("update public.cycle_items set income_template_base=-1 where cycle_id=$1", [first])).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);

it("migrates populated legacy rows without changing balances or inventing daily amounts", async () => {
  const db = await PGlite.create({
    parsers: { [types.INT8]: (value: string) => value },
  });
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz);
      create table auth.identities(user_id uuid, provider_id text, provider text, created_at timestamptz);
      create function auth.uid() returns uuid language sql as 'select null::uuid';`);
    const directory = resolve(
      import.meta.dirname,
      "../../../supabase/migrations",
    );
    const files = (await readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const settingsMigration = files.indexOf(
      "202610070002_settings_calendar_categories.sql",
    );
    expect(settingsMigration).toBeGreaterThan(0);
    for (const name of files.slice(0, settingsMigration))
      await db.exec(await readFile(resolve(directory, name), "utf8"));
    const u = crypto.randomUUID(),
      v = crypto.randomUUID();
    const first = crypto.randomUUID(),
      old = crypto.randomUUID(),
      current = crypto.randomUUID();
    const item = crypto.randomUUID(),
      one = crypto.randomUUID(),
      two = crypto.randomUUID();
    await db.query("insert into public.app_users(id) values ($1), ($2)", [
      u,
      v,
    ]);
    await db.query(
      "insert into public.user_settings(user_id, cycle_start_day) values ($1, 1), ($2, 1)",
      [u, v],
    );
    await db.query(
      `insert into public.recurring_items(id,user_id,kind,name,amount) values
      ($1,$2,'fixed_expense','房租',1000), ($3,$4,'fixed_expense','甲',3), ($5,$4,'fixed_expense','乙',1)`,
      [item, u, one, v, two],
    );
    await db.query(
      "update public.recurring_items set category=' 自訂 ' where id=$1",
      [item],
    );
    await db.query(
      `insert into public.cycles(id,user_id,start_date,end_date,income,fixed_expense_target,fixed_expense_covered,fixed_savings_target,fixed_savings_actual,lifestyle_budget) values
      ($1,$2,'2026-10-01','2026-10-31',100,0,0,0,0,100),
      ($3,$4,'2026-09-01','2026-09-30',100,0,0,0,0,100),
      ($5,$4,'2026-10-01','2026-10-31',100,4,3,0,0,97)`,
      [first, u, old, v, current],
    );
    await db.query(
      `insert into public.budget_state(user_id,cycle_id,today,a,p,s) values ($1,$2,'2026-10-07',10,20,30), ($3,$4,'2026-10-07',40,50,60)`,
      [u, first, v, current],
    );
    await db.query(
      `insert into public.cycle_items(id,user_id,cycle_id,recurring_item_id,kind,name,target_amount,actual_amount) values
      (gen_random_uuid(),$1,$2,$3,'fixed_expense','房租',0,0),
      (gen_random_uuid(),$4,$5,$6,'fixed_expense','甲',0,null),
      (gen_random_uuid(),$4,$7,$6,'fixed_expense','甲',3,null),
      (gen_random_uuid(),$4,$7,$8,'fixed_expense','乙',1,null)`,
      [u, first, item, v, old, one, current, two],
    );
    const zero = crypto.randomUUID(),
      single = crypto.randomUUID(),
      multiple = crypto.randomUUID();
    for (const id of [zero, single, multiple])
      await db.query(
        "insert into public.command_receipts(user_id,command_id,request_hash,response) values ($1,$2,'legacy','{}')",
        [u, id],
      );
    await db.query(
      `insert into public.day_settlements(user_id,cycle_id,date,command_id) values
      ($1,$2,'2026-10-03',$3), ($1,$2,'2026-10-04',$4), ($1,$2,'2026-10-05',$5), ($1,$2,'2026-10-06',$5)`,
      [u, first, zero, single, multiple],
    );
    for (const [id, remainder, pool, carried] of [
      [single, -101, 51, 50],
      [multiple, -300, 150, 150],
    ] as const) {
      await db.query(
        `insert into public.budget_events(user_id,cycle_id,command_id,bucket,delta,reason,allocation_date) values
        ($1,$2,$3,'A',$4,'day_close',null), ($1,$2,$3,'P',$5,'day_close',null), ($1,$2,$3,'F',$6,'day_close','2026-10-07')`,
        [u, first, id, remainder, pool, carried],
      );
    }
    await db.query(
      `insert into public.transactions(id,user_id,cycle_id,kind,funding_source,amount,funded_amount,transaction_date,category)
      values (gen_random_uuid(),$1,$2,'expense','lifestyle',5,5,'2026-10-07',' 自訂 ')`,
      [u, first],
    );
    for (const name of files.slice(settingsMigration))
      await db.exec(await readFile(resolve(directory, name), "utf8"));
    const settlements = (
      await db.query(
        "select remaining_amount,pool_amount,carried_amount from public.day_settlements order by date",
      )
    ).rows;
    expect(settlements).toEqual([
      { remaining_amount: "0", pool_amount: "0", carried_amount: "0" },
      { remaining_amount: "101", pool_amount: "51", carried_amount: "50" },
      { remaining_amount: null, pool_amount: null, carried_amount: null },
      { remaining_amount: null, pool_amount: null, carried_amount: null },
    ]);
    expect(
      (
        await db.query(
          "select a,p,s from public.budget_state where user_id=$1",
          [u],
        )
      ).rows,
    ).toEqual([{ a: "10", p: "20", s: "30" }]);
    expect(
      (
        await db.query(
          "select included_amount,actual_amount from public.cycle_items where cycle_id=$1",
          [first],
        )
      ).rows,
    ).toEqual([{ included_amount: "1000", actual_amount: "0" }]);
    expect(
      (
        await db.query(
          "select sum(actual_amount)::bigint as total from public.cycle_items where cycle_id=$1",
          [current],
        )
      ).rows,
    ).toEqual([{ total: "3" }]);
    expect(
      (
        await db.query(
          "select actual_amount from public.cycle_items where cycle_id=$1",
          [old],
        )
      ).rows,
    ).toEqual([{ actual_amount: null }]);
    const transaction = (
      await db.query<{ category: string; category_id: string }>(
        "select category,category_id from public.transactions",
      )
    ).rows[0]!;
    expect(transaction.category).toBe(" 自訂 ");
    expect(transaction.category_id).toBeTruthy();
    expect(
      (
        await db.query("select name from public.categories where id=$1", [
          transaction.category_id,
        ])
      ).rows,
    ).toEqual([{ name: "自訂" }]);
    expect(
      (
        await db.query(
          "select subcategory_id,description,note,payment_type from public.transactions",
        )
      ).rows[0],
    ).toEqual({
      subcategory_id: null,
      description: null,
      note: null,
      payment_type: "immediate",
    });
    expect(
      (
        await db.query(
          "select hidden,scope from public.categories where id=$1",
          [transaction.category_id],
        )
      ).rows[0],
    ).toEqual({ hidden: true, scope: "daily" });
    expect(
      (
        await db.query(
          "select count(*)::int as count from public.categories where user_id=$1 and scope='daily' and hidden=false",
          [u],
        )
      ).rows[0],
    ).toEqual({ count: 7 });
    expect(
      (
        await db.query(
          "select count(*)::int as count from public.subcategories where user_id=$1",
          [u],
        )
      ).rows[0],
    ).toEqual({ count: 35 });
    const fixed = (
      await db.query<{ category_id: string }>(
        "select category_id from public.recurring_items where id=$1",
        [item],
      )
    ).rows[0]!;
    expect(fixed.category_id).toBeTruthy();
    expect(fixed.category_id).not.toBe(transaction.category_id);
    expect(
      (
        await db.query("select scope,name from public.categories where id=$1", [
          fixed.category_id,
        ])
      ).rows[0],
    ).toEqual({ scope: "fixed", name: "自訂" });
  } finally {
    await db.close();
  }
}, 30000);
