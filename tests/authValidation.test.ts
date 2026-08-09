import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAuthCredentials } from '../lib/authValidation.ts';

test('auth validation uses Chinese messages instead of native required bubbles', () => {
  assert.equal(validateAuthCredentials('', '', true), '请输入邮箱地址');
  assert.equal(validateAuthCredentials('seller@example.com', '', true), '请输入密码');
  assert.equal(validateAuthCredentials('not-an-email', 'password', true), '请输入有效的邮箱地址');
});

test('registration requires eight characters while login keeps legacy passwords valid', () => {
  assert.equal(validateAuthCredentials('seller@example.com', '1234567', false), '注册密码至少需要 8 位');
  assert.equal(validateAuthCredentials('seller@example.com', '123456', true), null);
  assert.equal(validateAuthCredentials('seller@example.com', '12345678', false), null);
});
