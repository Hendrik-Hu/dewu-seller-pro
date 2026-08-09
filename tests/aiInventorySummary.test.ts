import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAiInventorySummary, formatAiInventorySummaryAnswer } from '../supabase/functions/_shared/aiInventorySummary.ts';

test('AI summary excludes missing-cost sales from gross profit', () => {
  const summary = buildAiInventorySummary([], [
    { type: 'outbound', count: 2, price: 100, cost: 60, created_at: '2026-08-05T10:00:00Z' },
    { type: 'outbound', count: 1, price: 500, cost: null, created_at: '2026-08-06T10:00:00Z' },
  ], new Date('2026-08-09T12:00:00Z'));

  assert.equal(summary.monthSales, 700);
  assert.equal(summary.monthCostedSales, 200);
  assert.equal(summary.monthKnownCost, 120);
  assert.equal(summary.monthGrossProfit, 80);
  assert.equal(summary.missingCostCount, 1);
  assert.equal(summary.costCoverage, 66.7);
});

test('AI summary counts only active in-stock products in inventory totals', () => {
  const summary = buildAiInventorySummary([
    { sku: 'aa1', stock: 2, price: 100, status: 'instock' },
    { sku: 'AA1', stock: 3, price: 80, status: 'shipping' },
    { sku: 'BB2', stock: 1, price: 50, status: 'flaw' },
  ], [], new Date('2026-08-09T12:00:00Z'));

  assert.equal(summary.variants, 1);
  assert.equal(summary.skus, 1);
  assert.equal(summary.stock, 2);
  assert.equal(summary.value, 200);
  assert.equal(summary.costCoverage, 100);
});

test('AI monthly summary follows China time at the UTC month boundary', () => {
  const summary = buildAiInventorySummary([], [
    { type: 'outbound', count: 1, price: 88, cost: 40, created_at: '2026-07-31T16:30:00Z' },
  ], new Date('2026-08-01T01:00:00+08:00'));

  assert.equal(summary.monthSales, 88);
  assert.equal(summary.monthGrossProfit, 48);
});

test('deterministic fallback explains missing-cost profit coverage', () => {
  const answer = formatAiInventorySummaryAnswer({
    variants: 2,
    skus: 1,
    stock: 3,
    value: 1200,
    monthSales: 900,
    monthCostedSales: 700,
    monthKnownCost: 500,
    monthGrossProfit: 200,
    monthInbound: 3,
    monthOutbound: 2,
    costCoverage: 50,
    missingCostCount: 1,
  });

  assert.match(answer, /当前在售库存共 1 款、3 件/);
  assert.match(answer, /毛利润 ¥200/);
  assert.match(answer, /1 件出库缺少成本，未计入毛利润/);
});
