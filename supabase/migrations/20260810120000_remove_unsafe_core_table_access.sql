begin;

drop policy if exists "Allow All Access Activities" on public.activities;

revoke all on table public.products from anon;
revoke all on table public.activities from anon;
revoke all on table public.warehouses from anon;
revoke all on table public.profiles from anon;

revoke all on table public.products from authenticated;
revoke all on table public.activities from authenticated;
revoke all on table public.warehouses from authenticated;
revoke all on table public.profiles from authenticated;

grant select, insert, update, delete on table public.products to authenticated;
grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.warehouses to authenticated;
grant select, insert, update on table public.profiles to authenticated;

commit;
