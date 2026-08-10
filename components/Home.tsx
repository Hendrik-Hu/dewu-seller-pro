import React from 'react';
import { ShoppingBag, Truck, Package, ArrowDownRight, ArrowUpRight, ChevronRight, Clock, Sparkles, UserRound, RefreshCw, Loader2 } from 'lucide-react';
import { Activity, Warehouse } from '../types';
import { InventoryStatsModal } from './InventoryStatsModal';
import { AIManagementModal } from './AIManagementModal';
import { getActivityGrossAmount, getActivityQuantity } from '../lib/inventoryMetrics';
import { formatProductSize } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';
import { ActivityLedgerModal } from './ActivityLedgerModal';
import { getActivityTypeLabel } from '../lib/activityPresentation';
import type { InventoryAnalytics } from '../lib/inventoryMetrics';

interface HomeProps {
  userId: string;
  warehouses: Warehouse[];
  username: string;
  avatarUrl: string;
  onInboundClick: () => void;
  onOutboundClick: () => void;
  onInventoryClick?: () => void; // New prop for direct inventory click
  onTransitClick: () => void;
  onAvatarClick: () => void;
  activities: Activity[];
  transitProductCount: number;
  todaySalesAmount: number;
  todaySalesCount: number;
  analytics: InventoryAnalytics;
  analyticsReady: boolean;
  analyticsError?: string;
  recentActivitiesReady: boolean;
  recentActivitiesError?: string;
  onRetryData: () => void;
  onAIManageExecuted?: () => void;
}

