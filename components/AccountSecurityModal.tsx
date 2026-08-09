import React, { useEffect, useState } from 'react';
import { X, Mail, Lock, ChevronRight, Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openExternalUrl, PUBLIC_LINKS } from '../lib/publicLinks';
import { getAccountDeletionErrorMessage, validateNewPassword } from '../lib/accountSecurity';

interface AccountSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccountDeleted: () => void;
  email?: string;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({ isOpen, onClose, onAccountDeleted, email }) => {
  const [view, setView] = useState<'main' | 'password' | 'delete'>('main');
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const openDeleteView = () => {
    setDeleteConfirmation('');
    setDeletePassword('');
    setIsLoading(false);
    setView('delete');
  };

  useEffect(() => {
    if (isOpen) return;
    setView('main');
    setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setDeleteConfirmation('');
    setDeletePassword('');
    setIsLoading(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleUpdatePassword = async () => {
    const validationError = validateNewPassword(passwordForm.newPassword, passwordForm.confirmPassword);
    if (validationError) return alert(validationError);
    if (!passwordForm.currentPassword || !email) return alert('请输入当前登录密码');

    setIsLoading(true);
    try {
      const { error: reauthenticationError } = await supabase.auth.signInWithPassword({ email, password: passwordForm.currentPassword });
      if (reauthenticationError) throw new Error('当前密码不正确，密码未修改');
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword
      });

      if (error) throw error;
      
      alert('密码修改成功');
      setView('main');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error: any) {
      alert(`修改失败: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const renderMainView = () => (
    <div className="space-y-1">
      {/* Email (Read Only) */}
      <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 flex items-center justify-between rounded-xl">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-100 text-blue-600 rounded-lg dark:bg-blue-900/30 dark:text-blue-400">
            <Mail size={18} />
          </div>
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-white">绑定邮箱</div>
            <div className="text-xs text-slate-500 dark:text-zinc-500 mt-0.5">{email || '未获取'}</div>
          </div>
        </div>
        <div className="px-2 py-1 bg-green-100 text-green-600 text-[10px] font-bold rounded dark:bg-green-900/30 dark:text-green-400">
          已绑定
        </div>
      </div>

      {/* Password */}
      <button 
        onClick={() => setView('password')}
        className="w-full bg-white dark:bg-zinc-900 p-4 flex items-center justify-between border-b border-slate-50 dark:border-zinc-800 last:border-0 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-orange-100 text-orange-600 rounded-lg dark:bg-orange-900/30 dark:text-orange-400">
            <Lock size={18} />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-900 dark:text-white">登录密码</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">定期修改密码更安全</div>
          </div>
        </div>
        <ChevronRight size={16} className="text-slate-300" />
      </button>

      <button
        onClick={openDeleteView}
        className="mt-3 flex w-full items-center justify-between rounded-xl border border-red-100 bg-red-50/60 p-4 text-left dark:border-red-950 dark:bg-red-950/20"
      >
        <div className="flex items-center space-x-3">
          <div className="rounded-lg bg-red-100 p-2 text-red-600 dark:bg-red-950/50 dark:text-red-400"><Trash2 size={18} /></div>
          <div><div className="text-sm font-medium text-red-700 dark:text-red-300">永久删除账号</div><div className="mt-0.5 text-xs text-red-500/80">删除账号及关联库存、流水和图片</div></div>
        </div>
        <ChevronRight size={16} className="text-red-300" />
      </button>

    </div>
  );

  const renderPasswordView = () => (
    <div className="space-y-4 pt-4">
      <div className="space-y-3">
        <input type="email" name="username" value={email || ''} readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">当前密码</label>
          <input type="password" name="current-password" autoComplete="current-password" className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-dewu-500 transition-colors" placeholder="用于重新验证身份" value={passwordForm.currentPassword} onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">新密码</label>
          <input 
            type="password" 
            autoComplete="new-password"
            className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
            placeholder="请输入新密码"
            value={passwordForm.newPassword}
            onChange={e => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">确认新密码</label>
          <input 
            type="password" 
            autoComplete="new-password"
            className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
            placeholder="请再次输入新密码"
            value={passwordForm.confirmPassword}
            onChange={e => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
          />
        </div>
      </div>
      <button 
        onClick={handleUpdatePassword}
        disabled={isLoading}
        className="w-full bg-slate-900 dark:bg-dewu-500 text-white font-medium py-3 rounded-xl active:scale-95 transition-all shadow-lg shadow-slate-200 dark:shadow-none disabled:opacity-50"
      >
        {isLoading ? '提交中...' : '确认修改'}
      </button>
    </div>
  );

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== '永久删除' || !deletePassword || !email) return;
    setIsLoading(true);
    try {
      const { error: reauthenticationError } = await supabase.auth.signInWithPassword({ email, password: deletePassword });
      if (reauthenticationError) throw new Error('当前密码不正确，账号未删除');
      const { data, error } = await supabase.functions.invoke('delete-account', {
        body: { confirmation: 'DELETE_MY_ACCOUNT' },
      });
      if (error || !data?.deleted) {
        let detail = data?.error;
        const context = (error as any)?.context;
        if (!detail && context?.clone) {
          try { detail = (await context.clone().json())?.error; } catch { /* keep stable retry guidance */ }
        }
        throw new Error(detail || '删除服务暂时不可用');
      }
      await supabase.auth.signOut({ scope: 'local' });
      onAccountDeleted();
    } catch (error: any) {
      alert(getAccountDeletionErrorMessage(error?.message));
    } finally {
      setIsLoading(false);
    }
  };

  const renderDeleteView = () => (
    <form className="space-y-4 pt-2" onSubmit={(event) => { event.preventDefault(); void handleDeleteAccount(); }} autoComplete="off">
      <div className="rounded-xl border border-red-100 bg-red-50 p-4 text-sm leading-6 text-red-700 dark:border-red-950 dark:bg-red-950/20 dark:text-red-300">
        <div className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={17} />此操作不可撤销</div>
        账号、库存、回收站、流水、仓库、费用方案、修复与结算记录以及已上传图片都会永久删除。请先导出完整账本备份。
      </div>
      <input type="email" name="username" value={email || ''} readOnly autoComplete="username" tabIndex={-1} aria-hidden="true" className="sr-only" />
      <label className="block text-xs text-slate-500">请输入“永久删除”确认
        <input name="account-delete-confirmation" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" data-lpignore="true" data-1p-ignore="true" spellCheck={false} className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
      </label>
      <label className="block text-xs text-slate-500">当前登录密码
        <input type="password" name="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} autoComplete="current-password" className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-red-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
      </label>
      <button type="submit" disabled={isLoading || deleteConfirmation !== '永久删除' || !deletePassword} className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
        {isLoading && <Loader2 size={16} className="animate-spin" />}{isLoading ? '正在删除...' : '永久删除我的账号'}
      </button>
      <button type="button" onClick={() => openExternalUrl(PUBLIC_LINKS.accountDeletion)} className="block w-full text-center text-xs text-slate-400 underline">查看账号删除说明</button>
    </form>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {view === 'main' ? '账号安全' : view === 'password' ? '修改密码' : '删除账号'}
            </h2>
            <button 
                onClick={() => {
                    if (view === 'main') onClose();
                    else setView('main');
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300 p-1"
            >
                <X size={20} />
            </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto">
            {view === 'main' && renderMainView()}
            {view === 'password' && renderPasswordView()}
            {view === 'delete' && renderDeleteView()}
        </div>
      </div>
    </div>
  );
};
