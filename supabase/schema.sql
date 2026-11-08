-- PlotBook schema v2. Safe to re-run. Migrates the old "customer = one purchase" layout automatically.
create table if not exists plots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  number text not null, block text, size text,
  price numeric not null default 0,
  status text not null default 'available' check (status in ('available','sold','held')),
  created_at timestamptz not null default now()
);
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null, phone text, cnic text,
  created_at timestamptz not null default now()
);
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  customer_id uuid not null references customers on delete restrict,
  plot_id uuid not null references plots on delete restrict,
  total_price numeric not null check (total_price > 0),
  months int not null check (months > 0),
  start_date date not null,
  created_at timestamptz not null default now()
);

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='total_price') then
    insert into purchases (id, owner_id, customer_id, plot_id, total_price, months, start_date, created_at)
      select id, owner_id, id, plot_id, total_price, months, start_date, created_at from customers where plot_id is not null;
    alter table payments add column if not exists purchase_id uuid references purchases on delete cascade;
    update payments set purchase_id = customer_id where customer_id in (select id from purchases);
    delete from payments where purchase_id is null;
    alter table payments alter column purchase_id set not null;
    alter table payments drop column customer_id;
    alter table customers drop column plot_id, drop column total_price, drop column months, drop column start_date;
  end if;
end $$;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  purchase_id uuid not null references purchases on delete cascade,
  amount numeric not null check (amount > 0),
  paid_on date not null default current_date,
  method text, note text,
  created_at timestamptz not null default now()
);
create table if not exists plot_transfers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  purchase_id uuid not null references purchases on delete cascade,
  plot_id uuid not null references plots on delete cascade,
  from_customer_id uuid references customers on delete set null,
  to_customer_id uuid references customers on delete set null,
  transferred_on date not null, fee numeric not null default 0, note text,
  created_at timestamptz not null default now()
);
create table if not exists history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null, actor text, table_name text not null, row_id uuid,
  action text not null, old_data jsonb, new_data jsonb,
  created_at timestamptz not null default now()
);

-- Merge customers that were added twice (same phone): keep the oldest, move their plots to it.
with k as (select id, first_value(id) over (partition by owner_id, regexp_replace(phone,'\D','','g') order by created_at, id) keep from customers where coalesce(phone,'') <> '')
update purchases p set customer_id = k.keep from k where p.customer_id = k.id and k.keep <> k.id;
delete from customers c using (select id, first_value(id) over (partition by owner_id, regexp_replace(phone,'\D','','g') order by created_at, id) keep from customers where coalesce(phone,'') <> '') k where c.id = k.id and k.keep <> k.id;

create unique index if not exists plots_unique_number on plots (owner_id, lower(trim(number)));
create unique index if not exists purchases_one_per_plot on purchases (plot_id);
create unique index if not exists customers_unique_phone on customers (owner_id, regexp_replace(phone,'\D','','g')) where coalesce(phone,'') <> '';
create unique index if not exists customers_unique_cnic on customers (owner_id, cnic) where cnic is not null;
create index if not exists purchases_customer_idx on purchases (customer_id);
create index if not exists payments_purchase_idx on payments (purchase_id);
create index if not exists history_owner_idx on history (owner_id, created_at desc);

-- A plot is "sold" while it has a purchase and "available" again when the purchase is removed.
create or replace function sync_plot_status() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then update plots set status = 'sold' where id = new.plot_id;
  else update plots set status = 'available' where id = old.plot_id; end if;
  return null;
end $$;
drop trigger if exists purchases_plot_status on purchases;
create trigger purchases_plot_status after insert or delete on purchases for each row execute function sync_plot_status();

-- Change history: written by the database, so the app cannot skip or alter it.
create or replace function log_change() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  r := coalesce(new, old);
  insert into history (owner_id, actor, table_name, row_id, action, old_data, new_data)
  values (r.owner_id, coalesce(auth.jwt() ->> 'email', 'system'), tg_table_name, r.id, tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['plots','customers','purchases','payments','plot_transfers'] loop
    execute format('drop trigger if exists log_%1$s on %1$s', t);
    execute format('create trigger log_%1$s after insert or update or delete on %1$s for each row execute function log_change()', t);
  end loop;
end $$;

-- Ownership transfer in one step: records it and moves the plot (with its payment plan) to the new owner.
create or replace function transfer_plot(p_purchase uuid, p_to uuid, p_date date, p_fee numeric, p_note text) returns void language plpgsql as $$
declare pu purchases%rowtype;
begin
  select * into pu from purchases where id = p_purchase;
  if not found then raise exception 'Plot assignment not found'; end if;
  if pu.customer_id = p_to then raise exception 'That customer already owns this plot'; end if;
  if not exists (select 1 from customers where id = p_to) then raise exception 'New owner not found'; end if;
  insert into plot_transfers (purchase_id, plot_id, from_customer_id, to_customer_id, transferred_on, fee, note)
    values (p_purchase, pu.plot_id, pu.customer_id, p_to, p_date, coalesce(p_fee, 0), p_note);
  update purchases set customer_id = p_to where id = p_purchase;
end $$;

alter table plots enable row level security;
alter table customers enable row level security;
alter table purchases enable row level security;
alter table payments enable row level security;
alter table plot_transfers enable row level security;
alter table history enable row level security;
do $$ declare t text; begin
  foreach t in array array['plots','customers','purchases','payments','plot_transfers'] loop
    execute format('drop policy if exists "own %1$s" on %1$s', t);
    execute format('create policy "own %1$s" on %1$s for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;
drop policy if exists "own history" on history;
create policy "own history" on history for select using (owner_id = auth.uid());

notify pgrst, 'reload schema';
