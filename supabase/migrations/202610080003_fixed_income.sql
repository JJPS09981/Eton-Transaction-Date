-- Income bases are frozen separately from the next-cycle template. The first
-- cycle's budget can differ from the monthly income; balances stay unchanged.
alter table public.cycle_items
  add column income_template_base bigint check (income_template_base >= 0),
  add column income_budget_base bigint check (income_budget_base >= 0),
  add constraint income_bases_together check (
    (income_template_base is null and income_budget_base is null)
    or (income_template_base is not null and income_budget_base is not null)
  );

update public.cycle_items i
set income_template_base = case when c.initial_net_budget then r.amount else i.target_amount end,
    income_budget_base = i.target_amount
from public.cycles c, public.recurring_items r
where i.user_id = c.user_id and i.cycle_id = c.id and i.kind = 'income'
  and r.user_id = i.user_id and r.id = i.recurring_item_id;
