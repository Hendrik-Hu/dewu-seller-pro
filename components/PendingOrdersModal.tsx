import React, { useEffect, useMemo, useState } from 'react';
import { X, Truck, PackageCheck, Search, CheckCircle2, Circle, Check } from 'lucide-react';
import { Product } from '../types';
import { formatProductSize } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';

interface PendingOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onCompletePending: (productIds: string[]) => Promise<void>;
}

export const PendingOrdersModal: React.FC<PendingOrdersModalProps> = ({ isOpen, onClose, products, onCompletePending }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm('');
    setSelectedIds([]);
    setIsSubmitting(false);
  }, [isOpen]);

  const pendingProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return products.filter((product) => {
      if (product.status !== 'shipping') return false;
      if (!q) return true;
      return [
        product.name,
        product.sku,
        product.brand,
        product.size,
        product.warehouse,
        product.location,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [products, searchTerm]);

  const allVisibleSelected = pendingProducts.length > 0 && pendingProducts.every((product) => selectedIds.includes(product.id));

  const toggleSelection = (productId: string) => {
    setSelectedIds((prev) => (
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    ));
  };

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pendingProducts.some((product) => product.id === id)));
      return;
    }

    setSelectedIds((prev) => {
      const next = new Set(prev);
      pendingProducts.forEach((product) => next.add(product.id));
      return Array.from(next);
    });
  };

  const handleComplete = async (productIds: string[]) => {
    if (productIds.length === 0) return;

    const confirmed = window.confirm(`确认将 ${productIds.length} 个待发货商品标记为已处理吗？`);
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      await onCompletePending(productIds);
      setSelectedIds((prev) => prev.filter((id) => !productIds.includes(id)));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center space-x-2">
            <Truck className="text-orange-500" size={20} />
            <h2 className="text-lg font-bold text-slate-900">待发货商品</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-3 border-b border-slate-100 bg-slate-50 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索货号、名称、品牌、尺码..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-dewu-500"
            />
          </div>

          {pendingProducts.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="text-[11px] text-slate-500">当前待处理 {pendingProducts.length} 个，已选 {selectedIds.length} 个</div>
              <button
                onClick={handleToggleSelectAll}
                className="text-[11px] font-medium text-dewu-600"
              >
                {allVisibleSelected ? '取消全选' : '全选当前结果'}
              </button>
            </div>
          )}
        </div>
        
        <div className="overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {pendingProducts.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
               <PackageCheck size={48} className="text-slate-200" />
               <span className="text-sm font-medium">暂无待发货订单</span>
               <p className="text-xs text-slate-400">所有订单已处理完毕</p>
             </div>
          ) : (
            pendingProducts.map(product => (
              <button
                key={product.id}
                type="button"
                onClick={() => toggleSelection(product.id)}
                className="w-full flex items-center space-x-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm relative overflow-hidden text-left"
              >
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400"></div>
                <div className="shrink-0 text-dewu-500">
                  {selectedIds.includes(product.id) ? (
                    <CheckCircle2 size={18} fill="currentColor" />
                  ) : (
                    <Circle size={18} className="text-slate-300" />
                  )}
                </div>
                <ProductImage src={product.imageUrl} alt={product.name} className="w-16 h-16 rounded-lg object-cover bg-slate-100" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 line-clamp-2">{product.name}</h4>
                  <div className="flex items-center space-x-2 mt-1">
                     <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded">{formatProductSize(product.size)}</span>
                     <span className="text-[10px] text-slate-400">货号: {product.sku}</span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">
                    {product.warehouse || '未设置仓库'}{product.location ? ` · ${product.location}` : ''}
                  </div>
                  <div className="flex justify-between items-center mt-2">
                     <p className="text-sm font-bold text-slate-900">¥{product.price}</p>
                     <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleComplete([product.id]);
                        }}
                        disabled={isSubmitting}
                        className="text-[10px] bg-orange-50 text-orange-600 px-2 py-1 rounded-full font-medium border border-orange-100 disabled:opacity-50"
                     >
                        标记已处理
                     </button>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        
        {pendingProducts.length > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50">
             <button
                onClick={() => handleComplete(selectedIds)}
                disabled={selectedIds.length === 0 || isSubmitting}
                className="w-full bg-slate-900 text-white font-medium py-3 rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
             >
                <Check size={16} />
                {isSubmitting ? '处理中...' : `批量完成 (${selectedIds.length})`}
             </button>
          </div>
        )}
      </div>
    </div>
  );
};
