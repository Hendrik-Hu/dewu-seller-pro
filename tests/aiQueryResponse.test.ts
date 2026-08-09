import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDeterministicInventoryAnswer, formatRelevantSkuInventoryAnswer } from '../supabase/functions/_shared/aiQueryResponse.ts';

const summary = {
  skus: 5,
  stock: 43,
  value: 23255,
  monthInbound: 3,
  monthOutbound: 2,
  monthSales: 1798,
  monthCostedSales: 899,
  monthKnownCost: 749,
  monthGrossProfit: 150,
  costCoverage: 50,
  missingCostCount: 1,
};

test('global inventory summaries always use authoritative figures', () => {
  const answer = buildDeterministicInventoryAnswer('帮我总结一下当前库存情况', { summary });
  assert.match(answer || '', /5 款、43 件/);
  assert.match(answer || '', /预估总值 ¥23255/);
  assert.match(answer || '', /成本覆盖率 50%/);
  assert.match(answer || '', /1 件出库缺少成本/);
});

test('SKU queries aggregate unique sizes with weighted cost and warehouse facts', () => {
  const answer = formatRelevantSkuInventoryAnswer([
    { sku: 'DD1391', size: '42', stock: 2, price: 700, warehouse: '主仓', status: 'instock' },
    { sku: 'DD1391', size: '42', stock: 1, price: 1000, warehouse: '备用仓', status: 'instock' },
    { sku: 'DD1391', size: '43', stock: 1, price: 800, warehouse: '主仓', status: 'instock' },
    { sku: 'DD1391', size: '44', stock: 9, price: 1, warehouse: '主仓', status: 'flaw' },
  ]);
  assert.match(answer, /当前在售库存 4 件/);
  assert.match(answer, /42码 3件，平均成本 ¥800/);
  assert.match(answer, /主仓 2件、备用仓 1件/);
  assert.doesNotMatch(answer, /44码/);
});

test('execution commands never bypass planning through deterministic answers', () => {
  assert.equal(buildDeterministicInventoryAnswer('总结后把 Nike DD1391 42码入库1双', { summary }), null);
});
