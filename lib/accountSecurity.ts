export const ACCOUNT_DELETION_RETRY_MESSAGE = '账号删除未完成。部分上传图片可能已经删除，但账号和账本仍保留；请保持登录并重试。';

export const getAccountDeletionErrorMessage = (detail?: unknown) => {
  const text = String(detail || '').trim();
  return text ? `${ACCOUNT_DELETION_RETRY_MESSAGE}\n原因：${text}` : ACCOUNT_DELETION_RETRY_MESSAGE;
};

export const validateNewPassword = (password: string, confirmation: string) => {
  if (password.length < 8) return '新密码至少需要 8 位';
  if (password !== confirmation) return '两次输入的新密码不一致';
  return null;
};
