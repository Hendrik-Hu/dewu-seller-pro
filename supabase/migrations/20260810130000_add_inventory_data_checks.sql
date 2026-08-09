begin;

alter table public.products
  drop constraint if exists products_stock_nonnegative,
  drop constraint if exists products_price_nonnegative,
  drop constraint if exists products_status_allowed;

alter table public.products
  add constraint products_stock_nonnegative check (stock is null or stock >= 0) not valid,
  add constraint products_price_nonnegative check (price is null or price >= 0) not valid,
  add constraint products_status_allowed check (status is null or status in ('instock', 'shipping', 'sold', 'flaw')) not valid;

alter table public.activities
  drop constraint if exists activities_count_positive,
  drop constraint if exists activities_price_nonnegative,
  drop constraint if exists activities_cost_nonnegative,
  drop constraint if exists activities_type_allowed;

alter table public.activities
  add constraint activities_count_positive check (count is null or count > 0) not valid,
  add constraint activities_price_nonnegative check (price is null or price >= 0) not valid,
  add constraint activities_cost_nonnegative check (cost is null or cost >= 0) not valid,
  add constraint activities_type_allowed check (type is null or type in ('inbound', 'outbound', 'pending', 'restore', 'transfer')) not valid;

do $$
begin
  if not exists (select 1 from public.products where price < 0) then
    alter table public.products validate constraint products_price_nonnegative;
  end if;
  if not exists (select 1 from public.products where status is not null and status not in ('instock', 'shipping', 'sold', 'flaw')) then
    alter table public.products validate constraint products_status_allowed;
  end if;
  if not exists (select 1 from public.products where stock < 0) then
    alter table public.products validate constraint products_stock_nonnegative;
  end if;

  if not exists (select 1 from public.activities where price < 0) then
    alter table public.activities validate constraint activities_price_nonnegative;
  end if;
  if not exists (select 1 from public.activities where cost < 0) then
    alter table public.activities validate constraint activities_cost_nonnegative;
  end if;
  if not exists (select 1 from public.activities where type is not null and type not in ('inbound', 'outbound', 'pending', 'restore', 'transfer')) then
    alter table public.activities validate constraint activities_type_allowed;
  end if;
  if not exists (select 1 from public.activities where count is not null and count <= 0) then
    alter table public.activities validate constraint activities_count_positive;
  end if;
end;
$$;

commit;
