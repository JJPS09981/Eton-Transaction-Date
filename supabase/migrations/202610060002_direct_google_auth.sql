-- Google Identity Services is verified by the Worker. Supabase stores data only;
-- browser roles have no direct access to private application tables.
create table public.app_users (
  id uuid primary key,
  google_sub text unique check (google_sub is null or length(google_sub) between 1 and 255),
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- Preserve existing budget user IDs, and attach a prior Google identity only by
-- its provider ID. Email is intentionally never used to link accounts.
insert into public.app_users (id, google_sub, email, display_name, created_at)
select u.id, google_identity.provider_id, u.email,
       u.raw_user_meta_data ->> 'full_name', u.created_at
from auth.users u
left join lateral (
  select i.provider_id from auth.identities i
  where i.user_id = u.id and i.provider = 'google'
  order by i.created_at nulls last limit 1
) google_identity on true;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'user_settings', 'recurring_items', 'categories', 'cycles',
    'budget_state', 'installment_plans', 'command_receipts', 'budget_events'
  ] loop
    execute format('alter table public.%I drop constraint %I', table_name, table_name || '_user_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references public.app_users(id) on delete cascade',
      table_name, table_name || '_user_id_fkey'
    );
  end loop;
end $$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'app_users', 'user_settings', 'recurring_items', 'categories', 'cycles',
    'cycle_items', 'budget_state', 'day_allocations', 'transactions',
    'installment_plans', 'installment_dues', 'command_receipts',
    'budget_events', 'day_settlements', 'cycle_settlements'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from anon, authenticated', table_name);
    if table_name <> 'app_users' then
      execute format('drop policy if exists %I on public.%I', table_name || '_own_read', table_name);
    end if;
  end loop;
end $$;

revoke all on sequence public.budget_events_id_seq from anon, authenticated;
