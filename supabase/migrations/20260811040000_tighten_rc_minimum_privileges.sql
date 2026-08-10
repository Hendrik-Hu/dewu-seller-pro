-- The app manages fee schemes with row-scoped CRUD only. Table-wide and
-- schema-level capabilities are unnecessary and RLS does not protect TRUNCATE.
revoke truncate, references, trigger on table public.fee_schemes from authenticated;

-- These routines are trigger implementation details. PostgreSQL executes them
-- through their owning triggers without granting clients direct EXECUTE.
revoke all on function public.guard_outbound_fee_snapshot_update() from public, anon, authenticated;
revoke all on function public.guard_product_warehouse_reference() from public, anon, authenticated;
revoke all on function public.guard_warehouse_insert() from public, anon, authenticated;
revoke all on function public.normalize_fee_scheme_write() from public, anon, authenticated;
