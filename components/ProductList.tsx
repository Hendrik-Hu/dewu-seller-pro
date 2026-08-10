import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ArrowRightLeft, Search, Plus, Boxes, CircleDollarSign, Warehouse as WarehouseIcon, ChevronDown, ChevronLeft, ChevronRight, Check, MapPin, Trash2, Edit, X, Loader2, Star, CheckCircle2, Circle, Scale } from 'lucide-react';
import { Product, Warehouse } from '../types';
import { supabase } from '../lib/supabase';
import { listProducts, searchProductGroups } from '../services/products';
import { getInventoryWarehouseSummary } from '../services/analytics';
import { formatProductSize, normalizeSize, normalizeSku } from '../lib/productNormalization';
import { ProductImage } from './ProductImage';

interface ProductListProps {
  userId: string;
  onAddClick: () => void;
  onEditProduct: (product: Product) => void;
  onAdjustProduct: (product: Product) => void;
  onTransferProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  onBatchDeleteProducts: (productIds: string[]) => Promise<void>;
  warehouses: Warehouse[];
  warehousesReady: boolean;
  warehousesError?: string;
  onRetryWarehouses: () => void;
  onRenameWarehouse: (id: string, oldName: string, newName: string) => Promise<void>;
  onSetDefaultWarehouse: (id: string) => Promise<void>;
  onAddWarehouse: (name: string) => Promise<Warehouse>;
  onDeleteWarehouse: (id: string) => Promise<void>;
  refreshTrigger: number;
}

const ITEMS_PER_PAGE = 50;

interface AggregatedSizeRow {
  key: string;
  size: string;
  stock: number;
  averageCost: number;
  sourceCount: number;
  primaryProduct: Product;
  variants: Product[];
}

interface AggregatedProductGroup {
  key: string;
  sku: string;
  name: string;
  brand: string;
  imageUrl: string;
  totalStock: number;
  sizeRows: AggregatedSizeRow[];
}

