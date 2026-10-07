-- Additive metadata; money changes remain atomic Worker commands.
alter table public.day_settlements
  add column remaining_amount bigint check (remaining_amount >= 0),
  add column pool_amount bigint check (pool_amount >= 0),
  add column carried_amount bigint check (carried_amount >= 0),
  add constraint settlement_amounts_consistent check (
    (remaining_amount is null and pool_amount is null and carried_amount is null)
    or (remaining_amount is not null and pool_amount is not null and carried_amount is not null
        and remaining_amount = pool_amount + carried_amount)
  );
-- A single closed day within a command/cycle is unambiguous, including zero.
with single_day as (
  select user_id, cycle_id, command_id from public.day_settlements
  group by user_id, cycle_id, command_id having count(*) = 1
), recovered as (
  select d.user_id, d.cycle_id, d.date,
    coalesce(sum(-e.delta) filter (where e.bucket = 'A'), 0)::bigint as remaining,
    coalesce(sum(e.delta) filter (where e.bucket = 'P'), 0)::bigint as pool,
    coalesce(sum(e.delta) filter (where e.bucket = 'F'), 0)::bigint as carried
  from public.day_settlements d
  join single_day s using (user_id, cycle_id, command_id)
  left join public.budget_events e on e.user_id = d.user_id and e.cycle_id = d.cycle_id
    and e.command_id = d.command_id and e.reason = 'day_close'
  group by d.user_id, d.cycle_id, d.date
)
update public.day_settlements d
set remaining_amount = r.remaining, pool_amount = r.pool, carried_amount = r.carried
from recovered r where d.user_id = r.user_id and d.cycle_id = r.cycle_id and d.date = r.date
  and r.remaining = r.pool + r.carried;
alter table public.cycles add column initial_net_budget boolean not null default false;
update public.cycles c set initial_net_budget = true
where start_date = (select min(first.start_date) from public.cycles first where first.user_id = c.user_id);
alter table public.cycle_items add column included_amount bigint not null default 0 check (included_amount >= 0);
update public.cycle_items i set included_amount = r.amount
from public.cycles c, public.recurring_items r, public.budget_state b
where i.user_id = c.user_id and i.cycle_id = c.id and c.initial_net_budget
  and b.user_id = c.user_id and b.cycle_id = c.id
  and r.user_id = i.user_id and r.id = i.recurring_item_id and i.kind = 'fixed_expense';
-- Establish bounded per-item allocation of the current cycle's existing
-- reservation. These amounts never assert that a bank payment occurred.
with weighted as (
  select i.id, i.cycle_id, i.recurring_item_id, i.target_amount,
    c.fixed_expense_covered::numeric as covered,
    sum(i.target_amount::numeric) over (partition by i.cycle_id) as total
  from public.cycle_items i
  join public.cycles c on c.user_id = i.user_id and c.id = i.cycle_id
  join public.budget_state b on b.user_id = i.user_id and b.cycle_id = i.cycle_id
  where i.kind = 'fixed_expense'
), shares as (
  select *, case when total = 0 then 0 else floor(covered * target_amount / total) end as base,
    case when total = 0 then 0 else mod(covered * target_amount, total) end as remainder
  from weighted
), ranked as (
  select *, row_number() over (partition by cycle_id order by remainder desc, recurring_item_id) as rank,
    covered - sum(base) over (partition by cycle_id) as extra from shares
)
update public.cycle_items i set actual_amount = (r.base + case when r.rank <= r.extra then 1 else 0 end)::bigint
from ranked r where i.id = r.id;
alter table public.budget_events
  add column note text,
  add column recurring_item_id uuid,
  add foreign key (user_id, recurring_item_id) references public.recurring_items(user_id, id);
create unique index categories_user_name_unique on public.categories(user_id, lower(btrim(name)));
insert into public.categories (id, user_id, name, icon_key, sort_order)
select gen_random_uuid(), s.user_id, seed.name, 'tag', seed.position
from public.user_settings s cross join (values
  ('餐飲', 0), ('交通', 1), ('購物', 2), ('生活', 3),
  ('居家', 4), ('娛樂', 5), ('醫療', 6), ('學習', 7), ('其他', 8)
) as seed(name, position)
on conflict (user_id, lower(btrim(name))) do nothing;
insert into public.categories (id, user_id, name, icon_key, sort_order)
select gen_random_uuid(), user_id, min(btrim(category)), 'tag', 100
from (
  select user_id, category from public.transactions
  union all select user_id, category from public.recurring_items
) legacy where category is not null and btrim(category) <> ''
group by user_id, lower(btrim(category))
on conflict (user_id, lower(btrim(name))) do nothing;
update public.transactions t set category_id = c.id
from public.categories c
where c.user_id = t.user_id and lower(btrim(c.name)) = lower(btrim(t.category)) and t.category_id is null;
create index day_settlements_user_date_idx on public.day_settlements(user_id, date);
create index transactions_user_cycle_category_idx on public.transactions(user_id, cycle_id, category_id, transaction_date desc);
