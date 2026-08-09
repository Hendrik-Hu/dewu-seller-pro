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
import { BackupRestoreModal } from './components/BackupRestoreModal';
import { FeeSchemeModal } from './components/FeeSchemeModal';
import { AddProductModal } from './components/AddProductModal';
import { OutboundModal } from './components/OutboundModal';
import { PendingOrdersModal } from './components/PendingOrdersModal';
import { Tab, Product, Activity, Warehouse, OutboundFeeSelection } from './types';
import { supabase } from './lib/supabase';
import { createInventoryActivity, listActivities } from './services/activities';
import { batchInboundProducts, batchUpdateProductStatus, deleteProduct, listAllProducts, syncProductMainImageBySku, upsertProduct } from './services/products';
import { outboundProduct } from './services/outbound';
import { buildInventoryAnalytics } from './lib/inventoryMetrics';
import { Loader2 } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { parseRecoveryUrl } from './lib/authRecovery';
import { SystemBars } from './lib/systemBars';
import { formatProductSize, normalizeProduct, sameInventoryVariant } from './lib/productNormalization';
import { createProductImageRef, isProductImageRef } from './services/storageImages';
import { createWarehouse, deleteWarehouse, listWarehouses, renameWarehouse, setDefaultWarehouse } from './services/warehouses';
import { countOrphanWarehouseProducts } from './services/dataHealth';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentTab, setCurrentTab] = useState<Tab>(Tab.HOME);
  const [isLoading, setIsLoading] = useState(false);
  
  // App State
  const [products, setProducts] = useState<Product[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // For child components to refresh data

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem('seller_inventory_theme') || localStorage.getItem('dewu_theme');
    if (storedTheme === 'dark' || storedTheme === 'light') return storedTheme === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Auth Effect
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setIsPasswordRecovery(false);
      setIsAuthReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let removed = false;
    const handleRecoveryUrl = async (url: string) => {
      const payload = parseRecoveryUrl(url);
      if (!payload) return;
      const result = payload.code
        ? await supabase.auth.exchangeCodeForSession(payload.code)
        : await supabase.auth.setSession({ access_token: payload.accessToken!, refresh_token: payload.refreshToken! });
      if (!result.error && !removed) {
        setSession(result.data.session);
        setIsPasswordRecovery(true);
        setIsAuthReady(true);
      }
    };

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => handleRecoveryUrl(url));
    CapacitorApp.getLaunchUrl().then((result) => result?.url && handleRecoveryUrl(result.url));
    return () => {
      removed = true;
      listenerPromise.then((listener) => listener.remove());
    };
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
    localStorage.setItem('seller_inventory_theme', isDarkMode ? 'dark' : 'light');
    localStorage.removeItem('dewu_theme');

    if (Capacitor.isNativePlatform()) {
      void SystemBars.setTheme({ dark: isDarkMode })
        .catch((error) => console.warn('Unable to synchronize the native system bar theme.', error));
    }
  }, [isDarkMode]);

  // User Profile State
  const [userProfile, setUserProfile] = useState({
    name: '卖家用户',
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
          name: data.username || '卖家用户',
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
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showDataHealth, setShowDataHealth] = useState(false);
  const [showBackupRestore, setShowBackupRestore] = useState(false);
  const [showFeeSchemes, setShowFeeSchemes] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferProductTarget, setTransferProductTarget] = useState<Product | null>(null);
  
  // Warehouse State
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [orphanWarehouseIssueCount, setOrphanWarehouseIssueCount] = useState(0);
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
      setWarehouses(await listWarehouses(session.user.id));
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
      await setDefaultWarehouse(id);
      await fetchWarehouses();
      alert('已设置默认仓库');
    } catch (error: any) {
      console.error('Set default warehouse error:', error);
      alert(`设置失败：${error?.message || '请稍后重试'}`);
      await fetchWarehouses();
    }
  };

  const handleRenameWarehouse = async (id: string, _oldName: string, newName: string) => {
    try {
      await renameWarehouse(id, newName);
      await Promise.all([fetchWarehouses(), fetchData()]);
      setRefreshTrigger(prev => prev + 1);
      alert('仓库名称修改成功，历史流水名称保持不变');
    } catch (error: any) {
      console.error('Rename warehouse error:', error);
      alert(`修改失败：${error?.message || '请稍后重试'}`);
      await fetchWarehouses();
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
    if (!trimmedName || !session?.user?.id) throw new Error('请输入仓库名称');
    const created = await createWarehouse(trimmedName);
    await fetchWarehouses();
    return created;
  };

  const handleDeleteWarehouse = async (id: string) => {
    await deleteWarehouse(id);
    await fetchWarehouses();
    setRefreshTrigger((value) => value + 1);
  };

  const handleInboundEntry = () => {
    if (warehouses.length === 0) {
      setCurrentTab(Tab.PRODUCTS);
      alert('请先在库存页点击右上角加号，创建真实仓库后再入库。');
      return;
    }
    setEditingProduct(null);
    setShowAddModal(true);
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

  const handleOutboundProduct = async (product: Product, price: number, quantity: number, feeSelection: OutboundFeeSelection, operationId: string, platform: string = '得物') => {
    if (!session?.user?.id) return;
    
    try {
      await outboundProduct({
        product,
        userId: session.user.id,
        salePrice: price,
        quantity,
        platform,
        feeSelection,
        operationId,
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
      const [productsData, typedActivities, orphanCount] = await Promise.all([
        listAllProducts(session.user.id),
        listActivities(session.user.id),
        countOrphanWarehouseProducts(),
      ]);

      setProducts(productsData || []);
      setActivities(typedActivities || []);
      setOrphanWarehouseIssueCount(orphanCount);

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
            onInboundClick={handleInboundEntry}
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
            onAddClick={handleInboundEntry}
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
            onDeleteWarehouse={handleDeleteWarehouse}
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
            onRecycleBinClick={() => setShowRecycleBin(true)}
            onExportClick={() => setShowBackupRestore(true)}
            onDataHealthClick={() => setShowDataHealth(true)}
            onFeeSchemesClick={() => setShowFeeSchemes(true)}
            dataIssueCount={inventoryAnalytics.dataQuality.negativeStockCount + inventoryAnalytics.dataQuality.invalidActivityCount + orphanWarehouseIssueCount}
            appVersion={__APP_VERSION__}
          />
        );
      default:
        return <Home 
            userId={session.user.id}
            warehouses={warehouses}
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={handleInboundEntry}
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

  if (!isAuthReady) {
    return <div className="flex h-full w-full items-center justify-center bg-slate-50 dark:bg-black"><Loader2 className="h-8 w-8 animate-spin text-dewu-500" /></div>;
  }

  if (isPasswordRecovery) {
    return <AuthScreen isPasswordRecovery onAuthSuccess={() => {}} onRecoveryComplete={() => setIsPasswordRecovery(false)} />;
  }

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
              userId={session.user.id}
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
            <BackupRestoreModal
              isOpen={showBackupRestore}
              userId={session.user.id}
              onClose={() => setShowBackupRestore(false)}
              onRestored={() => {
                fetchData();
                setRefreshTrigger((value) => value + 1);
              }}
            />
            <FeeSchemeModal
              isOpen={showFeeSchemes}
              userId={session.user.id}
              onClose={() => setShowFeeSchemes(false)}
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
          </>
        )}
        
      </div>
    </div>
  );
}
