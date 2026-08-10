import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseInventoryAdjustment } from '../lib/inventoryAdjustment.ts';
import type { Product } from '../types.ts';

const product: Product = {
  id: 'p1', name: 'Test', brand: 'Nike', sku: 'DD1391', size: '42', warehouse: '主仓',
  stock: 10, price: 749, status: 'instock', imageUrl: '', location: '', source: '',
};

test('inventory adjustment rejects blanks, invalid values and no-op changes', () => {
  assert.throws(() => parseInventoryAdjustment(product, '', '749', '实物盘点'), /库存/);
  assert.throws(() => parseInventoryAdjustment(product, '9', '', '实物盘点'), /成本/);
  assert.throws(() => parseInventoryAdjustment(product, '-1', '749', '实物盘点'), /库存/);
  assert.throws(() => parseInventoryAdjustment(product, '9', 'NaN', '实物盘点'), /成本/);
  assert.throws(() => parseInventoryAdjustment(product, '10', '749', '实物盘点'), /均未变化/);
});

test('inventory adjustment rounds cost to cents and keeps an explicit reason', () => {
  assert.deepEqual(parseInventoryAdjustment(product, '9', '748.126', '  实物盘点少一双  '), {
    newStock: 9,
    newCost: 748.13,
    reason: '实物盘点少一双',
  });
});

test('purchase transit arrival is a status-only audited adjustment', () => {
  const transitProduct = { ...product, status: 'shipping' as const, stock: 2 };
  assert.deepEqual(parseInventoryAdjustment(transitProduct, '2', '749', '运输中商品确认到仓', 'instock'), {
    newStock: 2,
    newCost: 749,
    targetStatus: 'instock',
    reason: '运输中商品确认到仓',
  });
  assert.throws(() => parseInventoryAdjustment(transitProduct, '2', '749', '确认到仓', 'sold'), /状态变化/);
  assert.throws(() => parseInventoryAdjustment({ ...transitProduct, stock: 0 }, '0', '749', '确认到仓', 'instock'), /库存必须大于 0/);
});

test('v0.15 makes shipping purchase transit and disables the ledgerless sold shortcut', async () => {
  const [sql, home, transitModal, inboundModal, app, service] = await Promise.all([
    readFile(new URL('../supabase/migrations/20260811030000_define_shipping_as_purchase_transit.sql', import.meta.url), 'utf8'),
    readFile(new URL('../components/Home.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/PendingOrdersModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/AddProductModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../services/products.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(sql, /p_expected_status <> 'shipping' or p_target_status <> 'instock'/);
  assert.match(sql, /revoke all on function public\.complete_pending_products\(text\[\]\) from public, anon, authenticated/i);
  assert.match(sql, /卖出必须使用出库记账/);
  assert.match(sql, /batch_inbound_products_pre_transit_v15/);
  assert.match(sql, /item->>'status' = 'shipping' or p\.status = 'shipping'/);
  assert.match(home, /采购运输中/);
  assert.match(transitModal, /到仓只转为在售/);
  assert.match(inboundModal, /直接入仓/);
  assert.match(inboundModal, /采购运输中/);
  assert.doesNotMatch(transitModal, /待发货商品|标记已处理|批量完成/);
  assert.doesNotMatch(app, /handleCompletePendingProducts|completePendingProducts/);
  assert.doesNotMatch(service, /complete_pending_products/);
});

test('v0.12 SQL locks operations and variants, checks expected values, and revokes direct writes', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260811000000_add_audited_inventory_adjustments.sql', import.meta.url), 'utf8');
  assert.match(sql, /inventory-adjustment-operation:/);
  assert.match(sql, /p_expected_stock/);
  assert.match(sql, /库存或成本已发生变化/);
  assert.match(sql, /revoke insert, update on table public\.products from authenticated/i);
  assert.match(sql, /revoke insert, update on table public\.activities from authenticated/i);
  assert.doesNotMatch(sql, /references public\.products/);
});

test('batch inbound takes the shared SKU lock before entering variant-level core', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260811000500_unify_product_master_locking.sql', import.meta.url), 'utf8');
  const skuLock = sql.indexOf("'product-master:'");
  const coreCall = sql.indexOf('batch_inbound_products_pre_sku_lock_v12(p_rows');
  assert.ok(skuLock >= 0 && coreCall > skuLock);
  assert.match(sql, /order by 1/);
  assert.match(sql, /Inbound request exceeds 1 MB/);
  assert.match(sql, /Inbound batch id is invalid/);
  assert.match(sql, /batch_inbound_products\(jsonb, uuid, text, text\)/);
  assert.match(sql, /revoke all on function public\.batch_inbound_products_pre_sku_lock_v12/);
});

test('backup v4 restores adjustment history without invoking the adjustment RPC', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260811001000_upgrade_ledger_backup_for_inventory_adjustments.sql', import.meta.url), 'utf8');
  assert.match(sql, /ledger-backup@4/);
  assert.match(sql, /盘点目标商品未恢复/);
  assert.match(sql, /if not p_dry_run then\s+perform pg_advisory_xact_lock[\s\S]+restore_ledger_backup_pre_adjustment_v12/i);
  assert.match(sql, /insert into public\.inventory_adjustment_audit/);
  assert.doesNotMatch(sql, /adjust_product_inventory\s*\(/);
});

test('cloud source remains authoritative and the retired device cache is removed', async () => {
  const source = await readFile(new URL('../services/productMetadata.ts', import.meta.url), 'utf8');
  assert.match(source, /Preferences\.remove/);
  assert.match(source, /source: product\.source \|\| ''/);
  assert.doesNotMatch(source, /metadata\[product\.id\]\?\.source/);
});

test('SKU suggestions preserve private image references and batch payloads never persist signed URLs', async () => {
  const modal = await readFile(new URL('../components/AddProductModal.tsx', import.meta.url), 'utf8');
  const products = await readFile(new URL('../services/products.ts', import.meta.url), 'utf8');
  assert.match(modal, /imageStorageRef:[\s\S]+product\.imageStorageRef/);
  assert.match(products, /isProductImageRef\(product\.imageStorageRef\)[\s\S]+product\.imageStorageRef/);
  assert.match(products, /isProductImageRef\(product\.imageUrl\)[\s\S]+: ''/);
});

test('inventory adjustment uses an in-app confirmation before any accounting write', async () => {
  const modal = await readFile(new URL('../components/InventoryAdjustmentModal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(modal, /window\.confirm/);
  assert.match(modal, /确认本次盘点/);
  assert.match(modal, /返回修改/);
  assert.match(modal, /确认记账/);
  assert.ok(modal.indexOf('setConfirmation(parsed)') < modal.indexOf('const confirmAdjustment'));
  assert.ok(modal.indexOf('saveInventoryAdjustmentDraft(userId, product.id, submittedDraft)') > modal.indexOf('const confirmAdjustment'));
});
