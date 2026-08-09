import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateExplicitExecutionIntent, requiresWarehouseSetup } from '../supabase/functions/_shared/aiIntent.ts';

test('inbound wording cannot authorize an outbound model action', () => {
  const result = evaluateExplicitExecutionIntent('Nike DD1391 42码入库2双，成本749', 'outbound', 'Nike');
  assert.equal(result.brandExplicit, true);
  assert.equal(result.operationExplicit, true);
  assert.equal(result.directionMatches, false);
});

test('outbound wording cannot authorize an inbound model action', () => {
  const result = evaluateExplicitExecutionIntent('把 Nike DD1391 42码卖掉1双，售价899', 'inbound', 'Nike');
  assert.equal(result.brandExplicit, true);
  assert.equal(result.operationExplicit, true);
  assert.equal(result.directionMatches, false);
});

test('mixed inbound and outbound wording requires clarification', () => {
  const result = evaluateExplicitExecutionIntent('Nike DD1391 入库2双再卖掉1双，42码', 'inbound', 'Nike');
  assert.equal(result.operationExplicit, false);
  assert.equal(result.directionMatches, false);
});

test('brand must be explicitly present in the seller message', () => {
  const result = evaluateExplicitExecutionIntent('DD1391 42码入库2双', 'inbound', 'Nike');
  assert.equal(result.brandExplicit, false);
  assert.equal(result.directionMatches, true);
});

test('outbound sale price must be explicit while explicit zero remains valid', () => {
  assert.equal(
    evaluateExplicitExecutionIntent('Nike DD1391 42码出库1双', 'outbound', 'Nike').salePriceExplicit,
    false,
  );
  assert.equal(
    evaluateExplicitExecutionIntent('Nike DD1391 42码出库1双，售价0', 'outbound', 'Nike').salePriceExplicit,
    true,
  );
});

test('execution commands require the seller to create a real warehouse first', () => {
  assert.equal(requiresWarehouseSetup('Nike DD1391 42码入库1双，成本0', 0), true);
  assert.equal(requiresWarehouseSetup('把 Nike DD1391 42码卖掉1双，售价899', 0), true);
  assert.equal(requiresWarehouseSetup('帮我总结库存', 0), false);
  assert.equal(requiresWarehouseSetup('Nike DD1391 42码入库1双，成本0', 1), false);
});
