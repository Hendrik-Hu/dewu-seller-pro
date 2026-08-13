import React, { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Bot, ChevronRight, RefreshCw, Sparkles } from 'lucide-react';
import type { InventoryAnalytics } from '../lib/inventoryMetrics';
import { createDeferredComponent } from './DeferredComponent';

const AIManagementModal = createDeferredComponent(
  () => import('./AIManagementModal').then(({ AIManagementModal: component }) => component),
  { label: 'AI 助手', kind: 'modal' },
);

interface StatsProps {
  analytics: InventoryAnalytics;
  analyticsReady: boolean;
  analyticsError?: string;
  onRetryData: () => void;
  onAIExecuted?: () => void;
}

const COLORS = ['#14b8a6', '#0f766e', '#0d9488', '#ccfbf7'];

export const Stats: React.FC<StatsProps> = ({ analytics, analyticsReady, analyticsError, onRetryData, onAIExecuted }) => {
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  const monthly = analytics.monthly;
  const salesChartData = analytics.charts.salesTrend;
  const brandData = analytics.charts.topBrands;
  const topProducts = analytics.charts.topProducts;
  const hasMissingCosts = monthly.missingCostCount > 0;

  if (!analyticsReady) {
    return (
      <div className="app-page">
        <h1 className="app-page-title mb-5">经营统计</h1>
        <div className={`rounded-lg border px-4 py-5 text-sm ${analyticsError ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300' : 'border-slate-200 bg-white text-slate-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400'}`}>
          <p>{analyticsError ? '统计同步失败，未用 0 代替真实数据。' : '正在同步服务端权威统计...'}</p>
          {analyticsError && <button type="button" onClick={onRetryData} className="mt-3 inline-flex items-center gap-1 font-semibold"><RefreshCw size={14} />重新加载</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <header className="mb-5">
        <p className="text-xs font-semibold text-teal-600 dark:text-teal-400">本自然月</p>
        <h1 className="app-page-title mt-0.5">经营统计</h1>
      </header>

      {analyticsError && (
        <div className="app-status-banner mb-4 border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <span>{analyticsReady ? '统计刷新失败，当前显示上次成功结果，可能已过期。' : '统计同步失败，暂不显示为 0。'}</span>
          <button type="button" onClick={onRetryData} className="flex shrink-0 items-center gap-1 font-semibold"><RefreshCw size={12} />重试</button>
        </div>
      )}

      <section className="app-surface mb-4 overflow-hidden" aria-labelledby="monthly-result-title">
        <h2 id="monthly-result-title" className="sr-only">本月核心经营结果</h2>
        <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-100 dark:divide-zinc-800 dark:border-zinc-800">
          <div className="min-w-0 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">本月销售额</p>
            <p className="mt-1 truncate text-[26px] font-bold leading-8 text-slate-950 dark:text-white">¥{monthly.salesAmount.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">出库 {monthly.outboundCount} 件</p>
          </div>
          <div className="min-w-0 p-4">
            <p className="text-xs font-medium text-slate-500 dark:text-zinc-400">实际净利润</p>
            <p className={`mt-1 truncate text-[26px] font-bold leading-8 ${monthly.actualProfitCount === 0 ? 'text-slate-400' : monthly.actualNetProfitAmount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>{monthly.actualProfitCount === 0 ? '—' : `¥${monthly.actualNetProfitAmount.toLocaleString()}`}</p>
            <p className="mt-1 text-xs text-slate-400">{monthly.actualProfitCount === 0 ? '暂无可计算记录' : `覆盖 ${monthly.actualProfitCoverageRate.toFixed(0)}% 已记成本件数`}</p>
          </div>
        </div>
        <div className="grid grid-cols-3 divide-x divide-slate-100 dark:divide-zinc-800">
          <div className="px-3 py-4"><p className="text-xs text-slate-500">预计净利润</p><p className="mt-1 truncate text-base font-bold">{monthly.estimatedProfitCount === 0 ? '—' : `¥${monthly.estimatedNetProfitAmount.toLocaleString()}`}</p></div>
          <div className="px-3 py-4"><p className="text-xs text-slate-500">待结算</p><p className={`mt-1 text-base font-bold ${monthly.pendingSettlementCount > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-emerald-600'}`}>{monthly.outboundCount === 0 ? '—' : `${monthly.pendingSettlementCount} 件`}</p></div>
          <div className="px-3 py-4"><p className="text-xs text-slate-500">结算覆盖</p><p className="mt-1 text-base font-bold">{monthly.outboundCount === 0 ? '—' : `${monthly.settlementCoverageRate.toFixed(0)}%`}</p></div>
        </div>
      </section>

      <section className="app-list-surface mb-4" aria-labelledby="accounting-details-title">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-zinc-800"><h2 id="accounting-details-title" className="app-section-title">成本与毛利口径</h2></div>
        {[
          ['销售成本', `¥${monthly.costAmount.toLocaleString()}`, '仅统计已记录成本'],
          ['毛利润', `¥${monthly.grossProfitAmount.toLocaleString()}`, '已计成本销售额减成本'],
          ['毛利率', `${monthly.grossMarginRate.toFixed(1)}%`, `成本覆盖 ${monthly.costCoverageRate.toFixed(0)}%`],
          ['本月入库', `${monthly.inboundCount} 件`, '本自然月累计'],
        ].map(([label, value, help]) => <div key={label} className="flex min-h-14 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2 last:border-b-0 dark:border-zinc-800"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-slate-400">{help}</p></div><strong className="shrink-0 text-sm">{value}</strong></div>)}
      </section>

      {hasMissingCosts && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-xs leading-5 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          本月有 {monthly.missingCostCount} 件出库缺少成本，毛利润和毛利率暂不包含这些记录。
        </div>
      )}

      <button type="button" onClick={() => setIsAIModalOpen(true)} className="app-touch mb-4 flex w-full items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 text-left dark:border-violet-900/50 dark:bg-violet-950/20" aria-label="打开 AI 经营分析">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300"><Bot size={20} /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-violet-900 dark:text-violet-200">AI 经营分析</p><p className="mt-0.5 text-xs text-violet-600 dark:text-violet-300">基于同一账本口径提问，不替代真实结算</p></div>
        <ChevronRight size={18} className="shrink-0 text-violet-500" />
      </button>

      {isAIModalOpen && (
        <AIManagementModal
          isOpen
          onClose={() => setIsAIModalOpen(false)}
          onExecuted={onAIExecuted}
        />
      )}

      <div className="app-surface mb-4 p-4">
        <h3 className="app-section-title mb-4">近30天销售额趋势</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={salesChartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-zinc-800" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fill: '#94a3b8' }} dy={10} interval={4} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: '#fff' }}
                itemStyle={{ color: '#000' }}
                cursor={{ stroke: '#cbd5e1', strokeWidth: 1 }}
              />
              <Area type="monotone" dataKey="value" stroke="#14b8a6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="app-surface mb-4 p-4">
        <h3 className="app-section-title mb-4">库存品牌占比</h3>
        <div className="flex items-center">
          <div className="h-32 w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={brandData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={50}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {brandData.map((entry, index) => (
                    <Cell key={`${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-1/2 space-y-2">
            {brandData.map((entry, index) => (
              <div key={`${entry.name}-${index}`} className="flex items-center justify-between pr-2">
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  <span className="text-xs text-slate-600 dark:text-zinc-400">{entry.name}</span>
                </div>
                <span className="text-xs font-bold text-slate-900 dark:text-white">{entry.value}</span>
              </div>
            ))}
            {brandData.length === 0 && (
              <div className="text-xs text-slate-400 dark:text-zinc-600 text-center">暂无数据</div>
            )}
          </div>
        </div>
      </div>

      <div className="app-surface p-4">
        <h3 className="app-section-title mb-4">历史热销排行 TOP 5</h3>
        <div className="space-y-4">
          {topProducts.map((item, idx) => (
            <div key={item.sku || `${item.name}-${idx}`} className="flex items-center space-x-3">
              <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold text-white ${idx < 3 ? 'bg-slate-900 dark:bg-zinc-700' : 'bg-slate-300 dark:bg-zinc-800'}`}>
                {idx + 1}
              </span>
              <div className="flex-1">
                <div className="mb-1 flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-700 dark:text-zinc-300">{item.name}</div>
                    <div className="truncate text-xs text-slate-400 dark:text-zinc-500">货号 {item.sku || '未记录'}</div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400 dark:text-zinc-500">{item.sold} 件</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-black rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(item.sold / (topProducts[0]?.sold || 1)) * 100}%`, backgroundColor: '#14b8a6' }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
          {topProducts.length === 0 && (
            <div className="text-xs text-slate-400 dark:text-zinc-600 text-center py-4">暂无销售数据</div>
          )}
        </div>
      </div>
    </div>
  );
};
