-- A fixed expense may be charged monthly or once each calendar year.
-- Existing items remain monthly. The Worker resolves a billing month to the
-- budget cycle containing that month's first day and snapshots only due items.
alter table public.recurring_items
  add column category text,
  add column frequency text not null default 'monthly',
  add column due_month integer,
  add constraint recurring_items_category_length check (category is null or length(category) between 1 and 80),
  add constraint recurring_items_schedule_check check (
    (kind = 'fixed_expense' and (
      (frequency = 'monthly' and due_month is null) or
      (frequency = 'annual' and due_month between 1 and 12)
    )) or
    (kind <> 'fixed_expense' and frequency = 'monthly' and due_month is null and category is null)
  );

alter table public.cycle_items
  add column category text,
  add column frequency text not null default 'monthly',
  add column due_month integer,
  add constraint cycle_items_schedule_check check (
    (kind = 'fixed_expense' and (
      (frequency = 'monthly' and due_month is null) or
      (frequency = 'annual' and due_month between 1 and 12)
    )) or
    (kind <> 'fixed_expense' and frequency = 'monthly' and due_month is null and category is null)
  );
