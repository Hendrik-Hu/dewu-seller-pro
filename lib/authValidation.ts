const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const validateAuthCredentials = (
  email: string,
  password: string,
  isLogin: boolean,
): string | null => {
  if (!email.trim()) return '请输入邮箱地址';
  if (!EMAIL_PATTERN.test(email.trim())) return '请输入有效的邮箱地址';
  if (!password) return '请输入密码';
  if (!isLogin && password.length < 8) return '注册密码至少需要 8 位';
  return null;
};
