-- Keep the original transaction and append each correction, including deletion.
alter table public.transactions
  add column revision integer not null default 0 check (revision >= 0),
  add column updated_at timestamptz not null default now(),
  add column deleted_at timestamptz,
  add column income_destination text check (income_destination in ('pool','lifestyle'));

update public.transactions t set income_destination = case when exists (
  select 1 from public.budget_events e where e.user_id=t.user_id and e.transaction_id=t.id
    and e.reason='extra_income' and e.bucket in ('A','F') and e.delta>0
) then 'lifestyle' else 'pool' end where t.kind='income';
alter table public.transactions add check (
  kind='income' or income_destination is null
);

create table public.transaction_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  transaction_id uuid not null,
  command_id uuid not null,
  action text not null check(action in ('edit','delete')),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(user_id,transaction_id) references public.transactions(user_id,id),
  foreign key(user_id,command_id) references public.command_receipts(user_id,command_id),
  unique(user_id,transaction_id,command_id)
);
alter table public.transaction_revisions enable row level security;
revoke all on public.transaction_revisions from anon, authenticated;
create index transaction_revisions_user_time_idx on public.transaction_revisions(user_id,created_at desc);
create index transactions_active_date_idx on public.transactions(user_id,transaction_date desc,created_at desc,id desc) where deleted_at is null;
