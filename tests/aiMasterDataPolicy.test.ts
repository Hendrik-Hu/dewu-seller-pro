import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAiInboundProductName } from '../supabase/functions/_shared/aiMasterDataPolicy.ts';

test('existing SKU name always wins over a model-inferred brand-like name', () => {
  const name = resolveAiInboundProductName('DD1391', [
    { sku: 'DD1391', name: 'DD1391' },
    { sku: 'DD1391', name: 'Nike Dunk Low Black White (Panda)' },
  ], 'Nike');
  assert.equal(name, 'Nike Dunk Low Black White (Panda)');
});

test('new SKU uses the SKU instead of an unproven model-generated name', () => {
  assert.equal(resolveAiInboundProductName('NEW123', [], 'Nike'), 'NEW123');
});
