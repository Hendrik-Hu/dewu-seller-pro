import React, { useState, useRef, useEffect } from 'react';
import { Settings, Bell, Shield, CircleHelp, ChevronRight, LogOut, Edit2, Check, X, Camera, Moon, LayoutGrid, ToggleLeft, ToggleRight } from 'lucide-react';

import { AccountSecurityModal } from './AccountSecurityModal';

interface MenuItem {
  icon: React.ElementType;
  label: string;
  value?: string | React.ReactNode;
  action?: () => void;
}

interface ProfileProps {
  username: string;
  avatarUrl: string;
  onUpdateName: (name: string) => void;
  onUpdateAvatar: (file: File) => void;
  totalStock: number;
  totalInbound: number;
  totalOutbound: number;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  email?: string;
  onWidgetClick: () => void;
}

export const Profile: React.FC<ProfileProps> = ({ 
  username, 
  avatarUrl, 
  onUpdateName, 
  onUpdateAvatar,
  totalStock,
  totalInbound,
  totalOutbound,
  isDarkMode,
  onToggleTheme,
  onLogout,
  email,
  onWidgetClick
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(username);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Toggle Dark Mode
  // useEffect logic removed, controlled by parent App.tsx now

  const menuGroups: MenuItem[][] = [
    [
      { icon: Bell, label: '消息通知', value: '2条未读' },
    ],
    [
      { 
        icon: Moon, 
        label: '深夜模式', 
        value: isDarkMode ? <ToggleRight className="text-dewu-500" size={24} /> : <ToggleLeft className="text-slate-300" size={24} />,
        action: onToggleTheme
      },
      { icon: LayoutGrid, label: '小组件管理', action: onWidgetClick },
      { icon: Shield, label: '账号安全', action: () => setShowSecurityModal(true) },
      { icon: Settings, label: '通用设置', action: () => alert('清理缓存成功！') },
      { icon: CircleHelp, label: '帮助中心' },
    ]
  ];

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onUpdateAvatar(file);
    }
  };

  const handleStartEdit = () => {
    setTempName(username);
    setIsEditing(true);
  };

  const handleSaveName = () => {
    // Regex: exactly 4 Chinese characters
    const chineseRegex = /^[\u4e00-\u9fa5]{4}$/;
    
    if (chineseRegex.test(tempName)) {
      onUpdateName(tempName);
      setIsEditing(false);
    } else {
      alert("用户名格式错误：请输入四个字的中文");
    }
  };

  return (
    <div className="h-full bg-slate-50 dark:bg-black overflow-y-auto pb-24 transition-colors duration-300">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/*"
      />

      {/* Header Profile */}
      <div className="bg-white dark:bg-zinc-900 p-6 pt-10 pb-8 border-b border-slate-100 dark:border-zinc-800 transition-colors duration-300">
        <div className="flex items-center space-x-4">
          <div 
            className="relative w-20 h-20 rounded-full bg-slate-200 dark:bg-zinc-800 border-4 border-slate-50 dark:border-zinc-700 shadow-sm group cursor-pointer"
            onClick={handleAvatarClick}
          >
            <img src={avatarUrl} alt="User" className="w-full h-full object-cover rounded-full" />
            <div className="absolute inset-0 bg-black/30 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <Camera className="text-white" size={24} />
            </div>
          </div>
          
          <div className="flex-1">
            <div className="flex items-center space-x-2">
              {isEditing ? (
                <div className="flex items-center space-x-2">
                  <input 
                    type="text" 
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    className="border-b-2 border-dewu-500 outline-none text-xl font-bold text-slate-900 dark:text-white w-32 bg-transparent"
                    autoFocus
                  />
                  <button onClick={handleSaveName} className="p-1 bg-green-50 text-green-600 rounded-full">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setIsEditing(false)} className="p-1 bg-red-50 text-red-600 rounded-full">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{username}</h2>
                  <button 
                    onClick={handleStartEdit}
                    className="p-1.5 text-slate-400 hover:text-dewu-500 hover:bg-slate-50 dark:hover:bg-zinc-800 rounded-full transition-colors"
                  >
                    <Edit2 size={14} />
                  </button>
                </>
              )}
            </div>
            
            <div className="flex items-center mt-1 space-x-2">
              <span className="px-2 py-0.5 bg-dewu-50 dark:bg-dewu-900/30 text-dewu-600 dark:text-dewu-400 text-[10px] font-bold rounded border border-dewu-100 dark:border-dewu-800">
                PRO MERCHANT
              </span>
              <span className="text-xs text-slate-400 dark:text-zinc-500">ID: 88482024</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-4 mt-8">
          <div className="text-center">
            <div className="text-lg font-bold text-slate-900 dark:text-white">{totalStock}</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-1">总库存</div>
          </div>
          <div className="text-center border-l border-r border-slate-100 dark:border-zinc-800">
            <div className="text-lg font-bold text-slate-900 dark:text-white">{totalInbound}</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-1">总入库量</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-bold text-slate-900 dark:text-white">{totalOutbound}</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-1">总出库量</div>
          </div>
        </div>
      </div>

      {/* Menu Groups */}
      <div className="px-5 py-6 space-y-6">
        {menuGroups.map((group, gIdx) => (
          <div key={gIdx} className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-slate-100 dark:border-zinc-800 overflow-hidden transition-colors duration-300">
            {group.map((item, iIdx) => (
              <button 
                key={iIdx}
                onClick={item.action}
                className={`w-full flex items-center justify-between p-4 active:bg-slate-50 dark:active:bg-zinc-800 transition-colors ${
                  iIdx !== group.length - 1 ? 'border-b border-slate-50 dark:border-zinc-800' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-slate-50 dark:bg-zinc-800 rounded-lg text-slate-600 dark:text-zinc-400">
                    <item.icon size={18} />
                  </div>
                  <span className="text-sm font-medium text-slate-700 dark:text-zinc-200">{item.label}</span>
                </div>
                <div className="flex items-center space-x-2">
                  {item.value && (
                     typeof item.value === 'string' ? (
                        <span className="text-xs text-slate-400 dark:text-zinc-500 font-medium">{item.value}</span>
                     ) : (
                        item.value
                     )
                  )}
                  {typeof item.value === 'string' && <ChevronRight size={16} className="text-slate-300 dark:text-zinc-600" />}
                  {!item.value && <ChevronRight size={16} className="text-slate-300 dark:text-zinc-600" />}
                </div>
              </button>
            ))}
          </div>
        ))}

        <button 
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full bg-white dark:bg-zinc-900 text-red-500 font-medium text-sm p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm flex items-center justify-center space-x-2 active:bg-red-50 dark:active:bg-red-900/10 transition-colors">
          <LogOut size={18} />
          <span>退出登录</span>
        </button>

        <p className="text-center text-[10px] text-slate-300 dark:text-zinc-600">Version 1.0.0 · Developed for Dewu Sellers</p>
      </div>

      <AccountSecurityModal 
        isOpen={showSecurityModal}
        onClose={() => setShowSecurityModal(false)}
        email={email}
      />

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
            <div className="bg-white dark:bg-zinc-900 w-full max-w-xs rounded-2xl shadow-2xl p-6 transform transition-all scale-100">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white text-center mb-2">
                    确认退出登录？
                </h3>
                <p className="text-sm text-slate-500 dark:text-zinc-400 text-center mb-6">
                    退出后您需要重新登录才能管理库存
                </p>
                <div className="flex space-x-3">
                    <button 
                        onClick={() => setShowLogoutConfirm(false)}
                        className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 font-medium text-sm active:scale-95 transition-transform"
                    >
                        取消
                    </button>
                    <button 
                        onClick={() => {
                            setShowLogoutConfirm(false);
                            onLogout();
                        }}
                        className="flex-1 py-2.5 rounded-xl bg-slate-900 dark:bg-dewu-500 text-white font-medium text-sm active:scale-95 transition-transform shadow-lg shadow-slate-200 dark:shadow-none"
                    >
                        确认退出
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};