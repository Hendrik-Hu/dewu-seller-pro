import assert from 'node:assert/strict';
import test from 'node:test';
import { getTrustedAiInboundImageUrl } from '../supabase/functions/_shared/aiMediaPolicy.ts';

test('AI inbound never trusts model-provided product image URLs', () => {
  assert.equal(getTrustedAiInboundImageUrl('http://example.com/image.jpg'), '');
  assert.equal(getTrustedAiInboundImageUrl('https://images.example/product.jpg'), '');
  assert.equal(getTrustedAiInboundImageUrl(undefined), '');
});
