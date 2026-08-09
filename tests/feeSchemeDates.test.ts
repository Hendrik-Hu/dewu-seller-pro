import assert from 'node:assert/strict';
import test from 'node:test';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from '../lib/feeSchemeDates.ts';

test('cleared or invalid effective time stays empty instead of silently becoming now', () => {
  assert.equal(fromDateTimeLocalValue(''), '');
  assert.equal(fromDateTimeLocalValue('not-a-date'), '');
  assert.equal(toDateTimeLocalValue(''), '');
  assert.equal(toDateTimeLocalValue('not-a-date'), '');
});

test('valid local effective time converts to an ISO timestamp', () => {
  const value = fromDateTimeLocalValue('2026-08-10T18:30');
  assert.match(value, /^2026-08-10T\d{2}:30:00\.000Z$/);
  assert.equal(toDateTimeLocalValue(value).slice(0, 10), '2026-08-10');
});
