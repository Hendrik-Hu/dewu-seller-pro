import React from 'react';
import { X, Boxes, BarChart3, AlertCircle } from 'lucide-react';
import { Product } from '../types';

interface InventoryStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
}

export const InventoryStatsModal: React.FC<InventoryStatsModalProps> = ({ isOpen, onClose, products }) => {
  if (!isOpen) return null;

  // Calculate Stats
  const totalStock = products.reduce((sum, p) => sum + (p.status === 'instock' ? p.stock : 0), 0);
  
  // Top 5 Brands
  const brandCounts: Record<string, number> = {};
  products.forEach(p => {
    if (p.status === 'instock') {
        const brand = p.brand || '其他';
        brandCounts[brand] = (brandCounts[brand] || 0) + p.stock;
    }
  });

  const topBrands = Object.entries(brandCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white dark:bg-zinc-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-[scaleIn_0.2s_ease-out] border border-slate-100 dark:border-zinc-800">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-zinc-800 flex justify-between items-center bg-slate-50/50 dark:bg-black/20">
          <div className="flex items-center space-x-2">
            <div className="bg-purple-100 dark:bg-purple-900/30 p-1.5 rounded-lg">
                <BarChart3 size={18} className="text-purple-600 dark:text-purple-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">库存概览</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors">
            <X size={20} className="text-slate-400 dark:text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-6">
           {/* Total Stock */}
           <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl p-5 text-white shadow-lg shadow-purple-500/20">
              <div className="flex items-center space-x-2 mb-2 opacity-90">
                 <Boxes size={20} />
                 <span className="text-sm font-medium">目前总库存量</span>
              </div>
              <div className="text-4xl font-bold tracking-tight">{totalStock} <span className="text-lg font-normal opacity-80">件</span></div>
              <div className="mt-4 pt-3 border-t border-white/20 text-xs opacity-90 flex items-center">
                 <AlertCircle size={12} className="mr-1.5" />
                 <span>数据实时同步自云端仓库</span>
              </div>
           </div>

           {/* Top Brands */}
           <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3 flex items-center">
                 <span className="w-1 h-4 bg-purple-500 rounded-full mr-2"></span>
                 品牌库存 TOP 5
              </h3>
              <div className="space-y-3">
                 {topBrands.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between group">
                       <div className="flex items-center space-x-3">
                          <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold text-white ${
                             idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-slate-400' : idx === 2 ? 'bg-orange-400' : 'bg-slate-200 dark:bg-zinc-700 text-slate-500 dark:text-zinc-400'
                          }`}>
                             {idx + 1}
                          </span>
                          <span className="text-sm font-medium text-slate-700 dark:text-zinc-300">{item.name}</span>
                       </div>
                       <div className="flex items-center space-x-2">
                          <div className="w-24 h-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                             <div 
                                className="h-full bg-purple-500 rounded-full opacity-80" 
                                style={{ width: `${(item.count / (topBrands[0]?.count || 1)) * 100}%` }}
                             ></div>
                          </div>
                          <span className="text-xs font-bold text-slate-900 dark:text-white w-8 text-right">{item.count}</span>
                       </div>
                    </div>
                 ))}
                 {topBrands.length === 0 && (
                    <div className="text-center py-6 text-slate-400 dark:text-zinc-600 text-xs bg-slate-50 dark:bg-zinc-900/50 rounded-xl">
                       暂无品牌数据
                    </div>
                 )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};