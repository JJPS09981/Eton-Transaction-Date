-- Keep transaction snapshots and all money history intact.
alter table public.categories add column scope text not null default 'daily' check (scope in ('daily', 'fixed'));
drop index public.categories_user_name_unique;
create unique index categories_user_scope_name_unique on public.categories(user_id, scope, lower(btrim(name)));
update public.categories set hidden = true where scope = 'daily';
insert into public.categories(id, user_id, name, icon_key, sort_order, scope, hidden)
select gen_random_uuid(), s.user_id, seed.name, seed.icon, seed.position, 'daily', false
from public.user_settings s cross join (values
  ('餐飲','food',0), ('交通','transport',1), ('購物','shopping',2), ('娛樂','entertainment',3),
  ('生活','living',4), ('醫療','medical',5), ('其他','other',6)
) seed(name,icon,position)
on conflict(user_id, scope, lower(btrim(name))) do update set hidden=false, icon_key=excluded.icon_key, sort_order=excluded.sort_order;
insert into public.categories(id,user_id,name,icon_key,sort_order,scope)
select gen_random_uuid(),user_id,min(btrim(category)),'tag',100,'fixed'
from public.recurring_items where kind='fixed_expense' and category is not null and btrim(category)<>''
group by user_id,lower(btrim(category));
alter table public.recurring_items add column category_id uuid,
  add foreign key(user_id,category_id) references public.categories(user_id,id);
update public.recurring_items r set category_id=c.id from public.categories c
where r.user_id=c.user_id and r.kind='fixed_expense' and c.scope='fixed' and lower(btrim(r.category))=lower(btrim(c.name));
create table public.subcategories (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.app_users(id) on delete cascade,
  category_id uuid not null, name text not null check(length(btrim(name)) between 1 and 80),
  sort_order integer not null default 0, hidden boolean not null default false, created_at timestamptz not null default now(),
  foreign key(user_id,category_id) references public.categories(user_id,id),
  unique(user_id,category_id,id)
);
create unique index subcategories_parent_name_unique on public.subcategories(user_id,category_id,lower(btrim(name)));
alter table public.subcategories enable row level security;
revoke all on public.subcategories from anon, authenticated;
insert into public.subcategories(user_id,category_id,name,sort_order)
select c.user_id,c.id,seed.name,seed.position from public.categories c join (values
 ('餐飲','早餐',0),('餐飲','午餐',1),('餐飲','晚餐',2),('餐飲','飲料',3),('餐飲','超商',4),('餐飲','宵夜',5),('餐飲','其他',6),
 ('交通','大眾運輸',0),('交通','計程車',1),('交通','加油',2),('交通','停車',3),('交通','其他',4),
 ('購物','服飾',0),('購物','鞋包',1),('購物','3C',2),('購物','日用品',3),('購物','美妝',4),('購物','其他',5),
 ('娛樂','遊戲',0),('娛樂','電影',1),('娛樂','活動',2),('娛樂','訂閱',3),('娛樂','其他',4),
 ('生活','美髮',0),('生活','清潔',1),('生活','寵物',2),('生活','其他',3),
 ('醫療','看診',0),('醫療','藥品',1),('醫療','健檢',2),('醫療','其他',3),
 ('其他','人情',0),('其他','捐款',1),('其他','手續費',2),('其他','其他',3)
) seed(parent,name,position) on c.name=seed.parent and c.scope='daily';
alter table public.installment_plans add column subcategory_id uuid, add column subcategory_snapshot text,
  add column description text, add column transaction_date date,
  add foreign key(user_id,category_id,subcategory_id) references public.subcategories(user_id,category_id,id),
  add check(subcategory_id is null or category_id is not null);
alter table public.transactions add column subcategory_id uuid, add column subcategory text,
  add column description text check(description is null or length(description)<=200),
  add column payment_type text not null default 'immediate' check(payment_type in ('immediate','installment')),
  add column installment_plan_id uuid, add column installment_no integer,
  add column installment_count integer, add column installment_total bigint,
  add foreign key(user_id,category_id,subcategory_id) references public.subcategories(user_id,category_id,id),
  add foreign key(user_id,installment_plan_id) references public.installment_plans(user_id,id),
  add check(subcategory_id is null or category_id is not null),
  add check((payment_type='immediate' and installment_plan_id is null and installment_no is null and installment_count is null and installment_total is null)
    or (payment_type='installment' and installment_plan_id is not null and installment_no is not null and installment_count is not null and installment_total is not null and installment_no>=1 and installment_no<=installment_count and installment_count between 2 and 60 and installment_total>=amount));
create unique index transactions_installment_once on public.transactions(user_id,installment_plan_id,installment_no) where installment_plan_id is not null;
create index transactions_recent_description_idx on public.transactions(user_id,category_id,created_at desc) where description is not null;
create index installment_pending_cycle_idx on public.installment_dues(user_id,due_cycle_start) where status='pending';
