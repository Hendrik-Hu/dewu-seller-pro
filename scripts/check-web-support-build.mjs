import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve('dist');
const html = await readFile(path.join(dist, 'index.html'), 'utf8');
const assetNames = await readdir(path.join(dist, 'assets'));
const javascript = (await Promise.all(assetNames.filter((name) => name.endsWith('.js')).map((name) => readFile(path.join(dist, 'assets', name), 'utf8')))).join('\n');

assert.match(html, /src="\/assets\//, 'Web 支撑构建必须使用站点根路径资源，确保 auth 回跳可加载');
assert.doesNotMatch(html, /rel="manifest"|apple-mobile-web-app-capable/, 'Web 支撑页不得伪装成可安装库存 App');
assert.match(javascript, /ANDROID_ONLY_SUPPORT_SURFACE/, 'Web 支撑构建缺少 Android-only 标记');
assert.match(javascript, /仅在 Android App 中使用/, 'Web 根入口缺少准确的平台说明');

const forbiddenChunks = [
  'ProductList-', 'Stats-', 'Profile-', 'AIManagementModal-', 'ActivityLedgerModal-',
  'BackupRestoreModal-', 'FeeSchemeModal-', 'DataHealthModal-', 'RecycleBinModal-',
  'AddProductModal-', 'OutboundModal-', 'InventoryAdjustmentModal-',
];
for (const prefix of forbiddenChunks) {
  assert.ok(!assetNames.some((name) => name.startsWith(prefix)), `生产 Web 不得包含业务 chunk: ${prefix}`);
}
for (const forbiddenText of ['核对并提交调整', 'AI 经营助手', '完整账本', '库存管理']) {
  assert.ok(!javascript.includes(forbiddenText), `生产 Web JS 仍包含业务界面文本: ${forbiddenText}`);
}

for (const page of ['privacy.html', 'account-deletion.html', 'support.html', '.well-known/assetlinks.json']) {
  await readFile(path.join(dist, page), 'utf8');
}

console.log(JSON.stringify({ target: 'web-support', jsAssets: assetNames.filter((name) => name.endsWith('.js')).length, businessChunks: 0 }, null, 2));
