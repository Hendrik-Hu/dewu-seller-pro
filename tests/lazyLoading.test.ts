import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const read = (file: string) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');

test('first screen defers heavy pages and business modals', async () => {
  const [app, home, stats, profile] = await Promise.all([
    read('App.tsx'),
    read('components/Home.tsx'),
    read('components/Stats.tsx'),
    read('components/Profile.tsx'),
  ]);

  for (const source of [app, home, stats, profile]) {
    assert.doesNotMatch(source, /^import .*\.(?:Stats|ProductList|AIManagementModal|ActivityLedgerModal|BackupRestoreModal|FeeSchemeModal|DataHealthModal|RecycleBinModal)['"];?$/m);
  }
  assert.match(app, /createDeferredComponent/);
  assert.match(home, /createDeferredComponent/);
  assert.match(stats, /createDeferredComponent/);
  assert.match(profile, /createDeferredComponent/);
  assert.match(app, /showBackupRestore && \(/);
  assert.match(home, /showAIModal && \(/);
  assert.match(home, /showActivityLedger && \(/);
});

test('deferred failures stay local, support retry and ignore late unmounted loads', async () => {
  const deferred = await read('components/DeferredComponent.tsx');
  assert.match(deferred, /pendingImport = null/);
  assert.match(deferred, /let active = true/);
  assert.match(deferred, /if \(active\) setComponent/);
  assert.match(deferred, /现有数据没有被清空/);
  assert.match(deferred, /重新加载/);
  assert.match(deferred, /aria-busy/);
});

test('account changes close deferred user-scoped surfaces before the next account renders', async () => {
  const app = await read('App.tsx');
  const resetStart = app.indexOf('useLayoutEffect(() => {');
  const resetEnd = app.indexOf('  }, [session?.user?.id]);', resetStart);
  assert.ok(resetStart >= 0 && resetEnd > resetStart, 'missing centralized account reset');
  const reset = app.slice(resetStart, resetEnd);
  for (const expected of [
    'setShowAddModal(false)',
    'setShowOutboundModal(false)',
    'setShowTransitModal(false)',
    'setShowRecycleBin(false)',
    'setShowDataHealth(false)',
    'setShowBackupRestore(false)',
    'setShowFeeSchemes(false)',
    'setShowTransferModal(false)',
    'setShowFirstWarehouseModal(false)',
    'setCurrentTab(Tab.HOME)',
  ]) {
    assert.match(reset, new RegExp(expected.replace(/[()]/g, '\\$&')));
  }
});
