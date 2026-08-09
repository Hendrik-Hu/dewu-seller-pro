import assert from 'node:assert/strict';
import test from 'node:test';
import { isExecutablePlan } from '../supabase/functions/_shared/aiPlanPolicy.ts';

test('failed previews never receive an executable plan token', () => {
  assert.equal(isExecutablePlan(
    [{ type: 'inbound' }],
    [{ status: 'failed' }],
  ), false);
});

test('answer-only and mixed plans cannot be confirmed as inventory writes', () => {
  assert.equal(isExecutablePlan([{ type: 'answer' }], [{ status: 'planned' }]), false);
  assert.equal(isExecutablePlan(
    [{ type: 'inbound' }, { type: 'answer' }],
    [{ status: 'planned' }, { status: 'planned' }],
  ), false);
});

test('only fully planned inventory actions are executable', () => {
  assert.equal(isExecutablePlan(
    [{ type: 'inbound' }, { type: 'outbound' }],
    [{ status: 'planned' }, { status: 'planned' }],
  ), true);
});

test('confirmation rejects plans after authoritative revalidation fails', () => {
  const signedActions = [{ type: 'outbound' }];
  const freshPreviews = [{ status: 'failed' }];
  assert.equal(isExecutablePlan(signedActions, freshPreviews), false);
});
