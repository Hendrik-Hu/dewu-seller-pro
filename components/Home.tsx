import React from 'react';
import { ShoppingBag, Truck, Package, ArrowDownRight, ArrowUpRight, ChevronRight, Clock, Sparkles, UserRound, RefreshCw, Loader2, Warehouse as WarehouseIcon, Plus } from 'lucide-react';
import { Activity, Warehouse } from '../types';
import { getActivityGrossAmount, getActivityQuantity } from '../lib/inventoryMetrics';
import { formatProductSize } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';
import { getActivityTypeLabel } from '../lib/activityPresentation';
import type { InventoryAnalytics } from '../lib/inventoryMetrics';
import { createDeferredComponent } from './DeferredComponent';

const InventoryStatsModal = createDeferredComponent(
  () => import('./InventoryStatsModal').then(({ InventoryStatsModal: component }) => component),
  { label: '库存摘要', kind: 'modal' },
);
const AIManagementModal = createDeferredComponent(
  () => import('./AIManagementModal').then(({ AIManagementModal: component }) => component),
  { label: 'AI 助手', kind: 'modal' },
);
const ActivityLedgerModal = createDeferredComponent(
  () => import('./ActivityLedgerModal').then(({ ActivityLedgerModal: component }) => component),
  { label: '完整流水账本', kind: 'modal' },
);

interface HomeProps {
  userId: string;
  warehouses: Warehouse[];
  warehousesReady: boolean;
  warehousesError?: string;
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
  onRetryWarehouses: () => void;
  onStartFirstWarehouse: () => void;
  onAIManageExecuted?: () => void;
}

