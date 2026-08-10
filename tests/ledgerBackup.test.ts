import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLedgerBackupPackage, parseLedgerBackupPackage, serializeLedgerBackupPackage, stableStringify } from '../lib/ledgerBackup.ts';

const data = {
  products: [{ sourceId: 'p1', sku: 'DD1391', deletedAt: null }, { sourceId: 'p2', sku: 'A1', deletedAt: '2026-01-01' }],
  activities: [{ sourceId: 'a1', type: 'inbound' }],
  warehouses: [{ sourceId: 'w1', name: '主仓' }],
  repairs: [{ sourceId: 'r1', targetTable: 'products' }],
  feeSchemes: [{ sourceId: 'f1', name: '得物普通出售' }],
  settlements: [{ sourceId: 's1', activitySourceId: 'a1', revision: 1 }],
  inventoryAdjustments: [{ sourceId: 'ia1', productSourceId: 'p1', oldStock: 1, newStock: 2 }],
};

test('full ledger backup contains version, counts, media warning and valid integrity hash', async () => {
  const backup = await buildLedgerBackupPackage(data, '2026-08-10T00:00:00.000Z');
  assert.equal(backup.schemaVersion, 'dewu-seller-pro/ledger-backup@4');
  assert.deepEqual(backup.counts, { products: 2, activeProducts: 1, recycledProducts: 1, activities: 1, warehouses: 1, repairs: 1, feeSchemes: 1, settlements: 1, inventoryAdjustments: 1 });
  assert.equal(backup.media.included, false);
  assert.equal((await parseLedgerBackupPackage(serializeLedgerBackupPackage(backup))).integrity.value, backup.integrity.value);
});

test('legacy v1 backup remains parseable with an empty fee scheme collection', async () => {
  const legacyData = { ...data };
  delete (legacyData as any).feeSchemes;
  delete (legacyData as any).settlements;
  delete (legacyData as any).inventoryAdjustments;
  const unsigned = {
    schemaVersion: 'dewu-seller-pro/ledger-backup@1', exportedAt: '2026-08-10T00:00:00.000Z', scope: 'full-ledger',
    counts: { products: 2, activeProducts: 1, recycledProducts: 1, activities: 1, warehouses: 1, repairs: 1 },
    media: { included: false, note: 'legacy' }, data: legacyData,
  } as any;
  const modern = await buildLedgerBackupPackage(data, unsigned.exportedAt);
  const cryptoHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(unsigned)));
  const value = Array.from(new Uint8Array(cryptoHash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const parsed = await parseLedgerBackupPackage(JSON.stringify({ ...unsigned, integrity: { algorithm: 'SHA-256', value } }));
  assert.equal(parsed.schemaVersion, 'dewu-seller-pro/ledger-backup@1');
  assert.equal(parsed.data.feeSchemes, undefined);
  assert.equal(modern.data.feeSchemes.length, 1);
});

test('fee-era v2 backup remains parseable without settlement audit data', async () => {
  const v2Data = { ...data } as any;
  delete v2Data.settlements;
  delete v2Data.inventoryAdjustments;
  const unsigned = {
    schemaVersion: 'dewu-seller-pro/ledger-backup@2', exportedAt: '2026-08-10T00:00:00.000Z', scope: 'full-ledger',
    counts: { products: 2, activeProducts: 1, recycledProducts: 1, activities: 1, warehouses: 1, repairs: 1, feeSchemes: 1 },
    media: { included: false, note: 'v2' }, data: v2Data,
  } as any;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(unsigned)));
  const value = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const parsed = await parseLedgerBackupPackage(JSON.stringify({ ...unsigned, integrity: { algorithm: 'SHA-256', value } }));
  assert.equal(parsed.schemaVersion, 'dewu-seller-pro/ledger-backup@2');
  assert.equal(parsed.data.settlements, undefined);
});

test('settlement-era v3 backup remains parseable without inventory adjustment audits', async () => {
  const v3Data = { ...data } as any;
  delete v3Data.inventoryAdjustments;
  const unsigned = {
    schemaVersion: 'dewu-seller-pro/ledger-backup@3', exportedAt: '2026-08-10T00:00:00.000Z', scope: 'full-ledger',
    counts: { products: 2, activeProducts: 1, recycledProducts: 1, activities: 1, warehouses: 1, repairs: 1, feeSchemes: 1, settlements: 1 },
    media: { included: false, note: 'v3' }, data: v3Data,
  } as any;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(unsigned)));
  const value = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const parsed = await parseLedgerBackupPackage(JSON.stringify({ ...unsigned, integrity: { algorithm: 'SHA-256', value } }));
  assert.equal(parsed.schemaVersion, 'dewu-seller-pro/ledger-backup@3');
  assert.equal(parsed.data.inventoryAdjustments, undefined);
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
