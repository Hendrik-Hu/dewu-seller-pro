import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseInventoryAnalytics, parseInventoryGroupSearchEnvelope, parseWarehouseSummary } from '../lib/analyticsValidation.ts';
import { buildInventoryAnalytics } from '../lib/inventoryMetrics.ts';
import { extractSkuCandidates, parseAuthoritativeAnalyticsSummary } from '../supabase/functions/_shared/authoritativeAnalytics.ts';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const emptyInventoryAnalytics = () => buildInventoryAnalytics([], [], new Date('2026-08-10T12:00:00+08:00'));

test('authoritative analytics rejects missing, nonfinite and impossible values instead of producing fake zeroes', () => {
  const valid = emptyInventoryAnalytics();
  assert.deepEqual(parseInventoryAnalytics(valid, emptyInventoryAnalytics()), valid);

  const legacyBrand = structuredClone(valid);
  legacyBrand.charts.topBrands = [{ name: 'Unknown', value: 3 }];
  assert.equal(parseInventoryAnalytics(legacyBrand, emptyInventoryAnalytics()).charts.topBrands[0].name, '未知品牌');

  const missing = structuredClone(valid) as any;
  delete missing.dashboard.totalStock;
  assert.throws(() => parseInventoryAnalytics(missing, emptyInventoryAnalytics()), /totalStock/);

  const invalid = structuredClone(valid) as any;
  invalid.dashboard.totalStock = 'NaN';
  assert.throws(() => parseInventoryAnalytics(invalid, emptyInventoryAnalytics()), /totalStock/);

  const negative = structuredClone(valid) as any;
  negative.dashboard.totalStock = -1;
  assert.throws(() => parseInventoryAnalytics(negative, emptyInventoryAnalytics()), /不能为负数/);

  const coverage = structuredClone(valid) as any;
  coverage.monthly.costCoverageRate = 101;
  assert.throws(() => parseInventoryAnalytics(coverage, emptyInventoryAnalytics()), /0到100/);
  const impossibleMargin = structuredClone(valid) as any;
  impossibleMargin.monthly.grossMarginRate = 999;
  assert.throws(() => parseInventoryAnalytics(impossibleMargin, emptyInventoryAnalytics()), /不能超过100/);
  const fractionalCount = structuredClone(valid) as any;
  fractionalCount.dashboard.totalStock = 1.5;
  assert.throws(() => parseInventoryAnalytics(fractionalCount, emptyInventoryAnalytics()), /必须为整数/);
});

test('warehouse and grouped search envelopes reject malformed success payloads', () => {
  assert.deepEqual(parseWarehouseSummary({ totalCount: '2', totalValue: 3, warehouseCount: 1, warehouseValue: 2 }), {
    totalCount: 2, totalValue: 3, warehouseCount: 1, warehouseValue: 2,
  });
  assert.throws(() => parseWarehouseSummary({ totalCount: null, totalValue: 0, warehouseCount: 0, warehouseValue: 0 }), /totalCount/);
  assert.throws(() => parseWarehouseSummary({ totalCount: 0, totalValue: 0, warehouseCount: -2, warehouseValue: 0 }), /不能为负数/);
  assert.throws(() => parseInventoryGroupSearchEnvelope({ groupCount: 1, inventoryStock: 2, rowCount: 1, page: 1, pageSize: 20 }), /products/);
  assert.throws(() => parseInventoryGroupSearchEnvelope({ groupCount: -1, inventoryStock: 2, rowCount: 1, page: 1, pageSize: 20, products: [] }), /groupCount/);
});

test('AI authoritative summary is strict and explicit numeric SKUs remain discoverable', () => {
  const analytics = emptyInventoryAnalytics();
  analytics.dashboard.totalSkuCount = 2;
  analytics.dashboard.totalVariantCount = 3;
  assert.equal(parseAuthoritativeAnalyticsSummary(analytics).skus, 2);
  assert.throws(() => parseAuthoritativeAnalyticsSummary({ dashboard: {}, monthly: {} }), /totalVariantCount/);
  assert.throws(() => parseAuthoritativeAnalyticsSummary({ ...analytics, monthly: { ...analytics.monthly, costCoverageRate: 999 } }), /above range/);
  assert.deepEqual(extractSkuCandidates('查询货号：123456 的库存'), ['123456']);
  assert.deepEqual(extractSkuCandidates('净赚 123456 最低卖多少'), []);
  assert.deepEqual(extractSkuCandidates('查询 DD1391 和 SKU AA_123'), ['AA_123', 'DD1391']);
  assert.deepEqual(extractSkuCandidates('RC-TARGET 42码主仓净赚100最低卖多少'), ['RC-TARGET']);
});

test('large-ledger SQL and clients use authoritative aggregates and stable pagination', async () => {
  const [migration, activities, products, edge, analytics] = await Promise.all([
    read('supabase/migrations/20260811010000_add_authoritative_analytics.sql'),
    read('services/activities.ts'),
    read('services/products.ts'),
    read('supabase/functions/ai-manager/index.ts'),
    read('services/analytics.ts'),
  ]);
  assert.match(migration, /at time zone 'Asia\/Shanghai'/);
  assert.match(migration, /Warehouse does not exist/);
  assert.match(migration, /p_page > 100000/);
  assert.match(activities, /order\('created_at'.*\)[\s\S]*order\('id'/);
  assert.match(products, /order\('created_at'.*\)[\s\S]*order\('id'/);
  assert.match(edge, /rpc\("get_inventory_analytics", \{\}\)/);
  assert.doesNotMatch(edge, /"activities",\s*"type,sku,size,count,price,cost/);
  assert.match(edge, /context is incomplete/);
  assert.match(edge, /\.in\("sku", skuCandidates\)/);
  assert.doesNotMatch(edge, /sku\.ilike/);
  assert.doesNotMatch(edge, /\.ilike\("sku"/);
  assert.match(analytics, /asOf \? \{ p_as_of: asOf\.toISOString\(\) \} : \{\}/);
});

test('UI distinguishes initial loading, stale snapshots, search debounce and account changes', async () => {
  const [app, home, productList] = await Promise.all([
    read('App.tsx'), read('components/Home.tsx'), read('components/ProductList.tsx'),
  ]);
  assert.match(home, /analyticsReady \? `¥ \$\{todaySalesAmount\.toLocaleString\(\)\}` : '—'/);
  assert.match(home, /!recentActivitiesReady && !recentActivitiesError/);
  assert.match(productList, /searchPending = trimmedSearchQuery !== debouncedSearchQuery/);
  assert.match(productList, /isSearchGroupingMode = debouncedSearchQuery\.length > 0/);
  assert.match(productList, /latestStatsRequest\.current/);
  assert.match(productList, /仓库列表刷新失败，当前显示上次成功结果/);
  assert.match(app, /useLayoutEffect\(\(\) => \{/);
  assert.match(app, /userRequestGeneration\.current \+= 1/);
  assert.match(app, /latestDataRequest\.current/);
  assert.match(app, /setProductsLoaded\(false\)/);
  assert.match(app, /setRecentActivitiesReady\(false\)/);
  assert.match(app, /setCurrentTab\(Tab\.HOME\)/);
});
