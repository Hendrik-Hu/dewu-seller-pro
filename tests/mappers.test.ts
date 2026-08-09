import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeActivityCountForWrite } from '../lib/activityValidation.ts';

test('activity mapper defaults only a missing count to one', () => {
  assert.equal(normalizeActivityCountForWrite(undefined), 1);
  assert.equal(normalizeActivityCountForWrite(null), 1);
  assert.equal(normalizeActivityCountForWrite(0), 0);
  assert.equal(normalizeActivityCountForWrite(-2), -2);
});
