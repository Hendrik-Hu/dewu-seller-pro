import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('operation entry points no longer preload the full product catalog', async () => {
  const app = await read('App.tsx');
  assert.doesNotMatch(app, /listAllProducts|ensureProductsLoaded|productsLoaded/);
  assert.doesNotMatch(app, /existingProducts=|products=\{products\}/);
  assert.match(app, /<AddProductModal/);
  assert.match(app, /<OutboundModal/);
  assert.match(app, /<TransitInventoryModal[\s\S]*userId=\{session\.user\.id\}/);
});

test('inbound suggestions are debounced, guarded, and limited to five server results', async () => {
  const modal = await read('components/AddProductModal.tsx');
  assert.match(modal, /suggestInventorySkus\(userId, prefix, 5\)/);
  assert.match(modal, /window\.setTimeout\([\s\S]*250/);
  assert.match(modal, /latestSuggestionRequest/);
  assert.doesNotMatch(modal, /existingProducts/);
  assert.match(modal, /联想失败，可继续手动填写/);
});

test('outbound and transit lists use paginated server queries with latest-request guards', async () => {
  const [outbound, pending] = await Promise.all([
    read('components/OutboundModal.tsx'),
    read('components/PendingOrdersModal.tsx'),
  ]);
  assert.match(outbound, /listProducts\(\{[\s\S]*status: 'instock'[\s\S]*minStock: 1[\s\S]*pageSize: 20/);
  assert.match(outbound, /listActiveSkuVariants\(userId, selectedProduct\.sku\)/);
  assert.match(outbound, /latestCatalogRequest/);
  assert.match(outbound, /searchPending/);
  assert.doesNotMatch(outbound, /products\.filter/);

  assert.match(pending, /listProducts\(\{[\s\S]*status: 'shipping'[\s\S]*pageSize: 20/);
  assert.match(pending, /latestRequest/);
  assert.match(pending, /到仓核对/);
  assert.doesNotMatch(pending, /标记已处理|批量完成/);
  assert.doesNotMatch(pending, /products\.filter/);
});

test('operation catalog SQL is own-user scoped and uses literal normalized SKU matching', async () => {
  const migration = await read('supabase/migrations/20260811020000_add_operation_catalog_queries.sql');
  assert.match(migration, /suggest_inventory_skus/);
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 5\), 1\), 5\)/);
  assert.match(migration, /p\.user_id = v_user/);
  assert.match(migration, /replace\(v_prefix, '_', '\\_'\)/);
  assert.match(migration, /like v_pattern escape '\\'/);
  assert.match(migration, /upper\(btrim\(p\.sku\)\) = v_sku/);
  assert.match(migration, /revoke all on function public\.suggest_inventory_skus[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.list_active_sku_variants[\s\S]*to authenticated/);
});

test('generic product paging escapes LIKE wildcard characters and supports positive-stock filtering', async () => {
  const service = await read('services/products.ts');
  assert.match(service, /value\.replace\(\/\[\\\\%\(\),_\]\/g/);
  assert.match(service, /minStock = 0/);
  assert.match(service, /\.gte\('stock', minStock\)/);
});
