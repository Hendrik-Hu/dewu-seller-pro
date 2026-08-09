import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInventoryAnalytics, getActivityQuantity, hasInvalidActivityQuantity } from '../lib/inventoryMetrics.ts';
import type { Product } from '../types.ts';
import type { Activity } from '../types.ts';

const activity = (overrides: Partial<Activity>): Activity => ({
  id: 'activity',
  type: 'outbound',
  productName: 'Test Product',
  time: '刚刚',
  sku: 'SKU001',
  size: '42',
  price: 0,
  imageUrl: '',
  createdAt: '2026-08-08T10:00:00+08:00',
  ...overrides,
});

test('monthly gross profit excludes sales with missing cost instead of treating cost as zero', () => {
  const analytics = buildInventoryAnalytics([], [
    activity({ id: 'known-cost', price: 100, cost: 60, count: 2 }),
    activity({ id: 'missing-cost', price: 50, cost: undefined, count: 1 }),
  ], new Date('2026-08-08T12:00:00+08:00'));

  assert.equal(analytics.monthly.salesAmount, 250);
  assert.equal(analytics.monthly.costedSalesAmount, 200);
  assert.equal(analytics.monthly.costAmount, 120);
  assert.equal(analytics.monthly.grossProfitAmount, 80);
  assert.equal(analytics.monthly.grossMarginRate, 40);
  assert.equal(analytics.monthly.missingCostCount, 1);
  assert.ok(Math.abs(analytics.monthly.costCoverageRate - (200 / 3)) < 1e-10);
});

test('rolling 30 day trend excludes an activity from the same month and day in a previous year', () => {
  const analytics = buildInventoryAnalytics([], [
    activity({ id: 'current', price: 100, createdAt: '2026-08-08T10:00:00+08:00' }),
    activity({ id: 'old', price: 999, createdAt: '2025-08-08T10:00:00+08:00' }),
  ], new Date('2026-08-08T12:00:00+08:00'));

  const today = analytics.charts.salesTrend.find((point) => point.name === '8/8');
  assert.equal(today?.value, 100);
});

test('missing legacy activity count defaults to one but explicit nonpositive counts are excluded', () => {
  assert.equal(getActivityQuantity(activity({ count: undefined })), 1);
  assert.equal(getActivityQuantity(activity({ count: 0 })), 0);
  assert.equal(getActivityQuantity(activity({ count: -2 })), 0);
  assert.equal(hasInvalidActivityQuantity(activity({ count: 0 })), true);
  assert.equal(hasInvalidActivityQuantity(activity({ count: undefined })), false);
});

test('negative stock and invalid activities are excluded and counted as data quality issues', () => {
  const invalidProduct = {
    id: 'invalid', name: 'Invalid', brand: 'Nike', size: '42', sku: 'BAD1', price: 100,
    stock: -5, imageUrl: '', status: 'instock',
  } satisfies Product;
  const analytics = buildInventoryAnalytics([invalidProduct], [
    activity({ type: 'inbound', count: -5 }),
  ], new Date('2026-08-08T12:00:00+08:00'));

  assert.equal(analytics.dashboard.totalStock, 0);
  assert.equal(analytics.dashboard.totalInventoryValue, 0);
  assert.equal(analytics.lifetime.totalInboundCount, 0);
  assert.deepEqual(analytics.dataQuality, { negativeStockCount: 1, invalidActivityCount: 1 });
});

test('estimated and actual net profit remain separate and unknown fees do not inflate either total', () => {
  const analytics = buildInventoryAnalytics([], [
    activity({ id: 'settled', price: 100, cost: 60, count: 2, estimatedNetProfit: 60, actualPlatformFee: 30, actualNetProfit: 50 }),
    activity({ id: 'estimated-only', price: 100, cost: 70, count: 1, estimatedNetProfit: 20 }),
    activity({ id: 'fee-unknown', price: 100, cost: 80, count: 1 }),
    activity({ id: 'cost-unknown', price: 100, cost: undefined, count: 1, actualPlatformFee: 10 }),
  ], new Date('2026-08-08T12:00:00+08:00'));

  assert.equal(analytics.monthly.estimatedNetProfitAmount, 80);
  assert.equal(analytics.monthly.estimatedProfitCount, 3);
  assert.equal(analytics.monthly.actualNetProfitAmount, 50);
  assert.equal(analytics.monthly.actualProfitCount, 2);
  assert.equal(analytics.monthly.pendingSettlementCount, 2);
  assert.equal(analytics.monthly.settlementCoverageRate, 60);
  assert.equal(analytics.monthly.estimatedProfitCoverageRate, 75);
  assert.equal(analytics.monthly.actualProfitCoverageRate, 50);
});

test('zero profit totals remain distinguishable from having no calculable profit records', () => {
  const empty = buildInventoryAnalytics([], [], new Date('2026-08-08T12:00:00+08:00'));
  assert.equal(empty.monthly.estimatedNetProfitAmount, 0);
  assert.equal(empty.monthly.estimatedProfitCount, 0);
  assert.equal(empty.monthly.actualNetProfitAmount, 0);
  assert.equal(empty.monthly.actualProfitCount, 0);

  const calculatedZero = buildInventoryAnalytics([], [
    activity({ id: 'zero-profit', price: 100, cost: 100, count: 1, estimatedNetProfit: 0, actualPlatformFee: 0, actualNetProfit: 0 }),
  ], new Date('2026-08-08T12:00:00+08:00'));
  assert.equal(calculatedZero.monthly.estimatedNetProfitAmount, 0);
  assert.equal(calculatedZero.monthly.estimatedProfitCount, 1);
  assert.equal(calculatedZero.monthly.actualNetProfitAmount, 0);
  assert.equal(calculatedZero.monthly.actualProfitCount, 1);
});
