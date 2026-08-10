import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Plus, Save, Trash2, X } from 'lucide-react';
import { Preferences } from '@capacitor/preferences';
import { Product, Warehouse } from '../types';
import { formatProductSize, normalizeBrand, normalizeSize, normalizeSku } from '../lib/productNormalization';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (product: Product | Product[]) => Promise<void> | void;
  onDelete?: (productId: string) => void;
  initialData?: Product | null;
  warehouses: Warehouse[];
  existingProducts: Product[];
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
  const [productData, setProductData] = useState<Partial<Product>>(createEmptyDraft(warehouses));
  const [additionalVariants, setAdditionalVariants] = useState<AdditionalVariant[]>([]);
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
      setAdditionalVariants([]);
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
          return;
        }
      } catch (error) {
        console.error('Failed to load draft', error);
      }

      if (isMounted) {
        setProductData(createEmptyDraft(warehouses));
        setAdditionalVariants([]);
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
      value: serializeDraft(productData, additionalVariants),
    }).catch((error) => {
      console.warn('Failed to save draft', error);
    });
  }, [additionalVariants, initialData, isOpen, productData, userId]);

  useEffect(() => {
    if (!isOpen || initialData) return;

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
      imageStorageRef: productData.imageDataUrl ? productData.imageStorageRef : (productData.imageStorageRef || product.imageStorageRef),
    });
    setShowSkuSuggestions(false);
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
        imageStorageRef: undefined,
      });
    } catch (error) {
      console.error('Failed to read photo', error);
      alert('读取照片失败，请重试。');
    } finally {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{initialData ? '编辑商品资料' : '新增库存商品'}</h2>
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
                <div className="text-[11px] text-slate-400 mt-1">{initialData ? '名称、品牌和主图同步到同货号全部尺码；库位与来源仅修改当前仓库变体。' : '可直接拍照。若同货号已存在，最后一次拍摄的图片会覆盖为该商品主图。'}</div>
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
              <p className="mt-2 text-[10px] leading-4 text-amber-600">货号、尺码和仓库不可在资料编辑中修改；移动仓库请用调拨，库存和成本请用盘点调整。</p>
            </div>
          ) : <div className="relative">
            <label className="block text-xs font-medium text-slate-500 mb-1">
              货号 <span className="text-rose-500">必填</span>
            </label>
            <input
              ref={skuInputRef}
              type="text"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors uppercase"
              placeholder="DD1391-100"
              value={productData.sku}
              onFocus={() => setShowSkuSuggestions(true)}
              onBlur={() => window.setTimeout(() => setShowSkuSuggestions(false), 120)}
              onChange={(event) => {
                updateProductData({ sku: event.target.value.toUpperCase() });
                setShowSkuSuggestions(true);
              }}
            />
            <div className="mt-1 text-[11px] text-slate-400">输入后仅联想当前账号库存中已有的货号，最多显示 5 条。</div>
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
          </div>}

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

          <div className={`grid gap-4 ${initialData ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!initialData && <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                所属仓库 <span className="text-rose-500">必填</span>
              </label>
              <select
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-dewu-500 transition-colors"
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

          {!initialData && <div className="grid grid-cols-3 gap-3">
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
              <span>{initialData ? '保存修改' : additionalVariants.length > 0 ? `批量入库 ${additionalVariants.length + 1} 个尺码` : '保存入库'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
