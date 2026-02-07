import React, { useState } from 'react';
import { X, Mail, Smartphone, Lock, MessageCircle, ChevronRight, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface AccountSecurityModalProps {
  isOpen: boolean;
  onClose: () => void;
  email?: string;
}

export const AccountSecurityModal: React.FC<AccountSecurityModalProps> = ({ isOpen, onClose, email }) => {
  const [view, setView] = useState<'main' | 'password' | 'phone'>('main');
  const [passwordForm, setPasswordForm] = useState({ newPassword: '', confirmPassword: '' });
  const [phoneForm, setPhoneForm] = useState({ phone: '', code: '' });
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleUpdatePassword = async () => {
    if (passwordForm.newPassword.length < 6) {
      alert('密码长度至少为6位');
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert('两次输入的密码不一致');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword
      });

      if (error) throw error;
      
      alert('密码修改成功');
      setView('main');
      setPasswordForm({ newPassword: '', confirmPassword: '' });
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

      {/* Phone */}
      <button 
        onClick={() => setView('phone')}
        className="w-full bg-white dark:bg-zinc-900 p-4 flex items-center justify-between border-b border-slate-50 dark:border-zinc-800 last:border-0 hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg dark:bg-indigo-900/30 dark:text-indigo-400">
            <Smartphone size={18} />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-900 dark:text-white">手机号</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">未绑定</div>
          </div>
        </div>
        <ChevronRight size={16} className="text-slate-300" />
      </button>

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

      {/* Third Party - QQ */}
      <button 
        className="w-full bg-white dark:bg-zinc-900 p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-zinc-800 transition-colors"
      >
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-sky-100 text-sky-600 rounded-lg dark:bg-sky-900/30 dark:text-sky-400">
            <MessageCircle size={18} />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-slate-900 dark:text-white">QQ账号</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">未绑定</div>
          </div>
        </div>
        <span className="text-xs text-dewu-500 font-medium">去绑定</span>
      </button>
    </div>
  );

  const renderPasswordView = () => (
    <div className="space-y-4 pt-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5 ml-1">新密码</label>
          <input 
            type="password" 
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

  const renderPhoneView = () => (
    <div className="pt-8 text-center">
      <div className="w-16 h-16 bg-slate-100 dark:bg-zinc-800 rounded-full flex items-center justify-center mx-auto mb-4">
        <Smartphone size={32} className="text-slate-400" />
      </div>
      <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-2">绑定手机号</h3>
      <p className="text-sm text-slate-500 dark:text-zinc-500 px-8 mb-8">
        为了您的账号安全，绑定手机号功能需要通过企业实名认证后方可使用。
      </p>
      <button 
        onClick={() => setView('main')}
        className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 px-6 py-2 rounded-lg text-sm font-medium"
      >
        返回
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {view === 'main' ? '账号安全' : (view === 'password' ? '修改密码' : '绑定手机')}
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
            {view === 'phone' && renderPhoneView()}
        </div>
      </div>
    </div>
  );
};
