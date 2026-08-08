import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInventoryAnalytics } from '../lib/inventoryMetrics.ts';
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
