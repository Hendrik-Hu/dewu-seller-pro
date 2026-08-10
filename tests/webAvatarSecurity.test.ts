import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { File } from 'node:buffer';

import { AVATAR_MAX_SOURCE_BYTES, prepareAvatarImage } from '../lib/avatarImagePipeline.ts';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('all hosted routes receive a narrow production security policy', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map((item: any) => [item.key, item.value]));
  const csp = headers['Content-Security-Policy'];
  assert.equal(config.headers[0].source, '/(.*)');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src 'self' https:\/\/vitgaeirmnbvgwrpofmf\.supabase\.co wss:\/\/vitgaeirmnbvgwrpofmf\.supabase\.co/);
  assert.match(csp, /img-src 'self' data: blob: https:\/\/vitgaeirmnbvgwrpofmf\.supabase\.co/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(csp, /dify|coze|connect-src[^;]*\*/i);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Permissions-Policy'], /microphone=\(\)/);
});

test('avatar source limits reject oversized files before decode', async () => {
  const oversized = new File([new Uint8Array(AVATAR_MAX_SOURCE_BYTES + 1)], 'avatar.png', { type: 'image/png' });
  await assert.rejects(() => prepareAvatarImage(oversized as unknown as globalThis.File), /10 MB/);
});

test('avatar upload is immutable, owned and only cleans after profile commit', () => {
  const app = read('App.tsx');
  const service = read('services/avatarImages.ts');
  const profile = read('components/Profile.tsx');
  const migration = read('supabase/migrations/20260811034500_harden_avatar_upload_limits.sql');

  assert.match(profile, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(app, /prepareAvatarImage\(updates\.avatarFile\)/);
  assert.match(app, /if \(error\) throw error;[\s\S]*removeOwnedAvatar\(session\.user\.id, userProfile\.avatar\)/);
  assert.match(app, /uploadedAvatar\?\.created[\s\S]*removeOwnedAvatar\(session\.user\.id, uploadedAvatar\.path\)/);
  assert.match(service, /functions\.invoke\('upload-avatar'/);
  assert.doesNotMatch(service, /storage\.from\(BUCKET\)\.upload/);
  assert.match(service, /path\.startsWith\(`\$\{userId\}\/avatars\/`\)/);
  assert.match(service, /getOwnedAvatarPath\(userId, publicUrl\) !== path/);
  assert.match(service, /url\.origin !== STORAGE_ORIGIN/);
  assert.match(service, /file\.type !== 'image\/jpeg'/);
  assert.match(migration, /file_size_limit = 1048576/);
  assert.match(migration, /allowed_mime_types = array\['image\/jpeg'\]/);
  assert.match(migration, /drop policy if exists "Users can update their own avatars"/);
  assert.match(migration, /drop policy if exists "Authenticated users can upload avatars"/);
  assert.match(app, /const previousProfile = \{ \.\.\.userProfile \}/);
  assert.match(app, /setUserProfile\(previousProfile\)/);
  const edge = read('supabase/functions/upload-avatar/index.ts');
  assert.match(edge, /parseJpegDimensions/);
  assert.match(edge, /dimensions\.width > MAX_DIMENSION/);
  assert.match(edge, /body\.sha256\.toLowerCase\(\) !== hash/);
  assert.match(edge, /`\$\{user\.id\}\/avatars\/\$\{hash\}\.jpg`/);
});
