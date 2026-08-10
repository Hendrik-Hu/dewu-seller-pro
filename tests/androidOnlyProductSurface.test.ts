import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('production defaults to the Web support entry while dev and Android use the complete app', () => {
  const vite = read('vite.config.ts');
  const entry = read('index.tsx');
  const packageJson = JSON.parse(read('package.json'));
  assert.match(vite, /command === 'serve' \? 'app' : 'web-support'/);
  assert.match(vite, /isWebSupport \? 'WebSupportApp\.tsx' : 'App\.tsx'/);
  assert.match(entry, /from '@app-entry'/);
  assert.equal(packageJson.scripts.build, 'node scripts/build-target.mjs web-support && node scripts/check-web-support-build.mjs');
  assert.equal(packageJson.scripts['build:android'], 'node scripts/build-target.mjs android');
  assert.match(packageJson.scripts['android:sync'], /build-target\.mjs android/);
});

test('every Android build script explicitly builds the complete local app target', () => {
  for (const file of ['build_release_android.ps1', 'build_debug_apk.ps1', 'build_and_sync.ps1']) {
    const source = read(file);
    assert.match(source, /build-target\.mjs" android/);
    assert.doesNotMatch(source, /vite\\bin\\vite\.js" build/);
  }
  const release = read('build_release_android.ps1');
  assert.match(release, /check-first-screen-bundle\.mjs/);
  assert.match(release, /check-android-assets\.mjs/);
});

test('the Web root is an honest Android-only notice without a fake download or business login', () => {
  const supportApp = read('WebSupportApp.tsx');
  assert.match(supportApp, /ANDROID_ONLY_SUPPORT_SURFACE/);
  assert.match(supportApp, /仅在 Android App 中使用/);
  assert.match(supportApp, /不提供登录、库存查看、记账或经营操作/);
  assert.match(supportApp, /没有公开下载地址/);
  assert.doesNotMatch(supportApp, /href=["'][^"']*\.(?:apk|aab)/i);
  assert.doesNotMatch(supportApp, /import .* from ['"]\.\/App['"]/);
  assert.doesNotMatch(supportApp, /services\/(?:products|activities|analytics|warehouses)/);
  assert.doesNotMatch(supportApp, /\.auth\.signUp\(/);
});

test('Web auth callbacks and deletion are narrow support routes rather than the inventory app', () => {
  const supportApp = read('WebSupportApp.tsx');
  assert.match(supportApp, /pathname === '\/auth\/confirm'/);
  assert.match(supportApp, /pathname === '\/auth\/recovery'/);
  assert.match(supportApp, /pathname === '\/auth\/account-deletion'/);
  assert.match(supportApp, /catch \(error\)[\s\S]*signOut\(\{ scope: 'local' \}\)/);
  assert.match(supportApp, /parseConfirmationUrl/);
  assert.match(supportApp, /parseRecoveryUrl/);
  assert.match(supportApp, /signInWithPassword/);
  assert.match(supportApp, /functions\.invoke\('delete-account'/);
  assert.match(supportApp, /此页面只用于删除账号，不提供库存查看或其他业务操作/);
});

test('hosting rewrites preserve only policy, support, auth callback and deletion surfaces', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const rewrites = new Map(vercel.rewrites.map((item: { source: string; destination: string }) => [item.source, item.destination]));
  assert.equal(rewrites.get('/privacy.html'), '/privacy.html');
  assert.equal(rewrites.get('/account-deletion.html'), '/account-deletion.html');
  assert.equal(rewrites.get('/support.html'), '/support.html');
  assert.equal(rewrites.get('/auth/account-deletion'), '/index.html');
  assert.equal(rewrites.get('/(.*)'), '/index.html');
  const accountDeletion = read('public/account-deletion.html');
  assert.match(accountDeletion, /href="\/auth\/account-deletion"/);
  assert.doesNotMatch(accountDeletion, /网页版账号中心/);
});

test('the production build gate rejects inventory business chunks and installable-Web metadata', () => {
  const gate = read('scripts/check-web-support-build.mjs');
  assert.match(gate, /ANDROID_ONLY_SUPPORT_SURFACE/);
  for (const chunk of ['ProductList-', 'Stats-', 'AIManagementModal-', 'ActivityLedgerModal-', 'BackupRestoreModal-']) {
    assert.match(gate, new RegExp(chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(gate, /rel="manifest"/);
  assert.match(gate, /apple-mobile-web-app-capable/);
});
