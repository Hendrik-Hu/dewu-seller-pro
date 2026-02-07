import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Eye, EyeOff } from 'lucide-react';

interface AuthScreenProps {
  onAuthSuccess: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      alert('请输入邮箱地址');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin, // Reset link redirects back to app
      });
      if (error) throw error;
      alert('重置邮件已发送！请检查您的邮箱（包括垃圾邮件文件夹）。');
      setIsResetPassword(false);
      setIsLogin(true);
    } catch (error: any) {
      alert(error.message || '发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        
        // Check if email confirmation is required (production mode)
        if (data.user && !data.session) {
           alert('注册成功！\n\n验证邮件已发送至您的邮箱，请点击邮件中的链接完成验证后登录。');
        } else {
           alert('注册成功！请直接登录。');
        }
        
        setIsLogin(true);
        setLoading(false);
        return; // Don't trigger success yet, let them login
      }
      onAuthSuccess();
    } catch (error: any) {
      console.error('Auth error:', error);
      if (error.message.includes('Email not confirmed')) {
        alert('登录失败：您的邮箱尚未验证。\n\n请检查您的邮箱点击验证链接。');
      } else if (error.message.includes('Invalid login credentials')) {
        alert('登录失败：账号或密码错误。');
      } else {
        alert(error.message || '认证失败');
      }
    } finally {
      setLoading(false);
    }
  };

  if (isResetPassword) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-black p-6">
        <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-zinc-800">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              重置密码
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              输入您的注册邮箱，我们将向您发送重置链接
            </p>
          </div>

          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                邮箱
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-dewu-500 text-slate-900 dark:text-white transition-all"
                placeholder="请输入注册邮箱"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-dewu-500 hover:bg-dewu-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : '发送重置邮件'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsResetPassword(false)}
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-dewu-500 dark:hover:text-dewu-400 transition-colors"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-black p-6">
      <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-zinc-800">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            {isLogin ? '欢迎回来' : '创建账号'}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            得物卖家专业版 - 库存管理助手
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              邮箱
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-dewu-500 text-slate-900 dark:text-white transition-all"
              placeholder="请输入邮箱"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              密码
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-dewu-500 text-slate-900 dark:text-white transition-all"
                placeholder="请输入密码"
                minLength={6}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-dewu-500 hover:bg-dewu-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center space-y-3">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-slate-500 dark:text-slate-400 hover:text-dewu-500 dark:hover:text-dewu-400 transition-colors"
          >
            {isLogin ? '还没有账号？去注册' : '已有账号？去登录'}
          </button>
          
          {isLogin && (
            <button
              onClick={() => setIsResetPassword(true)}
              className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
            >
              忘记密码？
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
