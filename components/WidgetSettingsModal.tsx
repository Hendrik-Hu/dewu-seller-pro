import React, { useEffect, useState } from 'react';
import { X, Smartphone, Check, RefreshCw } from 'lucide-react';
import { updateWidgetData } from '../utils/widget';

interface WidgetSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalStock: number;
  todayInbound: number;
}

export const WidgetSettingsModal: React.FC<WidgetSettingsModalProps> = ({
  isOpen,
  onClose,
  totalStock,
  todayInbound
}) => {
  const [isSyncing, setIsSyncing] = useState(false);

  if (!isOpen) return null;

  const handleManualSync = async () => {
    setIsSyncing(true);
    await updateWidgetData({
      totalStock,
      inboundToday: todayInbound,
      lastUpdated: new Date().toLocaleTimeString()
    });
    setTimeout(() => setIsSyncing(false), 800);
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full h-[85%] sm:h-auto sm:max-w-sm bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-2xl p-6 flex flex-col shadow-2xl animate-in slide-in-from-bottom-10">
        
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">桌面小组件</h2>
          <button 
            onClick={onClose}
            className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-6">
          
          {/* Preview Card */}
          <div className="bg-gradient-to-br from-dewu-500 to-purple-600 rounded-2xl p-4 text-white shadow-lg transform scale-95 mx-auto w-full max-w-[280px]">
             <div className="flex justify-between items-start mb-2">
               <span className="text-xs font-medium opacity-80">得物卖家Pro</span>
               <div className="p-1 bg-white/20 rounded-full">
                 <Smartphone size={12} />
               </div>
             </div>
             <div className="flex items-end gap-2 mb-1">
                <span className="text-3xl font-bold">{totalStock}</span>
                <span className="text-xs opacity-80 mb-1">件库存</span>
             </div>
             <div className="text-xs opacity-60">今日入库: +{todayInbound}</div>
          </div>
          
          <div className="space-y-4">
             <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-slate-100 dark:border-zinc-800">
               <h3 className="font-semibold text-sm mb-3 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                 <span className="flex items-center justify-center w-5 h-5 rounded-full bg-dewu-500 text-white text-xs">1</span>
                 添加组件到桌面
               </h3>
               <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                 回到手机桌面 → 长按空白处 → 选择“添加小组件” → 找到“得物卖家Pro” → 拖动到桌面。
               </p>
             </div>

             <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-slate-100 dark:border-zinc-800">
               <h3 className="font-semibold text-sm mb-3 text-slate-900 dark:text-slate-100 flex items-center gap-2">
                 <span className="flex items-center justify-center w-5 h-5 rounded-full bg-dewu-500 text-white text-xs">2</span>
                 数据同步
               </h3>
               <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-3">
                 每次打开 App 时数据会自动同步。如果桌面数据未更新，请点击下方按钮手动同步。
               </p>
               <button 
                 onClick={handleManualSync}
                 disabled={isSyncing}
                 className="w-full py-2.5 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 active:scale-95 transition-all"
               >
                 {isSyncing ? (
                   <RefreshCw size={16} className="animate-spin text-dewu-500" />
                 ) : (
                   <RefreshCw size={16} />
                 )}
                 {isSyncing ? '同步中...' : '立即同步数据'}
               </button>
             </div>
          </div>

        </div>

        <button 
          onClick={onClose}
          className="mt-6 w-full py-3 bg-slate-900 dark:bg-white text-white dark:text-black rounded-xl font-bold text-sm active:scale-95 transition-transform"
        >
          我知道了
        </button>

      </div>
    </div>
  );
};
