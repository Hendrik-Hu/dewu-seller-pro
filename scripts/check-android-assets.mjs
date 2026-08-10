import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const sourceDir = path.resolve('dist/assets');
const androidDir = path.resolve('android/app/src/main/assets/public/assets');
const sourceNames = (await readdir(sourceDir)).sort();
const androidNames = (await readdir(androidDir)).sort();

assert.deepEqual(androidNames, sourceNames, 'Android 本地 assets 与生产构建文件列表不一致，请重新执行 android:sync');

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const name of sourceNames) {
  const [source, android] = await Promise.all([
    readFile(path.join(sourceDir, name)),
    readFile(path.join(androidDir, name)),
  ]);
  assert.equal(digest(android), digest(source), `Android 本地 chunk 内容不一致: ${name}`);
}

console.log(JSON.stringify({ assetCount: sourceNames.length, verifiedBy: 'SHA-256' }, null, 2));
