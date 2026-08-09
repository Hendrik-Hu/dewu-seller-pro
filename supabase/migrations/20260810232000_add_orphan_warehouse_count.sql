begin;

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
    and not exists (
      select 1
      from public.warehouses w
      where w.user_id = p.user_id
        and w.name = p.warehouse
    );
$$;

revoke all on function public.count_orphan_warehouse_products() from public, anon;
grant execute on function public.count_orphan_warehouse_products() to authenticated;

commit;
