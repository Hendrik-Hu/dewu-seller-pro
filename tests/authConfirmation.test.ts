import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseConfirmationUrl } from '../lib/authConfirmation.ts';

test('web confirmation links accept PKCE codes and signup token fragments', () => {
  assert.deepEqual(parseConfirmationUrl('https://seller.example/auth/confirm?code=signup-code'), {
    code: 'signup-code', accessToken: undefined, refreshToken: undefined,
  });
  assert.deepEqual(parseConfirmationUrl('https://seller.example/auth/confirm#access_token=a&refresh_token=r&type=signup'), {
    code: undefined, accessToken: 'a', refreshToken: 'r',
  });
});

test('confirmation parser rejects recovery and unrelated callbacks', () => {
  assert.equal(parseConfirmationUrl('https://seller.example/auth/recovery?code=recovery'), null);
  assert.equal(parseConfirmationUrl('https://seller.example/auth/confirm#access_token=a&refresh_token=r&type=recovery'), null);
  assert.equal(parseConfirmationUrl('http://seller.example/auth/confirm?code=insecure'), null);
});

test('registration UI matches link confirmation and auto-confirm behavior', () => {
  const source = readFileSync(new URL('../components/AuthScreen.tsx', import.meta.url), 'utf8');
  assert.match(source, /emailRedirectTo: PUBLIC_LINKS\.emailConfirmation/);
  assert.match(source, /请确认你的邮箱/);
  assert.match(source, /重新发送确认邮件/);
  assert.doesNotMatch(source, /6 位数验证码|verifyOtp/);
  assert.match(source, /data\.user && !data\.session[\s\S]*setIsAwaitingConfirmation\(true\)[\s\S]*onAuthSuccess\(\)/);
});

test('Android app links distinguish signup confirmation from password recovery', () => {
  const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(manifest, /android:pathPrefix="\/auth\/confirm"/);
  assert.match(manifest, /android:pathPrefix="\/auth\/recovery"/);
});
