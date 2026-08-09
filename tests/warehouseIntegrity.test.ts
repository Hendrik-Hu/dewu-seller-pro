import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../supabase/migrations/20260810230000_harden_warehouse_master_data.sql', import.meta.url),
  'utf8',
);
const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(new URL('../components/AddProductModal.tsx', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../services/warehouses.ts', import.meta.url), 'utf8');
const dataHealthSource = readFileSync(new URL('../services/dataHealth.ts', import.meta.url), 'utf8');
const orphanCountMigration = readFileSync(
  new URL('../supabase/migrations/20260810232000_add_orphan_warehouse_count.sql', import.meta.url),
  'utf8',
);
const zeroStockOrphanMigration = readFileSync(
  new URL('../supabase/migrations/20260810233000_ignore_zero_stock_orphan_warehouses.sql', import.meta.url),
  'utf8',
);

test('warehouse mutations are RPC-only and direct authenticated DML is revoked', () => {
  assert.match(migration, /revoke insert, update, delete on table public\.warehouses from authenticated/i);
  assert.match(serviceSource, /rpc\('create_warehouse'/);
  assert.match(serviceSource, /rpc\('rename_warehouse'/);
  assert.match(serviceSource, /rpc\('set_default_warehouse'/);
  assert.match(serviceSource, /rpc\('delete_warehouse'/);
  assert.doesNotMatch(serviceSource, /createDefaultWarehouses/);
  assert.doesNotMatch(serviceSource, /\.insert\(|\.update\(|\.delete\(/);
});

test('warehouse rules are transactionally guarded in the database', () => {
  assert.match(migration, /warehouses_user_normalized_name_unique/);
  assert.match(migration, /warehouses_one_default_per_user/);
  assert.match(migration, /v_count >= 6/);
  assert.match(migration, /products_guard_warehouse_reference/);
  assert.match(migration, /update public\.products[\s\S]*where user_id = v_user_id and warehouse = v_old_name/i);
  assert.doesNotMatch(migration, /update public\.activities/i);
});

test('new accounts and inbound drafts never fabricate example warehouses', () => {
  for (const source of [appSource, modalSource]) {
    assert.doesNotMatch(source, /杭州一号仓|上海浦东仓|北京大兴仓|广州白云仓/);
  }
  assert.match(appSource, /请先在库存页点击右上角加号/);
  assert.match(modalSource, /请先关闭窗口，在库存页点击右上角加号创建仓库/);
});

test('ledger restore validates normalized warehouse names before delegating to the definer core', () => {
  assert.match(migration, /备份包包含大小写或空白归一后同名的仓库/);
  assert.match(migration, /restore_ledger_backup_pre_warehouse_v11/);
  assert.match(migration, /revoke all on function public\.restore_ledger_backup_pre_warehouse_v11[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /security definer[\s\S]*return public\.restore_ledger_backup_pre_warehouse_v11/i);
});

test('orphan warehouse inventory is visible in data health and the profile issue count', () => {
  assert.match(dataHealthSource, /list_orphan_warehouse_products/);
  assert.match(dataHealthSource, /repair_orphan_product_warehouse/);
  assert.match(appSource, /orphanWarehouseIssueCount/);
  assert.match(appSource, /invalidActivityCount \+ orphanWarehouseIssueCount/);
});

test('orphan warehouse badge uses an exact server-side count', () => {
  assert.match(dataHealthSource, /rpc\('count_orphan_warehouse_products'\)/);
  assert.match(orphanCountMigration, /create or replace function public\.count_orphan_warehouse_products\(\)/);
  assert.match(orphanCountMigration, /select count\(\*\)/);
});

test('deleting an empty warehouse does not create zero-stock health warnings', () => {
  assert.match(zeroStockOrphanMigration, /p\.stock <> 0/g);
  assert.match(zeroStockOrphanMigration, /create or replace function public\.list_orphan_warehouse_products/);
  assert.match(zeroStockOrphanMigration, /create or replace function public\.count_orphan_warehouse_products/);
});
