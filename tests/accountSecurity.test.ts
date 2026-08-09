import test from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNT_DELETION_RETRY_MESSAGE, getAccountDeletionErrorMessage, validateNewPassword } from '../lib/accountSecurity.ts';

test('account deletion errors always disclose the cross-system retry boundary', () => {
  assert.equal(getAccountDeletionErrorMessage(), ACCOUNT_DELETION_RETRY_MESSAGE);
  assert.match(getAccountDeletionErrorMessage('服务暂时不可用'), /部分上传图片可能已经删除/);
  assert.match(getAccountDeletionErrorMessage('服务暂时不可用'), /账号和账本仍保留/);
});

test('all password changes share the eight-character minimum', () => {
  assert.equal(validateNewPassword('1234567', '1234567'), '新密码至少需要 8 位');
  assert.equal(validateNewPassword('12345678', '87654321'), '两次输入的新密码不一致');
  assert.equal(validateNewPassword('12345678', '12345678'), null);
});
