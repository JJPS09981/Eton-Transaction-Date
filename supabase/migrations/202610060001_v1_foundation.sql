-- All money writes are issued by the Worker in one PostgreSQL transaction.
create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cycle_start_day integer not null check (cycle_start_day between 1 and 31),
  budget_timezone text not null default 'Asia/Taipei',
  created_at timestamptz not null default now()
);

create table public.recurring_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'fixed_expense', 'fixed_savings')),
  name text not null,
  amount bigint not null check (amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.categories (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon_key text not null,
  sort_order integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.cycles (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  income bigint not null check (income >= 0),
  fixed_expense_target bigint not null check (fixed_expense_target >= 0),
  fixed_expense_covered bigint not null check (fixed_expense_covered >= 0 and fixed_expense_covered <= fixed_expense_target),
  fixed_savings_target bigint not null check (fixed_savings_target >= 0),
  fixed_savings_actual bigint not null check (fixed_savings_actual >= 0 and fixed_savings_actual <= fixed_savings_target),
  lifestyle_budget bigint not null check (lifestyle_budget >= 0),
  insufficient_funds boolean not null default false,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (start_date <= end_date),
  unique (user_id, start_date),
  unique (user_id, id)
);

create table public.cycle_items (
  id uuid primary key,
  user_id uuid not null,
  cycle_id uuid not null,
  recurring_item_id uuid not null,
  kind text not null check (kind in ('income', 'fixed_expense', 'fixed_savings')),
  name text not null,
  target_amount bigint not null check (target_amount >= 0),
  actual_amount bigint check (actual_amount is null or (actual_amount >= 0 and actual_amount <= target_amount)),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id) on delete cascade,
  foreign key (user_id, recurring_item_id) references public.recurring_items(user_id, id),
  unique (cycle_id, recurring_item_id)
);

create table public.budget_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cycle_id uuid not null,
  today date not null,
  a bigint not null check (a >= 0),
  p bigint not null check (p >= 0),
  s bigint not null check (s >= 0),
  insufficient_funds boolean not null default false,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id)
);

create table public.day_allocations (
  user_id uuid not null,
  cycle_id uuid not null,
  date date not null,
  amount bigint not null check (amount >= 0),
  primary key (user_id, cycle_id, date),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id) on delete cascade
);

create table public.transactions (
  id uuid primary key,
  user_id uuid not null,
  cycle_id uuid not null,
  kind text not null check (kind in ('expense', 'income')),
  funding_source text check (funding_source in ('lifestyle', 'savings')),
  amount bigint not null check (amount > 0),
  funded_amount bigint not null check (funded_amount >= 0 and funded_amount <= amount),
  insufficient_funds boolean not null default false,
  transaction_date date not null,
  budget_applied_at timestamptz not null default now(),
  category_id uuid,
  category text,
  note text,
  created_at timestamptz not null default now(),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id),
  foreign key (user_id, category_id) references public.categories(user_id, id),
  unique (user_id, id)
);

create table public.installment_plans (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_cycle_id uuid not null,
  total_amount bigint not null check (total_amount > 0),
  installment_count integer not null check (installment_count > 0 and installment_count <= total_amount),
  category_id uuid,
  category_snapshot text,
  note text,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (user_id, start_cycle_id) references public.cycles(user_id, id),
  foreign key (user_id, category_id) references public.categories(user_id, id),
  unique (user_id, id)
);

create table public.installment_dues (
  id uuid primary key,
  user_id uuid not null,
  plan_id uuid not null,
  installment_no integer not null check (installment_no > 0),
  due_cycle_start date not null,
  amount bigint not null check (amount > 0),
  status text not null check (status in ('pending', 'posted', 'canceled')),
  transaction_id uuid,
  posted_at timestamptz,
  foreign key (user_id, plan_id) references public.installment_plans(user_id, id),
  foreign key (user_id, transaction_id) references public.transactions(user_id, id),
  unique (plan_id, installment_no),
  unique (user_id, id)
);

create table public.command_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  command_id uuid not null,
  request_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, command_id)
);

create table public.budget_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid not null,
  command_id uuid not null,
  transaction_id uuid,
  bucket text not null check (bucket in ('A', 'P', 'S', 'F')),
  allocation_date date,
  delta bigint not null check (delta <> 0),
  reason text not null,
  applied_at timestamptz not null default now(),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id),
  foreign key (user_id, transaction_id) references public.transactions(user_id, id),
  foreign key (user_id, command_id) references public.command_receipts(user_id, command_id),
  check ((bucket = 'F' and allocation_date is not null) or (bucket <> 'F' and allocation_date is null))
);

create table public.day_settlements (
  user_id uuid not null,
  cycle_id uuid not null,
  date date not null,
  command_id uuid not null,
  settled_at timestamptz not null default now(),
  primary key (cycle_id, date),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id),
  foreign key (user_id, command_id) references public.command_receipts(user_id, command_id)
);

create table public.cycle_settlements (
  user_id uuid not null,
  cycle_id uuid primary key,
  command_id uuid not null,
  settled_at timestamptz not null default now(),
  foreign key (user_id, cycle_id) references public.cycles(user_id, id),
  foreign key (user_id, command_id) references public.command_receipts(user_id, command_id)
);

create index transactions_user_date_idx on public.transactions(user_id, transaction_date desc, created_at desc, id desc);
create index budget_events_user_time_idx on public.budget_events(user_id, applied_at desc);
create index cycles_user_dates_idx on public.cycles(user_id, start_date desc);

-- Browser roles may only read their own rows. Direct Worker connections must also
-- scope every query to the verified user_id because direct SQL has no JWT context.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings','recurring_items','categories','cycles','cycle_items','budget_state',
    'day_allocations','transactions','installment_plans','installment_dues','command_receipts','budget_events',
    'day_settlements','cycle_settlements'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name || '_own_read', table_name);
  end loop;
end $$;
