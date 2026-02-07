import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, Boxes, CircleDollarSign, Warehouse as WarehouseIcon, ChevronDown, ChevronLeft, ChevronRight, Check, MapPin, Trash2, Edit, X, Loader2, Star } from 'lucide-react';
import { Product, Warehouse } from '../types';
import { supabase } from '../lib/supabase';

interface ProductListProps {
  onAddClick: () => void;
  onEditProduct: (product: Product) => void;
  onDeleteProduct: (productId: string) => void;
  warehouses: Warehouse[];
  onRenameWarehouse: (id: string, oldName: string, newName: string) => void;
  onSetDefaultWarehouse: (id: string) => void;
  refreshTrigger: number;
}

const ITEMS_PER_PAGE = 50;

export const ProductList: React.FC<ProductListProps> = ({ onAddClick, onEditProduct, onDeleteProduct, warehouses, onRenameWarehouse, onSetDefaultWarehouse, refreshTrigger }) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  
  const [filter, setFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  
  // Initialize with default warehouse or first one
  const [currentWarehouse, setCurrentWarehouse] = useState(() => {
    const defaultWh = warehouses.find(w => w.is_default);
    return defaultWh?.name || warehouses[0]?.name || '杭州一号仓';
  });

  const [showWarehouseMenu, setShowWarehouseMenu] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null);
  const [newWarehouseName, setNewWarehouseName] = useState('');
  
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
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
    }
  }, [warehouses]);

  // Fetch Products from Backend
  const fetchProducts = async () => {
    setIsLoading(true);
    try {
        let query = supabase
            .from('products')
            .select('*', { count: 'exact' });

        // 1. Warehouse Filter
        // If currentWarehouse is set, filter by it. 
        // Note: Legacy data might handle 'null' warehouse as default, but for strict backend query we check the value.
        query = query.eq('warehouse', currentWarehouse);

        // 2. Status Filter
        if (filter !== 'all') {
            if (filter === '在售') query = query.eq('status', 'instock');
            else if (filter === '运输中') query = query.eq('status', 'shipping');
            else if (filter === '已售罄') query = query.eq('status', 'sold');
            else if (filter === '瑕疵') query = query.eq('status', 'flaw'); // Assuming 'flaw' status exists
        }

        // 3. Search Query (Backend ILIKE)
        if (searchQuery.trim()) {
            const q = searchQuery.trim();
            // Search in name, sku, or brand
            query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%`);
        }

        // 4. Pagination
        const from = (currentPage - 1) * ITEMS_PER_PAGE;
        const to = from + ITEMS_PER_PAGE - 1;
        query = query.range(from, to);

        // 5. Ordering
        query = query.order('created_at', { ascending: false });

        const { data, error, count } = await query;

        if (error) throw error;

        if (data) {
            // Map DB to Frontend Type
            const mappedProducts: Product[] = data.map((p: any) => ({
                id: p.id,
                name: p.name,
                brand: p.brand,
                size: p.size,
                sku: p.sku,
                price: p.price,
                stock: p.stock,
                imageUrl: p.image_url,
                status: p.status,
                location: p.location,
                warehouse: p.warehouse || '杭州一号仓'
            }));
            setProducts(mappedProducts);
            setTotalCount(count || 0);
        }
    } catch (error) {
        console.error('Error fetching products:', error);
    } finally {
        setIsLoading(false);
    }
  };

  // Effect to trigger fetch
  useEffect(() => {
    fetchProducts();
  }, [currentPage, currentWarehouse, filter, searchQuery, refreshTrigger]);

  // Long press handling
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  const handleTouchStart = (product: Product) => {
    if (activeProductId === product.id) return;

    isLongPress.current = false;
    longPressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      if (window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(50);
      }
      setActiveProductId(product.id);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleWarehouseSelect = (name: string) => {
    setCurrentWarehouse(name);
    setShowWarehouseMenu(false);
    setCurrentPage(1); // Reset page on warehouse change
  };

  const startEditingWarehouse = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    setEditingWarehouse(name);
    setNewWarehouseName(name);
  };

  const saveWarehouseName = (e: React.MouseEvent | React.FormEvent, wh: Warehouse) => {
    e.stopPropagation();
    if (newWarehouseName && newWarehouseName !== wh.name) {
        onRenameWarehouse(wh.id, wh.name, newWarehouseName);
        if (currentWarehouse === wh.name) {
            setCurrentWarehouse(newWarehouseName);
        }
    }
    setEditingWarehouse(null);
  };

  // Stats Calculation (Based on CURRENT PAGE data - or should we fetch aggregates?)
  // For "Total Stock" and "Total Value" in the header, usually users expect TOTAL for the warehouse, not just current page.
  // However, calculating total value for ALL items requires a separate aggregation query if we don't have all items.
  // For now, to keep it fast and simple in this refactor, we might hide it or accept it's current page stats?
  // User wants "Complete System". Real backend systems fetch aggregates separately.
  // Let's Add a separate effect to fetch Warehouse Stats if needed.
  // For now, let's use the totalCount for "Product Count" (which we have).
  // For "Total Value", it's harder without a sum query. 
  // I will implement a quick aggregation query for the current warehouse.

  const [warehouseStats, setWarehouseStats] = useState({ count: 0, value: 0 });

  useEffect(() => {
    const fetchStats = async () => {
        // Fetch aggregation for current warehouse
        // Since we can't easily do SUM via standard client without fetch all, we might skip Value or estimate it.
        // Or we fetch all fields 'price,stock' for this warehouse to calculate.
        // If data is < 10000, fetching just price/stock columns is cheap.
        const { data } = await supabase
            .from('products')
            .select('price, stock, status')
            .eq('warehouse', currentWarehouse)
            .eq('status', 'instock');
        
        if (data) {
            const totalStock = data.reduce((acc, curr) => acc + curr.stock, 0);
            const totalValue = data.reduce((acc, curr) => acc + (curr.price * curr.stock), 0);
            setWarehouseStats({ count: totalStock, value: totalValue });
        }
    };
    fetchStats();
  }, [currentWarehouse, refreshTrigger]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-black relative transition-colors duration-300" onClick={() => setActiveProductId(null)}>
      {/* Sticky Header */}
      <div className="sticky top-0 z-30 bg-slate-50 dark:bg-black px-5 pt-4 pb-2 shadow-sm transition-colors duration-300" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">库存管理</h1>
            <div className="relative">
              <button 
                onClick={() => setShowWarehouseMenu(!showWarehouseMenu)}
                className="flex items-center space-x-1.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 pl-3 pr-2 py-1.5 rounded-full text-xs font-bold text-slate-700 dark:text-zinc-200 shadow-sm active:bg-slate-50 dark:active:bg-zinc-800 transition-colors"
              >
                  <WarehouseIcon size={12} className="text-slate-400 dark:text-zinc-500" />
                  <span>{currentWarehouse}</span>
                  <ChevronDown size={14} className="text-slate-400 dark:text-zinc-500" />
              </button>
              
              {/* Warehouse Dropdown */}
              {showWarehouseMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => {
                      setShowWarehouseMenu(false);
                      setEditingWarehouse(null);
                  }}></div>
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-slate-100 dark:border-zinc-800 z-20 py-2 animate-[fadeIn_0.1s_ease-out] max-h-60 overflow-y-auto">
                    <div className="px-4 py-2 text-[10px] text-slate-400 dark:text-zinc-500 font-medium border-b border-slate-50 dark:border-zinc-800 mb-1 sticky top-0 bg-white dark:bg-zinc-900 z-10">
                        点击名称切换，点击右侧图标修改
                    </div>
                    {warehouses.map(wh => (
                      <div 
                        key={wh.id}
                        className="relative group"
                      >
                        {editingWarehouse === wh.name ? (
                            <div className="px-2 py-1.5 flex items-center space-x-2 bg-slate-50 dark:bg-zinc-800">
                                <input 
                                    type="text" 
                                    value={newWarehouseName}
                                    onChange={(e) => setNewWarehouseName(e.target.value)}
                                    className="flex-1 min-w-0 text-xs px-2 py-1 rounded border border-slate-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white focus:border-dewu-500 outline-none"
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <button 
                                    onClick={(e) => saveWarehouseName(e, wh)}
                                    className="p-1 bg-dewu-500 text-white rounded hover:bg-dewu-600"
                                >
                                    <Check size={12} />
                                </button>
                            </div>
                        ) : (
                            <button 
                                onClick={() => handleWarehouseSelect(wh.name)}
                                className="w-full text-left px-4 py-2.5 text-xs font-medium text-slate-700 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-zinc-800 flex items-center justify-between group"
                            >
                                <span>{wh.name}</span>
                                <div className="flex items-center space-x-2">
                                    {currentWarehouse === wh.name && <Check size={12} className="text-dewu-500 dark:text-dewu-400" />}
                                    
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSetDefaultWarehouse(wh.id);
                                        }}
                                        className={`p-1 rounded transition-colors ${
                                            wh.is_default 
                                                ? 'text-yellow-500 hover:text-yellow-600' 
                                                : 'text-slate-300 hover:text-yellow-500 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
                                        }`}
                                        title={wh.is_default ? "当前默认仓库" : "设为默认仓库"}
                                    >
                                        <Star size={12} fill={wh.is_default ? "currentColor" : "none"} />
                                    </button>

                                    <div 
                                        onClick={(e) => startEditingWarehouse(e, wh.name)}
                                        className="p-1 text-slate-300 hover:text-slate-600 dark:hover:text-zinc-400 hover:bg-slate-200 dark:hover:bg-zinc-700 rounded transition-colors"
                                    >
                                        <Edit size={12} />
                                    </div>
                                </div>
                            </button>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
        </div>
        
        {/* Inventory Overview */}
        <div className="bg-slate-900 dark:bg-zinc-900 rounded-2xl p-4 text-white shadow-xl shadow-slate-200 dark:shadow-none mb-4 grid grid-cols-2 divide-x divide-slate-700 dark:divide-zinc-700">
           <div className="pr-4">
              <div className="flex items-center space-x-1.5 mb-2 opacity-80">
                 <Boxes size={14} />
                 <span className="text-xs font-medium">商品数量</span>
              </div>
              <div className="text-2xl font-bold">{warehouseStats.count} <span className="text-xs font-normal opacity-60">件</span></div>
           </div>
           <div className="pl-4">
              <div className="flex items-center space-x-1.5 mb-2 opacity-80">
                 <CircleDollarSign size={14} />
                 <span className="text-xs font-medium">预估总价值</span>
              </div>
              <div className="text-2xl font-bold tracking-tight">¥{(warehouseStats.value / 10000).toFixed(1)}w</div>
           </div>
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
      </div>

      {/* Product List */}
      <div className="flex-1 overflow-y-auto px-5 py-2 pb-28 space-y-2">
        {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 dark:text-zinc-500">
                <Loader2 className="w-8 h-8 animate-spin mb-2 text-dewu-500" />
                <span className="text-xs">加载数据中...</span>
            </div>
        ) : (
            <>
                <p className="text-[10px] text-slate-400 dark:text-zinc-500 text-center mb-1">长按商品进行管理 · 每页 {ITEMS_PER_PAGE} 条 · 共 {totalCount} 条</p>
                
                {products.length === 0 && (
                    <div className="text-center py-20 text-slate-400 dark:text-zinc-500 text-xs">
                        暂无符合条件的商品
                    </div>
                )}

                {products.map((product) => (
                  <div 
                    key={product.id} 
                    className="bg-white dark:bg-zinc-900 p-2 rounded-xl border border-slate-100 dark:border-zinc-800 shadow-sm flex space-x-3 relative active:scale-[0.99] transition-transform select-none overflow-hidden"
                    onTouchStart={() => handleTouchStart(product)}
                    onTouchEnd={handleTouchEnd}
                    onTouchMove={handleTouchEnd}
                    onMouseDown={() => handleTouchStart(product)}
                    onMouseUp={handleTouchEnd}
                    onMouseLeave={handleTouchEnd}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!activeProductId) {
                            onEditProduct(product);
                        }
                    }} 
                  >
                    {/* Action Overlay */}
                    {activeProductId === product.id && (
                      <div className="absolute inset-0 z-20 bg-slate-900/95 dark:bg-black/95 flex items-center justify-center space-x-8 animate-[fadeIn_0.2s_ease-out]"
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
                          <div className="p-3 bg-white/10 rounded-full text-white group-active:bg-white/20 transition-colors mb-1">
                            <Edit size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-white">修改</span>
                        </button>

                        <div className="w-[1px] h-8 bg-white/10"></div>
                        
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`确定要删除 ${product.name} 吗？`)) {
                                onDeleteProduct(product.id);
                                setActiveProductId(null);
                            }
                          }}
                          className="flex flex-col items-center group"
                        >
                           <div className="p-3 bg-red-500/20 rounded-full text-red-500 group-active:bg-red-500/30 transition-colors mb-1">
                            <Trash2 size={20} />
                          </div>
                          <span className="text-[10px] font-medium text-red-500">删除</span>
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

                    <div className="relative flex-shrink-0">
                      <img src={product.imageUrl} alt={product.name} className="w-14 h-14 rounded-lg object-cover bg-slate-100 dark:bg-zinc-800" />
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
                          <span className="bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 text-[10px] px-1 py-0.5 rounded font-medium">{product.size}码</span>
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
      <button 
        onClick={onAddClick}
        className="fixed bottom-24 right-5 w-14 h-14 bg-slate-900 dark:bg-dewu-500 rounded-full shadow-lg shadow-slate-300 dark:shadow-none flex items-center justify-center text-white active:scale-90 transition-transform z-30"
      >
        <Plus size={28} />
      </button>
    </div>
  );
};