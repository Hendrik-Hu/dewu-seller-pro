import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve('dist');
const html = await readFile(path.join(distDir, 'index.html'), 'utf8');
const scriptSources = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((match) => match[1]);
const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)].map((match) => match[1]);

assert.equal(scriptSources.length, 1, '首页必须只有一个直接执行的入口脚本');
assert.ok(!html.includes('Stats-'), '首页不能预加载统计页和图表依赖');
assert.ok(!html.includes('AIManagementModal-'), '首页不能预加载 AI 管理');
assert.ok(!html.includes('ActivityLedgerModal-'), '首页不能预加载完整账本');
assert.ok(!html.includes('BackupRestoreModal-'), '首页不能预加载备份恢复');

const entryPath = path.join(distDir, scriptSources[0].replace(/^\.\//, ''));
const entry = await readFile(entryPath);
const entryBudget = 400_000;
assert.ok(entry.byteLength < entryBudget, `主入口 ${entry.byteLength} bytes 超过 ${entryBudget} bytes 预算`);

const assetNames = await readdir(path.join(distDir, 'assets'));
const deferredPrefixes = [
  'Stats-',
  'ProductList-',
  'AIManagementModal-',
  'ActivityLedgerModal-',
  'BackupRestoreModal-',
  'FeeSchemeModal-',
  'DataHealthModal-',
  'RecycleBinModal-',
];
for (const prefix of deferredPrefixes) {
  assert.ok(assetNames.some((name) => name.startsWith(prefix) && name.endsWith('.js')), `缺少按需 chunk: ${prefix}`);
}

const initialAssets = [...scriptSources, ...preloads];
let initialRawBytes = 0;
let initialGzipBytes = 0;
for (const source of initialAssets) {
  const bytes = await readFile(path.join(distDir, source.replace(/^\.\//, '')));
  initialRawBytes += bytes.byteLength;
  initialGzipBytes += gzipSync(bytes).byteLength;
}

console.log(JSON.stringify({
  entry: path.basename(entryPath),
  entryRawBytes: entry.byteLength,
  entryGzipBytes: gzipSync(entry).byteLength,
  initialJsAssets: initialAssets.map((value) => path.basename(value)),
  initialRawBytes,
  initialGzipBytes,
}, null, 2));