export const Home: React.FC<HomeProps> = ({ 
  userId,
  warehouses,
  warehousesReady,
  warehousesError,
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
  onRetryWarehouses,
  onStartFirstWarehouse,
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
    <div className="app-page space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-teal-600 dark:text-teal-400">今日经营</p>
          <h1 className="app-page-title mt-0.5 truncate">你好，{username}</h1>
        </div>
        <button type="button" onClick={onAvatarClick} aria-label="打开个人中心" className="app-touch h-12 w-12 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <UserRound size={20} className="m-auto h-full text-slate-400" aria-label="默认头像" />
          )}
        </button>
      </header>

      {!analyticsReady && !analyticsError && (
        <div className="app-status-banner border-slate-200 bg-white text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"><span className="flex items-center gap-2"><Loader2 size={14} className="animate-spin" />正在同步库存与经营摘要</span></div>
      )}
      {analyticsError && (
        <div className="app-status-banner border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <span>{analyticsReady ? '数据刷新失败，当前显示上次成功结果，可能已过期。' : '库存与经营摘要同步失败，请重试。'}</span>
          <button type="button" onClick={onRetryData} className="app-touch flex shrink-0 items-center gap-1 font-semibold"><RefreshCw size={14} />重试</button>
        </div>
      )}

      {!warehousesReady && (
        <div className={`app-status-banner ${warehousesError ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300' : 'border-slate-200 bg-white text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'}`}>
          <span className="flex items-center gap-2">{!warehousesError && <Loader2 size={13} className="animate-spin" />}{warehousesError ? '仓库同步失败，尚未把账号判断为空。' : '正在确认你的仓库信息...'}</span>
          {warehousesError && <button type="button" onClick={onRetryWarehouses} className="app-touch shrink-0 font-semibold">重试</button>}
        </div>
      )}

      {warehousesReady && warehousesError && (
        <div className="app-status-banner border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <span>仓库刷新失败，当前结果可能已过期。</span>
          <button type="button" onClick={onRetryWarehouses} className="app-touch shrink-0 font-semibold">重新同步</button>
        </div>
      )}

      {warehousesReady && !warehousesError && warehouses.length === 0 && (
        <section className="app-surface p-4" aria-labelledby="first-use-title">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-dewu-50 text-dewu-600 dark:bg-dewu-950/40 dark:text-dewu-300">
              <WarehouseIcon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="first-use-title" className="app-section-title">先建立真实库存起点</h2>
              <p className="app-help-text mt-1">创建第一个主仓后即可入库。首页数字只来自你的真实账本。</p>
            </div>
          </div>
          <button type="button" onClick={onStartFirstWarehouse} className="app-primary-action mt-4" aria-label="创建第一个仓库并继续入库">
            <Plus size={15} />创建第一个仓库
          </button>
        </section>
      )}

      <section aria-labelledby="today-summary-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="today-summary-title" className="app-section-title">今日概览</h2>
          <span className="text-xs text-slate-400">实时账本</span>
        </div>
        <div className="app-surface overflow-hidden">
          <div className="flex items-center gap-3 border-b border-slate-100 p-4 dark:border-zinc-800">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-300"><ShoppingBag size={20} /></div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-slate-500 dark:text-zinc-400">今日销售额</p>
              <p className="mt-1 truncate text-[28px] font-bold leading-8 text-slate-950 dark:text-white">{analyticsReady ? `¥ ${todaySalesAmount.toLocaleString()}` : '—'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-slate-500 dark:text-zinc-400">已售</p>
              <p className="mt-1 text-xl font-bold">{analyticsReady ? `${todaySalesCount} 件` : '—'}</p>
            </div>
          </div>
          <button type="button" onClick={onTransitClick} className="app-touch flex w-full items-center gap-3 px-4 py-2 text-left active:bg-orange-50 dark:active:bg-orange-950/20" aria-label={`查看采购运输中商品，当前 ${analyticsReady ? transitProductCount : '未同步'} 件`}>
            <Truck size={20} className="text-orange-500" />
            <span className="flex-1 text-sm font-semibold">采购运输中</span>
            <span className="text-sm font-bold text-orange-600 dark:text-orange-400">{analyticsReady ? `${transitProductCount} 件` : '—'}</span>
            <ChevronRight size={18} className="text-slate-400" />
          </button>
        </div>
      </section>

      <section aria-labelledby="quick-action-title">
        <h2 id="quick-action-title" className="app-section-title mb-3">开始记账</h2>
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={onInboundClick} className="app-touch flex min-h-16 items-center gap-3 rounded-lg bg-blue-600 px-4 text-left text-white active:bg-blue-700">
            <ArrowDownRight size={24} /><span><strong className="block text-base">入库</strong><small className="text-xs text-blue-100">记录采购与到仓</small></span>
          </button>
          <button type="button" onClick={onOutboundClick} className="app-touch flex min-h-16 items-center gap-3 rounded-lg bg-emerald-600 px-4 text-left text-white active:bg-emerald-700">
            <ArrowUpRight size={24} /><span><strong className="block text-base">出库</strong><small className="text-xs text-emerald-100">记录成交与费用</small></span>
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button type="button" onClick={() => setShowInventoryModal(true)} disabled={!analyticsReady} className="app-secondary-action justify-start"><Package size={20} className="text-teal-600" />库存摘要</button>
          <button type="button" onClick={() => setShowAIModal(true)} className="app-secondary-action justify-start"><Sparkles size={20} className="text-violet-600" />AI 分析</button>
        </div>
      </section>

      {/* Inventory Stats Modal */}
      {showInventoryModal && (
        <InventoryStatsModal
          isOpen
          onClose={() => setShowInventoryModal(false)}
          analytics={analytics}
        />
      )}

      {showAIModal && (
        <AIManagementModal
          isOpen
          onClose={() => setShowAIModal(false)}
          onExecuted={onAIManageExecuted}
        />
      )}

      {showActivityLedger && (
        <ActivityLedgerModal
          isOpen
          userId={userId}
          warehouses={warehouses}
          onClose={() => setShowActivityLedger(false)}
        />
      )}

      <section aria-labelledby="recent-activity-title">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="recent-activity-title" className="app-section-title">最近流水</h2>
          <button type="button" onClick={() => setShowActivityLedger(true)} className="app-touch -mr-2 flex items-center gap-1 px-2 text-sm font-semibold text-dewu-600 dark:text-dewu-400">
            查看全部 <ChevronRight size={13} />
          </button>
        </div>
        <div className="app-list-surface">
          {recentActivitiesReady && recentActivitiesError && (
            <div className="app-status-banner m-3 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
              <span>最近动态刷新失败，当前显示上次成功结果，可能已过期。</span>
              <button type="button" onClick={onRetryData} className="shrink-0 font-semibold">重试</button>
            </div>
          )}
          {!recentActivitiesReady && !recentActivitiesError ? (
            <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-400 dark:text-zinc-500">
              <Loader2 size={14} className="animate-spin" />正在同步最近动态...
            </div>
          ) : !recentActivitiesReady && recentActivitiesError ? (
            <div className="m-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-5 text-center text-sm text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300">
              <p>最近动态加载失败，没有用空数据替代。</p>
              <button type="button" onClick={onRetryData} className="mt-2 inline-flex items-center gap-1 font-semibold"><RefreshCw size={12} />重新加载</button>
            </div>
          ) : activities.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              暂无动态
            </div>
          ) : (
            activities.slice(0, 10).map((activity) => (
              <div key={activity.id} className="flex min-h-[72px] items-center gap-3 border-b border-slate-100 px-3 py-3 last:border-b-0 dark:border-zinc-800">
                <ProductImage src={activity.imageUrl} alt={activity.productName} className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800" />
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start">
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white line-clamp-1">{activity.productName}</h4>
                    <span className="flex items-center text-xs font-medium text-slate-400 dark:text-zinc-500">
                      <Clock size={12} className="mr-1" />
                      {formatTime(activity.createdAt || activity.created_at)}
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-1">
                    <div className="flex items-center space-x-2">
                       <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
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
                      {getActivityQuantity(activity) > 1 && <div className="text-xs text-slate-400 dark:text-zinc-500">单价 ¥{activity.price}</div>}
                    </div>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
};
