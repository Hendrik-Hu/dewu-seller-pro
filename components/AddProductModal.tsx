import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Loader2, Save, Sparkles, Trash2, X } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import { Product, Warehouse } from '../types';
import { supabase } from '../lib/supabase';
import { normalizeBrand, normalizeSize, normalizeSku } from '../lib/productNormalization';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product) => Promise<void> | void;
  onDelete?: (productId: string) => void;
  initialData?: Product | null;
  warehouses: Warehouse[];
  existingProducts: Product[];
  userId: string;
}

const DRAFT_KEY = 'addProductDraftV2';
const getDraftKey = (userId: string) => `${DRAFT_KEY}:${userId}`;

const serializeDraft = (productData: Partial<Product>) => JSON.stringify({
  ...productData,
  imageDataUrl: undefined,
  imageFile: undefined,
});

const createEmptyDraft = (warehouses: Warehouse[]): Partial<Product> => ({
  name: '',
  brand: '',
  sku: '',
  size: '',
  price: undefined,
  stock: undefined,
  status: 'instock',
  location: '',
  warehouse: warehouses[0]?.name || '杭州一号仓',
  source: '',
  imageUrl: '',
  imageDataUrl: '',
});

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData,
  warehouses,
  existingProducts,
  userId,
}) => {
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [productData, setProductData] = useState<Partial<Product>>(createEmptyDraft(warehouses));
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [showSkuSuggestions, setShowSkuSuggestions] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const skuInputRef = useRef<HTMLInputElement>(null);
  const deferredSku = useDeferredValue((productData.sku || '').trim().toUpperCase());

  useEffect(() => {
    if (!isOpen) return;

    if (initialData) {
      setProductData({
        ...initialData,
        source: initialData.source || '',
        imageDataUrl: '',
      });
      setSelectedImageFile(null);
      return;
    }

    let isMounted = true;
    const loadDraft = async () => {
      try {
        await Preferences.remove({ key: DRAFT_KEY });
        const { value } = await Preferences.get({ key: getDraftKey(userId) });
        if (!isMounted) return;
        if (value) {
          const parsed = JSON.parse(value);
          setProductData({
            ...createEmptyDraft(warehouses),
            ...parsed,
            warehouse: parsed.warehouse || warehouses[0]?.name || '杭州一号仓',
          });
          return;
        }
      } catch (error) {
        console.error('Failed to load draft', error);
      }

      if (isMounted) {
        setProductData(createEmptyDraft(warehouses));
      }
    };

    loadDraft();
    setSelectedImageFile(null);

    return () => {
      isMounted = false;
    };
  }, [isOpen, initialData, userId, warehouses]);

  useEffect(() => {
    if (!isOpen || initialData) return;

    Preferences.set({
      key: getDraftKey(userId),
      value: serializeDraft(productData),
    }).catch((error) => {
      console.warn('Failed to save draft', error);
    });
  }, [initialData, isOpen, productData, userId]);

  useEffect(() => {
    if (!isOpen || initialData) return;

    const persistDraft = () => {
      Preferences.set({
        key: getDraftKey(userId),
        value: serializeDraft(productData),
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
  }, [initialData, isOpen, productData, userId]);

  const skuSuggestions = useMemo(() => {
    if (!deferredSku) return [];

    const uniqueProducts = new Map<string, Product>();
    existingProducts.forEach((product) => {
      const key = product.sku.toUpperCase();
      if (!key.startsWith(deferredSku)) return;
      if (!uniqueProducts.has(key)) {
        uniqueProducts.set(key, product);
      }
    });

    return Array.from(uniqueProducts.values()).slice(0, 5);
  }, [deferredSku, existingProducts]);

  const previewImage = productData.imageDataUrl || productData.imageUrl;

  const updateProductData = (updates: Partial<Product>) => {
    setProductData((prev) => ({ ...prev, ...updates }));
  };

  const handleSelectSuggestion = (product: Product) => {
    updateProductData({
      sku: product.sku,
      name: productData.name || product.name,
      brand: productData.brand || product.brand,
      imageUrl: productData.imageDataUrl ? productData.imageUrl : (productData.imageUrl || product.imageUrl),
    });
    setShowSkuSuggestions(false);
  };

  const handleSmartLookup = async () => {
    if (!productData.sku) {
      alert('请先输入货号');
      return;
    }

    setIsLookingUp(true);

    try {
      const { data, error } = await supabase.functions.invoke('lookup-sku', {
        body: { sku: productData.sku },
      });

      if (error) {
        console.warn('Backend function not found, falling back to mock logic.', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        if (productData.sku.toUpperCase().includes('DD1391')) {
          updateProductData({
            name: 'Nike Dunk Low Black White (Panda)',
            brand: 'Nike',
            imageUrl: 'https://images.stockx.com/images/Nike-Dunk-Low-Retro-White-Black-2021-Product.jpg?fit=fill&bg=FFFFFF&w=700&h=500&fm=webp&auto=compress&q=90&dpr=2&trim=color&updated_at=1633027409',
            price: 749,
          });
        } else {
          alert('未找到该货号信息，请手动输入。');
        }
      } else if (data && data.found) {
        updateProductData({
          name: data.name,
          brand: data.brand,
          imageUrl: productData.imageDataUrl || data.imageUrl,
          price: data.price !== undefined ? data.price : productData.price,
          size: data.size !== undefined ? data.size : productData.size,
        });
      } else {
        alert('未找到该商品信息');
      }
    } catch (error) {
      console.error(error);
      alert('识别失败');
    } finally {
      setIsLookingUp(false);
    }
  };

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setSelectedImageFile(file);
      updateProductData({
        imageDataUrl: dataUrl,
        imageUrl: '',
      });
    } catch (error) {
      console.error('Failed to read photo', error);
      alert('读取照片失败，请重试。');
    } finally {
      event.target.value = '';
    }
  };

  const handleSave = async () => {
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

    const product: Product = {
      id: initialData?.id || Date.now().toString(),
      name: String(productData.name || '').trim() || normalizeSku(productData.sku),
      brand: normalizeBrand(productData.brand),
      size: normalizeSize(productData.size),
      sku: normalizeSku(productData.sku),
      price: cost,
      stock,
      imageUrl: productData.imageUrl || '',
      imageDataUrl: productData.imageDataUrl || '',
      imageFile: selectedImageFile || undefined,
      status: productData.status || 'instock',
      location: productData.location || '待分配',
      warehouse: productData.warehouse || '杭州一号仓',
      source: productData.source || '',
    };

    try {
      await onSave(product);
      await Preferences.remove({ key: getDraftKey(userId) });
    } catch (error) {
      console.error('Save operation failed', error);
    }
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
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{initialData ? '编辑库存商品' : '新增库存商品'}</h2>
            {!initialData && (
              <p className="text-[11px] text-slate-400 mt-0.5">草稿会在切换 App 或离开页面时自动保存</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoChange}
          />

          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-700">商品主图 <span className="text-slate-400 font-normal">选填</span></div>
                <div className="text-[11px] text-slate-400 mt-1">可直接拍照。若同货号已存在，最后一次拍摄的图片会覆盖为该商品主图。</div>
              </div>
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="shrink-0 flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white active:scale-95 transition-transform"
              >
                <Camera size={16} />
                拍照
              </button>
            </div>
            {previewImage ? (
              <div className="mt-3 relative">
                <img src={previewImage} alt="商品预览" className="h-32 w-full rounded-xl object-cover bg-slate-200" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedImageFile(null);
                    updateProductData({ imageDataUrl: '', imageUrl: '' });
                  }}
                  className="absolute top-2 right-2 rounded-full bg-black/55 p-1 text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="mt-3 h-24 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-xs text-slate-400">
                暂无商品图片
              </div>
            )}
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              货号 <span className="text-rose-500">必填</span>
            </label>
            <div className="flex space-x-2">
              <input
                ref={skuInputRef}
                type="text"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors uppercase"
                placeholder="DD1391-100"
                value={productData.sku}
                onFocus={() => setShowSkuSuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowSkuSuggestions(false), 120)}
                onChange={(event) => {
                  updateProductData({ sku: event.target.value.toUpperCase() });
                  setShowSkuSuggestions(true);
                }}
              />
              <button
                onClick={handleSmartLookup}
                disabled={isLookingUp || !productData.sku}
                className="bg-indigo-600 text-white px-3 rounded-lg flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all shadow-sm shadow-indigo-200"
              >
                {isLookingUp ? <Loader2 size={18} className="animate-spin" /> : <Sparkles size={18} />}
              </button>
            </div>
            {showSkuSuggestions && skuSuggestions.length > 0 && (
              <div className="absolute z-10 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
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
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              商品名称 <span className="text-rose-500">必填</span>
            </label>
            <input
              type="text"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
              placeholder="例如: Nike Dunk Low Panda"
              value={productData.name}
              onChange={(event) => updateProductData({ name: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                所属仓库 <span className="text-rose-500">必填</span>
              </label>
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                value={productData.warehouse}
                onChange={(event) => updateProductData({ warehouse: event.target.value })}
              >
                {warehouses.map((warehouse) => (
                  <option key={warehouse.id} value={warehouse.name}>{warehouse.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                放置位置 <span className="text-slate-400">选填</span>
              </label>
              <input
                type="text"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="A-01"
                value={productData.location || ''}
                onChange={(event) => updateProductData({ location: event.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              来源备注 <span className="text-slate-400">选填</span>
            </label>
            <input
              type="text"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
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
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
              placeholder="Nike"
              value={productData.brand}
              onChange={(event) => updateProductData({ brand: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                尺码 <span className="text-rose-500">必填</span>
              </label>
              <input
                type="text"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
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
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
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
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
                placeholder="0"
                value={productData.stock ?? ''}
                onChange={(event) => updateProductData({ stock: event.target.value === '' ? undefined : parseInt(event.target.value, 10) })}
              />
            </div>
          </div>

          <div className="mt-4 flex space-x-3">
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
