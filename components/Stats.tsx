import React, { useMemo, useState } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell
} from 'recharts';
import { Sparkles, Bot, Send } from 'lucide-react';
import { Product, Activity } from '../types';
import { AIAssistantModal } from './AIAssistantModal';

interface StatsProps {
  products: Product[];
  activities: Activity[];
}

const COLORS = ['#14b8a6', '#0f766e', '#0d9488', '#ccfbf7'];

export const Stats: React.FC<StatsProps> = ({ products, activities }) => {
  const [isAIModalOpen, setIsAIModalOpen] = useState(false);
  
  // --- Calculation Logic ---
  const stats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // Helper: Check if date is in current month
    const isCurrentMonth = (dateStr: string) => {
      const d = new Date(dateStr);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    };

    // Filter activities for this month
    // NOTE: This is strictly filtering by month. If user's timezone or DB timezone is different, 
    // recently added items might be excluded if near month boundary.
    // const thisMonthActivities = activities; // TEMPORARILY DISABLE FILTER TO DEBUG
    const thisMonthActivities = activities.filter(a => isCurrentMonth(a.created_at || a.createdAt)); 
    
    // 1. Month Sales (Outbound Price Sum)
    const monthSales = thisMonthActivities
      .filter(a => a.type === 'outbound')
      .reduce((sum, a) => sum + a.price, 0);

    // 2. Month Cost (Outbound Cost Sum)
    const monthCost = thisMonthActivities
      .filter(a => a.type === 'outbound')
      .reduce((sum, a) => sum + (a.cost || 0), 0);

    // 3. Month Profit
    const monthProfit = monthSales - monthCost;

    // 4. Month Profit Rate
    const profitRate = monthSales > 0 ? (monthProfit / monthSales) * 100 : 0;

    // 5. Counts
    const inboundCount = thisMonthActivities
      .filter(a => a.type === 'inbound')
      .reduce((sum, a) => sum + (Number(a.count) || 1), 0); // Use count if available, default to 1 for legacy data

    const outboundCount = thisMonthActivities
      .filter(a => a.type === 'outbound')
      .length; // Outbound is always 1 per activity currently (logic in handleOutboundProduct)
    
    // Sold Count is same as outbound count for now
    const soldCount = outboundCount; 

    // --- Chart Data Preparation ---
    // 30 Days Revenue Trend
    const salesDataMap = new Map<string, number>();
    // Initialize last 30 days
    for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = `${d.getMonth() + 1}/${d.getDate()}`;
        salesDataMap.set(key, 0);
    }
    
    // Fill with data
    activities.forEach(a => {
        if (a.type === 'outbound') {
            const d = new Date(a.createdAt);
            const key = `${d.getMonth() + 1}/${d.getDate()}`;
            if (salesDataMap.has(key)) {
                salesDataMap.set(key, (salesDataMap.get(key) || 0) + a.price);
            }
        }
    });

    const salesChartData = Array.from(salesDataMap.entries()).map(([name, value]) => ({ name, value }));

    // Brand Distribution
    const brandCountMap = new Map<string, number>();
    products.forEach(p => {
        if (p.status === 'instock') {
            brandCountMap.set(p.brand, (brandCountMap.get(p.brand) || 0) + 1);
        }
    });
    
    const brandData = Array.from(brandCountMap.entries())
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5); // Top 5 brands

    // Top Products (by Sales Count in Activities)
    const productSalesMap = new Map<string, number>();
    activities.filter(a => a.type === 'outbound').forEach(a => {
        productSalesMap.set(a.productName, (productSalesMap.get(a.productName) || 0) + 1);
    });

    const topProducts = Array.from(productSalesMap.entries())
        .map(([name, sold]) => ({ name, sold }))
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 5);

    return {
        monthSales,
        monthProfit,
        profitRate,
        inboundCount,
        outboundCount,
        soldCount,
        salesChartData,
        brandData,
        topProducts
    };
  }, [products, activities]);

  return (
    <div className="px-5 py-6 pb-24 h-full overflow-y-auto bg-slate-50 dark:bg-black transition-colors duration-300">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white mb-6">数据统计</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {/* Row 1 */}
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">本月销售额</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">¥{stats.monthSales.toLocaleString()}</p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">实时数据</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">本月利润</p>
          <p className={`text-sm font-bold ${stats.monthProfit >= 0 ? 'text-slate-900 dark:text-white' : 'text-red-500'}`}>
            ¥{stats.monthProfit.toLocaleString()}
          </p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">实时数据</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">本月利润率</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.profitRate.toFixed(1)}%</p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">实时数据</p>
        </div>

        {/* Row 2 */}
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">入库件数</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.inboundCount}</p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">本月累积</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">出库件数</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.outboundCount}</p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">本月累积</p>
        </div>
        <div className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex flex-col justify-between min-h-[80px]">
          <p className="text-[10px] text-slate-400 dark:text-zinc-500 mb-1">出售件数</p>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{stats.soldCount}</p>
          <p className="text-[10px] text-slate-300 dark:text-zinc-600 font-medium mt-1">本月累积</p>
        </div>
      </div>

      {/* AI Chat Module */}
      <div 
        onClick={() => setIsAIModalOpen(true)}
        className="bg-white dark:bg-zinc-900 rounded-2xl border border-slate-200 dark:border-zinc-800 shadow-sm mb-6 overflow-hidden flex flex-col cursor-pointer hover:shadow-md transition-shadow group"
      >
        <div className="bg-gradient-to-r from-indigo-600 to-violet-600 p-3 flex items-center justify-between">
            <div className="flex items-center space-x-2 text-white">
                <Bot size={18} />
                <span className="text-sm font-bold">AI 经营助手</span>
            </div>
            <span className="text-[10px] bg-white/20 text-white px-2 py-0.5 rounded-full group-hover:bg-white/30 transition-colors">点击展开</span>
        </div>
        
        {/* Chat Area */}
        <div className="p-4 bg-slate-50 dark:bg-black h-40 overflow-y-auto space-y-3 pointer-events-none">
            <div className="flex items-start space-x-2">
                <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={12} className="text-indigo-600 dark:text-indigo-400" />
                </div>
                <div className="bg-white dark:bg-zinc-800 p-2.5 rounded-2xl rounded-tl-none border border-slate-100 dark:border-zinc-700 text-xs text-slate-600 dark:text-zinc-300 shadow-sm">
                    👋 嗨！我是你的智能助手。本月利润率为 <span className="font-bold text-slate-900 dark:text-white">{stats.profitRate.toFixed(1)}%</span>，点击这里让我为你详细分析库存和销售趋势！
                </div>
            </div>
        </div>

        {/* Input Area */}
        <div className="p-3 bg-white dark:bg-zinc-900 border-t border-slate-100 dark:border-zinc-800 flex items-center space-x-2 pointer-events-none">
            <input 
                type="text" 
                placeholder="点击向 AI 提问..." 
                readOnly
                className="flex-1 bg-slate-50 dark:bg-black text-xs py-2 px-3 rounded-lg outline-none focus:ring-1 focus:ring-indigo-500 transition-all dark:text-white dark:placeholder-zinc-600"
            />
            <button className="p-2 bg-indigo-600 text-white rounded-lg active:scale-95 transition-transform">
                <Send size={14} />
            </button>
        </div>
      </div>

      <AIAssistantModal 
        isOpen={isAIModalOpen} 
        onClose={() => setIsAIModalOpen(false)}
        products={products}
        activities={activities}
      />

      {/* Revenue Chart */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm mb-6">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">30天营收趋势</h3>
        <div className="h-32 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={stats.salesChartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-zinc-800" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{fontSize: 9, fill: '#94a3b8'}} 
                dy={10}
                interval={4} 
              />
              <YAxis hide />
              <Tooltip 
                contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: '#fff'}}
                itemStyle={{color: '#000'}}
                cursor={{stroke: '#cbd5e1', strokeWidth: 1}}
              />
              <Area type="monotone" dataKey="value" stroke="#14b8a6" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Brand Distribution */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm mb-6">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">库存品牌占比</h3>
        <div className="flex items-center">
          <div className="h-32 w-1/2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.brandData}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={50}
                  paddingAngle={5}
                  dataKey="value"
                  stroke="none"
                >
                  {stats.brandData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="w-1/2 space-y-2">
            {stats.brandData.map((entry, index) => (
              <div key={index} className="flex items-center justify-between pr-2">
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full mr-2" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                  <span className="text-xs text-slate-600 dark:text-zinc-400">{entry.name}</span>
                </div>
                <span className="text-xs font-bold text-slate-900 dark:text-white">{entry.value}</span>
              </div>
            ))}
            {stats.brandData.length === 0 && (
                <div className="text-xs text-slate-400 dark:text-zinc-600 text-center">暂无数据</div>
            )}
          </div>
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-slate-100 dark:border-zinc-800 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-4">热销排行 TOP 5</h3>
        <div className="space-y-4">
          {stats.topProducts.map((item, idx) => (
            <div key={idx} className="flex items-center space-x-3">
              <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold text-white ${idx < 3 ? 'bg-slate-900 dark:bg-zinc-700' : 'bg-slate-300 dark:bg-zinc-800'}`}>
                {idx + 1}
              </span>
              <div className="flex-1">
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-slate-700 dark:text-zinc-300 truncate max-w-[150px]">{item.name}</span>
                  <span className="text-xs text-slate-400 dark:text-zinc-500">{item.sold} 双</span>
                </div>
                <div className="h-1.5 w-full bg-slate-100 dark:bg-black rounded-full overflow-hidden">
                  <div 
                    className="h-full rounded-full transition-all duration-500" 
                    style={{ width: `${(item.sold / (stats.topProducts[0]?.sold || 1)) * 100}%`, backgroundColor: '#14b8a6' }}
                  ></div>
                </div>
              </div>
            </div>
          ))}
          {stats.topProducts.length === 0 && (
            <div className="text-xs text-slate-400 dark:text-zinc-600 text-center py-4">暂无销售数据</div>
          )}
        </div>
      </div>
    </div>
  );
};