export const ProductList: React.FC<ProductListProps> = ({ userId, onAddClick, onEditProduct, onAdjustProduct, onTransferProduct, onDeleteProduct, onBatchDeleteProducts, warehouses, warehousesReady, warehousesError, onRetryWarehouses, onRenameWarehouse, onSetDefaultWarehouse, onAddWarehouse, onDeleteWarehouse, refreshTrigger }) => {
  const MAX_WAREHOUSES = 6;
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  
  const [filter, setFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Initialize with default warehouse or first one
  const [currentWarehouse, setCurrentWarehouse] = useState(() => {
    const defaultWh = warehouses.find(w => w.is_default);
    return defaultWh?.name || warehouses[0]?.name || '';
  });

  const [showWarehouseMenu, setShowWarehouseMenu] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  const [addingWarehouseName, setAddingWarehouseName] = useState('');
  const [showAddWarehouseForm, setShowAddWarehouseForm] = useState(false);
  const [isAddingWarehouse, setIsAddingWarehouse] = useState(false);
  
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [searchInventoryStock, setSearchInventoryStock] = useState(0);
  const [loadError, setLoadError] = useState('');
  const [retryNonce, setRetryNonce] = useState(0);
  const latestRequest = useRef(0);
  const latestStatsRequest = useRef(0);
  const [aggregatedActionVariants, setAggregatedActionVariants] = useState<Product[] | null>(null);
  
  // Update current warehouse if default changes or initial load
  useEffect(() => {
    if (warehouses.length > 0) {
        // If currentWarehouse is not valid OR we just loaded warehouses, sync with default
        const defaultWh = warehouses.find(w => w.is_default);
        // If we don't have a valid current warehouse, OR if the default warehouse changed (and we want to reflect that)
        // But be careful not to override user manual selection if they just switched.
        // Simple logic: If currentWarehouse is not in the list, OR on first load (how to detect first load?)
        
        // Better logic: If currentWarehouse is just a fallback string (e.g. from state init) but now we have real data
        const currentExists = warehouses.some(w => w.name === currentWarehouse);
        
        if (!currentExists) {
             setCurrentWarehouse(defaultWh?.name || warehouses[0].name);
        } else {
             // Optional: if user hasn't manually selected, maybe we want to enforce default?
             // For now, let's stick to "if invalid, reset". 
             // But the issue user reported "no warehouse shown" suggests currentWarehouse might be empty or invalid?
        }
    } else {
      setCurrentWarehouse('');
      setProducts([]);
      setTotalCount(0);
    }
  }, [warehouses]);

  // Fetch Products from Backend
  const fetchProducts = async () => {
    if (!userId || !currentWarehouse) {
      latestRequest.current += 1;
      setProducts([]);
      setTotalCount(0);
      setSearchInventoryStock(0);
      setLoadError('');
      setIsLoading(false);
      return;
    }

    const requestId = ++latestRequest.current;
    setIsLoading(true);
    setLoadError('');
    try {
        const statusMap: Record<string, Product['status'] | undefined> = {
            all: undefined,
            '在售': 'instock',
            '运输中': 'shipping',
            '已售罄': 'sold',
            '瑕疵': 'flaw',
        };

        if (debouncedSearchQuery.trim()) {
          const matches = await searchProductGroups({
            warehouse: currentWarehouse,
            status: statusMap[filter] || undefined,
            search: debouncedSearchQuery,
            page: currentPage,
            pageSize: 20,
          });
          if (requestId !== latestRequest.current) return;
          setProducts(matches.products);
          setTotalCount(matches.groupCount);
          setSearchInventoryStock(matches.inventoryStock);
        } else {
          const page = await listProducts({
              userId,
              warehouse: currentWarehouse,
              status: statusMap[filter] || undefined,
              page: currentPage,
              pageSize: ITEMS_PER_PAGE,
          });
          if (requestId !== latestRequest.current) return;
          setProducts(page.products);
          setTotalCount(page.totalCount);
          setSearchInventoryStock(0);
        }
    } catch (error) {
        console.error('Error fetching products:', error);
        if (requestId === latestRequest.current) {
          setLoadError((error as any)?.message || '库存数据加载失败，请重试');
        }
    } finally {
        if (requestId === latestRequest.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    latestRequest.current += 1;
    setIsLoading(true);
    setLoadError('');
    const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  // Effect to trigger fetch
  useEffect(() => {
    fetchProducts();
  }, [userId, currentPage, currentWarehouse, filter, debouncedSearchQuery, refreshTrigger, retryNonce]);

  // Long press handling
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);
  const suppressClickUntil = useRef(0);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);

  const clearLongPressTimer = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, product: Product) => {
    if (isSelectionMode) return;
    if (activeProductId === product.id) return;

    clearLongPressTimer();
    isLongPress.current = false;
    longPressOrigin.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      suppressClickUntil.current = Date.now() + 1000;
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(50);
      }
      setActiveProductId(product.id);
    }, 600);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const origin = longPressOrigin.current;
    if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) {
      clearLongPressTimer();
    }
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    clearLongPressTimer();
    longPressOrigin.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resetSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedProductIds([]);
  };

  const enterSelectionMode = (productId: string) => {
    setIsSelectionMode(true);
    setSelectedProductIds([productId]);
    setActiveProductId(null);
  };

  const toggleProductSelection = (productId: string) => {
    setSelectedProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedProductIds.length === 0) {
      alert('请先勾选要移入回收站的商品');
      return;
    }

    const confirmed = window.confirm(`确定要将已勾选的 ${selectedProductIds.length} 个商品移入回收站吗？`);
    if (!confirmed) return;

    setIsBatchDeleting(true);
    try {
      await onBatchDeleteProducts(selectedProductIds);
      resetSelectionMode();
    } finally {
      setIsBatchDeleting(false);
    }
  };

  const handleWarehouseSelect = (name: string) => {
    setCurrentWarehouse(name);
    setShowWarehouseMenu(false);
    setShowAddWarehouseForm(false);
    setAddingWarehouseName('');
    setCurrentPage(1); // Reset page on warehouse change
  };

  const startEditingWarehouse = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    setEditingWarehouse(name);
    setNewWarehouseName(name);
  };

  const saveWarehouseName = async (e: React.MouseEvent | React.FormEvent, wh: Warehouse) => {
    e.stopPropagation();
    const trimmedName = newWarehouseName.trim();
    if (trimmedName && trimmedName !== wh.name) {
      try {
        await onRenameWarehouse(wh.id, wh.name, trimmedName);
        if (currentWarehouse === wh.name) setCurrentWarehouse(trimmedName);
      } catch {
        return;
      }
    }
    setEditingWarehouse(null);
  };

  const handleDeleteWarehouse = async (e: React.MouseEvent, warehouse: Warehouse) => {
    e.stopPropagation();
    if (!confirm(`确定删除空仓库“${warehouse.name}”吗？有库存时系统会阻止删除。`)) return;
    try {
      await onDeleteWarehouse(warehouse.id);
      setEditingWarehouse(null);
      if (currentWarehouse === warehouse.name) setCurrentWarehouse('');
      setShowWarehouseMenu(false);
    } catch (error: any) {
      alert(`删除仓库失败：${error?.message || '请稍后重试'}`);
    }
  };

  const handleAddWarehouse = async (e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    const trimmedName = addingWarehouseName.trim();
    if (!trimmedName || isAddingWarehouse) return;

    if (warehouses.length >= MAX_WAREHOUSES) {
      alert(`最多允许设置 ${MAX_WAREHOUSES} 个仓库`);
      return;
    }

    if (warehouses.some((warehouse) => warehouse.name === trimmedName)) {
      alert('该仓库名称已存在');
      return;
    }

    setIsAddingWarehouse(true);
    try {
      const created = await onAddWarehouse(trimmedName);
      setAddingWarehouseName('');
      setShowAddWarehouseForm(false);
      setCurrentWarehouse(created.name);
      setCurrentPage(1);
      setShowWarehouseMenu(false);
    } catch (error: any) {
      alert(`新增仓库失败：${error?.message || '请稍后重试'}`);
    } finally {
      setIsAddingWarehouse(false);
    }
  };

  const [inventoryStats, setInventoryStats] = useState({
    totalCount: 0,
    totalValue: 0,
    warehouseCount: 0,
    warehouseValue: 0,
  });
  const [inventoryStatsReady, setInventoryStatsReady] = useState(false);
  const [inventoryStatsWarehouse, setInventoryStatsWarehouse] = useState('');
  const [inventoryStatsError, setInventoryStatsError] = useState('');
  const [inventoryStatsRetry, setInventoryStatsRetry] = useState(0);

  useEffect(() => {
    const fetchStats = async () => {
        const requestId = ++latestStatsRequest.current;
        if (!userId || !currentWarehouse) {
          setInventoryStats({ totalCount: 0, totalValue: 0, warehouseCount: 0, warehouseValue: 0 });
          setInventoryStatsReady(false);
          setInventoryStatsError('');
          return;
        }

        setInventoryStatsError('');
        try {
          const nextStats = await getInventoryWarehouseSummary(currentWarehouse);
          if (requestId !== latestStatsRequest.current) return;
          setInventoryStats(nextStats);
          setInventoryStatsReady(true);
          setInventoryStatsWarehouse(currentWarehouse);
        } catch (error) {
          console.error('Warehouse summary fetch error:', error);
          if (requestId !== latestStatsRequest.current) return;
          setInventoryStatsError((error as any)?.message || '仓库摘要加载失败');
        }
    };
    void fetchStats();
  }, [userId, currentWarehouse, refreshTrigger, inventoryStatsRetry]);

  const trimmedSearchQuery = searchQuery.trim();
  const searchPending = trimmedSearchQuery !== debouncedSearchQuery;
  const hasCurrentInventoryStats = inventoryStatsReady && inventoryStatsWarehouse === currentWarehouse;
  const totalPages = Math.ceil(totalCount / (debouncedSearchQuery ? 20 : ITEMS_PER_PAGE));
  const selectedOnPageCount = products.filter((product) => selectedProductIds.includes(product.id)).length;
  const allVisibleSelected = products.length > 0 && selectedOnPageCount === products.length;
  const isSearchGroupingMode = debouncedSearchQuery.length > 0 && !isSelectionMode;
  const canAddMoreWarehouses = warehouses.length < MAX_WAREHOUSES;

  const aggregatedSearchResults = useMemo<AggregatedProductGroup[]>(() => {
    if (!isSearchGroupingMode) return [];

    const groups = new Map<string, {
      key: string;
      sku: string;
      name: string;
      brand: string;
      imageUrl: string;
      totalStock: number;
      sizeMap: Map<string, {
        stock: number;
        totalCostValue: number;
        priceSamples: number[];
        sourceCount: number;
        primaryProduct: Product;
        variants: Product[];
      }>;
    }>();

    products.filter((product) => Number(product.stock) >= 0).forEach((product) => {
      const normalizedSku = normalizeSku(product.sku);
      const groupKey = normalizedSku || `${product.brand}__${product.name}`;
      const sizeKey = normalizeSize(product.size);

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          key: groupKey,
          sku: normalizedSku,
          name: product.name,
          brand: product.brand,
          imageUrl: product.imageUrl,
          totalStock: 0,
          sizeMap: new Map(),
        });
      }

      const group = groups.get(groupKey)!;
      group.totalStock += Number(product.stock) || 0;

      if (!group.sizeMap.has(sizeKey)) {
        group.sizeMap.set(sizeKey, {
          stock: 0,
          totalCostValue: 0,
          priceSamples: [],
          sourceCount: 0,
          primaryProduct: product,
          variants: [],
        });
      }

      const sizeRow = group.sizeMap.get(sizeKey)!;
      const stock = Number(product.stock) || 0;
      const price = Number(product.price) || 0;

      sizeRow.stock += stock;
      sizeRow.totalCostValue += price * stock;
      sizeRow.priceSamples.push(price);
      sizeRow.sourceCount += 1;
      sizeRow.variants.push(product);
    });

    const parseSizeForSort = (value: string) => {
      const numeric = Number.parseFloat(value);
      return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
    };

    return Array.from(groups.values()).map((group) => ({
      key: group.key,
      sku: group.sku,
      name: group.name,
      brand: group.brand,
      imageUrl: group.imageUrl,
      totalStock: group.totalStock,
      sizeRows: Array.from(group.sizeMap.entries())
        .map(([size, row]) => {
          const averageCost = row.stock > 0
            ? row.totalCostValue / row.stock
            : (row.priceSamples.reduce((sum, price) => sum + price, 0) / Math.max(row.priceSamples.length, 1));

          return {
            key: `${group.key}__${size}`,
            size,
            stock: row.stock,
            averageCost,
            sourceCount: row.sourceCount,
            primaryProduct: row.primaryProduct,
            variants: row.variants,
          };
        })
        .sort((a, b) => {
          const sizeDiff = parseSizeForSort(a.size) - parseSizeForSort(b.size);
          return sizeDiff !== 0 ? sizeDiff : a.size.localeCompare(b.size, 'zh-CN');
        }),
    }));
  }, [products, isSearchGroupingMode]);

  const formatCost = (value: number) => {
    const rounded = Number(value.toFixed(2));
    return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
  };

  const formatCompactCurrency = (value: number) => {
    if (value >= 10000) {
      const wan = value / 10000;
      const digits = wan >= 10 ? 0 : 1;
      return `¥${wan.toFixed(digits)}w`;
    }

    return `¥${Math.round(value)}`;
  };

  useEffect(() => {
    setSelectedProductIds((prev) => prev.filter((id) => products.some((product) => product.id === id)));
  }, [products]);

  const handleToggleSelectAllVisible = () => {
    if (products.length === 0) return;

    if (allVisibleSelected) {
      setSelectedProductIds((prev) => prev.filter((id) => !products.some((product) => product.id === id)));
      return;
    }

    setSelectedProductIds((prev) => {
      const merged = new Set(prev);
      products.forEach((product) => merged.add(product.id));
      return Array.from(merged);
    });
  };

  return (
    <div
      className="flex flex-col h-full bg-slate-50 dark:bg-black relative transition-colors duration-300"
      onClick={() => {
        if (!isSelectionMode) {
          setActiveProductId(null);
        }
      }}
    >
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-black px-5 pt-4 pb-2 shadow-sm transition-colors duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">库存管理</h1>
            <div className="relative">
              <button 
                onClick={() => {
                  if (!warehousesReady) return;
                  const nextOpen = !showWarehouseMenu;
                  setShowWarehouseMenu(nextOpen);
                  if (warehouses.length === 0) setShowAddWarehouseForm(nextOpen);
                }}
                aria-label={warehouses.length === 0 ? '添加仓库' : '选择仓库'}
                disabled={!warehousesReady}
                title={warehouses.length === 0 ? '添加仓库' : '选择仓库'}
                className={`${warehouses.length === 0
                  ? "flex h-9 w-9 items-center justify-center rounded-full border border-dashed border-dewu-300 bg-white text-dewu-600 shadow-sm dark:border-dewu-700 dark:bg-zinc-900 dark:text-dewu-400"
                  : "flex items-center space-x-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold text-slate-700 dark:text-zinc-200 shadow-sm active:bg-slate-50 dark:active:bg-zinc-800 transition-colors"} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                  {warehouses.length === 0 ? <Plus size={17} /> : <>
                    <WarehouseIcon size={12} className="text-slate-400 dark:text-zinc-500" />
                    <span>{currentWarehouse}</span>
                    <ChevronDown size={14} className="text-slate-400 dark:text-zinc-500" />
                  </>}
              </button>
              
              {/* Warehouse Dropdown */}
              {showWarehouseMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => {
                      setShowWarehouseMenu(false);
                      setEditingWarehouse(null);
                      setShowAddWarehouseForm(false);
                      setAddingWarehouseName('');
                  }}></div>
                  <div className="absolute right-0 top-full mt-2 w-52 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-slate-100 dark:border-zinc-800 z-20 py-1.5 animate-[fadeIn_0.1s_ease-out] max-h-72 overflow-y-auto">
                    {warehouses.length === 0 && !showAddWarehouseForm && (
                      <p className="px-3 py-2 text-center text-[11px] text-slate-500 dark:text-zinc-400">暂无仓库，请先创建</p>
                    )}
                    {warehouses.map(wh => (
                      <div 
                        key={wh.id}
                        className="relative group"
                      >
                        {editingWarehouse === wh.name ? (
                            <div className="px-1.5 py-1 flex items-center space-x-1.5 bg-slate-50 dark:bg-zinc-800">
                                <input 
                                    type="text" 
                                    value={newWarehouseName}
                                    onChange={(e) => setNewWarehouseName(e.target.value)}
                                    className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded-md border border-slate-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white focus:border-dewu-500 outline-none"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <button 
                                    onClick={(e) => saveWarehouseName(e, wh)}
                                    className="flex h-6 w-6 items-center justify-center rounded-md bg-dewu-500 text-white hover:bg-dewu-600"
                                >
                                    <Check size={10} />
                                </button>
                            </div>
                        ) : (
                            <div
                                role="button"
                                tabIndex={0}
                                onClick={() => handleWarehouseSelect(wh.name)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') handleWarehouseSelect(wh.name);
                                }}
                                className="w-full text-left px-3 py-1.5 text-[11px] font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center justify-between group"
                            >
                                <span className="truncate pr-2">{wh.name}</span>
                                <div className="flex items-center space-x-1">
                                    {currentWarehouse === wh.name && <Check size={10} className="text-dewu-500 dark:text-dewu-400" />}
                                    
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSetDefaultWarehouse(wh.id);
                                        }}
                                        className={`p-0.5 rounded transition-colors ${
                                            wh.is_default 
                                                ? 'text-yellow-500 hover:text-yellow-600' 
                                                : 'text-slate-300 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                        }`}
                                        title={wh.is_default ? "当前默认仓库" : "设为默认仓库"}
                                    >
                                        <Star size={10} fill={wh.is_default ? "currentColor" : "none"} />
                                    </button>

                                    <button
                                        onClick={(e) => startEditingWarehouse(e, wh.name)}
                                        className="p-0.5 text-slate-300 hover:text-slate-600 dark:hover:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded transition-colors"
                                        title="重命名仓库"
                                    >
                                        <Edit size={10} />
                                    </button>
                                    <button
                                      onClick={(e) => handleDeleteWarehouse(e, wh)}
                                      className="p-0.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded transition-colors"
                                      title="删除空仓库"
                                    >
                                      <Trash2 size={10} />
                                    </button>
                                </div>
                            </div>
                        )}
                      </div>
                    ))}
                    <div className="mt-1 border-t border-slate-100 dark:border-zinc-800 px-2 pt-2">
                      {showAddWarehouseForm ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={addingWarehouseName}
                            onChange={(e) => setAddingWarehouseName(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleAddWarehouse(e);
                              }
                              if (e.key === 'Escape') {
                                e.stopPropagation();
                                setShowAddWarehouseForm(false);
                                setAddingWarehouseName('');
                              }
                            }}
                            placeholder="输入仓库名称"
                            className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-lg border border-slate-200 dark:border-zinc-700 bg-slate-50 dark:bg-zinc-800 dark:text-white focus:border-dewu-500 outline-none"
                            autoFocus
                          />
                          <button
                            onClick={handleAddWarehouse}
                            disabled={!addingWarehouseName.trim() || isAddingWarehouse}
                            className="shrink-0 h-8 w-8 rounded-lg bg-slate-900 dark:bg-dewu-500 text-white flex items-center justify-center disabled:opacity-50"
                            title={isAddingWarehouse ? '添加中' : '确认添加'}
                          >
                            {isAddingWarehouse ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowAddWarehouseForm(false);
                              setAddingWarehouseName('');
                            }}
                            className="shrink-0 h-8 w-8 rounded-lg border border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 flex items-center justify-center"
                            title="取消"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!canAddMoreWarehouses) return;
                              setShowAddWarehouseForm(true);
                            }}
                            disabled={!canAddMoreWarehouses}
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-slate-300 bg-slate-50 text-slate-500 transition-colors hover:border-dewu-400 hover:text-dewu-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:border-dewu-500 dark:hover:text-dewu-400"
                            title={canAddMoreWarehouses ? '新增仓库' : `最多允许设置 ${MAX_WAREHOUSES} 个仓库`}
                          >
                            <Plus size={14} />
                          </button>
                          {!canAddMoreWarehouses && (
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500">最多 6 个仓库</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
        </div>
        {warehousesReady && warehousesError && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            <span>仓库列表刷新失败，当前显示上次成功结果，可能已过期。</span>
            <button type="button" onClick={onRetryWarehouses} className="shrink-0 font-semibold">重试</button>
          </div>
        )}
        
        {/* Inventory Overview */}
        {inventoryStatsError && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
            <span>{hasCurrentInventoryStats ? '仓库摘要刷新失败，当前显示上次成功结果。' : '仓库摘要加载失败，暂不显示为 0。'}</span>
            <button type="button" onClick={() => setInventoryStatsRetry((value) => value + 1)} className="shrink-0 font-semibold">重试</button>
          </div>
        )}
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-900 p-2 text-white shadow-lg shadow-slate-200/70 dark:bg-zinc-900 dark:shadow-none">
          {[
            {
              key: 'total-count',
              icon: Boxes,
              label: '总库存数',
              value: (
                <>
                  {hasCurrentInventoryStats ? inventoryStats.totalCount : '—'}
                  {hasCurrentInventoryStats && <span className="ml-1 text-[11px] font-normal opacity-60">件</span>}
                </>
              ),
            },
            {
              key: 'total-value',
              icon: CircleDollarSign,
              label: '预估总值',
              value: hasCurrentInventoryStats ? formatCompactCurrency(inventoryStats.totalValue) : '—',
            },
            {
              key: 'warehouse-count',
              icon: WarehouseIcon,
              label: '该仓库库存数',
              value: (
                <>
                  {hasCurrentInventoryStats ? inventoryStats.warehouseCount : '—'}
                  {hasCurrentInventoryStats && <span className="ml-1 text-[11px] font-normal opacity-60">件</span>}
                </>
              ),
            },
            {
              key: 'warehouse-value',
              icon: CircleDollarSign,
              label: '该仓库预估总值',
              value: hasCurrentInventoryStats ? formatCompactCurrency(inventoryStats.warehouseValue) : '—',
            },
          ].map((stat) => {
            const Icon = stat.icon;

            return (
              <div
                key={stat.key}
                className="rounded-lg border border-white/8 bg-white/[0.04] px-2.5 py-2 dark:border-white/5 dark:bg-white/[0.03]"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-medium leading-tight text-slate-300/90 dark:text-zinc-300/90">
                  <Icon size={11} className="shrink-0 opacity-80" />
                  <span className="truncate">{stat.label}</span>
                </div>
                <div className="mt-1 text-[18px] font-bold leading-none tracking-tight text-white">
                  {stat.value}
                </div>
              </div>
            );
          })}
        </div>
        
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-1 shadow-sm border border-slate-200 dark:border-zinc-800 mb-3">
            {/* Search Bar */}
            <div className="relative">
            <Search className="absolute left-3 top-2.5 text-slate-400 dark:text-zinc-500" size={18} />
            <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentPage(1); // Reset to first page on search
                }}
                placeholder="搜索货号、名称、品牌..." 
                className="w-full bg-transparent text-sm text-slate-900 dark:text-white rounded-lg pl-10 pr-4 py-2 outline-none"
            />
            {searchQuery && (
                <button 
                    onClick={() => {
                        setSearchQuery('');
                        setCurrentPage(1);
                    }}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-zinc-300"
                >
                    <X size={16} />
                </button>
            )}
            </div>
        </div>

        {/* Filter Chips */}
        <div className="flex space-x-2 overflow-x-auto no-scrollbar pb-2">
          {['全部', '在售', '运输中', '已售罄', '瑕疵'].map((label, idx) => (
            <button 
              key={idx}
              onClick={() => {
                setFilter(label === '全部' ? 'all' : label);
                setCurrentPage(1); // Reset page on filter
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                (filter === 'all' && label === '全部') || filter === label 
                  ? 'bg-slate-900 dark:bg-zinc-800 text-white' 
                  : 'bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isSelectionMode && (
          <div className="mt-3 rounded-xl border border-dewu-100 bg-white px-3 py-2 shadow-sm dark:border-dewu-900/40 dark:bg-zinc-900">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900 dark:text-white">已进入勾选模式</div>
                <div className="text-[10px] text-slate-500 dark:text-zinc-400">已选 {selectedProductIds.length} 个商品</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleSelectAllVisible}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  {allVisibleSelected ? '取消全选' : '全选本页'}
                </button>
                <button
                  onClick={resetSelectionMode}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-[11px] font-medium text-slate-600 dark:border-zinc-700 dark:text-zinc-300"
                >
                  取消
                </button>
                <button
                  onClick={handleBatchDelete}
                  disabled={selectedProductIds.length === 0 || isBatchDeleting}
                  className="rounded-lg bg-red-500 px-3 py-1.5 text-[11px] font-medium text-white disabled:opacity-50"
                >
                  {isBatchDeleting ? '正在移入...' : `移入回收站${selectedProductIds.length > 0 ? ` (${selectedProductIds.length})` : ''}`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Product List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 pb-28 space-y-2">
        {searchPending || isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-dewu-500" />
                <span className="text-xs">{searchPending ? '正在更新搜索结果...' : '加载数据中...'}</span>
            </div>
        ) : loadError ? (
          <div className="mx-auto mt-12 max-w-xs rounded-xl border border-rose-200 bg-rose-50 p-4 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
            <p className="text-xs text-rose-600 dark:text-rose-300">{loadError}</p>
            <button type="button" onClick={() => setRetryNonce((value) => value + 1)} className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white">重新加载</button>
          </div>
        ) : (
            <>
                {warehouses.length > 0 && <p className="text-[10px] text-slate-400 dark:text-zinc-500 text-center mb-1">
                  {isSelectionMode
                    ? '点击商品可勾选或取消勾选'
                    : isSearchGroupingMode
                      ? `该搜索下共有 ${totalCount} 款商品，${searchInventoryStock} 个库存`
                      : `点击或长按商品进行管理 · 每页 ${ITEMS_PER_PAGE} 条 · 共 ${totalCount} 条`}
                </p>}
                
                {!warehousesReady ? (
                    <div className="mx-auto mt-10 max-w-xs text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400">
                        {warehousesError ? <WarehouseIcon size={22} /> : <Loader2 size={22} className="animate-spin" />}
                      </div>
                      <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{warehousesError ? '仓库信息同步失败' : '正在同步仓库'}</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">{warehousesError || '正在读取仓库，请稍候。'} 未确认前不会把它当成空账号。</p>
                      {warehousesError && <button type="button" onClick={onRetryWarehouses} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white dark:bg-white dark:text-black">重新同步</button>}
                    </div>
                ) : warehouses.length === 0 ? (
                    <div className="mx-auto mt-10 max-w-xs text-center">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-dewu-50 text-dewu-600 dark:bg-dewu-950/30 dark:text-dewu-400">
                        <WarehouseIcon size={22} />
                      </div>
                      <h2 className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">先创建你的第一个仓库</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-zinc-400">点击右上角加号填写真实仓库名称。首个仓库会自动成为主仓。</p>
                    </div>
                ) : products.length === 0 && (
                    <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs">
                        暂无符合条件的商品
                    </div>
                )}

                {isSearchGroupingMode ? aggregatedSearchResults.map((group) => (
                  <div
                    key={group.key}
                    className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm space-y-3"
                  >
                    <div className="flex space-x-3">
                      <ProductImage src={group.imageUrl} alt={group.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100 dark:bg-zinc-800 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 bg-slate-50 dark:bg-zinc-800 px-1 py-0.5 rounded uppercase tracking-wider mb-1 inline-block">{group.brand}</span>
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white leading-tight truncate">{group.name}</h3>
                            <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">货号: {group.sku}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[10px] text-slate-400 dark:text-zinc-500">总库存</div>
                            <div className="text-sm font-bold text-dewu-600 dark:text-dewu-400">{group.totalStock}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-zinc-950 border border-slate-100 dark:border-zinc-800 p-1 grid grid-cols-3 gap-1">
                      {group.sizeRows.map((sizeRow) => (
                        <button
                          key={sizeRow.key}
                          onClick={() => setAggregatedActionVariants(sizeRow.variants)}
                          className="w-full px-1.5 py-1 rounded-md border border-slate-100 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/80 text-left hover:bg-white dark:hover:bg-zinc-900 transition-colors"
                        >
                          <div className="min-w-0 flex flex-col gap-1">
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="bg-white dark:bg-zinc-900 text-slate-700 dark:text-zinc-200 text-[9px] px-1 py-0.5 rounded font-medium leading-none">{formatProductSize(sizeRow.size)}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 leading-none">库存 {sizeRow.stock}</span>
                            </div>
                            <div className="flex items-end justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[9px] text-slate-400 dark:text-zinc-500 leading-none">均成本</div>
                                <div className="text-[11px] font-bold text-slate-900 dark:text-white mt-0.5 leading-none">¥{formatCost(sizeRow.averageCost)}</div>
                              </div>
                              {sizeRow.sourceCount > 1 && (
                                <span className="text-[9px] text-slate-400 dark:text-zinc-500 leading-none shrink-0">合并 {sizeRow.sourceCount}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )) : products.map((product) => (
                  <div 
                    key={product.id} 
                    className="bg-white dark:bg-zinc-900 p-2 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex space-x-3 relative select-none overflow-hidden"
                    onPointerDown={(event) => handlePointerDown(event, product)}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!isSelectionMode) {
                            setActiveProductId(product.id);
                        }
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (isLongPress.current || Date.now() < suppressClickUntil.current) {
                            isLongPress.current = false;
                            return;
                        }
                        if (isSelectionMode) {
                            toggleProductSelection(product.id);
                            return;
                        }
                        if (!activeProductId) {
                            setActiveProductId(product.id);
                        }
                    }} 
                  >
                    {/* Action Overlay */}
                    {activeProductId === product.id && (
                      <div className="absolute inset-0 z-20 grid grid-cols-5 items-center gap-1 bg-slate-900/95 px-3 dark:bg-black/95 animate-[fadeIn_0.2s_ease-out]"
                           onClick={(e) => e.stopPropagation()}
                      >
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveProductId(null);
                            onEditProduct(product);
                          }}
                          className="flex flex-col items-center group"
                        >
                          <div className="mx-auto mb-1 w-fit rounded-full bg-white/10 p-2.5 text-white transition-colors group-active:bg-white/20">
                            <Edit size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-white">修改</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveProductId(null);
                            onAdjustProduct(product);
                          }}
                          className="flex flex-col items-center group"
                        >
                          <div className="mx-auto mb-1 w-fit rounded-full bg-amber-500/20 p-2.5 text-amber-300 transition-colors group-active:bg-amber-500/30">
                            <Scale size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-amber-300">盘点</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveProductId(null);
                            onTransferProduct(product);
                          }}
                          disabled={product.stock <= 0 || product.status !== 'instock'}
                          className="flex flex-col items-center group disabled:opacity-40"
                        >
                          <div className="mx-auto mb-1 w-fit rounded-full bg-cyan-500/20 p-2.5 text-cyan-300 transition-colors group-active:bg-cyan-500/30">
                            <ArrowRightLeft size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-cyan-300">调拨</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            enterSelectionMode(product.id);
                          }}
                          className="flex flex-col items-center group"
                        >
                          <div className="mx-auto mb-1 w-fit rounded-full bg-dewu-500/20 p-2.5 text-dewu-300 transition-colors group-active:bg-dewu-500/30">
                            <CheckCircle2 size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-dewu-300">勾选</span>
                        </button>

                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`确定要将 ${product.name} 移入回收站吗？`)) {
                                onDeleteProduct(product.id);
                                setActiveProductId(null);
                            }
                          }}
                          className="flex flex-col items-center group"
                        >
                           <div className="mx-auto mb-1 w-fit rounded-full bg-red-500/20 p-2.5 text-red-500 transition-colors group-active:bg-red-500/30">
                            <Trash2 size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-red-500">回收站</span>
                        </button>

                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveProductId(null);
                            }}
                            className="absolute top-1 right-2 p-2 text-white/30 hover:text-white"
                        >
                            <X size={14} />
                        </button>
                      </div>
                    )}

                    {isSelectionMode && (
                      <div className="absolute left-2 top-2 z-10">
                        <div className={`rounded-full ${selectedProductIds.includes(product.id) ? 'text-dewu-500' : 'text-slate-300 dark:text-zinc-600'}`}>
                          {selectedProductIds.includes(product.id) ? (
                            <CheckCircle2 size={18} fill="currentColor" className="text-dewu-500" />
                          ) : (
                            <Circle size={18} />
                          )}
                        </div>
                      </div>
                    )}

                    <div className="relative flex-shrink-0">
                      <ProductImage src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100 dark:bg-zinc-800" />
                      {(product.stock <= 0 || product.status === 'sold') && (
                        <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
                          <span className="text-white text-[10px] font-bold">SOLD</span>
                        </div>
                      )}
                    </div>
                    
                    <div className="flex-1 flex flex-col justify-between min-w-0">
                      <div>
                        <div className="flex justify-between items-start">
                          <div className="flex items-center space-x-2">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 bg-slate-50 dark:bg-zinc-800 px-1 py-0.5 rounded uppercase tracking-wider mb-1 inline-block">{product.brand}</span>
                            {product.location && (
                              <span className="flex items-center text-[10px] font-medium text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-1 py-0.5 rounded mb-1">
                                <MapPin size={8} className="mr-0.5" />
                                {product.location}
                              </span>
                            )}
                          </div>
                        </div>
                        <h3 className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-1 leading-tight">{product.name}</h3>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 mt-0.5">货号: {product.sku}</p>
                      </div>
                      
                      <div className="flex justify-between items-end mt-1">
                        <div className="flex items-center space-x-2">
                          <span className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[10px] px-1 py-0.5 rounded font-medium">{formatProductSize(product.size)}</span>
                          <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                            product.stock > 10 ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20' : 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20'
                          }`}>库存 {product.stock}</span>
                        </div>
                        <span className="text-sm font-bold text-dewu-600 dark:text-dewu-400">¥{product.price}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Pagination Controls */}
                {totalPages > 1 && (
                   <div className="flex items-center justify-center space-x-4 py-4">
                      <button 
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="p-2 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 disabled:opacity-50 text-slate-600 dark:text-zinc-400"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                        第 {currentPage} / {totalPages} 页
                      </span>
                      <button 
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="p-2 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 disabled:opacity-50 text-slate-600 dark:text-zinc-400"
                      >
                        <ChevronRight size={16} />
                      </button>
                   </div>
                )}
                
                {/* Padding for bottom nav and fab */}
                <div className="h-10"></div>
            </>
        )}
      </div>

      {/* FAB - Floating Action Button */}
      {warehouses.length > 0 && <button
        onClick={onAddClick}
        disabled={isSelectionMode}
        className="fixed bottom-24 right-5 w-14 h-14 bg-slate-900 dark:bg-dewu-500 rounded-full shadow-lg shadow-slate-300 dark:shadow-none flex items-center justify-center text-white active:scale-90 transition-transform z-30"
      >
        <Plus size={28} />
      </button>}

      {aggregatedActionVariants && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-4 backdrop-blur-sm" onClick={() => setAggregatedActionVariants(null)}>
          <div className="max-h-[78vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-zinc-950" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">选择仓库与操作</h3>
                <p className="mt-1 text-[11px] text-slate-500">{aggregatedActionVariants[0]?.sku} · {formatProductSize(aggregatedActionVariants[0]?.size || '')}</p>
              </div>
              <button type="button" onClick={() => setAggregatedActionVariants(null)} className="p-2 text-slate-400" aria-label="关闭商品操作"><X size={18} /></button>
            </div>
            <div className="space-y-2">
              {aggregatedActionVariants.map((variant) => (
                <div key={variant.id} className="rounded-xl border border-slate-200 p-3 dark:border-zinc-800">
                  <div className="flex items-center justify-between gap-3">
                    <div><div className="text-sm font-semibold text-slate-800 dark:text-white">{variant.warehouse}</div><div className="mt-1 text-[11px] text-slate-500">库存 {variant.stock} · 平均成本 ¥{Number(variant.price).toFixed(2)}</div></div>
                    <div className="flex gap-1">
                      <button type="button" onClick={() => { setAggregatedActionVariants(null); onEditProduct(variant); }} className="flex flex-col items-center gap-0.5 rounded-lg bg-slate-100 px-2 py-1.5 text-[9px] text-slate-600 dark:bg-zinc-800 dark:text-zinc-300" aria-label={`编辑${variant.warehouse}商品资料`}><Edit size={14} /><span>资料</span></button>
                      <button type="button" onClick={() => { setAggregatedActionVariants(null); onAdjustProduct(variant); }} className="flex flex-col items-center gap-0.5 rounded-lg bg-blue-50 px-2 py-1.5 text-[9px] text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" aria-label={`盘点${variant.warehouse}库存`}><Scale size={14} /><span>盘点</span></button>
                      <button type="button" disabled={variant.stock <= 0 || variant.status !== 'instock'} onClick={() => { setAggregatedActionVariants(null); onTransferProduct(variant); }} className="flex flex-col items-center gap-0.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-[9px] text-emerald-600 disabled:opacity-30 dark:bg-emerald-950/40 dark:text-emerald-300" aria-label={`调拨${variant.warehouse}库存`}><ArrowRightLeft size={14} /><span>调拨</span></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {aggregatedActionVariants.length > 1 && <p className="mt-3 text-[11px] leading-5 text-amber-600">该尺码分布在多个仓库。盘点和调拨只作用于你明确选择的仓库，不会修改聚合总量。</p>}
          </div>
        </div>
      )}
    </div>
  );
};