export const Home: React.FC<HomeProps> = ({ 
  userId,
  warehouses,
  username, 
  avatarUrl,
  onInboundClick, 
  onOutboundClick, 
  onInventoryClick,
  onTransitClick,
  onAvatarClick,
  activities,
  transitProductCount,
  todaySalesAmount,
  todaySalesCount,
  analytics,
  analyticsReady,
  analyticsError,
  recentActivitiesReady,
  recentActivitiesError,
  onRetryData,
  onAIManageExecuted
}) => {
  // Inventory Modal State
  const [showInventoryModal, setShowInventoryModal] = React.useState(false);
  const [showAIModal, setShowAIModal] = React.useState(false);
  const [showActivityLedger, setShowActivityLedger] = React.useState(false);

  const formatTime = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (e) {
      return '';
    }
  };
  
  return (
    <div className="px-5 py-6 pb-24 space-y-6 h-full overflow-y-auto bg-slate-50 dark:bg-black transition-colors duration-300">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">你好！{username}</h1>
          <p className="text-slate-500 dark:text-zinc-400 text-sm mt-1">今天也要爆单哦 🚀</p>
        </div>
        <button onClick={onAvatarClick} className="w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 overflow-hidden border border-slate-200 dark:border-zinc-700 active:opacity-80 transition-opacity">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <UserRound size={20} className="m-auto h-full text-slate-400" aria-label="默认头像" />
          )}
        </button>
      </div>

      {!analyticsReady && !analyticsError && (
        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">正在同步库存与经营摘要...</div>
      )}
      {analyticsError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <span>{analyticsReady ? '数据刷新失败，当前显示上次成功结果，可能已过期。' : '库存与经营摘要同步失败，请重试。'}</span>
          <button type="button" onClick={onRetryData} className="flex shrink-0 items-center gap-1 font-semibold"><RefreshCw size={12} />重试</button>
        </div>
      )}

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Sales Card */}
        <div className="bg-gradient-to-br from-dewu-500 to-dewu-600 p-3.5 rounded-xl text-white shadow-lg shadow-dewu-200/20 min-h-[132px]">
          <div className="flex justify-between items-center mb-3">
             <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
              <ShoppingBag size={18} className="text-white" />
            </div>
            {/* Simple static trend indicator for now */}
            <span className="text-[11px] font-medium bg-white/20 px-2 py-0.5 rounded-full text-white">今日实时</span>
          </div>
          <div className="space-y-2">
            <div>
              <div className="flex items-baseline space-x-1">
                <span className="text-[30px] leading-none font-bold">{analyticsReady ? `¥ ${todaySalesAmount.toLocaleString()}` : '—'}</span>
              </div>
              <div className="text-dewu-50 text-[11px] opacity-90 mt-1">今日销售额</div>
            </div>
            
            <div className="w-full h-px bg-white/20"></div>
            
            <div className="flex items-baseline justify-between">
              <span className="text-dewu-50 text-[11px] opacity-90">销售件数</span>
              <span className="text-xl leading-none font-bold">{analyticsReady ? todaySalesCount : '—'} <span className="text-[11px] font-normal opacity-80">件</span></span>
            </div>
          </div>
        </div>

        {/* Purchasing transit inventory */}
        <button 
          onClick={onTransitClick}
          className="bg-white dark:bg-zinc-900 p-3.5 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm min-h-[132px] group active:scale-95 transition-all text-left"
        >
          <div className="w-full flex justify-between items-center mb-3">
            <div className="bg-orange-50 dark:bg-orange-900/20 p-2 rounded-lg group-hover:bg-orange-100 dark:group-hover:bg-orange-900/30 transition-colors">
              <Truck size={18} className="text-orange-500" />
            </div>
            <ChevronRight size={14} className="text-slate-300 dark:text-zinc-600 group-hover:text-slate-400" />
          </div>
          <div className="space-y-1.5">
            <div className="text-[42px] leading-none font-bold text-slate-900 dark:text-white">{analyticsReady ? transitProductCount : '—'}</div>
            <div className="text-slate-400 dark:text-zinc-500 text-[11px]">采购运输中</div>
          </div>
        </button>
      </div>

      {/* Action Grid */}
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 px-1">快速功能</h3>
        <div className="bg-white dark:bg-zinc-900 rounded-2xl p-4 border border-slate-100 dark:border-zinc-800 shadow-sm grid grid-cols-4 gap-4">
          <button onClick={onInboundClick} className="flex flex-col items-center space-y-2 active:opacity-60 transition-opacity">
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl">
              <ArrowDownRight size={20} className="text-blue-500" />
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">入库</span>
          </button>
          <button onClick={onOutboundClick} className="flex flex-col items-center space-y-2 active:opacity-60 transition-opacity">
            <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-xl">
              <ArrowUpRight size={20} className="text-green-500" />
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">出库</span>
          </button>
          
          {/* Inventory Button - Trigger Modal */}
          <button 
            onClick={() => setShowInventoryModal(true)} 
            disabled={!analyticsReady}
            className="flex flex-col items-center space-y-2 active:opacity-60 transition-opacity"
          >
            <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-xl">
              <Package size={20} className="text-purple-500" />
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">库存</span>
          </button>
          
          <button 
            onClick={() => setShowAIModal(true)}
            className="flex flex-col items-center space-y-2 active:opacity-60 transition-opacity"
          >
            <div className="bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-xl relative overflow-hidden group">
              <Sparkles size={20} className="text-indigo-500 relative z-10" />
              <div className="absolute inset-0 bg-indigo-100 dark:bg-indigo-900/40 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            </div>
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">AI 助手</span>
          </button>
        </div>
      </div>

      {/* Inventory Stats Modal */}
      <InventoryStatsModal 
        isOpen={showInventoryModal}
        onClose={() => setShowInventoryModal(false)} 
        analytics={analytics}
      />

      <AIManagementModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        onExecuted={onAIManageExecuted}
      />

      <ActivityLedgerModal
        isOpen={showActivityLedger}
        userId={userId}
        warehouses={warehouses}
        onClose={() => setShowActivityLedger(false)}
      />

      {/* Recent Activity */}
      <div>
        <div className="flex justify-between items-center px-1 mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">最近动态 (近10条)</h3>
          <button onClick={() => setShowActivityLedger(true)} className="flex items-center gap-0.5 text-xs font-medium text-dewu-600 dark:text-dewu-400">
            查看全部 <ChevronRight size={13} />
          </button>
        </div>
        <div className="space-y-3">
          {recentActivitiesReady && recentActivitiesError && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              <span>最近动态刷新失败，当前显示上次成功结果，可能已过期。</span>
              <button type="button" onClick={onRetryData} className="shrink-0 font-semibold">重试</button>
            </div>
          )}
          {!recentActivitiesReady && !recentActivitiesError ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-8 text-xs text-slate-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
              <Loader2 size={14} className="animate-spin" />正在同步最近动态...
            </div>
          ) : !recentActivitiesReady && recentActivitiesError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-5 text-center text-xs text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              <p>最近动态加载失败，没有用空数据替代。</p>
              <button type="button" onClick={onRetryData} className="mt-2 inline-flex items-center gap-1 font-semibold"><RefreshCw size={12} />重新加载</button>
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800">
              暂无动态
            </div>
          ) : (
            activities.slice(0, 10).map((activity) => (
              <div key={activity.id} className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex items-center space-x-3">
                <ProductImage src={activity.imageUrl} alt={activity.productName} className="w-12 h-12 rounded-lg object-cover bg-slate-100 dark:bg-zinc-800" />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">{activity.productName}</h4>
                    <span className="text-[10px] font-medium text-slate-400 dark:text-zinc-500 flex items-center">
                      <Clock size={10} className="mr-1" />
                      {formatTime(activity.createdAt || activity.created_at)}
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-1">
                    <div className="flex items-center space-x-2">
                       <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                         activity.type === 'inbound'
                           ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                           : activity.type === 'pending'
                             ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400'
                           : activity.type === 'restore'
                             ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
                             : activity.type === 'transfer'
                               ? 'bg-cyan-50 dark:bg-cyan-900/20 text-cyan-600 dark:text-cyan-400'
                             : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                       }`}>
                         {getActivityTypeLabel(activity.type)}
                       </span>
                       <div className="flex items-center text-xs text-slate-500 dark:text-zinc-400">
                         <span>{activity.sku}</span>
                         {activity.size && (
                           <>
                             <span className="mx-1.5 opacity-30">|</span>
                             <span>{formatProductSize(activity.size)}</span>
                           </>
                         )}
                         <span className="mx-1.5 opacity-30">|</span>
                         <span className={getActivityQuantity(activity) === 0 ? 'font-medium text-red-500' : ''}>
                           {getActivityQuantity(activity) === 0 ? `异常 ${activity.count}` : `x${getActivityQuantity(activity)}`}
                         </span>
                       </div>
                    </div>
                    {!['restore', 'transfer'].includes(activity.type) && <div className="text-right">
                      <span className="text-sm font-bold text-dewu-600 dark:text-dewu-400">¥{getActivityGrossAmount(activity)}</span>
                      {getActivityQuantity(activity) > 1 && (
                        <div className="text-[10px] text-slate-400 dark:text-zinc-500">单价 ¥{activity.price}</div>
                      )}
                    </div>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
