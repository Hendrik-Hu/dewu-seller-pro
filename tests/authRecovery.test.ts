import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_RECOVERY_REDIRECT, parseRecoveryUrl } from '../lib/authRecovery.ts';

test('native recovery links accept a PKCE authorization code', () => {
  assert.deepEqual(parseRecoveryUrl(`${NATIVE_RECOVERY_REDIRECT}?code=abc123`), { code: 'abc123', accessToken: undefined, refreshToken: undefined });
});

test('web recovery links accept legacy token fragments', () => {
  assert.deepEqual(parseRecoveryUrl('https://example.com/auth/recovery#access_token=a&refresh_token=r&type=recovery'), {
    code: undefined,
    accessToken: 'a',
    refreshToken: 'r',
  });
});

test('unrelated links and incomplete credentials are rejected', () => {
  assert.equal(parseRecoveryUrl('com.hendrikhu.sellerinventory://other?code=abc'), null);
  assert.equal(parseRecoveryUrl(`${NATIVE_RECOVERY_REDIRECT}#access_token=only`), null);
});

