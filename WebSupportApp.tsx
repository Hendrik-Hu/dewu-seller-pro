import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { supabase } from './lib/supabase';
import { parseConfirmationUrl } from './lib/authConfirmation';
import { parseRecoveryUrl } from './lib/authRecovery';
import { APP_DISCLAIMER, APP_NAME } from './lib/brand';
import { getAccountDeletionErrorMessage } from './lib/accountSecurity';

export const WEB_SUPPORT_MARKER = 'ANDROID_ONLY_SUPPORT_SURFACE';

type CallbackState = 'processing' | 'ready' | 'success' | 'error';

export const getWebSupportRoute = (pathname: string) => {
  if (pathname === '/auth/confirm') return 'confirm';
  if (pathname === '/auth/recovery') return 'recovery';
  if (pathname === '/auth/account-deletion') return 'account-deletion';
  return 'support';
};

const PageFrame: React.FC<React.PropsWithChildren> = ({ children }) => (
  <div data-product-surface={WEB_SUPPORT_MARKER} className="min-h-full overflow-y-auto bg-slate-50 px-5 py-10 text-slate-900 dark:bg-black dark:text-white">
    <main className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {children}
    </main>
  </div>
);

const AndroidOnlyNotice = () => (
  <PageFrame>
    <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-dewu-50 text-xl font-black text-dewu-600 dark:bg-dewu-500/10 dark:text-dewu-300">库</div>
    <h1 className="text-2xl font-bold">{APP_NAME}仅在 Android App 中使用</h1>
    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-zinc-300">网页端不提供登录、库存查看、记账或经营操作。请在已安装的 Android App 中继续使用。</p>
    <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
      当前为闭测阶段，安装包仅通过已确认的测试渠道提供。本页面没有公开下载地址，请不要从非可信来源安装同名应用。
    </div>
    <nav className="mt-6 grid gap-2 text-sm">
      <a className="rounded-md border border-slate-200 px-4 py-3 font-medium text-dewu-700 dark:border-zinc-800 dark:text-dewu-300" href="/privacy.html">隐私说明</a>
      <a className="rounded-md border border-slate-200 px-4 py-3 font-medium text-dewu-700 dark:border-zinc-800 dark:text-dewu-300" href="/account-deletion.html">账号删除说明</a>
      <a className="rounded-md border border-slate-200 px-4 py-3 font-medium text-dewu-700 dark:border-zinc-800 dark:text-dewu-300" href="/support.html">支持与安全反馈</a>
    </nav>
    <p className="mt-6 text-xs leading-5 text-slate-400">{APP_DISCLAIMER}</p>
  </PageFrame>
);

const CallbackMessage: React.FC<{ title: string; state: CallbackState; message: string }> = ({ title, state, message }) => (
  <PageFrame>
    <h1 className="text-xl font-bold">{title}</h1>
    <div className="mt-5 flex items-start gap-3 rounded-lg bg-slate-50 p-4 text-sm leading-6 dark:bg-zinc-900">
      {state === 'processing' && <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-dewu-500" />}
      <p>{message}</p>
    </div>
    <a className="mt-6 block text-center text-sm font-medium text-dewu-700 dark:text-dewu-300" href="/">返回说明页</a>
  </PageFrame>
);

const ConfirmationPage = () => {
  const [state, setState] = useState<CallbackState>('processing');
  const [message, setMessage] = useState('正在核验确认链接…');

  useEffect(() => {
    let active = true;
    const complete = async () => {
      const payload = parseConfirmationUrl(window.location.href);
      if (!payload) throw new Error('invalid confirmation link');
      const result = payload.code
        ? await supabase.auth.exchangeCodeForSession(payload.code)
        : await supabase.auth.setSession({ access_token: payload.accessToken!, refresh_token: payload.refreshToken! });
      if (result.error) throw result.error;
      await supabase.auth.signOut({ scope: 'local' });
      if (active) {
        setState('success');
        setMessage('邮箱确认已完成。请返回 Android App 登录。');
      }
    };
    void complete().catch(() => {
      if (active) {
        setState('error');
        setMessage('确认链接无法完成。请返回 Android App 重新发送确认邮件。');
      }
    });
    return () => { active = false; };
  }, []);

  return <CallbackMessage title="邮箱确认" state={state} message={message} />;
};

const RecoveryPage = () => {
  const [state, setState] = useState<CallbackState>('processing');
  const [message, setMessage] = useState('正在核验密码恢复链接…');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const prepare = async () => {
      const payload = parseRecoveryUrl(window.location.href);
      if (!payload) throw new Error('invalid recovery link');
      const result = payload.code
        ? await supabase.auth.exchangeCodeForSession(payload.code)
        : await supabase.auth.setSession({ access_token: payload.accessToken!, refresh_token: payload.refreshToken! });
      if (result.error) throw result.error;
      if (active) {
        setState('ready');
        setMessage('恢复链接已验证，请设置新密码。');
      }
    };
    void prepare().catch(() => {
      if (active) {
        setState('error');
        setMessage('恢复链接无法完成。请返回 Android App 重新发起忘记密码。');
      }
    });
    return () => { active = false; };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return setMessage('新密码至少需要 8 位。');
    if (password !== confirmation) return setMessage('两次输入的新密码不一致。');
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage('密码更新失败，请重新打开邮件中的链接。');
      setSubmitting(false);
      return;
    }
    await supabase.auth.signOut();
    setPassword('');
    setConfirmation('');
    setState('success');
    setMessage('密码已更新。请返回 Android App 使用新密码登录。');
    setSubmitting(false);
  };

  if (state !== 'ready') return <CallbackMessage title="找回密码" state={state} message={message} />;
  return (
    <PageFrame>
      <h1 className="text-xl font-bold">设置新密码</h1>
      <p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{message}</p>
      <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
        <label className="block text-sm">新密码
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-3 outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-900" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <label className="block text-sm">确认新密码
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-3 outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-900" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <button className="auth-primary-action flex w-full items-center justify-center rounded-md bg-dewu-500 py-3 font-bold disabled:opacity-50" type="submit" disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : '更新密码'}
        </button>
      </form>
    </PageFrame>
  );
};

