import React, { useEffect, useRef, useState } from 'react';
import { Camera, PackageCheck, Plus, Save, Trash2, Truck, X } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import { Product, Warehouse } from '../types';
import { formatProductSize, normalizeBrand, normalizeSize, normalizeSku } from '../lib/productNormalization';
import { prepareProductImage } from '../lib/productImagePipeline';
import { deleteProductPhotoDraft, loadProductPhotoDraft, pruneProductPhotoDrafts, saveProductPhotoDraft } from '../services/productPhotoDrafts';
import { suggestInventorySkus } from '../services/products';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product | Product[]) => Promise<void> | void;
  onDelete?: (productId: string) => void;
  initialData?: Product | null;
  warehouses: Warehouse[];
  userId: string;
}

const DRAFT_KEY = 'addProductDraftV2';
const getDraftKey = (userId: string) => `${DRAFT_KEY}:${userId}`;
const createDraftId = () => globalThis.crypto?.randomUUID?.() || `draft-${Date.now()}`;
const getInitialWarehouseName = (warehouses: Warehouse[]) =>
  warehouses.find((warehouse) => warehouse.is_default)?.name || warehouses[0]?.name || '';

interface AdditionalVariant {
  id: string;
  size: string;
  price?: number;
  stock?: number;
}

const serializeDraft = (productData: Partial<Product>, additionalVariants: AdditionalVariant[]) => JSON.stringify({
  ...productData,
  imageDataUrl: undefined,
  imageFile: undefined,
  additionalVariants,
});

