import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllPages } from '../services/pagination.ts';

test('pagination reads past the PostgREST 1000-row boundary and verifies total count', async () => {
  const source = Array.from({ length: 1001 }, (_, id) => ({ id: String(id) }));
  const rows = await fetchAllPages(async (from, to) => ({ data: source.slice(from, to + 1), error: null, count: source.length }), {
    pageSize: 500,
    getKey: (row) => row.id,
  });
  assert.equal(rows.length, 1001);
  assert.equal(rows.at(-1)?.id, '1000');
});

test('pagination rejects count drift and duplicate page rows', async () => {
  await assert.rejects(() => fetchAllPages(async (from) => ({
    data: from === 0 ? [{ id: '1' }] : [], error: null, count: from === 0 ? 2 : 1,
  }), { pageSize: 1, getKey: (row) => row.id, label: '流水' }), /发生变化/);

  await assert.rejects(() => fetchAllPages(async (from) => ({
    data: from < 2 ? [{ id: 'same' }] : [], error: null, count: 2,
  }), { pageSize: 1, getKey: (row) => row.id, label: '商品' }), /重复记录/);
});
