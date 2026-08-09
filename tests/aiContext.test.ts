import assert from 'node:assert/strict';
import test from 'node:test';
import { serializeAiContext } from '../supabase/functions/_shared/aiContext.ts';

test('SKU queries preserve relevant size rows within the Dify input limit', () => {
  const serialized = serializeAiContext({
    summary: { skus: 99, stock: 999, value: 888888, monthSales: 123456 },
    relevantProducts: [
      { sku: 'DD1391', size: '42', stock: 2, price: 749, warehouse: '惠来老家仓' },
      { sku: 'DD1391', size: '46', stock: 3, price: 799, warehouse: '广州学校仓' },
      { sku: 'DD1391', size: '均码', stock: 1, price: 0, warehouse: '北京大兴仓' },
    ],
  }, 220);

  assert.ok(serialized.length <= 220);
  const parsed = JSON.parse(serialized);
  assert.equal(parsed.products[0].sku, 'DD1391');
  assert.equal(parsed.products[0].size, '42');
  assert.ok(parsed.products.length >= 2);
});

test('global summaries are always valid JSON within the Dify input limit', () => {
  const serialized = serializeAiContext({
    summary: {
      skus: 1234, stock: 99999, value: 99999999,
      monthSales: 88888888, monthCostedSales: 77777777,
      monthKnownCost: 66666666, monthGrossProfit: 11111111,
      costCoverage: 87.6, missingCostCount: 123,
      monthInbound: 4567, monthOutbound: 3456,
    },
  }, 220);

  assert.ok(serialized.length <= 220);
  assert.doesNotThrow(() => JSON.parse(serialized));
});
