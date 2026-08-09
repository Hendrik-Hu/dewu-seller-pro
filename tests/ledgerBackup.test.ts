import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLedgerBackupPackage, parseLedgerBackupPackage, serializeLedgerBackupPackage } from '../lib/ledgerBackup.ts';

const data = {
  products: [{ sourceId: 'p1', sku: 'DD1391', deletedAt: null }, { sourceId: 'p2', sku: 'A1', deletedAt: '2026-01-01' }],
  activities: [{ sourceId: 'a1', type: 'inbound' }],
  warehouses: [{ sourceId: 'w1', name: '主仓' }],
  repairs: [{ sourceId: 'r1', targetTable: 'products' }],
};

test('full ledger backup contains version, counts, media warning and valid integrity hash', async () => {
  const backup = await buildLedgerBackupPackage(data, '2026-08-10T00:00:00.000Z');
  assert.equal(backup.schemaVersion, 'dewu-seller-pro/ledger-backup@1');
  assert.deepEqual(backup.counts, { products: 2, activeProducts: 1, recycledProducts: 1, activities: 1, warehouses: 1, repairs: 1 });
  assert.equal(backup.media.included, false);
  assert.equal((await parseLedgerBackupPackage(serializeLedgerBackupPackage(backup))).integrity.value, backup.integrity.value);
});

test('backup parser rejects unsupported, tampered and count-mismatched packages', async () => {
  const backup = await buildLedgerBackupPackage(data, '2026-08-10T00:00:00.000Z');
  await assert.rejects(() => parseLedgerBackupPackage(JSON.stringify({ ...backup, schemaVersion: 'unknown' })), /不支持/);
  await assert.rejects(() => parseLedgerBackupPackage(JSON.stringify({ ...backup, counts: { ...backup.counts, products: 3 } })), /计数/);
  await assert.rejects(() => parseLedgerBackupPackage(JSON.stringify({ ...backup, exportedAt: 'changed' })), /完整性/);
});

test('backup parser rejects scalar rows before restore preflight', async () => {
  const backup = await buildLedgerBackupPackage(data, '2026-08-10T00:00:00.000Z');
  const malformed = {
    ...backup,
    data: { ...backup.data, activities: [null] },
    counts: { ...backup.counts, activities: 1 },
  };
  await assert.rejects(() => parseLedgerBackupPackage(JSON.stringify(malformed)), /无法识别/);
});

test('backup builder enforces server-compatible item limits', async () => {
  const oversized = { ...data, warehouses: Array.from({ length: 101 }, (_, index) => ({ sourceId: `w${index}`, name: `仓库${index}` })) };
  await assert.rejects(() => buildLedgerBackupPackage(oversized), /数量上限/);
});
