import React, { useState, useEffect } from 'react';
import { X, Save, Sparkles, Loader2, Trash2 } from 'lucide-react';
import { Product, Warehouse } from '../types';
import { supabase } from '../lib/supabase';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => void;
  onDelete?: (productId: string) => void;
  initialData?: Product | null;
  warehouses: Warehouse[];
}

export const AddProductModal: React.FC<AddProductModalProps> = ({ isOpen, onClose, onSave, onDelete, initialData, warehouses }) => {
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [productData, setProductData] = useState<Partial<Product>>({
    name: '',
    brand: '',
    sku: '',
    size: '',
    price: undefined,
    stock: undefined,
    status: 'instock',
    location: '',
    warehouse: warehouses[0]?.name || '杭州一号仓'
  });
  
  useEffect(() => {
    if (isOpen && initialData) {
      setProductData({ ...initialData });
    } else if (isOpen && !initialData) {
      // Reset for new product
      setProductData({
        name: '',
        brand: '',
        sku: '',
        size: '',
        price: undefined,
        stock: undefined,
        status: 'instock',
        location: '',
        warehouse: warehouses[0]?.name || '杭州一号仓'
      });
    }
  }, [isOpen, initialData, warehouses]);

  // 调用后端逻辑 (Edge Function)
  const handleSmartLookup = async () => {
    if (!productData.sku) {
      alert("请先输入货号");
      return;
    }

    setIsLookingUp(true);

    try {
      // 1. 尝试调用 Supabase Edge Function
      const { data, error } = await supabase.functions.invoke('lookup-sku', {
        body: { sku: productData.sku }
      });

      if (error) {
        // 如果后端函数还没部署，我们为了演示效果，使用前端模拟数据
        console.warn("Backend function not found, falling back to mock logic.", error);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 模拟网络延迟
        
        // 模拟后端返回的数据
        if (productData.sku.toUpperCase().includes('DD1391')) {
            setProductData(prev => ({
                ...prev,
                name: 'Nike Dunk Low Black White (Panda)',
                brand: 'Nike',
                imageUrl: 'https://images.stockx.com/images/Nike-Dunk-Low-Retro-White-Black-2021-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1633027409',
                price: 749
            }));
        } else {
            alert("模拟后端：未找到该货号信息，请手动输入");
        }
      } else {
        // 2. 如果成功调用真实后端，使用返回的数据
        if (data && data.found) {
            setProductData(prev => ({
                ...prev,
                name: data.name,
                brand: data.brand,
                imageUrl: data.imageUrl
            }));
        } else {
            alert("未找到该商品信息");
        }
      }

    } catch (err) {
      console.error(err);
      alert("识别失败");
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleSave = () => {
    if (!productData.name || !productData.brand || !productData.price) {
      alert("请填写必要信息");
      return;
    }

    const product: Product = {
      id: initialData?.id || Date.now().toString(),
      name: productData.name || 'Unknown',
      brand: productData.brand || 'Unknown',
      size: productData.size || '均码',
      sku: productData.sku || 'N/A',
      price: Number(productData.price) || 0,
      stock: Number(productData.stock) || 0,
      imageUrl: productData.imageUrl || `https://picsum.photos/200/200?random=${Date.now()}`,
      status: productData.status || 'instock',
      location: productData.location || '待分配',
      warehouse: productData.warehouse || '杭州一号仓'
    };

    onSave(product);
  };

  const handleDelete = () => {
    if (initialData?.id && onDelete) {
        if (confirm('确定要删除这个商品吗？删除后无法恢复。')) {
            onDelete(initialData.id);
        }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">{initialData ? '编辑库存商品' : '新增库存商品'}</h2>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-5 space-y-4">
            
          {/* SKU Input with Smart Button */}
          <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">货号 (输入后点击右侧魔法棒)</label>
              <div className="flex space-x-2">
                <input 
                    type="text" 
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors uppercase"
                    placeholder="DD1391-100"
                    value={productData.sku}
                    onChange={(e) => setProductData({...productData, sku: e.target.value})}
                />
                <button 
                    onClick={handleSmartLookup}
                    disabled={isLookingUp || !productData.sku}
                    className="bg-indigo-600 text-white px-3 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all shadow-sm shadow-indigo-200"
                >
                    {isLookingUp ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
                </button>
              </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">商品名称</label>
            <input 
              type="text" 
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
              placeholder="例如: Nike Dunk Low Panda"
              value={productData.name}
              onChange={(e) => setProductData({...productData, name: e.target.value})}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
               <label className="block text-xs font-medium text-slate-500 mb-1">所属仓库</label>
               <select
                 className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                 value={productData.warehouse}
                 onChange={(e) => setProductData({...productData, warehouse: e.target.value})}
               >
                  {warehouses.map(wh => (
                    <option key={wh.id} value={wh.name}>{wh.name}</option>
                  ))}
               </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">放置位置</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="A-01"
                value={productData.location || ''}
                onChange={(e) => setProductData({...productData, location: e.target.value})}
              />
            </div>
          </div>
          <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">品牌</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="Nike"
                value={productData.brand}
                onChange={(e) => setProductData({...productData, brand: e.target.value})}
              />
            </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">尺码</label>
              <input 
                type="text" 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="42"
                value={productData.size}
                onChange={(e) => setProductData({...productData, size: e.target.value})}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">成本 (¥)</label>
              <input 
                type="number" 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="0.00"
                value={productData.price || ''}
                onChange={(e) => setProductData({...productData, price: parseFloat(e.target.value)})}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">库存</label>
              <input 
                type="number" 
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="0"
                value={productData.stock !== undefined ? productData.stock : ''}
                onChange={(e) => setProductData({...productData, stock: parseInt(e.target.value)})}
              />
            </div>
          </div>

          <div className="mt-4 flex space-x-3">
             {/* Delete Button - Only shown when editing existing product */}
             {initialData && (
                 <button 
                    onClick={handleDelete}
                    className="bg-red-50 text-red-500 p-3 rounded-xl flex items-center justify-center active:scale-95 transition-all border border-red-100"
                 >
                    <Trash2 size={20} />
                 </button>
             )}

             <button 
                onClick={handleSave}
                className="flex-1 bg-slate-900 text-white font-medium py-3 rounded-xl flex items-center justify-center space-x-2 active:scale-95 transition-all shadow-lg shadow-slate-200"
             >
                <Save size={18} />
                <span>{initialData ? '保存修改' : '保存入库'}</span>
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};