import React, { useState, useRef } from 'react';
import { ArchiveRestore, Calculator, ChevronRight, LogOut, Edit2, Check, X, Camera, Moon, ToggleLeft, ToggleRight, Shield, Download, UserRound, ShieldAlert, LifeBuoy } from 'lucide-react';

import { APP_DISCLAIMER, APP_NAME } from '../lib/brand';
import { openExternalUrl, PUBLIC_LINKS } from '../lib/publicLinks';
import { SupportDiagnosticState } from '../lib/supportDiagnostics';
import { createDeferredComponent } from './DeferredComponent';

const AccountSecurityModal = createDeferredComponent(
  () => import('./AccountSecurityModal').then(({ AccountSecurityModal: component }) => component),
  { label: '账号安全', kind: 'modal' },
);
const SupportDiagnosticsModal = createDeferredComponent(
  () => import('./SupportDiagnosticsModal').then(({ SupportDiagnosticsModal: component }) => component),
  { label: '支持与安全诊断', kind: 'modal' },
);

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
  onRecycleBinClick: () => void;
  onExportClick: () => void;
  onDataHealthClick: () => void;
  onFeeSchemesClick: () => void;
  dataIssueCount: number;
  appVersion: string;
  diagnosticState: SupportDiagnosticState;
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
  onRecycleBinClick,
  onExportClick,
  onDataHealthClick,
  onFeeSchemesClick,
  dataIssueCount,
  appVersion,
  diagnosticState,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(username);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSupportModal, setShowSupportModal] = useState(false);

  // Toggle Dark Mode
  // useEffect logic removed, controlled by parent App.tsx now

  const menuGroups: Array<{ title: string; items: MenuItem[] }> = [
    {
      title: '数据与安全',
      items: [
      {
        icon: ShieldAlert,
        label: '数据体检',
        value: dataIssueCount > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600 dark:bg-amber-950/30 dark:text-amber-300">{dataIssueCount} 条待核对</span> : '正常',
        action: onDataHealthClick,
      },
      { icon: ArchiveRestore, label: '回收站', action: onRecycleBinClick },
      { icon: Download, label: '导出与恢复', action: onExportClick },
    ]},
    {
      title: '经营设置',
      items: [
      { icon: Calculator, label: '费用方案', action: onFeeSchemesClick },
      { 
        icon: Moon, 
        label: '深夜模式', 
        value: isDarkMode ? <ToggleRight className="text-dewu-500" size={24} /> : <ToggleLeft className="text-slate-300" size={24} />,
        action: onToggleTheme
      },
    ]},
    {
      title: '账号与支持',
      items: [
        { icon: Shield, label: '账号安全', action: () => setShowSecurityModal(true) },
        { icon: LifeBuoy, label: '支持与诊断', action: () => setShowSupportModal(true) },
      ],
    },
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
    const normalizedName = tempName.trim().replace(/\s+/g, ' ');
    const isValidName = normalizedName.length >= 2
      && normalizedName.length <= 20
      && !/[<>\r\n\t]/.test(normalizedName);

    if (isValidName) {
      onUpdateName(normalizedName);
      setIsEditing(false);
    } else {
      alert('用户名需为 2–20 个字符，且不能包含换行或尖括号');
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 pb-24 transition-colors duration-300 dark:bg-black">
      {/* Hidden File Input */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
        accept="image/jpeg,image/png,image/webp"
      />

      {/* Header Profile */}
      <div className="border-b border-slate-100 bg-white px-4 pb-6 pt-7 transition-colors duration-300 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center space-x-4">
          <div 
            className="group relative h-16 w-16 cursor-pointer rounded-full border-2 border-slate-100 bg-slate-200 dark:border-zinc-700 dark:bg-zinc-800"
            onClick={handleAvatarClick}
            role="button"
            tabIndex={0}
            aria-label="更换头像"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="User" className="w-full h-full object-cover rounded-full" />
            ) : (
              <UserRound size={34} className="m-auto h-full text-slate-400" aria-label="默认头像" />
            )}
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
                  <button onClick={handleSaveName} className="app-icon-button border-0 bg-green-50 text-green-600" aria-label="保存用户名">
                    <Check size={16} />
                  </button>
                  <button onClick={() => setIsEditing(false)} className="app-icon-button border-0 bg-red-50 text-red-600" aria-label="取消修改用户名">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">{username}</h2>
                  <button 
                    onClick={handleStartEdit}
                    className="app-icon-button border-0 bg-transparent text-slate-400 hover:bg-slate-50 hover:text-dewu-500 dark:hover:bg-zinc-800"
                    aria-label="修改用户名"
                  >
                    <Edit2 size={14} />
                  </button>
                </>
              )}
            </div>
            
            {email && <p className="mt-1 truncate text-xs text-slate-400 dark:text-zinc-500">{email}</p>}
          </div>
        </div>
        
        <div className="mt-6 grid grid-cols-3 gap-4">
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
      <div className="space-y-5 px-4 py-5">
        {menuGroups.map((group, gIdx) => (
          <section key={group.title} aria-labelledby={`profile-group-${gIdx}`}>
            <h3 id={`profile-group-${gIdx}`} className="app-section-title mb-2 px-1">{group.title}</h3>
            <div className="app-list-surface">
            {group.items.map((item, iIdx) => (
              <button 
                key={item.label}
                onClick={item.action}
                className={`app-touch flex w-full items-center justify-between px-4 text-left transition-colors active:bg-slate-50 dark:active:bg-zinc-800 ${
                  iIdx !== group.items.length - 1 ? 'border-b border-slate-100 dark:border-zinc-800' : ''
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
          </section>
        ))}

        <button 
          onClick={() => setShowLogoutConfirm(true)}
          className="app-secondary-action w-full space-x-2 text-sm font-medium text-red-500 active:bg-red-50 dark:active:bg-red-900/10">
          <LogOut size={18} />
          <span>退出登录</span>
        </button>

        <div className="text-center text-xs leading-5 text-slate-500 dark:text-zinc-500">
          <p>{APP_NAME} · Version {appVersion}</p>
          <p>{APP_DISCLAIMER}</p>
          <div className="mt-1 flex justify-center gap-3"><button onClick={() => openExternalUrl(PUBLIC_LINKS.privacy)} className="underline">隐私说明</button><button onClick={() => openExternalUrl(PUBLIC_LINKS.accountDeletion)} className="underline">账号删除说明</button><button onClick={() => setShowSupportModal(true)} className="underline">支持与诊断</button></div>
        </div>
      </div>

      {showSecurityModal && (
        <AccountSecurityModal
          isOpen
          onClose={() => setShowSecurityModal(false)}
          onAccountDeleted={onLogout}
          email={email}
        />
      )}
      {showSupportModal && (
        <SupportDiagnosticsModal
          isOpen
          onClose={() => setShowSupportModal(false)}
          appVersion={appVersion}
          diagnosticState={diagnosticState}
        />
      )}

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
