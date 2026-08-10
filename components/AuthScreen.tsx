import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { APP_DISCLAIMER, APP_NAME } from '../lib/brand';
import { Capacitor } from '@capacitor/core';
import { PUBLIC_LINKS } from '../lib/publicLinks';
import { validateAuthCredentials } from '../lib/authValidation';

interface AuthScreenProps {
  onAuthSuccess: () => void;
  isPasswordRecovery?: boolean;
  onRecoveryComplete?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, isPasswordRecovery = false, onRecoveryComplete }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [isAwaitingConfirmation, setIsAwaitingConfirmation] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');

  const getAuthErrorMessage = (error: any, fallback: string) => {
    const message = String(error?.message || '').trim();

    if (!message) return fallback;
    if (message.includes('Failed to fetch')) {
      return '无法连接到登录服务，请检查当前网络、DNS 或 Supabase 服务配置后重试。';
    }
    if (message.includes('Email not confirmed')) {
      return '您的邮箱尚未验证，请先完成邮箱验证。';
    }
    if (message.includes('Invalid login credentials')) {
      return '账号或密码错误。';
    }

    return message;
  };

  const handleResendConfirmation = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: PUBLIC_LINKS.emailConfirmation },
      });
      if (error) throw error;
      alert('确认邮件已重新发送，请检查收件箱和垃圾邮件。');
    } catch (error: any) {
      alert(getAuthErrorMessage(error, '确认邮件发送失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      alert('请输入邮箱地址');
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: Capacitor.isNativePlatform()
          ? PUBLIC_LINKS.passwordRecovery
          : new URL('/auth/recovery', window.location.origin).toString(),
      });
      if (error) throw error;
      alert('重置邮件已发送！请检查您的邮箱（包括垃圾邮件文件夹）。');
      setIsResetPassword(false);
      setIsLogin(true);
    } catch (error: any) {
      alert(getAuthErrorMessage(error, '发送失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryPassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 8) return alert('新密码至少需要 8 位');
    if (password !== confirmPassword) return alert('两次输入的新密码不一致');
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      setPassword('');
      setConfirmPassword('');
      alert('密码已更新，请使用新密码重新登录');
      onRecoveryComplete?.();
    } catch (error: any) {
      alert(getAuthErrorMessage(error, '密码更新失败，请重新打开邮件中的链接'));
    } finally {
      setLoading(false);
    }
  };

  if (isPasswordRecovery) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 dark:bg-black">
        <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-white p-8 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <h1 className="mb-2 text-center text-2xl font-bold text-slate-900 dark:text-white">设置新密码</h1>
          <p className="mb-7 text-center text-sm text-slate-500">恢复链接已验证，请设置新的登录密码</p>
          <form onSubmit={handleRecoveryPassword} className="space-y-4">
            <label className="block text-sm text-slate-600 dark:text-zinc-300">新密码
              <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
            <label className="block text-sm text-slate-600 dark:text-zinc-300">确认新密码
              <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-800" />
            </label>
            <button type="submit" disabled={loading} className="auth-primary-action flex w-full items-center justify-center rounded-xl bg-slate-900 py-3 font-bold disabled:opacity-50 dark:bg-dewu-500">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : '更新密码'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateAuthCredentials(email, password, isLogin);
    if (validationError) {
      alert(validationError);
      return;
    }
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
          options: { emailRedirectTo: PUBLIC_LINKS.emailConfirmation },
        });
        if (error) throw error;
        
        // Check if email confirmation is required (production mode)
        if (data.user && !data.session) {
           setIsAwaitingConfirmation(true);
        } else {
           onAuthSuccess();
        }
        
        setLoading(false);
        return; 
      }
      onAuthSuccess();
    } catch (error: any) {
      console.error('Auth error:', error);
      if (error.message.includes('Email not confirmed')) {
        alert('登录失败：您的邮箱尚未验证。\n\n请检查您的邮箱验证码。');
        setIsAwaitingConfirmation(true);
      } else if (error.message.includes('Invalid login credentials')) {
        alert('登录失败：账号或密码错误。');
      } else {
        alert(getAuthErrorMessage(error, '认证失败'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (isAwaitingConfirmation) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-black p-6">
        <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-zinc-800">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              请确认你的邮箱
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              确认链接已发送至 {email}。点击邮件中的链接后会回到卖家库存助手。
            </p>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => {
                setIsAwaitingConfirmation(false);
                setIsLogin(true);
              }}
              className="auth-primary-action w-full bg-dewu-500 hover:bg-dewu-600 font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95"
            >
              已完成验证，去登录
            </button>
            <button
              type="button"
              onClick={handleResendConfirmation}
              disabled={loading}
              className="w-full rounded-xl border border-slate-200 py-3 text-sm font-semibold text-slate-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300"
            >
              {loading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : '重新发送确认邮件'}
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsAwaitingConfirmation(false)}
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-dewu-500 dark:hover:text-dewu-400 transition-colors"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

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
              className="auth-primary-action w-full bg-dewu-500 hover:bg-dewu-600 font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
            {APP_NAME}
          </p>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-zinc-500">{APP_DISCLAIMER}</p>
        </div>

        <form onSubmit={handleAuth} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              邮箱
            </label>
            <input
              type="email"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-dewu-500 text-slate-900 dark:text-white transition-all"
                placeholder="请输入密码"
                minLength={isLogin ? undefined : 8}
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
            className="auth-primary-action w-full bg-dewu-500 hover:bg-dewu-600 font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : (isLogin ? '登录' : '注册')}
          </button>
        </form>

        <div className="mt-6 flex flex-col items-center space-y-3">
          <button
            type="button"
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
