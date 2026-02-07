import React from 'react';
import { ShoppingBag, Truck, Package, ArrowDownRight, ArrowUpRight, AlertCircle, ChevronRight, Clock, Sparkles } from 'lucide-react';
import { Activity, Product } from '../types';
import { InventoryStatsModal } from './InventoryStatsModal';
import { AIAssistantModal } from './AIAssistantModal';

interface HomeProps {
  username: string;
  avatarUrl: string;
  onInboundClick: () => void;
  onOutboundClick: () => void;
  onInventoryClick?: () => void; // New prop for direct inventory click
  onPendingClick: () => void;
  onAvatarClick: () => void;
  activities: Activity[];
  pendingOrderCount: number;
  todaySalesAmount: number;
  todaySalesCount: number;
  products: Product[];
}

export const Home: React.FC<HomeProps> = ({ 
  username, 
  avatarUrl,
  onInboundClick, 
  onOutboundClick, 
  onInventoryClick,
  onPendingClick,
  onAvatarClick,
  activities,
  pendingOrderCount,
  todaySalesAmount,
  todaySalesCount,
  products
}) => {
  // Inventory Modal State
  const [showInventoryModal, setShowInventoryModal] = React.useState(false);
  // AI Assistant Modal State
  const [showAIModal, setShowAIModal] = React.useState(false);

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
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        </button>
      </div>

      {/* Quick Stats Cards */}
      <div className="grid grid-cols-2 gap-4">
        {/* Sales Card */}
        <div className="bg-gradient-to-br from-dewu-500 to-dewu-600 p-4 rounded-2xl text-white shadow-lg shadow-dewu-200/20 flex flex-col justify-between">
          <div className="flex justify-between items-start mb-2">
             <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
              <ShoppingBag size={20} className="text-white" />
            </div>
            {/* Simple static trend indicator for now */}
            <span className="text-xs font-medium bg-white/20 px-2 py-0.5 rounded-full text-white">今日实时</span>
          </div>
          <div>
            <div className="flex items-baseline space-x-1">
              <span className="text-2xl font-bold">¥ {todaySalesAmount.toLocaleString()}</span>
            </div>
            <div className="text-dewu-50 text-xs opacity-90 mt-0.5">今日销售额</div>
            
            <div className="w-full h-[1px] bg-white/20 my-2"></div>
            
            <div className="flex items-baseline justify-between">
              <span className="text-dewu-50 text-xs opacity-90">销售量</span>
              <span className="text-lg font-bold">{todaySalesCount} <span className="text-xs font-normal opacity-80">双</span></span>
            </div>
          </div>
        </div>

        {/* Pending Orders Card */}
        <button 
          onClick={onPendingClick}
          className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between group active:scale-95 transition-all text-left"
        >
          <div className="w-full flex justify-between items-start mb-4">
            <div className="bg-orange-50 dark:bg-orange-900/20 p-2 rounded-lg group-hover:bg-orange-100 dark:group-hover:bg-orange-900/30 transition-colors">
              <Truck size={20} className="text-orange-500" />
            </div>
            <ChevronRight size={16} className="text-slate-300 dark:text-zinc-600 group-hover:text-slate-400" />
          </div>
          <div>
            <div className="text-3xl font-bold text-slate-900 dark:text-white mb-1">{pendingOrderCount}</div>
            <div className="text-slate-400 dark:text-zinc-500 text-xs">待发货订单</div>
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
            <span className="text-xs font-medium text-slate-600 dark:text-zinc-300">AI 分析</span>
          </button>
        </div>
      </div>

      {/* Inventory Stats Modal */}
      <InventoryStatsModal 
        isOpen={showInventoryModal}
        onClose={() => setShowInventoryModal(false)} 
        products={products}
      />

      {/* AI Assistant Modal */}
      <AIAssistantModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        products={products}
        activities={activities}
      />

      {/* Recent Activity */}
      <div>
        <div className="flex justify-between items-center px-1 mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">最近动态 (近10条)</h3>
          <button className="text-xs text-dewu-500 font-medium">查看全部</button>
        </div>
        <div className="space-y-3">
          {activities.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs bg-white dark:bg-zinc-900 rounded-2xl border border-slate-100 dark:border-zinc-800">
              暂无动态
            </div>
          ) : (
            activities.slice(0, 10).map((activity) => (
              <div key={activity.id} className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex items-center space-x-3">
                <img src={activity.imageUrl} alt={activity.productName} className="w-12 h-12 rounded-lg object-cover bg-slate-100 dark:bg-zinc-800" />
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
                         activity.type === 'inbound' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400' : 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                       }`}>
                         {activity.type === 'inbound' ? '入库' : '出库'}
                       </span>
                       <div className="flex items-center text-xs text-slate-500 dark:text-zinc-400">
                         <span>{activity.sku}</span>
                         {activity.size && (
                           <>
                             <span className="mx-1.5 opacity-30">|</span>
                             <span>{activity.size}码</span>
                           </>
                         )}
                         <span className="mx-1.5 opacity-30">|</span>
                         <span>x{activity.count || 1}</span>
                       </div>
                    </div>
                    <span className="text-sm font-bold text-dewu-600 dark:text-dewu-400">¥{activity.price}</span>
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