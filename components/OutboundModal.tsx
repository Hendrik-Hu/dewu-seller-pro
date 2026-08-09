import React, { useEffect, useMemo, useState } from 'react';
import { X, ArrowUpRight, Search, DollarSign, Calculator, Loader2 } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import type { FeeScheme, OutboundFeeSelection, Product } from '../types';
import { normalizeOutboundQuantity, normalizeSalePrice } from '../lib/outboundRules';
import { formatProductSize, normalizeSku } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';
import { listFeeSchemes } from '../services/feeSchemes';
import { calculateFeeQuote } from '../lib/feeCalculations';

interface OutboundModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  userId: string;
  onOutbound: (product: Product, sellingPrice: number, quantity: number, feeSelection: OutboundFeeSelection, operationId: string) => Promise<void> | void;
}

const createOperationId = () => globalThis.crypto?.randomUUID?.() || `outbound-${Date.now()}`;
const getDraftKey = (userId: string, productId: string) => `outboundDraftV1:${userId}:${productId}`;

export const OutboundModal: React.FC<OutboundModalProps> = ({ isOpen, onClose, products, userId, onOutbound }) => {
  const [searchTerm, setSearchTerm] = useState('');
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
    }).catch(() => {
      setSellingPrice(''); setQuantity(1); setManualFeeEnabled(false); setManualFee(''); setOperationId(createOperationId()); setSubmitted(false); setSubmittedSchemeUpdatedAt('');
    }).finally(() => { if (mounted) { setDraftProductId(selectedProduct.id); setDraftReady(true); } });
    return () => { mounted = false; };
  }, [draftProductId, feeSchemes, selectedProduct, userId]);

  useEffect(() => {
    if (!selectedProduct || !draftReady || draftProductId !== selectedProduct.id) return;
    Preferences.set({ key: getDraftKey(userId, selectedProduct.id), value: JSON.stringify({
      sellingPrice, quantity, selectedSchemeId, manualFeeEnabled, manualFee, operationId, submitted, submittedSchemeUpdatedAt,
    }) }).catch((error) => console.warn('Failed to save outbound draft', error));
  }, [draftProductId, draftReady, manualFee, manualFeeEnabled, operationId, quantity, selectedProduct, selectedSchemeId, sellingPrice, submitted, submittedSchemeUpdatedAt, userId]);

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

  if (!isOpen) return null;

  const handleClose = () => {
    if (selectedProduct && !submitted) Preferences.remove({ key: getDraftKey(userId, selectedProduct.id) }).catch(() => {});
    setSearchTerm('');
    setSelectedProduct(null);
    setSellingPrice('');
    setQuantity(1);
    setValidationError('');
    setIsSubmitting(false);
    setDraftProductId(null);
    setDraftReady(false);
    setSubmitted(false);
    setSubmittedSchemeUpdatedAt('');
    onClose();
  };

  const selectProduct = (product: Product) => {
    setSelectedProduct(product);
    setSellingPrice('');
    setQuantity(1);
    setValidationError('');
    setDraftProductId(null);
    setDraftReady(false);
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
        sellingPrice, quantity: finalQuantity, selectedSchemeId, manualFeeEnabled, manualFee, operationId, submitted: true, submittedSchemeUpdatedAt: lockedSchemeUpdatedAt,
      }) });
      await onOutbound(selectedProduct, finalPrice, finalQuantity, selection, operationId);
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

  // Only show results if user has typed something
  const hasSearch = searchTerm.trim().length > 0;
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const availableProducts = hasSearch 
    ? products
        .filter(p =>
          p.stock > 0 &&
          [
            p.name,
            p.sku,
            p.brand,
            p.size,
            p.source,
            p.warehouse,
            p.location,
          ]
            .filter(Boolean)
            .some(value => String(value).toLowerCase().includes(normalizedSearch))
        )
        .sort((a, b) => {
          const aSkuExact = a.sku.toLowerCase() === normalizedSearch ? 3 : a.sku.toLowerCase().startsWith(normalizedSearch) ? 2 : a.name.toLowerCase().startsWith(normalizedSearch) ? 1 : 0;
          const bSkuExact = b.sku.toLowerCase() === normalizedSearch ? 3 : b.sku.toLowerCase().startsWith(normalizedSearch) ? 2 : b.name.toLowerCase().startsWith(normalizedSearch) ? 1 : 0;
          if (aSkuExact !== bSkuExact) return bSkuExact - aSkuExact;
          return b.stock - a.stock;
        })
    : [];

  const quickPickProducts = !hasSearch
    ? products
        .filter((p) => p.stock > 0)
        .sort((a, b) => b.stock - a.stock)
        .slice(0, 8)
    : [];

  // Find other sizes for the same SKU
  const sameSkuProducts = selectedProduct 
    ? products
        .filter(p => normalizeSku(p.sku) === normalizeSku(selectedProduct.sku) && p.stock > 0)
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
                quickPickProducts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
                    <Search size={32} className="opacity-20" />
                    <span className="text-xs">请输入货号搜索库存商品</span>
                  </div>
                ) : (
                  <>
                    <div className="text-[11px] text-slate-400 mb-1">常用在库商品</div>
                    {quickPickProducts.map(product => (
                      <div key={product.id} className="flex items-center space-x-3 bg-white p-2 rounded-xl border border-slate-100 shadow-sm animate-[fadeIn_0.2s_ease-out]">
                        <ProductImage src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100" />
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-bold text-slate-900 truncate">{product.name}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{product.sku} · {formatProductSize(product.size)} · 库存 {product.stock}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{product.warehouse || '未设置仓库'} · 成本 ¥{product.price}</p>
                        </div>
                        <button
                          onClick={() => {
                            selectProduct(product);
                          }}
                          className="bg-slate-900 text-white p-2 rounded-lg active:scale-95 transition-transform"
                        >
                          <ArrowUpRight size={18} />
                        </button>
                      </div>
                    ))}
                  </>
                )
              ) : availableProducts.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-2 mt-10">
                  <span className="text-sm font-medium">商品不存在</span>
                </div>
              ) : (
                availableProducts.map(product => (
                  <div key={product.id} className="flex items-center space-x-3 bg-white p-2 rounded-xl border border-slate-100 shadow-sm animate-[fadeIn_0.2s_ease-out]">
                    <ProductImage src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100" />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-slate-900 truncate">{product.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{product.brand} · {formatProductSize(product.size)} · 库存 {product.stock}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{product.sku}{product.source ? ` · ${product.source}` : ''}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{product.warehouse || '未设置仓库'} · 成本 ¥{product.price}</p>
                    </div>
                    <button 
                      onClick={() => {
                        selectProduct(product);
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
               <ProductImage src={selectedProduct.imageUrl} alt={selectedProduct.name} className="w-20 h-20 rounded-xl object-cover bg-slate-100 shadow-sm" />
               <div>
                  <h3 className="font-bold text-slate-900 text-sm">{selectedProduct.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{selectedProduct.sku}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{selectedProduct.warehouse || '未设置仓库'}</p>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-1 rounded font-medium">{formatProductSize(selectedProduct.size)}</span>
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
                  <div className="mt-2 text-[11px] text-amber-600">请填写真实成交单价，系统不会使用成本价代替。</div>
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
                  {!selectedScheme && manualFeeEnabled && <p className="mt-2 border-t border-emerald-100 pt-2 text-[10px] leading-4 text-slate-500">未使用费用方案，本次按手动总费用估算。</p>}
                </div>
              ) : <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">费用方案未配置，本次只记录成交额和毛利润；平台费用、到手与净利润保持未知。</div>
            )}

            <p className="text-[10px] leading-4 text-slate-400">费用仅为估算，实际金额以平台出价页和订单结算明细为准。</p>

            {validationError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{validationError}</div>
            )}

            <button 
              onClick={handleConfirmOutbound}
              disabled={!draftReady || isSubmitting || !sellingPrice.trim() || (manualFeeEnabled && !manualFee.trim())}
              className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-xl active:scale-95 transition-all shadow-lg shadow-slate-200 flex items-center justify-center space-x-2 disabled:opacity-40 disabled:active:scale-100"
            >
              <span>{isSubmitting ? '正在出库...' : submitted ? '核对上次出库' : `确认出库 (x${quantity})`}</span>
              <ArrowUpRight size={18} />
            </button>
            
            <button 
              onClick={() => { if (!submitted) setSelectedProduct(null); }}
              disabled={submitted}
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
