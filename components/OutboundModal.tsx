import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, ArrowUpRight, Search, DollarSign, Calculator, Loader2 } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import type { FeeScheme, OutboundExecutionMode, OutboundFeeSelection, Product } from '../types';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules';
import { formatProductSize } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';
import { listFeeSchemes } from '../services/feeSchemes';
import { calculateFeeQuote } from '../lib/feeCalculations';
import { calculateTargetUnitPrice, type TargetPricingKind } from '../lib/targetPricing';
import { getFeeQuotePresentation } from '../lib/feeQuotePresentation';
import { listActiveSkuVariants, listProducts } from '../services/products';

interface OutboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onOutbound: (product: Product, sellingPrice: number, quantity: number, feeSelection: OutboundFeeSelection, operationId: string, mode: OutboundExecutionMode) => Promise<void> | void;
}

const createOperationId = () => globalThis.crypto?.randomUUID?.() || `outbound-${Date.now()}`;
const getDraftKey = (userId: string, productId: string) => `outboundDraftV1:${userId}:${productId}`;

export const OutboundModal: React.FC<OutboundModalProps> = ({ isOpen, onClose, userId, onOutbound }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([]);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [sameSkuProducts, setSameSkuProducts] = useState<Product[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [variantsError, setVariantsError] = useState('');
  const latestCatalogRequest = useRef(0);
  const latestVariantRequest = useRef(0);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [sellingPrice, setSellingPrice] = useState<string>('');
  const [quantity, setQuantity] = useState(1);
  const [validationError, setValidationError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feeSchemes, setFeeSchemes] = useState<FeeScheme[]>([]);
  const [feeSchemesLoading, setFeeSchemesLoading] = useState(false);
  const [selectedSchemeId, setSelectedSchemeId] = useState('');
  const [manualFeeEnabled, setManualFeeEnabled] = useState(false);
  const [manualFee, setManualFee] = useState('');
  const [operationId, setOperationId] = useState<string>(createOperationId);
  const [draftProductId, setDraftProductId] = useState<string | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedSchemeUpdatedAt, setSubmittedSchemeUpdatedAt] = useState('');
  const [targetPricingOpen, setTargetPricingOpen] = useState(false);
  const [targetPricingKind, setTargetPricingKind] = useState<TargetPricingKind>('netProfit');
  const [targetPricingValue, setTargetPricingValue] = useState('');
  const [targetPricingRequested, setTargetPricingRequested] = useState(false);
  const [executionMode, setExecutionMode] = useState<OutboundExecutionMode>('sales_order');

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
      setCatalogPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [isOpen, searchTerm]);

  useEffect(() => {
    if (!isOpen || selectedProduct) return;
    const requestId = ++latestCatalogRequest.current;
    setCatalogLoading(true);
    setCatalogError('');
    listProducts({
      userId,
      status: 'instock',
      minStock: 1,
      search: debouncedSearchTerm || undefined,
      page: catalogPage,
      pageSize: 20,
    }).then((result) => {
      if (requestId !== latestCatalogRequest.current) return;
      setCatalogProducts(result.products);
      setCatalogTotal(result.totalCount);
    }).catch((error) => {
      if (requestId !== latestCatalogRequest.current) return;
      setCatalogProducts([]);
      setCatalogTotal(0);
      setCatalogError(error instanceof Error ? error.message : '在库商品加载失败');
    }).finally(() => {
      if (requestId === latestCatalogRequest.current) setCatalogLoading(false);
    });
  }, [catalogPage, catalogRetry, debouncedSearchTerm, isOpen, selectedProduct, userId]);

  useEffect(() => {
    if (!isOpen || !selectedProduct) {
      setSameSkuProducts([]);
      setVariantsError('');
      setVariantsLoading(false);
      return;
    }
    const requestId = ++latestVariantRequest.current;
    setVariantsLoading(true);
    setVariantsError('');
    listActiveSkuVariants(userId, selectedProduct.sku).then((products) => {
      if (requestId !== latestVariantRequest.current) return;
      setSameSkuProducts(products);
    }).catch((error) => {
      if (requestId !== latestVariantRequest.current) return;
      setSameSkuProducts([selectedProduct]);
      setVariantsError(error instanceof Error ? error.message : '同货号库存加载失败');
    }).finally(() => {
      if (requestId === latestVariantRequest.current) setVariantsLoading(false);
    });
  }, [isOpen, selectedProduct?.id, selectedProduct?.sku, userId]);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    setFeeSchemesLoading(true);
    listFeeSchemes(userId).then((items) => {
      if (!mounted) return;
      const active = items.filter((item) => new Date(item.effectiveFrom).getTime() <= Date.now());
      setFeeSchemes(active);
      setSelectedSchemeId((current) => current || active.find((item) => item.isDefault)?.id || '');
    }).catch((error) => setValidationError(`费用方案加载失败：${String(error?.message || error)}`))
      .finally(() => { if (mounted) setFeeSchemesLoading(false); });
    return () => { mounted = false; };
  }, [isOpen, userId]);

  useEffect(() => {
    if (!selectedProduct) { setDraftProductId(null); setDraftReady(false); return; }
    if (draftProductId === selectedProduct.id) return;
    let mounted = true;
    Preferences.get({ key: getDraftKey(userId, selectedProduct.id) }).then(({ value }) => {
      if (!mounted) return;
      const draft = value ? JSON.parse(value) : null;
      setSellingPrice(String(draft?.sellingPrice ?? ''));
      setQuantity(Number.isInteger(Number(draft?.quantity)) ? Number(draft.quantity) : 1);
      setSelectedSchemeId(String(draft?.selectedSchemeId || feeSchemes.find((item) => item.isDefault)?.id || ''));
      setManualFeeEnabled(Boolean(draft?.manualFeeEnabled));
      setManualFee(String(draft?.manualFee ?? ''));
      setOperationId(String(draft?.operationId || createOperationId()));
      setSubmitted(Boolean(draft?.submitted));
      setSubmittedSchemeUpdatedAt(String(draft?.submittedSchemeUpdatedAt || ''));
      setExecutionMode(draft?.executionMode === 'quick_ledger' ? 'quick_ledger' : 'sales_order');
    }).catch(() => {
      setSellingPrice(''); setQuantity(1); setManualFeeEnabled(false); setManualFee(''); setOperationId(createOperationId()); setSubmitted(false); setSubmittedSchemeUpdatedAt('');
    }).finally(() => { if (mounted) { setDraftProductId(selectedProduct.id); setDraftReady(true); } });
    return () => { mounted = false; };
  }, [draftProductId, feeSchemes, selectedProduct, userId]);

  useEffect(() => {
    if (!selectedProduct || !draftReady || draftProductId !== selectedProduct.id) return;
    Preferences.set({ key: getDraftKey(userId, selectedProduct.id), value: JSON.stringify({
      sellingPrice, quantity, selectedSchemeId, manualFeeEnabled, manualFee, operationId, submitted, submittedSchemeUpdatedAt, executionMode,
    }) }).catch((error) => console.warn('Failed to save outbound draft', error));
  }, [draftProductId, draftReady, executionMode, manualFee, manualFeeEnabled, operationId, quantity, selectedProduct, selectedSchemeId, sellingPrice, submitted, submittedSchemeUpdatedAt, userId]);

  const selectedScheme = feeSchemes.find((item) => item.id === selectedSchemeId);
  const feeQuote = useMemo(() => {
    if (!selectedProduct || !sellingPrice.trim()) return undefined;
    try {
      return calculateFeeQuote({
        unitSalePrice: normalizeSalePrice(sellingPrice), unitCost: selectedProduct.price, quantity,
        scheme: selectedScheme, manualFeeOverride: manualFeeEnabled && manualFee.trim() ? normalizeSalePrice(manualFee) : undefined,
      });
    } catch { return undefined; }
  }, [manualFee, manualFeeEnabled, quantity, selectedProduct, selectedScheme, sellingPrice]);
  const feeQuotePresentation = getFeeQuotePresentation(Boolean(selectedScheme), manualFeeEnabled);
  const targetPricing = useMemo(() => {
    if (!targetPricingRequested || !selectedProduct) return { result: undefined, error: '' };
    if (!targetPricingValue.trim()) return { result: undefined, error: '请输入目标值。' };
    if (manualFeeEnabled && !manualFee.trim()) return { result: undefined, error: '请输入本次手动平台总费用。' };
    try {
      const result = calculateTargetUnitPrice({
        kind: targetPricingKind,
        target: Number(targetPricingValue),
        unitCost: selectedProduct.price,
        quantity,
        scheme: selectedScheme,
        manualFeeOverride: manualFeeEnabled ? normalizeSalePrice(manualFee) : undefined,
      });
      return { result, error: result ? '' : '在单价 100 万元以内无法达到这个目标。' };
    } catch (error) {
      return { result: undefined, error: error instanceof Error ? error.message : '暂时无法反算售价。' };
    }
  }, [manualFee, manualFeeEnabled, quantity, selectedProduct, selectedScheme, targetPricingKind, targetPricingRequested, targetPricingValue]);

  if (!isOpen) return null;

  const handleClose = () => {
    if (selectedProduct && !submitted) Preferences.remove({ key: getDraftKey(userId, selectedProduct.id) }).catch(() => {});
    setSearchTerm('');
    setDebouncedSearchTerm('');
    setCatalogProducts([]);
    setCatalogPage(1);
    setCatalogTotal(0);
    setCatalogError('');
    setCatalogRetry(0);
    setSameSkuProducts([]);
    setVariantsError('');
    setSelectedProduct(null);
    setSellingPrice('');
    setQuantity(1);
    setValidationError('');
    setIsSubmitting(false);
    setDraftProductId(null);
    setDraftReady(false);
    setSubmitted(false);
    setSubmittedSchemeUpdatedAt('');
    setTargetPricingOpen(false);
    setTargetPricingValue('');
    setTargetPricingRequested(false);
    onClose();
  };

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSellingPrice('');
    setQuantity(1);
    setValidationError('');
    setDraftProductId(null);
    setDraftReady(false);
    setTargetPricingOpen(false);
    setTargetPricingValue('');
    setTargetPricingRequested(false);
  };

  const handleConfirmOutbound = async () => {
    if (!selectedProduct) return;

    try {
      const finalPrice = normalizeSalePrice(sellingPrice);
      const finalQuantity = normalizeOutboundQuantity(quantity, selectedProduct.stock);
      if (manualFeeEnabled && !manualFee.trim()) throw new Error('请输入本次手动平台总费用，或关闭手动覆盖。');
      const manualFeeOverride = manualFeeEnabled ? normalizeSalePrice(manualFee) : undefined;
      const selection: OutboundFeeSelection = {
        schemeId: selectedSchemeId || undefined,
        schemeUpdatedAt: submitted ? submittedSchemeUpdatedAt || undefined : selectedScheme?.updatedAt,
        manualFeeOverride,
        quote: calculateFeeQuote({ unitSalePrice: finalPrice, unitCost: selectedProduct.price, quantity: finalQuantity, scheme: selectedScheme, manualFeeOverride }),
      };
      setValidationError('');
      setIsSubmitting(true);
      setSubmitted(true);
      const lockedSchemeUpdatedAt = submitted ? submittedSchemeUpdatedAt : selectedScheme?.updatedAt || '';
      setSubmittedSchemeUpdatedAt(lockedSchemeUpdatedAt);
      await Preferences.set({ key: getDraftKey(userId, selectedProduct.id), value: JSON.stringify({
        sellingPrice, quantity: finalQuantity, selectedSchemeId, manualFeeEnabled, manualFee, operationId, submitted: true, submittedSchemeUpdatedAt: lockedSchemeUpdatedAt, executionMode,
      }) });
      await onOutbound(selectedProduct, finalPrice, finalQuantity, selection, operationId, executionMode);
      await Preferences.remove({ key: getDraftKey(userId, selectedProduct.id) });
      handleClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : '出库失败，请稍后重试。';
      const isValidationError = /must|invalid|required|not found|insufficient|changed|请输入|不足|无效|方案/i.test(message);
      if (isValidationError) { setSubmitted(false); setSubmittedSchemeUpdatedAt(''); }
      setValidationError(isValidationError ? message : `出库结果暂时无法确认：${message}。请保留当前内容后重试，同一操作不会重复扣减库存。`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const searchPending = searchTerm.trim() !== debouncedSearchTerm;
  const hasSearch = debouncedSearchTerm.length > 0;
  const totalCatalogPages = Math.max(1, Math.ceil(catalogTotal / 20));

  return (
    <div className="app-task-shell animate-[fadeIn_0.2s_ease-out]">
      <div className="app-task-panel">
        <div className="app-task-header">
          <h2 className="text-lg font-bold text-slate-900">
            {selectedProduct ? '确认出库信息' : '商品出库'}
          </h2>
          <button 
            onClick={handleClose}
            className="app-icon-button border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭出库"
          >
            <X size={20} />
          </button>
        </div>
        
        {!selectedProduct ? (
          <>
            <div className="border-b border-slate-100 bg-slate-50 p-4 flex-shrink-0">
               <div className="relative">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                  <input 
                    type="text" 
                    placeholder="搜索商品货号" 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                    className="app-form-control bg-white pl-9"
                  />
                </div>
            </div>

            <div className="min-h-[200px] space-y-0 overflow-y-auto p-4">
              {(catalogLoading || searchPending) && (
                <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400"><Loader2 size={16} className="animate-spin" />正在查询在库商品...</div>
              )}
              {!catalogLoading && !searchPending && catalogError && (
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <p className="text-xs text-rose-500">商品目录加载失败，尚未显示空结果</p>
                  <button type="button" onClick={() => setCatalogRetry((value) => value + 1)} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white">重试</button>
                </div>
              )}
              {!catalogLoading && !searchPending && !catalogError && catalogProducts.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
                  <Search size={32} className="opacity-20" />
                  <span className="text-sm font-medium">{hasSearch ? '没有匹配的在库商品' : '暂无可出库商品'}</span>
                </div>
              )}
              {!catalogLoading && !searchPending && !catalogError && catalogProducts.length > 0 && (
                <>
                  <div className="flex items-center justify-between pb-2 text-xs text-slate-500">
                    <span>{hasSearch ? `找到 ${catalogTotal} 条库存` : '最近在库商品'}</span>
                    <span>{catalogPage}/{totalCatalogPages}</span>
                  </div>
                  {catalogProducts.map(product => (
                  <div key={product.id} className="flex min-h-[80px] items-center space-x-3 border-b border-slate-100 bg-white p-3 animate-[fadeIn_0.2s_ease-out]">
                    <ProductImage src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100" />
                    <div className="flex-1 min-w-0">
                      <h4 className="truncate text-sm font-bold text-slate-900">{product.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">{product.brand} · {formatProductSize(product.size)} · 库存 {product.stock}</p>
                      <p className="mt-1 text-xs text-slate-500">{product.sku}{product.source ? ` · ${product.source}` : ''}</p>
                      <p className="mt-1 text-xs text-slate-500">{product.warehouse || '未设置仓库'} · 成本 ¥{product.price}</p>
                    </div>
                    <button 
                      onClick={() => {
                        selectProduct(product);
                      }}
                      className="app-icon-button border-0 bg-green-600 text-white active:scale-95"
                      aria-label={`选择 ${product.name} 出库`}
                    >
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  ))}
                  {totalCatalogPages > 1 && (
                    <div className="flex items-center justify-between pt-1">
                      <button type="button" disabled={catalogPage <= 1} onClick={() => setCatalogPage((page) => Math.max(1, page - 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40">上一页</button>
                      <button type="button" disabled={catalogPage >= totalCatalogPages} onClick={() => setCatalogPage((page) => Math.min(totalCatalogPages, page + 1))} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40">下一页</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="app-task-body space-y-5">
            <div className="flex items-start space-x-4">
               <ProductImage src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-20 h-20 rounded-xl object-cover bg-slate-100 shadow-sm" />
               <div>
                  <h3 className="font-bold text-slate-900 text-sm">{selectedProduct.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{selectedProduct.sku}</p>
                  <p className="mt-1 text-xs text-slate-500">{selectedProduct.warehouse || '未设置仓库'}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{formatProductSize(selectedProduct.size)}</span>
                    <span className="rounded bg-orange-50 px-2 py-1 text-xs font-medium text-orange-600">库存 {selectedProduct.stock}</span>
                  </div>
               </div>
            </div>

            {/* Size Selector */}
            {(variantsLoading || variantsError || sameSkuProducts.length > 1) && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">切换尺码</label>
                {variantsLoading && <p className="mb-2 text-[11px] text-slate-400">正在同步同货号库存...</p>}
                {!variantsLoading && variantsError && <p className="mb-2 text-[11px] text-rose-500">同货号库存同步失败，请返回后重试。</p>}
                <div className="flex flex-wrap gap-2">
                  {sameSkuProducts.map(p => (
                    <button
                      key={p.id}
                      disabled={submitted}
                      onClick={() => {
                        selectProduct(p);
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        selectedProduct.id === p.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {p.size} · {p.warehouse || '未设置'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <label className="mb-2 block text-xs font-medium text-slate-600">记录方式</label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-200/70 p-1">
                  <button type="button" disabled={submitted} onClick={() => setExecutionMode('sales_order')} className={`app-touch rounded-md px-2 text-xs font-semibold ${executionMode === 'sales_order' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>销售订单</button>
                  <button type="button" disabled={submitted} onClick={() => setExecutionMode('quick_ledger')} className={`app-touch rounded-md px-2 text-xs font-semibold ${executionMode === 'quick_ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>直接记出库</button>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{executionMode === 'sales_order' ? '先预留库存并进入待发货；确认发货后才形成出库流水。' : '适合已经完成交易的补记场景，会立即扣库存并形成出库流水。'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">出库数量</label>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => setQuantity(q => Math.max(1, q - 1))}
                      disabled={submitted}
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
                      disabled={submitted}
                      className="flex-1 w-full bg-white text-center font-bold text-slate-900 rounded-lg py-1.5 outline-none border border-slate-200 focus:border-dewu-500"
                    />
                    <button 
                      onClick={() => setQuantity(q => Math.min(selectedProduct.stock, q + 1))}
                      disabled={submitted}
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
                    onChange={(e) => {
                      setSellingPrice(e.target.value);
                      setValidationError('');
                    }}
                    min="0"
                    step="0.01"
                    disabled={submitted}
                    className="w-full bg-white text-lg font-bold text-dewu-600 rounded-xl pl-9 pr-4 py-2 outline-none border-2 border-slate-200 focus:border-dewu-500 transition-all"
                    placeholder="0.00"
                    autoFocus
                  />
                </div>
                {sellingPrice && parseFloat(sellingPrice) > selectedProduct.price && (
                   <div className="mt-2 text-xs text-green-600 font-medium flex items-center justify-between">
                      <span>未扣平台费毛利: +¥{(parseFloat(sellingPrice) - selectedProduct.price).toFixed(2)}/件</span>
                      <span>合计 +¥{((parseFloat(sellingPrice) - selectedProduct.price) * quantity).toFixed(2)}</span>
                   </div>
                )}
                 {sellingPrice && parseFloat(sellingPrice) < selectedProduct.price && (
                   <div className="mt-2 text-xs text-red-500 font-medium flex items-center justify-between">
                      <span>未扣平台费毛亏: -¥{(selectedProduct.price - parseFloat(sellingPrice)).toFixed(2)}/件</span>
                      <span>合计 -¥{((selectedProduct.price - parseFloat(sellingPrice)) * quantity).toFixed(2)}</span>
                   </div>
                )}
                {!sellingPrice.trim() && (
                  <div className="mt-2 text-xs text-amber-600">请填写真实成交单价，系统不会使用成本价代替。</div>
                )}
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700"><Calculator size={14} />费用方案</label>
                  {feeSchemesLoading && <Loader2 size={14} className="animate-spin text-slate-400" />}
                </div>
                <select value={selectedSchemeId} onChange={(event) => setSelectedSchemeId(event.target.value)} disabled={submitted || feeSchemesLoading} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-dewu-500 disabled:opacity-60">
                  <option value="">未选择费用方案</option>
                  {feeSchemes.map((scheme) => <option key={scheme.id} value={scheme.id}>{scheme.name}{scheme.isDefault ? ' · 默认' : ''}</option>)}
                </select>
                <label className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>手动覆盖本次平台总费用</span><input type="checkbox" checked={manualFeeEnabled} onChange={(event) => setManualFeeEnabled(event.target.checked)} disabled={submitted} className="h-4 w-4 accent-teal-500" /></label>
                {manualFeeEnabled && <input type="number" min="0" step="0.01" value={manualFee} onChange={(event) => setManualFee(event.target.value)} disabled={submitted} placeholder="本次费用总额" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-dewu-500" />}

                <button
                  type="button"
                  onClick={() => { setTargetPricingOpen((current) => !current); setTargetPricingRequested(false); }}
                  disabled={submitted}
                  className="app-touch mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-teal-200 bg-teal-50 text-xs font-semibold text-teal-700 disabled:opacity-50"
                >
                  <Calculator size={14} />反算售价
                </button>

                {targetPricingOpen && (
                  <div className="mt-3 border-t border-slate-200 pt-3">
                    <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
                      {([
                        ['netProceeds', '目标到手'],
                        ['netProfit', '目标净赚'],
                        ['netMargin', '目标净利率'],
                      ] as Array<[TargetPricingKind, string]>).map(([kind, label]) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => { setTargetPricingKind(kind); setTargetPricingRequested(false); }}
                          className={`min-w-0 rounded-md px-1 py-1.5 text-[11px] font-medium ${targetPricingKind === kind ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <span className="absolute left-3 top-2 text-xs text-slate-400">{targetPricingKind === 'netMargin' ? '%' : '¥'}</span>
                        <input
                          type="number"
                          min="0"
                          max={targetPricingKind === 'netMargin' ? 100 : undefined}
                          step="0.01"
                          value={targetPricingValue}
                          onChange={(event) => { setTargetPricingValue(event.target.value); setTargetPricingRequested(false); }}
                          placeholder={targetPricingKind === 'netMargin' ? '例如 20' : '例如 500'}
                          className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-7 pr-2 text-sm outline-none focus:border-dewu-500"
                        />
                      </div>
                      <button type="button" onClick={() => setTargetPricingRequested(true)} className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white">计算</button>
                    </div>

                    {targetPricingRequested && targetPricing.error && (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-4 text-amber-700">{targetPricing.error}</p>
                    )}
                    {targetPricing.result && (
                      <div className="mt-2 rounded-lg border border-teal-100 bg-teal-50/70 p-2.5">
                        <div className="flex items-end justify-between">
                          <div>
                            <p className="text-[10px] text-slate-500">最低单件售价</p>
                            <p className="text-xl font-bold text-teal-700">¥{targetPricing.result.unitSalePrice.toFixed(2)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setSellingPrice(targetPricing.result!.unitSalePrice.toFixed(2)); setValidationError(''); }}
                            className="rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-semibold text-white"
                          >
                            使用这个售价
                          </button>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-teal-100 pt-2 text-[10px]">
                          <span className="text-slate-500">成交额</span><span className="text-right font-medium">¥{targetPricing.result.quote.grossAmount.toFixed(2)}</span>
                          <span className="text-slate-500">预计费用</span><span className="text-right font-medium">¥{targetPricing.result.quote.totalFee!.toFixed(2)}</span>
                          <span className="text-slate-500">预计到手</span><span className="text-right font-medium">¥{targetPricing.result.quote.netProceeds!.toFixed(2)}</span>
                          <span className="text-slate-500">预计净利润</span><span className="text-right font-medium">¥{targetPricing.result.quote.netProfit!.toFixed(2)}</span>
                          <span className="text-slate-500">净利率</span><span className="text-right font-medium">{targetPricing.result.quote.netMarginRate == null ? '—（成交额为 0）' : `${targetPricing.result.quote.netMarginRate.toFixed(1)}%`}</span>
                        </div>
                        <p className="mt-2 text-[10px] leading-4 text-slate-500">成本 ¥{selectedProduct.price.toFixed(2)} × {quantity}；{manualFeeEnabled ? '本次按手动总费用估算' : `费用方案：${selectedScheme?.name || '未选择'}`}。修改数量或费用后结果会按当前输入重新计算。</p>
                        {selectedScheme && <p className="text-[10px] leading-4 text-slate-400">方案生效：{new Date(selectedScheme.effectiveFrom).toLocaleString('zh-CN')}</p>}
                        {selectedProduct.price === 0 && <p className="mt-1 font-semibold text-red-600 text-[10px]">当前成本为 0，请先确认成本记录是否准确。</p>}
                      </div>
                    )}
                    <p className="mt-2 text-[10px] leading-4 text-slate-400">反算结果仅用于估算，不会自动出库；实际费用以平台结算明细为准。</p>
                  </div>
                )}
              </div>
            </div>

            {sellingPrice.trim() && feeQuote && (
              feeQuote.known ? (
                <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <span className="text-slate-500">成交总额</span><strong className="text-right text-slate-800">¥{feeQuote.grossAmount.toFixed(2)}</strong>
                    <span className="text-slate-500">预计平台费用</span><strong className="text-right text-amber-600">-¥{feeQuote.totalFee!.toFixed(2)}</strong>
                    <span className="text-slate-500">预计到手</span><strong className="text-right text-dewu-700">¥{feeQuote.netProceeds!.toFixed(2)}</strong>
                    <span className="text-slate-500">预计净利润</span><strong className={`text-right ${feeQuote.netProfit! >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>¥{feeQuote.netProfit!.toFixed(2)}</strong>
                    <span className="text-slate-500">净利率</span><strong className="text-right text-slate-800">{feeQuote.netMarginRate == null ? '不适用' : `${feeQuote.netMarginRate.toFixed(1)}%`}</strong>
                    <span className="text-slate-500">保本单价</span><strong className="text-right text-slate-800">{feeQuote.breakEvenUnitPrice == null ? '无法达到' : `¥${feeQuote.breakEvenUnitPrice.toFixed(2)}`}</strong>
                  </div>
                  {selectedScheme && <p className="mt-2 border-t border-emerald-100 pt-2 text-[10px] leading-4 text-slate-500">比例费{selectedScheme.percentageUnit === 'item' ? `按件 ×${quantity}` : '按本次交易 ×1'}；固定费{selectedScheme.fixedFeeUnit === 'item' ? `按件 ×${quantity}` : '按交易 ×1'}；运费{selectedScheme.shippingFeeUnit === 'item' ? `按件 ×${quantity}` : '按交易 ×1'}；其他费用{selectedScheme.otherFeeUnit === 'item' ? `按件 ×${quantity}` : '按交易 ×1'}{manualFeeEnabled ? '；最终采用手动总费用' : ''}</p>}
                  {feeQuotePresentation.source === 'manual' && <p className="mt-2 border-t border-emerald-100 pt-2 text-[10px] leading-4 text-slate-500">{feeQuotePresentation.message}</p>}
                </div>
              ) : <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">{feeQuotePresentation.message}</div>
            )}

            <p className="text-xs leading-5 text-slate-500">费用仅为估算，实际金额以平台出价页和订单结算明细为准。</p>

            {validationError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{validationError}</div>
            )}

            <button 
              onClick={handleConfirmOutbound}
              disabled={!draftReady || isSubmitting || !sellingPrice.trim() || (manualFeeEnabled && !manualFee.trim())}
              className="app-primary-action sticky bottom-0 z-20 -mx-4 w-[calc(100%+2rem)] space-x-2 rounded-none border-t border-slate-200 bg-green-600 px-4 shadow-[0_-6px_16px_rgba(15,23,42,0.08)] disabled:opacity-40 disabled:active:scale-100"
            >
              <span>{isSubmitting ? '正在提交...' : submitted ? '核对上次提交' : executionMode === 'sales_order' ? `创建销售订单 (x${quantity})` : `确认直接出库 (x${quantity})`}</span>
              <ArrowUpRight size={18} />
            </button>
            
            <button 
              onClick={() => { if (!submitted) setSelectedProduct(null); }}
              disabled={submitted}
              className="app-secondary-action w-full text-xs text-slate-500 hover:text-slate-700"
            >
              返回重新选择
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
