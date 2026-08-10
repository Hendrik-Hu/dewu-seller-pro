import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { hasRecentDynamicImportFailure, isDynamicImportFailure, recoverFromDynamicImportFailure } from '../lib/chunkRecovery.ts';

const createStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

test('known stale chunk failures trigger exactly one automatic full reload per entry', () => {
  const storage = createStorage();
  let reloads = 0;
  const dependencies = {
    storage,
    fingerprint: '/assets/index-old.js',
    online: true,
    reload: () => { reloads += 1; },
    schedule: (callback: () => void) => callback(),
  };
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/Profile-old.js');

  assert.equal(recoverFromDynamicImportFailure(error, dependencies), 'reloading');
  assert.equal(reloads, 1);
  assert.equal(recoverFromDynamicImportFailure(error, dependencies), 'already-reloaded');
  assert.equal(reloads, 1);
});

test('a new entry fingerprint gets one independent recovery after a deployment', () => {
  const storage = createStorage();
  let reloads = 0;
  const error = new Error('ChunkLoadError: Loading chunk Profile failed');
  const run = (fingerprint: string) => recoverFromDynamicImportFailure(error, {
    storage,
    fingerprint,
    online: true,
    reload: () => { reloads += 1; },
    schedule: (callback) => callback(),
  });

  assert.equal(run('/assets/index-v1.js'), 'reloading');
  assert.equal(run('/assets/index-v2.js'), 'reloading');
  assert.equal(reloads, 2);
});

test('ordinary network and business errors keep local retry and never reload the app', () => {
  let reloads = 0;
  const result = recoverFromDynamicImportFailure(new Error('Network request timed out'), {
    storage: createStorage(),
    fingerprint: '/assets/index.js',
    reload: () => { reloads += 1; },
    schedule: (callback) => callback(),
  });
  assert.equal(result, 'not-chunk-error');
  assert.equal(reloads, 0);
  assert.equal(isDynamicImportFailure(new Error('库存同步失败')), false);
});

test('offline dynamic import failures keep local retry and never reload the whole app', () => {
  let reloads = 0;
  const result = recoverFromDynamicImportFailure(
    new TypeError('Failed to fetch dynamically imported module: /assets/Profile-old.js'),
    {
      online: false,
      storage: createStorage(),
      fingerprint: '/assets/index-old.js',
      reload: () => { reloads += 1; },
      schedule: (callback) => callback(),
    },
  );
  assert.equal(result, 'not-chunk-error');
  assert.equal(reloads, 0);
});

test('unavailable session storage requires an explicit user refresh instead of risking a loop', () => {
  const storage = {
    getItem: () => { throw new Error('storage unavailable'); },
    setItem: () => { throw new Error('storage unavailable'); },
  };
  assert.equal(recoverFromDynamicImportFailure('Importing a module script failed', {
    storage,
    fingerprint: '/assets/index.js',
    online: true,
  }), 'reload-required');
});

test('Vite preload failures and deferred imports share the same recovery guard', async () => {
  const [entry, deferred] = await Promise.all([
    readFile(new URL('../index.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../components/DeferredComponent.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(entry, /addEventListener\('vite:preloadError'/);
  assert.match(entry, /recoverFromDynamicImportFailure\(preloadError\.payload\)/);
  assert.match(entry, /event\.preventDefault\(\)/);
  assert.match(deferred, /recoverFromDynamicImportFailure\(loadError\)/);
  assert.match(deferred, /hasRecentDynamicImportFailure\(\)/);
});

test('a Vite preload signal survives browser-specific error wrapping long enough for the local boundary', () => {
  recoverFromDynamicImportFailure(new Error('Importing a module script failed'), {
    online: true,
    storage: createStorage(),
    fingerprint: '/assets/index-wrapped.js',
    reload: () => {},
    schedule: () => {},
  });
  assert.equal(hasRecentDynamicImportFailure(), true);
});
