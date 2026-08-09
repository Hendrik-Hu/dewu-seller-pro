import React, { useEffect, useState } from 'react';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { Product } from '../types';
import { listDeletedProducts, restoreProduct } from '../services/products';
import { ProductImage } from './ProductImage';
import { formatProductSize } from '../lib/productNormalization';

interface RecycleBinModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onRestored: () => void;
}

export const RecycleBinModal: React.FC<RecycleBinModalProps> = ({ isOpen, onClose, userId, onRestored }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const loadProducts = async () => {
    setIsLoading(true);
    try {
      setProducts(await listDeletedProducts(userId));
    } catch (error) {
      console.error('Failed to load recycle bin', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadProducts();
  }, [isOpen, userId]);

  const handleRestore = async (product: Product) => {
    setRestoringId(product.id);
    try {
      const result = await restoreProduct(product.id, userId);
      setProducts((current) => current.filter((item) => item.id !== product.id));
      onRestored();
      if (result.merged) alert('已与同货号、同尺码、同仓库的现有库存合并，并重新计算平均成本。');
    } catch (error: any) {
      alert(`恢复失败：${error?.message || '请稍后重试'}`);
    } finally {
      setRestoringId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <section className="flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <header className="flex items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div>
            <h2 className="font-bold text-slate-900 dark:text-white">回收站</h2>
            <p className="mt-0.5 text-[11px] text-slate-400">移出的库存可在这里恢复</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400"><X size={20} /></button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-4 dark:bg-black/40">
          {isLoading && <div className="flex justify-center py-10"><Loader2 className="animate-spin text-dewu-500" /></div>}
          {!isLoading && products.length === 0 && (
            <div className="py-12 text-center text-slate-400">
              <Trash2 className="mx-auto mb-2" size={28} />
              <p className="text-sm">回收站为空</p>
            </div>
          )}
          {products.map((product) => (
            <article key={product.id} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
              <ProductImage src={product.imageUrl} alt={product.name} className="h-12 w-12 shrink-0 rounded-lg bg-slate-100 object-cover dark:bg-zinc-800" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold text-slate-800 dark:text-zinc-100">{product.name}</h3>
                <p className="mt-0.5 text-[11px] text-slate-400">{product.sku} · {formatProductSize(product.size)} · 库存 {product.stock}</p>
              </div>
              <button
                onClick={() => handleRestore(product)}
                disabled={restoringId === product.id}
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-dewu-50 text-dewu-600 disabled:opacity-50 dark:bg-dewu-900/30 dark:text-dewu-400"
                title="恢复商品"
              >
                {restoringId === product.id ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
