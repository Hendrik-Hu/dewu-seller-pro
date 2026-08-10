import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, PackageCheck, Search, Truck, X } from 'lucide-react';
import { Product } from '../types';
import { formatProductSize } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';
import { listProducts } from '../services/products';

interface TransitInventoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onReviewArrival: (product: Product) => void;
}

export const TransitInventoryModal: React.FC<TransitInventoryModalProps> = ({
  isOpen, onClose, userId, onReviewArrival,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const latestRequest = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setProducts([]);
    setPage(1);
    setTotalCount(0);
    setLoadError('');
    setReloadToken(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, searchTerm]);

  useEffect(() => {
    if (!isOpen) return;
    const requestId = ++latestRequest.current;
    setLoading(true);
    setLoadError('');
    listProducts({
      userId,
      status: 'shipping',
      minStock: 0,
      search: debouncedSearchTerm || undefined,
      page,
      pageSize: 20,
    }).then((result) => {
      if (requestId !== latestRequest.current) return;
      setProducts(result.products);
      setTotalCount(result.totalCount);
    }).catch((error) => {
      if (requestId !== latestRequest.current) return;
      setProducts([]);
      setTotalCount(0);
      setLoadError(error instanceof Error ? error.message : '运输中库存加载失败');
    }).finally(() => {
      if (requestId === latestRequest.current) setLoading(false);
    });
  }, [debouncedSearchTerm, isOpen, page, reloadToken, userId]);

  if (!isOpen) return null;

  const searchPending = searchTerm.trim() !== debouncedSearchTerm;
  const totalPages = Math.max(1, Math.ceil(totalCount / 20));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-100 p-4 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Truck className="text-orange-500" size={20} />
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">采购运输中</h2>
              <p className="text-[10px] text-slate-400">到仓只转为在售，卖出必须另走出库记账</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-slate-400" aria-label="关闭运输中库存"><X size={20} /></button>
        </header>

        <div className="space-y-2 border-b border-slate-100 bg-slate-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="搜索货号、名称、品牌、尺码..." className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-dewu-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white" />
          </div>
          {!loading && !searchPending && !loadError && products.length > 0 && <p className="text-[11px] text-slate-500">共 {totalCount} 个运输中库存变体</p>}
        </div>

        <div className="min-h-[220px] space-y-3 overflow-y-auto p-4">
          {loading || searchPending ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-slate-400"><Loader2 size={16} className="animate-spin" />正在同步运输中商品...</div>
          ) : loadError ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center"><p className="text-xs text-rose-500">运输中库存加载失败，尚未显示空结果</p><button type="button" onClick={() => setReloadToken((value) => value + 1)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white">重试</button></div>
          ) : products.length === 0 ? (
            <div className="mt-10 flex h-full flex-col items-center justify-center space-y-2 text-slate-400"><PackageCheck size={48} className="text-slate-200" /><span className="text-sm font-medium">暂无运输中商品</span><p className="text-xs">这里不代表待发货订单</p></div>
          ) : products.map((product) => (
            <article key={product.id} className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="absolute inset-y-0 left-0 w-1 bg-orange-400" />
              <ProductImage src={product.imageUrl} alt={product.name} className="h-16 w-16 shrink-0 rounded-lg bg-slate-100 object-cover" />
              <div className="min-w-0 flex-1">
                <h4 className="line-clamp-2 text-xs font-bold text-slate-900 dark:text-white">{product.name}</h4>
                <p className="mt-1 text-[10px] text-slate-400">{product.sku} · {formatProductSize(product.size)} · {product.warehouse || '未设置仓库'}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <div><p className="text-xs font-semibold text-slate-700 dark:text-zinc-200">库存 {product.stock} 件</p><p className="text-[10px] text-slate-400">平均成本 ¥{product.price.toFixed(2)}</p></div>
                  {product.stock > 0 ? <button type="button" onClick={() => onReviewArrival(product)} className="shrink-0 rounded-lg bg-orange-50 px-2.5 py-1.5 text-[11px] font-semibold text-orange-600 dark:bg-orange-950/30 dark:text-orange-300">到仓核对</button> : <span className="text-[10px] text-rose-500">库存异常，请盘点</span>}
                </div>
              </div>
            </article>
          ))}
          {!loading && !searchPending && !loadError && totalPages > 1 && <div className="flex items-center justify-between pt-1"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40" aria-label="上一页"><ChevronLeft size={16} /></button><span className="text-[11px] text-slate-400">{page}/{totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} className="rounded-lg border border-slate-200 p-2 text-slate-500 disabled:opacity-40" aria-label="下一页"><ChevronRight size={16} /></button></div>}
        </div>
      </div>
    </div>
  );
};
