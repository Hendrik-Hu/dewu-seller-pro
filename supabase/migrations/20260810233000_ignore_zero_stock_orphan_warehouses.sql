begin;

create or replace function public.list_orphan_warehouse_products()
returns table (
  id text,
  name text,
  sku text,
  size text,
  warehouse text,
  stock integer,
  status text,
  created_at timestamptz
)
language sql
security invoker
set search_path = public, pg_temp
as $$
  select p.id, p.name, p.sku, p.size, p.warehouse, p.stock, p.status, p.created_at
  from public.products p
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and p.stock <> 0
    and not exists (
      select 1
      from public.warehouses w
      where w.user_id = p.user_id
        and w.name = p.warehouse
    )
  order by p.created_at, p.id;
$$;

create or replace function public.count_orphan_warehouse_products()
returns bigint
language sql
security invoker
set search_path = public, pg_temp
as $$
  select count(*)
  from public.products p
  where p.user_id = auth.uid()
    and p.deleted_at is null
    and p.stock <> 0
    and not exists (
      select 1
      from public.warehouses w
      where w.user_id = p.user_id
        and w.name = p.warehouse
    );
$$;

revoke all on function public.list_orphan_warehouse_products() from public, anon;
revoke all on function public.count_orphan_warehouse_products() from public, anon;
grant execute on function public.list_orphan_warehouse_products() to authenticated;
grant execute on function public.count_orphan_warehouse_products() to authenticated;

commit;
