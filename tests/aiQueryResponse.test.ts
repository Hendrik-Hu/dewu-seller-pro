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

const feeScheme = {
  id: 'fee-1', name: '默认鞋类', sale_mode: '普通出售', category: '鞋类', percent_rate: 5,
  percent_min: 3, percent_max: 20, percentage_unit: 'transaction', fixed_fee: 2,
  fixed_fee_unit: 'transaction', shipping_fee: 8, shipping_fee_unit: 'transaction',
  other_fee: 1, other_fee_unit: 'transaction', effective_from: '2026-08-10T00:00:00.000Z',
  is_default: true, updated_at: '2026-08-10T00:00:00.000Z',
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

test('target pricing uses one authoritative SKU size warehouse variant and default fee scheme', () => {
  const answer = buildDeterministicInventoryAnswer('DD1391 42码 主仓 2双，净赚100最低卖多少', {
    relevantProducts: [
      { sku: 'DD1391', size: '42', warehouse: '主仓', stock: 3, price: 749, status: 'instock' },
      { sku: 'DD1391', size: '43', warehouse: '主仓', stock: 1, price: 780, status: 'instock' },
    ],
    feeSchemes: [feeScheme],
  });
  assert.match(answer || '', /最低单件售价/);
  assert.match(answer || '', /成本 ¥749\.00 × 2/);
  assert.match(answer || '', /费用方案“默认鞋类”/);
  assert.match(answer || '', /生效时间 2026-08-10/);
  assert.match(answer || '', /不会生成或执行库存操作/);
});

test('target pricing refuses to choose between multiple inventory variants', () => {
  const answer = buildDeterministicInventoryAnswer('DD1391 净赚100最低卖多少', {
    relevantProducts: [
      { sku: 'DD1391', size: '42', warehouse: '主仓', stock: 2, price: 749, status: 'instock' },
      { sku: 'DD1391', size: '43', warehouse: '备用仓', stock: 1, price: 800, status: 'instock' },
    ],
    feeSchemes: [feeScheme],
  });
  assert.match(answer || '', /明确唯一库存变体/);
  assert.match(answer || '', /42码 \/ 主仓/);
  assert.match(answer || '', /43码 \/ 备用仓/);
  assert.doesNotMatch(answer || '', /最低单件售价/);
});

test('target amounts and sale prices are never mistaken for an omitted size', () => {
  const context = {
    relevantProducts: [
      { sku: 'DD1391', size: '42', warehouse: '主仓', stock: 2, price: 749, status: 'instock' },
      { sku: 'DD1391', size: '43', warehouse: '主仓', stock: 1, price: 800, status: 'instock' },
    ],
    feeSchemes: [feeScheme],
  };
  const targetAnswer = buildDeterministicInventoryAnswer('DD1391 主仓 净赚42最低卖多少', context);
  const quoteAnswer = buildDeterministicInventoryAnswer('DD1391 主仓 卖42到手多少', context);
  assert.match(targetAnswer || '', /明确唯一库存变体/);
  assert.match(quoteAnswer || '', /明确唯一库存变体/);
  assert.doesNotMatch(targetAnswer || '', /最低单件售价/);
  assert.doesNotMatch(quoteAnswer || '', /预计到手/);
});

test('price quote queries use the same deterministic fee calculation', () => {
  const answer = buildDeterministicInventoryAnswer('DD1391 42码 主仓 卖899到手多少', {
    relevantProducts: [{ sku: 'DD1391', size: '42', warehouse: '主仓', stock: 2, price: 749, status: 'instock' }],
    feeSchemes: [feeScheme],
  });
  assert.match(answer || '', /单件售价 ¥899\.00/);
  assert.match(answer || '', /预计到手/);
  assert.match(answer || '', /预计净利润/);
});

test('zero target pricing reports an undefined margin without crashing', () => {
  const answer = buildDeterministicInventoryAnswer('ZERO 42码 主仓 净赚0最低卖多少', {
    relevantProducts: [{ sku: 'ZERO', size: '42', warehouse: '主仓', stock: 1, price: 0, status: 'instock' }],
    feeSchemes: [{ ...feeScheme, percent_rate: 0, percent_min: null, percent_max: null, fixed_fee: 0, shipping_fee: 0, other_fee: 0 }],
  });
  assert.match(answer || '', /最低单件售价为 ¥0\.00/);
  assert.match(answer || '', /净利率 —（成交额为 0）/);
  assert.match(answer || '', /强提示：当前成本为 0/);
});