const AccountDeletionPage = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password || confirmation !== '永久删除') {
      setMessage('请填写账号邮箱、当前密码，并准确输入“永久删除”。');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) throw new Error('账号或当前密码不正确，账号未删除');
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation: 'DELETE_MY_ACCOUNT' } });
      if (error || !data?.deleted) throw new Error(data?.error || '删除服务暂时不可用');
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      setPassword('');
      setConfirmation('');
      setDeleted(true);
    } catch (error) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      setPassword('');
      setMessage(getAccountDeletionErrorMessage(error instanceof Error ? error.message : undefined));
    } finally {
      setSubmitting(false);
    }
  };

  if (deleted) {
    return <CallbackMessage title="账号已删除" state="success" message="账号删除已完成，登录状态已失效。" />;
  }

  return (
    <PageFrame>
      <h1 className="text-xl font-bold">在线提交账号删除</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-zinc-400">此页面只用于删除账号，不提供库存查看或其他业务操作。建议先在 Android App 导出账本并保存重要图片。</p>
      <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700 dark:border-red-950 dark:bg-red-950/20 dark:text-red-300">删除不可撤销，将清除账号及关联库存、流水、仓库、结算、审计和账号目录中的图片。</div>
      <form className="mt-5 space-y-4" onSubmit={submit} autoComplete="off" noValidate>
        <label className="block text-sm">账号邮箱
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-3 outline-none focus:border-red-400 dark:border-zinc-700 dark:bg-zinc-900" type="email" name="username" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label className="block text-sm">请输入“永久删除”确认
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-3 outline-none focus:border-red-400 dark:border-zinc-700 dark:bg-zinc-900" name="account-delete-confirmation" autoComplete="off" data-lpignore="true" data-1p-ignore="true" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        </label>
        <label className="block text-sm">当前登录密码
          <input className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-3 outline-none focus:border-red-400 dark:border-zinc-700 dark:bg-zinc-900" type="password" name="current-password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {message && <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{message}</p>}
        <button className="flex w-full items-center justify-center rounded-md bg-red-600 py-3 font-bold text-white disabled:opacity-40" type="submit" disabled={submitting || confirmation !== '永久删除' || !email.trim() || !password}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : '永久删除我的账号'}
        </button>
      </form>
      <a className="mt-5 block text-center text-sm text-slate-500 underline" href="/account-deletion.html">查看删除范围与说明</a>
    </PageFrame>
  );
};

export default function WebSupportApp() {
  const route = getWebSupportRoute(window.location.pathname);
  if (route === 'confirm') return <ConfirmationPage />;
  if (route === 'recovery') return <RecoveryPage />;
  if (route === 'account-deletion') return <AccountDeletionPage />;
  return <AndroidOnlyNotice />;
}
