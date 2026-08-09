import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { APP_DISCLAIMER, APP_NAME } from '../lib/brand';
import { Capacitor } from '@capacitor/core';
import { PUBLIC_LINKS } from '../lib/publicLinks';

interface AuthScreenProps {
  onAuthSuccess: () => void;
  isPasswordRecovery?: boolean;
  onRecoveryComplete?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess, isPasswordRecovery = false, onRecoveryComplete }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
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

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp) return alert('请输入验证码');
    
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: 'signup'
      });

      if (error) throw error;

      if (data.session) {
        alert('验证成功！');
        onAuthSuccess();
      } else {
        alert('验证完成，请登录');
        setIsVerifying(false);
        setIsLogin(true);
      }
    } catch (error: any) {
      console.error('Verify error:', error);
      alert(`验证失败: ${getAuthErrorMessage(error, '验证码错误或已过期')}`);
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
            <button type="submit" disabled={loading} className="flex w-full items-center justify-center rounded-xl bg-slate-900 py-3 font-bold text-white disabled:opacity-50 dark:bg-dewu-500">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : '更新密码'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
           alert('注册成功！\n\n验证码已发送至您的邮箱，请输入验证码完成注册。');
           setIsVerifying(true);
        } else {
           alert('注册成功！请直接登录。');
           setIsLogin(true);
        }
        
        setLoading(false);
        return; 
      }
      onAuthSuccess();
    } catch (error: any) {
      console.error('Auth error:', error);
      if (error.message.includes('Email not confirmed')) {
        alert('登录失败：您的邮箱尚未验证。\n\n请检查您的邮箱验证码。');
        setIsVerifying(true); // Allow them to enter OTP if they try to login unverified
      } else if (error.message.includes('Invalid login credentials')) {
        alert('登录失败：账号或密码错误。');
      } else {
        alert(getAuthErrorMessage(error, '认证失败'));
      }
    } finally {
      setLoading(false);
    }
  };

  if (isVerifying) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-black p-6">
        <div className="w-full max-w-sm bg-white dark:bg-zinc-900 rounded-2xl shadow-xl p-8 border border-slate-100 dark:border-zinc-800">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              请输入验证码
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              已发送 6 位数验证码至 {email}
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                验证码
              </label>
              <input
                type="text"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-dewu-500 text-slate-900 dark:text-white transition-all text-center tracking-widest text-lg"
                placeholder="000000"
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-dewu-500 hover:bg-dewu-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center shadow-lg shadow-dewu-500/30 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : '验证并登录'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsVerifying(false)}
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
            {APP_NAME}
          </p>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-zinc-500">{APP_DISCLAIMER}</p>
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