const createEmptyDraft = (warehouses: Warehouse[]): Partial<Product> => ({
  id: createDraftId(),
  name: '',
  brand: '',
  sku: '',
  size: '',
  price: undefined,
  stock: undefined,
  status: 'instock',
  location: '',
  warehouse: getInitialWarehouseName(warehouses),
  source: '',
  imageUrl: '',
  imageDataUrl: '',
});

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData,
  warehouses,
  userId,
}) => {
  const [productData, setProductData] = useState<Partial<Product>>(createEmptyDraft(warehouses));
  const [additionalVariants, setAdditionalVariants] = useState<AdditionalVariant[]>([]);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [showSkuSuggestions, setShowSkuSuggestions] = useState(false);
  const [skuSuggestions, setSkuSuggestions] = useState<Product[]>([]);
  const [skuSuggestionsLoading, setSkuSuggestionsLoading] = useState(false);
  const [skuSuggestionsError, setSkuSuggestionsError] = useState('');
  const latestSuggestionRequest = useRef(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const skuInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef('');
  const draftHydratedRef = useRef(false);
  const photoRequestIdRef = useRef(0);

  const replacePhotoPreviewUrl = (next: string) => {
    if (photoPreviewUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = next;
    setPhotoPreviewUrl(next);
  };

  useEffect(() => () => {
    if (photoPreviewUrlRef.current.startsWith('blob:')) URL.revokeObjectURL(photoPreviewUrlRef.current);
  }, []);

  useEffect(() => {
    if (isOpen) return;
    photoRequestIdRef.current += 1;
    setSelectedImageFile(null);
    setPhotoProcessing(false);
    replacePhotoPreviewUrl('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    if (initialData) {
      draftHydratedRef.current = true;
      setProductData({
        ...initialData,
        source: initialData.source || '',
        imageDataUrl: '',
      });
      setSelectedImageFile(null);
      replacePhotoPreviewUrl('');
      setAdditionalVariants([]);
      return;
    }

    draftHydratedRef.current = false;
    let isMounted = true;
    const loadDraft = async () => {
      try {
        await Preferences.remove({ key: DRAFT_KEY });
        const { value } = await Preferences.get({ key: getDraftKey(userId) });
        if (!isMounted) return;
        if (value) {
          const parsed = JSON.parse(value);
          const restoredVariants = Array.isArray(parsed.additionalVariants) ? parsed.additionalVariants : [];
          delete parsed.additionalVariants;
          setProductData({
            ...createEmptyDraft(warehouses),
            ...parsed,
            warehouse: warehouses.some((warehouse) => warehouse.name === parsed.warehouse)
              ? parsed.warehouse
              : getInitialWarehouseName(warehouses),
          });
          setAdditionalVariants(restoredVariants);
          try {
            const persistedPhotoDraftId = parsed.imageDraftId || parsed.id;
            const restoredPhoto = await loadProductPhotoDraft(userId, persistedPhotoDraftId);
            if (!isMounted) return;
            if (restoredPhoto) {
              setSelectedImageFile(restoredPhoto);
              replacePhotoPreviewUrl(URL.createObjectURL(restoredPhoto));
            } else {
              setSelectedImageFile(null);
              replacePhotoPreviewUrl('');
            }
            pruneProductPhotoDrafts(userId, persistedPhotoDraftId ? [persistedPhotoDraftId] : []).catch(() => {});
          } catch (photoError) {
            console.warn('Failed to restore the saved photo draft.', photoError);
            setSelectedImageFile(null);
            replacePhotoPreviewUrl('');
          }
          draftHydratedRef.current = true;
          return;
        }
      } catch (error) {
        console.error('Failed to load draft', error);
      }

      if (isMounted) {
        setProductData(createEmptyDraft(warehouses));
        setAdditionalVariants([]);
        replacePhotoPreviewUrl('');
        draftHydratedRef.current = true;
      }
    };

    loadDraft();
    setSelectedImageFile(null);

    return () => {
      isMounted = false;
    };
  }, [isOpen, initialData, userId, warehouses]);

  useEffect(() => {
    if (!isOpen || initialData || !draftHydratedRef.current) return;

    Preferences.set({
      key: getDraftKey(userId),
      value: serializeDraft(productData, additionalVariants),
    }).catch((error) => {
      console.warn('Failed to save draft', error);
    });
  }, [additionalVariants, initialData, isOpen, productData, userId]);

  useEffect(() => {
    if (!isOpen || initialData || !draftHydratedRef.current) return;

    const persistDraft = () => {
      Preferences.set({
        key: getDraftKey(userId),
        value: serializeDraft(productData, additionalVariants),
      }).catch(() => {});
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        persistDraft();
      }
    };

    window.addEventListener('beforeunload', persistDraft);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', persistDraft);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [additionalVariants, initialData, isOpen, productData, userId]);

  useEffect(() => {
    if (!isOpen || initialData) {
      latestSuggestionRequest.current += 1;
      setSkuSuggestions([]);
      setSkuSuggestionsLoading(false);
      setSkuSuggestionsError('');
      return;
    }
    const prefix = normalizeSku(productData.sku || '');
    const requestId = ++latestSuggestionRequest.current;
    if (prefix.length < 2) {
      setSkuSuggestions([]);
      setSkuSuggestionsLoading(false);
      setSkuSuggestionsError('');
      return;
    }

    setSkuSuggestionsLoading(true);
    setSkuSuggestionsError('');
    const timer = window.setTimeout(() => {
      suggestInventorySkus(userId, prefix, 5)
        .then((products) => {
          if (requestId !== latestSuggestionRequest.current) return;
          setSkuSuggestions(products);
        })
        .catch((error) => {
          if (requestId !== latestSuggestionRequest.current) return;
          setSkuSuggestions([]);
          setSkuSuggestionsError(error instanceof Error ? error.message : '货号联想加载失败');
        })
        .finally(() => {
          if (requestId === latestSuggestionRequest.current) setSkuSuggestionsLoading(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [initialData, isOpen, productData.sku, userId]);

  const previewImage = photoPreviewUrl || productData.imageUrl;

  const updateProductData = (updates: Partial<Product>) => {
    setProductData((prev) => ({ ...prev, ...updates }));
  };

  const handleSelectSuggestion = (product: Product) => {
    updateProductData({
      sku: product.sku,
      name: productData.name || product.name,
      brand: productData.brand || product.brand,
      imageUrl: selectedImageFile ? productData.imageUrl : (productData.imageUrl || product.imageUrl),
      imageStorageRef: selectedImageFile ? productData.imageStorageRef : (productData.imageStorageRef || product.imageStorageRef),
      previousImageStorageRef: product.imageStorageRef || productData.previousImageStorageRef,
    });
    setShowSkuSuggestions(false);
  };

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const requestId = ++photoRequestIdRef.current;

    try {
      setPhotoProcessing(true);
      const preparedFile = await prepareProductImage(file);
      const photoDraftId = productData.imageDraftId || productData.id || createDraftId();
      if (!initialData) await saveProductPhotoDraft(userId, photoDraftId, preparedFile);
      if (requestId !== photoRequestIdRef.current) return;
      setSelectedImageFile(preparedFile);
      replacePhotoPreviewUrl(URL.createObjectURL(preparedFile));
      updateProductData({
        imageDataUrl: '',
        imageDraftId: initialData ? undefined : photoDraftId,
        previousImageStorageRef: productData.imageStorageRef || productData.previousImageStorageRef,
      });
    } catch (error) {
      console.error('Failed to prepare photo', error);
      alert(error instanceof Error ? error.message : '读取照片失败，请重试。');
    } finally {
      if (requestId === photoRequestIdRef.current) setPhotoProcessing(false);
      event.target.value = '';
    }
  };

  const handleSave = async () => {
    if (initialData) {
      const name = String(productData.name || '').trim();
      const brand = String(productData.brand || '').trim();
      if (!name) {
        alert('请先填写必填项：商品名称');
        return;
      }
      if (!brand) {
        alert('请先填写必填项：品牌');
        return;
      }
      const editedProduct: Product = {
        ...initialData,
        name,
        brand: normalizeBrand(brand),
        location: String(productData.location || '').trim(),
        source: String(productData.source || '').trim(),
        imageUrl: productData.imageUrl || initialData.imageUrl || '',
        imageStorageRef: productData.imageStorageRef || initialData.imageStorageRef,
        imageDataUrl: productData.imageDataUrl || '',
        imageFile: selectedImageFile || undefined,
        previousImageStorageRef: productData.previousImageStorageRef || initialData.imageStorageRef,
      };
      try {
        await onSave(editedProduct);
      } catch (error) {
        console.error('Metadata save operation failed', error);
      }
      return;
    }

    if (warehouses.length === 0) {
      alert('请先关闭窗口，在库存页点击右上角加号创建仓库。');
      return;
    }

    const requiredFields: Array<[string, unknown]> = [
      ['货号', productData.sku],
      ['商品名称', productData.name],
      ['品牌', productData.brand],
      ['尺码', productData.size],
      ['成本', productData.price],
      ['库存', productData.stock],
      ['所属仓库', productData.warehouse],
    ];

    const missingField = requiredFields.find(([, value]) => value === undefined || value === null || value === '');
    if (missingField) {
      alert(`请先填写必填项：${missingField[0]}`);
      return;
    }

    if (!warehouses.some((warehouse) => warehouse.name === productData.warehouse)) {
      alert('所选仓库已不存在，请重新选择有效仓库');
      return;
    }

    const cost = Number(productData.price);
    if (!Number.isFinite(cost) || cost < 0) {
      alert('成本必须是大于或等于 0 的有效数字');
      return;
    }

    const stock = Number(productData.stock);
    if (!Number.isInteger(stock) || stock <= 0) {
      alert('入库数量必须是大于 0 的整数');
      return;
    }

    const variantRows = [
      { size: String(productData.size || ''), price: cost, stock },
      ...additionalVariants,
    ];
    for (let index = 0; index < variantRows.length; index += 1) {
      const variant = variantRows[index];
      if (!String(variant.size || '').trim()) {
        alert(`请填写第 ${index + 1} 行的尺码`);
        return;
      }
      if (!Number.isFinite(Number(variant.price)) || Number(variant.price) < 0) {
        alert(`第 ${index + 1} 行的成本必须是大于或等于 0 的有效数字`);
        return;
      }
      if (!Number.isInteger(Number(variant.stock)) || Number(variant.stock) <= 0) {
        alert(`第 ${index + 1} 行的库存必须是大于 0 的整数`);
        return;
      }
    }

    const normalizedSizes = variantRows.map((variant) => normalizeSize(variant.size));
    if (new Set(normalizedSizes).size !== normalizedSizes.length) {
      alert('同一批次中不能重复填写相同尺码');
      return;
    }

    const productId = initialData?.id || productData.id || createDraftId();
    const product: Product = {
      id: productId,
      name: String(productData.name || '').trim() || normalizeSku(productData.sku),
      brand: normalizeBrand(productData.brand),
      size: normalizeSize(productData.size),
      sku: normalizeSku(productData.sku),
      price: cost,
      stock,
      imageUrl: productData.imageUrl || '',
      imageStorageRef: productData.imageStorageRef,
      imageDataUrl: productData.imageDataUrl || '',
      imageFile: selectedImageFile || undefined,
      imageDraftId: productData.imageDraftId,
      previousImageStorageRef: productData.previousImageStorageRef,
      status: productData.status || 'instock',
      location: productData.location || '待分配',
      warehouse: productData.warehouse || '',
      source: productData.source || '',
    };

    const batchProducts = variantRows.map((variant, index) => ({
      ...product,
      id: index === 0 ? productId : `${productId}-${index}`,
      size: normalizeSize(variant.size),
      price: Number(variant.price),
      stock: Number(variant.stock),
      imageFile: index === 0 ? product.imageFile : undefined,
      imageDataUrl: index === 0 ? product.imageDataUrl : '',
    }));

    try {
      await onSave(initialData ? product : batchProducts);
      await deleteProductPhotoDraft(userId, productData.imageDraftId || productData.id).catch((error) => {
        console.warn('Saved product but failed to remove the local photo draft.', error);
      });
      await Preferences.remove({ key: getDraftKey(userId) });
    } catch (error) {
      console.error('Save operation failed', error);
    }
  };

  const handleDelete = () => {
    if (initialData?.id && onDelete) {
      if (confirm('确定要将这个商品移入回收站吗？之后可以恢复。')) {
        onDelete(initialData.id);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="app-task-shell animate-[fadeIn_0.2s_ease-out]">
      <div className="app-task-panel">
        <div className="app-task-header">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{initialData ? '编辑商品资料' : '新增库存商品'}</h2>
            {!initialData && (
              <p className="mt-0.5 text-xs text-slate-500">草稿会在切换 App 或离开页面时自动保存</p>
            )}
          </div>
          <button onClick={onClose} className="app-icon-button border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="关闭入库">
            <X size={20} />
          </button>
        </div>

        <div className="app-task-body flex flex-col gap-4">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={handlePhotoChange}
          />

          <div className="order-[20] rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-700">商品主图 <span className="font-normal text-slate-400">选填</span></div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{initialData ? '名称、品牌和主图同步到同货号全部尺码；库位与来源仅修改当前仓库变体。' : '支持 JPEG、PNG、WebP；照片会压缩并随草稿恢复。'}</div>
              </div>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoProcessing}
                className="app-touch flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white active:scale-95 disabled:opacity-50"
              >
                <Camera size={16} />
                {photoProcessing ? '处理中' : '拍照'}
              </button>
            </div>
            {previewImage ? (
              <div className="relative mt-3 w-24">
                <img src={previewImage} alt="商品预览" className="h-20 w-24 rounded-lg bg-slate-200 object-cover" />
                {photoPreviewUrl && (
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                    已压缩 · 草稿可恢复
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedImageFile(null);
                    replacePhotoPreviewUrl('');
                    deleteProductPhotoDraft(userId, productData.imageDraftId || productData.id).catch(() => {});
                    updateProductData({
                      imageDataUrl: '',
                      imageDraftId: undefined,
                      imageStorageRef: productData.previousImageStorageRef || productData.imageStorageRef,
                      previousImageStorageRef: undefined,
                    });
                  }}
                  className="app-icon-button absolute -right-3 -top-3 h-10 min-h-10 w-10 min-w-10 border-0 bg-black/60 text-white"
                  aria-label="移除商品图片"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-400">暂未添加图片</p>
            )}
          </div>

          {initialData ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold text-slate-700">库存变体身份</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div><div className="text-slate-400">货号</div><div className="mt-0.5 truncate font-medium text-slate-700">{initialData.sku}</div></div>
                <div><div className="text-slate-400">尺码</div><div className="mt-0.5 font-medium text-slate-700">{formatProductSize(initialData.size)}</div></div>
                <div><div className="text-slate-400">仓库</div><div className="mt-0.5 truncate font-medium text-slate-700">{initialData.warehouse || '—'}</div></div>
                <div><div className="text-slate-400">库存</div><div className="mt-0.5 font-medium text-slate-700">{initialData.stock}</div></div>
                <div><div className="text-slate-400">平均成本</div><div className="mt-0.5 font-medium text-slate-700">¥{initialData.price.toFixed(2)}</div></div>
              </div>
              <p className="mt-2 text-xs leading-5 text-amber-600">货号、尺码和仓库不可在资料编辑中修改；移动仓库请用调拨，库存和成本请用盘点调整。</p>
            </div>
          ) : <div className="relative">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              货号 <span className="text-rose-500">必填</span>
            </label>
            <input
              ref={skuInputRef}
              type="text"
              className="app-form-control uppercase"
              placeholder="DD1391-100"
              value={productData.sku}
              onFocus={() => setShowSkuSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSkuSuggestions(false), 120)}
              onChange={(event) => {
                updateProductData({ sku: event.target.value.toUpperCase() });
                setShowSkuSuggestions(true);
              }}
            />
            <div className="mt-1 text-xs text-slate-500">输入后仅联想当前账号库存中已有的货号，最多 5 条。</div>
            {showSkuSuggestions && (skuSuggestionsLoading || skuSuggestionsError || skuSuggestions.length > 0) && (
              <div className="absolute z-10 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                {skuSuggestionsLoading && <div className="px-3 py-2.5 text-[11px] text-slate-400">正在查询已有货号...</div>}
                {!skuSuggestionsLoading && skuSuggestionsError && <div className="px-3 py-2.5 text-[11px] text-rose-500">联想失败，可继续手动填写</div>}
                {skuSuggestions.map((product) => (
                  <button
                    type="button"
                    key={product.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleSelectSuggestion(product)}
                    className="w-full px-3 py-2.5 text-left hover:bg-slate-50 transition-colors border-b last:border-b-0 border-slate-100"
                  >
                    <div className="text-sm font-medium text-slate-800">{product.sku}</div>
                    <div className="text-[11px] text-slate-400">{product.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              商品名称 <span className="text-rose-500">必填</span>
            </label>
            <input
              type="text"
              className="app-form-control"
              placeholder="例如: Nike Dunk Low Panda"
              value={productData.name}
              onChange={(event) => updateProductData({ name: event.target.value })}
            />
          </div>

          <div className={`grid gap-4 ${initialData ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!initialData && <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                所属仓库 <span className="text-rose-500">必填</span>
              </label>
              <select
                className="app-form-control"
                value={productData.warehouse}
                onChange={(event) => updateProductData({ warehouse: event.target.value })}
              >
                {warehouses.length === 0 && <option value="">请先创建仓库</option>}
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.name}>{warehouse.name}</option>
                ))}
              </select>
            </div>}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                放置位置 <span className="text-slate-400">选填</span>
              </label>
              <input
                type="text"
                className="app-form-control"
                placeholder="A-01"
                value={productData.location || ''}
                onChange={(event) => updateProductData({ location: event.target.value })}
              />
            </div>
          </div>

          {!initialData && (
            <div>
              <div className="mb-1 text-xs font-medium text-slate-500">入库状态 <span className="text-rose-500">必填</span></div>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-1.5">
                <button type="button" onClick={() => updateProductData({ status: 'instock' })} className={`app-touch flex items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors ${productData.status !== 'shipping' ? 'bg-white text-dewu-600 shadow-sm' : 'text-slate-500'}`}><PackageCheck size={14} />直接入仓</button>
                <button type="button" onClick={() => updateProductData({ status: 'shipping' })} className={`app-touch flex items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors ${productData.status === 'shipping' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500'}`}><Truck size={14} />采购运输中</button>
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">{productData.status === 'shipping' ? '运输中商品不计入可售库存，收货后需在首页“采购运输中”确认到仓。' : '直接入仓后立即计入可售库存。'}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              来源备注 <span className="text-slate-400">选填</span>
            </label>
            <input
              type="text"
              className="app-form-control"
              placeholder="例如：得物自有、线下档口、同行调货"
              value={productData.source || ''}
              onChange={(event) => updateProductData({ source: event.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              品牌 <span className="text-rose-500">必填</span>
            </label>
            <input
              type="text"
              className="app-form-control"
              placeholder="Nike"
              value={productData.brand}
              onChange={(event) => updateProductData({ brand: event.target.value })}
            />
          </div>

          {!initialData && <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                尺码 <span className="text-rose-500">必填</span>
              </label>
              <input
                type="text"
                className="app-form-control"
                placeholder="42"
                value={productData.size}
                onChange={(event) => updateProductData({ size: event.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                成本 (¥) <span className="text-rose-500">必填</span>
              </label>
              <input
                type="number"
                className="app-form-control"
                placeholder="0.00"
                value={productData.price ?? ''}
                onChange={(event) => updateProductData({ price: event.target.value === '' ? undefined : parseFloat(event.target.value) })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                库存 <span className="text-rose-500">必填</span>
              </label>
              <input
                type="number"
                className="app-form-control"
                placeholder="0"
                value={productData.stock ?? ''}
                onChange={(event) => updateProductData({ stock: event.target.value === '' ? undefined : parseInt(event.target.value, 10) })}
              />
            </div>
          </div>}

          {!initialData && (
            <div className="space-y-2">
              {additionalVariants.map((variant, index) => (
                <div key={variant.id} className="grid grid-cols-[1fr_1fr_1fr_36px] items-center gap-2 rounded-xl bg-slate-50 p-2">
                  <input
                    type="text"
                    aria-label={`第 ${index + 2} 行尺码`}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-dewu-500 focus:outline-none"
                    placeholder="尺码"
                    value={variant.size}
                    onChange={(event) => setAdditionalVariants((rows) => rows.map((row) => row.id === variant.id ? { ...row, size: event.target.value } : row))}
                  />
                  <input
                    type="number"
                    aria-label={`第 ${index + 2} 行成本`}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-dewu-500 focus:outline-none"
                    placeholder="成本"
                    value={variant.price ?? ''}
                    onChange={(event) => setAdditionalVariants((rows) => rows.map((row) => row.id === variant.id ? { ...row, price: event.target.value === '' ? undefined : Number(event.target.value) } : row))}
                  />
                  <input
                    type="number"
                    aria-label={`第 ${index + 2} 行库存`}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-dewu-500 focus:outline-none"
                    placeholder="数量"
                    value={variant.stock ?? ''}
                    onChange={(event) => setAdditionalVariants((rows) => rows.map((row) => row.id === variant.id ? { ...row, stock: event.target.value === '' ? undefined : Number(event.target.value) } : row))}
                  />
                  <button
                    type="button"
                    onClick={() => setAdditionalVariants((rows) => rows.filter((row) => row.id !== variant.id))}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-red-500"
                    title="移除此尺码"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setAdditionalVariants((rows) => [...rows, { id: `${Date.now()}-${rows.length}`, size: '', price: productData.price, stock: 1 }])}
                disabled={additionalVariants.length >= 11}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 disabled:opacity-40"
              >
                <Plus size={15} />
                {additionalVariants.length >= 11 ? '单次最多 12 个尺码' : '添加尺码'}
              </button>
            </div>
          )}

          <div className="order-[30] sticky bottom-0 z-20 -mx-4 -mb-4 mt-2 flex space-x-3 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
            {initialData && (
              <button
                onClick={handleDelete}
                className="app-icon-button border-red-100 bg-red-50 text-red-500 active:scale-95"
                aria-label="移入回收站"
              >
                <Trash2 size={20} />
              </button>
            )}

            <button
              onClick={handleSave}
              disabled={photoProcessing}
              className="app-primary-action flex-1 space-x-2 bg-blue-600 active:scale-[0.99]"
            >
              <Save size={18} />
              <span>{initialData ? '保存修改' : additionalVariants.length > 0 ? `批量入库 ${additionalVariants.length + 1} 个尺码` : '保存入库'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
