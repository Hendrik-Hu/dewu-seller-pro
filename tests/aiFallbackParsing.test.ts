import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBasicInventoryCommand } from '../supabase/functions/_shared/aiFallbackParsing.ts';

test('fallback does not mistake SKU size or quantity digits for inbound cost', () => {
  const parsed = parseBasicInventoryCommand('入库 Nike DD1391 42码 2双');
  assert.equal(parsed.brand, 'Nike');
  assert.equal(parsed.quantity, 2);
  assert.equal(parsed.inboundCost.explicit, false);
  assert.equal(parsed.inboundCost.value, 0);
});

test('fallback extracts only semantic inbound cost', () => {
  const parsed = parseBasicInventoryCommand('入库 DD1391 Nike 42码 2双，进价749');
  assert.equal(parsed.brand, 'Nike');
  assert.equal(parsed.inboundCost.explicit, true);
  assert.equal(parsed.inboundCost.value, 749);
});

test('fallback does not mistake outbound quantity for sale price', () => {
  const parsed = parseBasicInventoryCommand('卖掉 Nike DD1391 42码 1双');
  assert.equal(parsed.outboundPrice.explicit, false);
  assert.equal(parsed.outboundPrice.value, 0);
});

test('fallback accepts semantic or currency-marked outbound price including zero', () => {
  assert.deepEqual(parseBasicInventoryCommand('卖掉 Nike DD1391 42码 1双，售价899').outboundPrice, { value: 899, explicit: true });
  assert.deepEqual(parseBasicInventoryCommand('卖掉 Nike DD1391 42码 1双，￥0').outboundPrice, { value: 0, explicit: true });
});
