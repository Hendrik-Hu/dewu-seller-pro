import React, { useState } from 'react';
import { X, ArrowUpRight, Search, DollarSign } from 'lucide-react';
import { Product } from '../types';

interface OutboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onOutbound: (product: Product, sellingPrice: number, quantity: number) => void;
}

export const OutboundModal: React.FC<OutboundModalProps> = ({ isOpen, onClose, products, onOutbound }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [quantity, setQuantity] = useState(1);

  if (!isOpen) return null;

  const handleClose = () => {
    setSearchTerm('');
    setSelectedProduct(null);
    setSellingPrice('');
    setQuantity(1);
    onClose();
  };

  const handleConfirmOutbound = () => {
    if (!selectedProduct) return;
    
    // Default to cost price if not entered
    const finalPrice = sellingPrice ? parseFloat(sellingPrice) : selectedProduct.price;
    
    onOutbound(selectedProduct, finalPrice, quantity);
    handleClose();
  };

  // Only show results if user has typed something
  const hasSearch = searchTerm.trim().length > 0;

  const availableProducts = hasSearch 
    ? products.filter(p => 
        p.stock > 0 && 
        (p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
         p.sku.toLowerCase().includes(searchTerm.toLowerCase()))
      )
    : [];

  // Find other sizes for the same SKU
  const sameSkuProducts = selectedProduct 
    ? products
        .filter(p => p.sku === selectedProduct.sku && p.stock > 0)
        .sort((a, b) => parseFloat(a.size) - parseFloat(b.size))
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-slate-900">
            {selectedProduct ? '确认出库信息' : '商品出库'}
          </h2>
          <button 
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X size={20} />
          </button>
        </div>
        
        {!selectedProduct ? (
          <>
            <div className="p-3 border-b border-slate-100 bg-slate-50 flex-shrink-0">
               <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="搜索商品货号" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                    className="w-full bg-white text-sm text-slate-900 rounded-xl pl-9 pr-4 py-2 outline-none border border-slate-200 focus:border-dewu-500 transition-all"
                  />
                </div>
            </div>

            <div className="overflow-y-auto p-4 space-y-3 min-h-[200px]">
              {!hasSearch ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
                  <Search size={32} className="opacity-20" />
                  <span className="text-xs">请输入货号搜索库存商品</span>
                </div>
              ) : availableProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
                  <span className="text-sm font-medium">商品不存在</span>
                </div>
              ) : (
                availableProducts.map(product => (
                  <div key={product.id} className="flex items-center space-x-3 bg-white p-2 rounded-xl border border-slate-100 shadow-sm animate-[fadeIn_0.2s_ease-out]">
                    <img src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 truncate">{product.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">Size: {product.size} · Stock: {product.stock}</p>
                      <p className="text-sm font-bold text-dewu-600 mt-1">¥{product.price}</p>
                    </div>
                    <button 
                      onClick={() => {
                        setSelectedProduct(product);
                        setSellingPrice(product.price.toString()); // Default to cost price
                        setQuantity(1);
                      }}
                      className="bg-slate-900 text-white p-2 rounded-lg active:scale-95 transition-transform"
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </>
        ) : (
          <div className="p-6 space-y-6 overflow-y-auto">
            <div className="flex items-start space-x-4">
               <img src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-20 h-20 rounded-xl object-cover bg-slate-100 shadow-sm" />
               <div>
                  <h3 className="font-bold text-slate-900 text-sm">{selectedProduct.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{selectedProduct.sku}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-1 rounded font-medium">{selectedProduct.size}码</span>
                    <span className="bg-orange-50 text-orange-600 text-[10px] px-2 py-1 rounded font-medium">库存 {selectedProduct.stock}</span>
                  </div>
               </div>
            </div>

            {/* Size Selector */}
            {sameSkuProducts.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">切换尺码</label>
                <div className="flex flex-wrap gap-2">
                  {sameSkuProducts.map(p => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProduct(p);
                        setSellingPrice(p.price.toString());
                        setQuantity(1);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        selectedProduct.id === p.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {p.size}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">出库数量</label>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 active:scale-95"
                    >
                      -
                    </button>
                    <input 
                      type="number"
                      value={quantity}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        if (!isNaN(val)) setQuantity(Math.min(selectedProduct.stock, Math.max(1, val)));
                      }}
                      className="flex-1 w-full bg-white text-center font-bold text-slate-900 rounded-lg py-1.5 outline-none border border-slate-200 focus:border-dewu-500"
                    />
                    <button 
                      onClick={() => setQuantity(q => Math.min(selectedProduct.stock, q + 1))}
                      className="w-8 h-8 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-slate-600 active:scale-95"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">入库成本</label>
                  <div className="text-sm font-bold text-slate-700 mt-2">¥ {selectedProduct.price}</div>
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-medium text-slate-900 mb-1.5">实际出售价格 (单价)</label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input 
                    type="number" 
                    value={sellingPrice}
                    onChange={(e) => setSellingPrice(e.target.value)}
                    className="w-full bg-white text-lg font-bold text-dewu-600 rounded-xl pl-9 pr-4 py-2 outline-none border-2 border-slate-200 focus:border-dewu-500 transition-all"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {sellingPrice && parseFloat(sellingPrice) > selectedProduct.price && (
                   <div className="mt-2 text-xs text-green-600 font-medium flex items-center justify-between">
                      <span>单件利润: +¥{(parseFloat(sellingPrice) - selectedProduct.price).toFixed(2)}</span>
                      <span>总利润: +¥{((parseFloat(sellingPrice) - selectedProduct.price) * quantity).toFixed(2)}</span>
                   </div>
                )}
                 {sellingPrice && parseFloat(sellingPrice) < selectedProduct.price && (
                   <div className="mt-2 text-xs text-red-500 font-medium flex items-center justify-between">
                      <span>单件亏损: -¥{(selectedProduct.price - parseFloat(sellingPrice)).toFixed(2)}</span>
                      <span>总亏损: -¥{((selectedProduct.price - parseFloat(sellingPrice)) * quantity).toFixed(2)}</span>
                   </div>
                )}
              </div>
            </div>

            <button 
              onClick={handleConfirmOutbound}
              className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl active:scale-95 transition-all shadow-lg shadow-slate-200 flex items-center justify-center space-x-2"
            >
              <span>确认出库 (x{quantity})</span>
              <ArrowUpRight size={18} />
            </button>
            
            <button 
              onClick={() => setSelectedProduct(null)}
              className="w-full text-slate-400 text-xs py-2 hover:text-slate-600"
            >
              返回重新选择
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
