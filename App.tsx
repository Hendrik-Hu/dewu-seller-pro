import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { BottomNav } from './components/BottomNav';
import { Home } from './components/Home';
import { ProductList } from './components/ProductList';
import { Stats } from './components/Stats';
import { Profile } from './components/Profile';
import { RecycleBinModal } from './components/RecycleBinModal';
import { TransferProductModal } from './components/TransferProductModal';
import { DataHealthModal } from './components/DataHealthModal';
import { AddProductModal } from './components/AddProductModal';
import { OutboundModal } from './components/OutboundModal';
import { PendingOrdersModal } from './components/PendingOrdersModal';
import { WidgetSettingsModal } from './components/WidgetSettingsModal';
import { updateWidgetData } from './utils/widget';
import { Tab, Product, Activity, Warehouse } from './types';
import { supabase } from './lib/supabase';
import { createInventoryActivity, listActivities } from './services/activities';
import { batchInboundProducts, batchUpdateProductStatus, deleteProduct, listAllProducts, listProductsForExport, syncProductMainImageBySku, upsertProduct } from './services/products';
import { outboundProduct } from './services/outbound';
import { buildInventoryAnalytics } from './lib/inventoryMetrics';
import { Loader2 } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { formatProductSize, normalizeProduct, sameInventoryVariant } from './lib/productNormalization';
import { createProductImageRef, isProductImageRef } from './services/storageImages';
import { buildInventoryCsv } from './lib/inventoryExport';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentTab, setCurrentTab] = useState<Tab>(Tab.HOME);
  const [isLoading, setIsLoading] = useState(false);
  
  // App State
  const [products, setProducts] = useState<Product[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // For child components to refresh data

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('dewu_theme') === 'dark';
  });

  // Auth Effect
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    // Session state will be updated by onAuthStateChange
  };

  // Apply Theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('dewu_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // User Profile State
  const [userProfile, setUserProfile] = useState({
    name: '得物卖家',
    avatar: ''
  });

  // Fetch Profile from Supabase
  const fetchProfile = async () => {
    if (!session?.user?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
        
      if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
        console.error('Error fetching profile:', error);
        return;
      }

      if (data) {
        let avatarUrl = data.avatar_url || '';
        
        // Fix for legacy data: if avatar is a blob URL (which is temporary), revert to default
        if (avatarUrl.startsWith('blob:')) {
            console.warn('Found invalid blob URL in profile, reverting to default.');
            avatarUrl = '';
        }

        setUserProfile({
          name: data.username || '得物卖家',
          avatar: avatarUrl
        });
      }
    } catch (error) {
      console.error('Fetch profile exception:', error);
    }
  };

  // Update Profile
  const updateProfile = async (updates: { name?: string; avatar?: string; avatarFile?: File }) => {
    if (!session?.user?.id) return;

    let newAvatarUrl = updates.avatar ?? userProfile.avatar;

    // Handle File Upload
    if (updates.avatarFile) {
      try {
        const file = updates.avatarFile;
        const fileExt = file.name.split('.').pop();
        const fileName = `${session.user.id}/${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(fileName, file, {
            upsert: true
          });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(fileName);
          
        newAvatarUrl = publicUrl;
      } catch (error: any) {
        console.error('Error uploading avatar:', error);
        alert('头像上传失败 (请确保已创建 avatars 存储桶并设为公开): ' + error.message);
        return;
      }
    }

    // 1. Optimistic Update
    setUserProfile(prev => ({ 
      ...prev, 
      name: updates.name || prev.name,
      avatar: newAvatarUrl 
    }));

    try {
      const { error } = await supabase
        .from('profiles')
        .upsert({
          id: session.user.id,
          username: updates.name || userProfile.name,
          avatar_url: newAvatarUrl,
          updated_at: new Date().toISOString(),
        });

      if (error) throw error;
    } catch (error: any) {
      console.error('Error updating profile:', error);
      alert('个人信息同步失败');
    }
  };

  useEffect(() => {
    if (session) {
      fetchProfile();
    }
  }, [session]);
  
  // Modals
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOutboundModal, setShowOutboundModal] = useState(false);
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [showWidgetModal, setShowWidgetModal] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showDataHealth, setShowDataHealth] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferProductTarget, setTransferProductTarget] = useState<Product | null>(null);
  
  // Warehouse State
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const inventoryAnalytics = buildInventoryAnalytics(products, activities);

  const dataUrlToFile = async (dataUrl: string, fileName: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
  };

  const uploadProductImage = async (userId: string, product: Product) => {
    let file = product.imageFile;

    if (!file && product.imageDataUrl?.startsWith('data:')) {
      const ext = product.imageDataUrl.match(/^data:image\/(\w+)/)?.[1] || 'jpg';
      file = await dataUrlToFile(product.imageDataUrl, `${product.sku || 'product'}-${Date.now()}.${ext}`);
    }

    if (!file) {
      return product.imageStorageRef || product.imageUrl;
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const safeSku = (product.sku || 'product').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeProductId = (product.id || 'draft').replace(/[^a-zA-Z0-9_-]/g, '_');
    const path = `${userId}/products/${safeSku}/${safeProductId}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(path, file, { upsert: true });

    if (uploadError) throw uploadError;

    return createProductImageRef(path);
  };

  // Fetch Warehouses
  const fetchWarehouses = async () => {
    if (!session?.user?.id) return;
    try {
      const { data, error } = await supabase
        .from('warehouses')
        .select('id, name, is_default')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: true });
        
      if (error) throw error;

      if (data && data.length > 0) {
        setWarehouses(data);
      } else {
         // Initialize default warehouses if none exist
         // We do this check locally first to avoid race conditions if possible, 
         // but best practice is Unique Constraint in DB.
         const defaults = ['杭州一号仓', '上海浦东仓', '北京大兴仓', '广州白云仓'];
         
         // Sequential insert to avoid race condition on 'empty' check
         // Or just insert and ignore error.
         const { data: newData, error: insertError } = await supabase
           .from('warehouses')
           .insert(defaults.map((name, index) => ({
             name,
             user_id: session.user.id,
             created_at: new Date().toISOString(),
             is_default: index === 0 // Make the first one default
           })))
           .select('id, name, is_default'); // Select back the IDs
           
         if (!insertError && newData) {
           setWarehouses(newData);
         }
      }
    } catch (error) {
      console.error('Error fetching warehouses:', error);
    }
  };

  useEffect(() => {
    if (session) {
      fetchWarehouses();
    }
  }, [session]);

  const handleSetDefaultWarehouse = async (id: string) => {
    try {
      // 1. Optimistic Update
      setWarehouses(prev => prev.map(w => ({
        ...w,
        is_default: w.id === id
      })));

      // 2. Update DB
      // First, set all to false
      const { error: resetError } = await supabase
        .from('warehouses')
        .update({ is_default: false })
        .eq('user_id', session?.user?.id);

      if (resetError) throw resetError;

      // Then set target to true
      const { error } = await supabase
        .from('warehouses')
        .update({ is_default: true })
        .eq('id', id)
        .eq('user_id', session?.user?.id);

      if (error) throw error;
      
      alert('已设置默认仓库');
      
      // Force refresh warehouses from DB to ensure consistency
      fetchWarehouses();
    } catch (error: any) {
      console.error('Set default warehouse error:', error);
      alert('设置失败');
      fetchWarehouses(); // Rollback on error
    }
  };

  const handleRenameWarehouse = async (id: string, oldName: string, newName: string) => {
    try {
        // 1. Update local state
        setWarehouses(prev => prev.map(w => w.id === id ? { ...w, name: newName } : w));
        
        // 2. Update Warehouse Table (using ID for uniqueness)
        const { error: whError } = await supabase
            .from('warehouses')
            .update({ name: newName })
            .eq('id', id)
            .eq('user_id', session?.user?.id);
            
        if (whError) throw whError;

        // 3. Update Products (still using Name reference)
        const { error: prodError } = await supabase
            .from('products')
            .update({ warehouse: newName })
            .eq('warehouse', oldName) // This might update products in other warehouses if names were duplicates, but that's expected behavior for name-based FK simulation
            .eq('user_id', session?.user?.id);
        
        if (prodError) throw prodError;

        // 4. Update Activities
        const { error: actError } = await supabase
            .from('activities')
            .update({ warehouse: newName })
            .eq('warehouse', oldName)
            .eq('user_id', session?.user?.id);
            
        if (actError) throw actError;

        // 5. Refresh data
        fetchData();
        setRefreshTrigger(prev => prev + 1);
        alert('仓库名称修改成功');

    } catch (error: any) {
        console.error('Rename warehouse error:', error);
        alert(`修改失败: ${error.message}`);
    }
  };

  const handleAddOrUpdateProduct = async (productInput: Product | Product[]) => {
    try {
      if (Array.isArray(productInput)) {
        if (!session?.user?.id || productInput.length === 0) return;
        if (productInput.some((product) => Number(product.stock) < 0)) {
          throw new Error('负库存异常不能通过普通入库修改，请先到“我的 - 数据体检”核对修正');
        }
        const normalizedProducts = productInput.map(normalizeProduct);
        const uploadedImageUrl = await uploadProductImage(session.user.id, normalizedProducts[0]);
        const productsToSave = normalizedProducts.map((product) => ({
          ...product,
          imageUrl: uploadedImageUrl || product.imageUrl || '',
          imageStorageRef: isProductImageRef(uploadedImageUrl) ? uploadedImageUrl : product.imageStorageRef,
          imageDataUrl: '',
          imageFile: undefined,
        }));

        await batchInboundProducts(productsToSave, session.user.id);
        await fetchData();
        setRefreshTrigger((previous) => previous + 1);
        setShowAddModal(false);
        setEditingProduct(null);
        return;
      }

      const product = productInput;
      if (Number(product.stock) < 0 || Number(editingProduct?.stock) < 0) {
        setShowAddModal(false);
        setEditingProduct(null);
        setShowDataHealth(true);
        throw new Error('该记录存在负库存异常，只能通过数据体检修正');
      }
      const normalizedProduct = normalizeProduct(product);
      const anomalousVariant = products.find(
        p => Number(p.stock) < 0 && sameInventoryVariant(p, normalizedProduct)
      );
      if (anomalousVariant) {
        setShowAddModal(false);
        setEditingProduct(null);
        setShowDataHealth(true);
        throw new Error('同仓库、货号和尺码存在负库存异常，请先完成数据体检后再入库');
      }
      // Check for existing product with same SKU and Size (Unique constraint logic)
      const existingProduct = products.find(
        p => sameInventoryVariant(p, normalizedProduct) && p.id !== normalizedProduct.id
      );

      let finalProduct = { ...normalizedProduct };
      let isMerge = false;

      // If adding new product and duplicate found
      if (existingProduct && !editingProduct) {
        const confirmMerge = confirm(
          `检测到仓库中已存在 [${existingProduct.sku} - ${formatProductSize(existingProduct.size)}]。\n\n` +
          `现有库存: ${existingProduct.stock} 件\n` +
          `现有成本: ¥${existingProduct.price}\n\n` +
          `将执行合并入库，并自动计算平均成本。是否继续？`
        );
        
        if (!confirmMerge) return;

        isMerge = true;
        // Weighted average price calculation
        const totalValue = (existingProduct.price * existingProduct.stock) + (normalizedProduct.price * normalizedProduct.stock);
        const totalStock = existingProduct.stock + normalizedProduct.stock;
        const avgPrice = parseFloat((totalValue / totalStock).toFixed(2));

        finalProduct = {
          ...existingProduct,
          price: avgPrice,
          stock: totalStock,
          location: normalizedProduct.location || existingProduct.location,
          warehouse: normalizedProduct.warehouse || existingProduct.warehouse,
          status: 'instock'
        };
      }

      if (!session?.user?.id) return;
      const uploadedImageUrl = await uploadProductImage(session.user.id, normalizedProduct);

      finalProduct = {
        ...finalProduct,
        imageUrl: uploadedImageUrl || finalProduct.imageUrl || '',
        imageStorageRef: isProductImageRef(uploadedImageUrl) ? uploadedImageUrl : finalProduct.imageStorageRef,
        source: normalizedProduct.source || finalProduct.source || '',
        imageDataUrl: '',
        imageFile: undefined,
      };

      await upsertProduct(finalProduct, session.user.id);

      if (uploadedImageUrl) {
        await syncProductMainImageBySku(session.user.id, finalProduct.sku, uploadedImageUrl);
      }

      // Add Activity Log
      if (!editingProduct || isMerge) {
         try {
           await createInventoryActivity({
             userId: session.user.id,
             type: 'inbound',
             productName: finalProduct.name,
             sku: finalProduct.sku,
             size: finalProduct.size,
             price: isMerge ? normalizedProduct.price : finalProduct.price,
             cost: isMerge ? normalizedProduct.price : finalProduct.price,
             imageUrl: finalProduct.imageUrl,
             warehouse: finalProduct.warehouse,
             count: normalizedProduct.stock,
             source: normalizedProduct.source,
           });
         } catch (insertActError) {
           console.error('Activity Insert Error:', insertActError);
         }
      }

      fetchData();
      setRefreshTrigger(prev => prev + 1); // Trigger refresh for ProductList
      setShowAddModal(false);
      setEditingProduct(null);

    } catch (error: any) {
      console.error('Error saving product:', error);
      alert(`保存失败: ${error.message || JSON.stringify(error)}`);
      throw error; // Re-throw so the modal knows save failed
    }
  };

  const handleEditClick = (product: Product) => {
    if (Number(product.stock) < 0) {
      setEditingProduct(null);
      setShowAddModal(false);
      setShowDataHealth(true);
      alert('该记录存在负库存异常，已为你打开数据体检。普通编辑不会修改异常数量。');
      return;
    }
    setEditingProduct(product);
    setShowAddModal(true);
  };

  const handleDeleteProduct = async (productId: string) => {
    try {
      if (!session?.user?.id) return;
      await deleteProduct(productId, session.user.id);
      
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowAddModal(false);
      
    } catch (error: any) {
      console.error('Delete error:', error);
      alert('移入回收站失败');
    }
  };

  const handleAddWarehouse = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !session?.user?.id) return;

    if (warehouses.length >= 6) {
      throw new Error('最多允许设置 6 个仓库');
    }

    if (warehouses.some((warehouse) => warehouse.name === trimmedName)) {
      throw new Error('仓库名称已存在');
    }

    const { data, error } = await supabase
      .from('warehouses')
      .insert({
        name: trimmedName,
        user_id: session.user.id,
        created_at: new Date().toISOString(),
        is_default: false,
      })
      .select('id, name, is_default')
      .single();

    if (error) throw error;

    if (data) {
      setWarehouses((prev) => [...prev, data]);
    }
  };

  const handleBatchDeleteProducts = async (productIds: string[]) => {
    if (!session?.user?.id || productIds.length === 0) return;

    try {
      await Promise.all(productIds.map((productId) => deleteProduct(productId, session.user.id)));
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowAddModal(false);
      setEditingProduct(null);
      alert(`已将 ${productIds.length} 个商品移入回收站`);
    } catch (error: any) {
      console.error('Batch delete error:', error);
      alert(`批量移入回收站失败: ${error.message || '请稍后重试'}`);
      throw error;
    }
  };

  const handleExportProducts = async () => {
    if (!session?.user?.id) return;
    try {
      const exportProducts = await listProductsForExport(session.user.id);
      const blob = new Blob([buildInventoryCsv(exportProducts)], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `dewu-inventory-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error: any) {
      alert(`导出失败：${error?.message || '请稍后重试'}`);
    }
  };

  const handleCompletePendingProducts = async (productIds: string[]) => {
    if (!session?.user?.id || productIds.length === 0) return;

    try {
      await batchUpdateProductStatus(productIds, session.user.id, 'sold');
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      alert(`已完成 ${productIds.length} 个待发货商品`);
    } catch (error: any) {
      console.error('Complete pending error:', error);
      alert(`操作失败: ${error.message || '请稍后重试'}`);
      throw error;
    }
  };

  const handleOutboundProduct = async (product: Product, price: number, quantity: number = 1, platform: string = '得物') => {
    if (!session?.user?.id) return;
    
    try {
      await outboundProduct({
        product,
        userId: session.user.id,
        salePrice: price,
        quantity,
        platform,
      });

      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowOutboundModal(false);
      alert(`出库成功 (x${quantity})`);
      
    } catch (error: any) {
      console.error('Outbound error:', error);
      alert(`出库失败: ${error.message || JSON.stringify(error)}`);
      throw error;
    }
  };

  // Fetch Data
  const fetchData = async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    try {
      const [productsData, typedActivities] = await Promise.all([
        listAllProducts(session.user.id),
        listActivities(session.user.id),
      ]);

      setProducts(productsData || []);
      setActivities(typedActivities || []);

    } catch (error) {
      console.error('Fetch data error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial Load
  useEffect(() => {
    // Wait for welcome screen and session
    if (session) {
      // If user has already seen welcome screen or dismissed it
      if (!showWelcome) {
         fetchData();
      }
    }
  }, [showWelcome, session]);

  useEffect(() => {
    if (!session || showWelcome) return;

    updateWidgetData({
      totalStock: inventoryAnalytics.dashboard.totalStock,
      inboundToday: inventoryAnalytics.dashboard.todayInboundCount,
      lastUpdated: new Date().toLocaleTimeString(),
    });
  }, [
    inventoryAnalytics.dashboard.todayInboundCount,
    inventoryAnalytics.dashboard.totalStock,
    session,
    showWelcome,
  ]);

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
  };

  // Render loading state if session exists but data/warehouses are loading
  if (session && isLoading && products.length === 0 && warehouses.length === 0) {
      return (
        <div className="h-full w-full bg-slate-50 dark:bg-black flex flex-col items-center justify-center">
           <Loader2 className="w-8 h-8 animate-spin mb-2 text-dewu-500" />
           <span className="text-xs text-slate-400">加载资源中...</span>
        </div>
      );
  }

  const renderContent = () => {
    if (isLoading && products.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin mb-2 text-dewu-500" />
          <span className="text-xs">同步云端数据中...</span>
        </div>
      );
    }

    switch (currentTab) {
      case Tab.HOME:
        return (
          <Home 
            userId={session.user.id}
            warehouses={warehouses}
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={() => {
              setEditingProduct(null);
              setShowAddModal(true);
            }} 
            onOutboundClick={() => setShowOutboundModal(true)}
            onPendingClick={() => setShowPendingModal(true)}
            activities={activities}
            pendingOrderCount={inventoryAnalytics.dashboard.pendingOrderCount}
            todaySalesAmount={inventoryAnalytics.dashboard.todaySalesAmount}
            todaySalesCount={inventoryAnalytics.dashboard.todaySalesCount}
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            products={products}
            onAIManageExecuted={() => {
              fetchData();
              setRefreshTrigger(prev => prev + 1);
            }}
          />
        );
      case Tab.PRODUCTS:
        return (
          <ProductList 
            userId={session.user.id}
            onAddClick={() => {
              setEditingProduct(null);
              setShowAddModal(true);
            }}
            onEditProduct={handleEditClick}
            onTransferProduct={(product) => {
              setTransferProductTarget(product);
              setShowTransferModal(true);
            }}
            onDeleteProduct={handleDeleteProduct}
            onBatchDeleteProducts={handleBatchDeleteProducts}
            warehouses={warehouses}
            onRenameWarehouse={handleRenameWarehouse}
            onSetDefaultWarehouse={handleSetDefaultWarehouse}
            onAddWarehouse={handleAddWarehouse}
            refreshTrigger={refreshTrigger}
          />
        );
      case Tab.STATS:
        return (
          <Stats
            products={products}
            activities={activities}
            onAIExecuted={() => {
              fetchData();
              setRefreshTrigger(prev => prev + 1);
            }}
          />
        );
      case Tab.ME:
        // Calculate Stats for Profile
        return (
          <Profile 
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onUpdateName={(name) => updateProfile({ name })}
            onUpdateAvatar={(file) => updateProfile({ avatarFile: file })}
            totalStock={inventoryAnalytics.dashboard.totalStock}
            totalInbound={inventoryAnalytics.lifetime.totalInboundCount}
            totalOutbound={inventoryAnalytics.lifetime.totalOutboundCount}
            isDarkMode={isDarkMode}
            onToggleTheme={() => setIsDarkMode(!isDarkMode)}
            onLogout={handleLogout}
            email={session?.user?.email}
            onWidgetClick={() => setShowWidgetModal(true)}
            onRecycleBinClick={() => setShowRecycleBin(true)}
            onExportClick={handleExportProducts}
            onDataHealthClick={() => setShowDataHealth(true)}
            dataIssueCount={inventoryAnalytics.dataQuality.negativeStockCount + inventoryAnalytics.dataQuality.invalidActivityCount}
            appVersion={__APP_VERSION__}
          />
        );
      default:
        return <Home 
            userId={session.user.id}
            warehouses={warehouses}
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={() => setShowAddModal(true)} 
            onOutboundClick={() => setShowOutboundModal(true)}
            onPendingClick={() => setShowPendingModal(true)}
            activities={activities}
            pendingOrderCount={inventoryAnalytics.dashboard.pendingOrderCount}
            todaySalesAmount={inventoryAnalytics.dashboard.todaySalesAmount}
            todaySalesCount={inventoryAnalytics.dashboard.todaySalesCount}
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            products={products}
            onAIManageExecuted={() => {
              fetchData();
              setRefreshTrigger(prev => prev + 1);
            }}
          />;
    }
  };

  if (!session) {
    return <AuthScreen onAuthSuccess={() => {}} />;
  }

  return (
    <div className="h-full w-full bg-slate-50 dark:bg-black flex flex-col items-center justify-center transition-colors duration-300">
      <div className="w-full h-full max-w-md bg-white dark:bg-black relative shadow-2xl overflow-hidden sm:rounded-3xl sm:h-[90vh] sm:border-4 sm:border-slate-900 dark:sm:border-zinc-800 transition-colors duration-300">
        
        {showWelcome && <WelcomeScreen onComplete={handleWelcomeComplete} />}
        
        {!showWelcome && (
          <>
            <main className="h-full w-full overflow-hidden bg-slate-50 dark:bg-black transition-colors duration-300">
              {renderContent()}
            </main>
            <BottomNav currentTab={currentTab} onTabChange={setCurrentTab} />
            
            {/* Modals rendered at root level */}
            <AddProductModal 
              isOpen={showAddModal} 
              onClose={() => {
                setShowAddModal(false);
                setEditingProduct(null);
              }} 
              onSave={handleAddOrUpdateProduct}
              onDelete={handleDeleteProduct}
              initialData={editingProduct}
              warehouses={warehouses}
              existingProducts={products}
              userId={session.user.id}
            />
            <OutboundModal
              isOpen={showOutboundModal}
              onClose={() => setShowOutboundModal(false)}
              products={products}
              onOutbound={handleOutboundProduct}
            />
            <PendingOrdersModal
              isOpen={showPendingModal}
              onClose={() => setShowPendingModal(false)}
              products={products}
              onCompletePending={handleCompletePendingProducts}
            />
            <RecycleBinModal
              isOpen={showRecycleBin}
              onClose={() => setShowRecycleBin(false)}
              userId={session.user.id}
              onRestored={() => {
                fetchData();
                setRefreshTrigger((value) => value + 1);
              }}
            />
            <DataHealthModal
              isOpen={showDataHealth}
              userId={session.user.id}
              onClose={() => setShowDataHealth(false)}
              onRepaired={() => {
                fetchData();
                setRefreshTrigger((value) => value + 1);
              }}
            />
            <TransferProductModal
              isOpen={showTransferModal}
              product={transferProductTarget}
              warehouses={warehouses}
              userId={session.user.id}
              onClose={() => setShowTransferModal(false)}
              onTransferred={() => {
                setShowTransferModal(false);
                setTransferProductTarget(null);
                fetchData();
                setRefreshTrigger((value) => value + 1);
              }}
            />
            <WidgetSettingsModal
              isOpen={showWidgetModal}
              onClose={() => setShowWidgetModal(false)}
              totalStock={inventoryAnalytics.dashboard.totalStock}
              todayInbound={inventoryAnalytics.dashboard.todayInboundCount}
            />
          </>
        )}
        
      </div>
    </div>
  );
}
