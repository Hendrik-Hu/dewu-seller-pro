import assert from 'node:assert/strict';
import test from 'node:test';
import { getActivityTypeLabel } from '../lib/activityPresentation.ts';

test('all activity types have an explicit seller-facing label', () => {
  assert.equal(getActivityTypeLabel('inbound'), '入库');
  assert.equal(getActivityTypeLabel('outbound'), '出库');
  assert.equal(getActivityTypeLabel('pending'), '待发货');
  assert.equal(getActivityTypeLabel('restore'), '恢复');
  assert.equal(getActivityTypeLabel('transfer'), '调拨');
});
