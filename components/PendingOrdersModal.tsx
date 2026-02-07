import React from 'react';
import { X, Truck, PackageCheck } from 'lucide-react';
import { Product } from '../types';

interface PendingOrdersModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
}

export const PendingOrdersModal: React.FC<PendingOrdersModalProps> = ({ isOpen, onClose, products }) => {
  if (!isOpen) return null;

  // Filter for items that are marked as 'shipping'
  const pendingProducts = products.filter(p => p.status === 'shipping');

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
        
        <div className="overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {pendingProducts.length === 0 ? (
             <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
               <PackageCheck size={48} className="text-slate-200" />
               <span className="text-sm font-medium">暂无待发货订单</span>
               <p className="text-xs text-slate-400">所有订单已处理完毕</p>
             </div>
          ) : (
            pendingProducts.map(product => (
              <div key={product.id} className="flex items-center space-x-3 bg-white p-3 rounded-xl border border-slate-100 shadow-sm relative overflow-hidden">
                 <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-400"></div>
                <img src={product.imageUrl} alt={product.name} className="w-16 h-16 rounded-lg object-cover bg-slate-100" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-900 line-clamp-2">{product.name}</h4>
                  <div className="flex items-center space-x-2 mt-1">
                     <span className="bg-slate-100 text-slate-500 text-[10px] px-1.5 py-0.5 rounded">{product.size}码</span>
                     <span className="text-[10px] text-slate-400">货号: {product.sku}</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                     <p className="text-sm font-bold text-slate-900">¥{product.price}</p>
                     <button className="text-[10px] bg-orange-50 text-orange-600 px-2 py-1 rounded-full font-medium border border-orange-100">
                        打印面单
                     </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {pendingProducts.length > 0 && (
          <div className="p-4 border-t border-slate-100 bg-slate-50">
             <button className="w-full bg-slate-900 text-white font-medium py-3 rounded-xl shadow-lg shadow-slate-200 active:scale-95 transition-all">
                批量发货 ({pendingProducts.length})
             </button>
          </div>
        )}
      </div>
    </div>
  );
};