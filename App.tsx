import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { BottomNav } from './components/BottomNav';
import { Home } from './components/Home';
import { createDeferredComponent } from './components/DeferredComponent';
import { Tab, Product, Activity, Warehouse, OutboundExecutionMode, OutboundFeeSelection } from './types';
import { supabase } from './lib/supabase';
import { listRecentActivities } from './services/activities';
import { batchInboundProducts, deleteProduct, deleteProducts, updateProductMetadata } from './services/products';
import { outboundProduct } from './services/outbound';
import { createSalesOrder } from './services/salesOrders';
import { emptyInventoryAnalytics, getInventoryAnalytics } from './services/analytics';
import { Loader2 } from 'lucide-react';
import { Session } from '@supabase/supabase-js';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { parseRecoveryUrl } from './lib/authRecovery';
import { parseConfirmationUrl } from './lib/authConfirmation';
import { SystemBars } from './lib/systemBars';
import { normalizeProduct } from './lib/productNormalization';
import {
  enqueueProductImageCleanup,
  isProductImageRef,
  processProductImageCleanupQueue,
  removeProductImageRefIfUnreferenced,
  uploadImmutableProductImage,
} from './services/storageImages';
import { createWarehouse, deleteWarehouse, listWarehouses, renameWarehouse, setDefaultWarehouse } from './services/warehouses';
import { countOrphanWarehouseProducts } from './services/dataHealth';
import { clearPendingFirstWarehouseCreation } from './services/firstWarehouseCreation';
import { createEmptySupportDiagnosticState, recordDiagnosticDomainResult } from './lib/supportDiagnostics';
import { prepareAvatarImage } from './lib/avatarImagePipeline';
import { removeOwnedAvatar, uploadImmutableAvatar } from './services/avatarImages';

const ProductList = createDeferredComponent(
  () => import('./components/ProductList').then(({ ProductList: component }) => component),
  { label: '库存管理', kind: 'page' },
);
const Stats = createDeferredComponent(
  () => import('./components/Stats').then(({ Stats: component }) => component),
  { label: '数据统计', kind: 'page' },
);
const Profile = createDeferredComponent(
  () => import('./components/Profile').then(({ Profile: component }) => component),
  { label: '个人中心', kind: 'page' },
);
const AddProductModal = createDeferredComponent(
  () => import('./components/AddProductModal').then(({ AddProductModal: component }) => component),
  { label: '入库表单', kind: 'modal' },
);
const FirstWarehouseModal = createDeferredComponent(
  () => import('./components/FirstWarehouseModal').then(({ FirstWarehouseModal: component }) => component),
  { label: '首仓创建', kind: 'modal' },
);
const InventoryAdjustmentModal = createDeferredComponent(
  () => import('./components/InventoryAdjustmentModal').then(({ InventoryAdjustmentModal: component }) => component),
  { label: '盘点调整', kind: 'modal' },
);
const OutboundModal = createDeferredComponent(
  () => import('./components/OutboundModal').then(({ OutboundModal: component }) => component),
  { label: '出库表单', kind: 'modal' },
);
const TransitInventoryModal = createDeferredComponent(
  () => import('./components/PendingOrdersModal').then(({ TransitInventoryModal: component }) => component),
  { label: '采购运输中库存', kind: 'modal' },
);
const RecycleBinModal = createDeferredComponent(
  () => import('./components/RecycleBinModal').then(({ RecycleBinModal: component }) => component),
  { label: '回收站', kind: 'modal' },
);
const DataHealthModal = createDeferredComponent(
  () => import('./components/DataHealthModal').then(({ DataHealthModal: component }) => component),
  { label: '数据体检', kind: 'modal' },
);
const BackupRestoreModal = createDeferredComponent(
  () => import('./components/BackupRestoreModal').then(({ BackupRestoreModal: component }) => component),
  { label: '账本导出与恢复', kind: 'modal' },
);
const FeeSchemeModal = createDeferredComponent(
  () => import('./components/FeeSchemeModal').then(({ FeeSchemeModal: component }) => component),
  { label: '费用方案', kind: 'modal' },
);
const TransferProductModal = createDeferredComponent(
  () => import('./components/TransferProductModal').then(({ TransferProductModal: component }) => component),
  { label: '库存调拨', kind: 'modal' },
);

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentTab, setCurrentTab] = useState<Tab>(Tab.HOME);
  const [isLoading, setIsLoading] = useState(false);
  
  // App State
  const [activities, setActivities] = useState<Activity[]>([]);
  const [analytics, setAnalytics] = useState(emptyInventoryAnalytics);
  const [analyticsReady, setAnalyticsReady] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [recentActivitiesReady, setRecentActivitiesReady] = useState(false);
  const [recentActivitiesError, setRecentActivitiesError] = useState('');
  const [supportDiagnosticState, setSupportDiagnosticState] = useState(createEmptySupportDiagnosticState);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // For child components to refresh data
  const previousUserId = useRef<string | null>(null);
  const userRequestGeneration = useRef(0);
  const latestDataRequest = useRef(0);
  const latestWarehouseRequest = useRef(0);
  const latestProfileRequest = useRef(0);
  const cleanupStartedForUser = useRef<string | null>(null);

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
      if (payload) {
        const result = payload.code
          ? await supabase.auth.exchangeCodeForSession(payload.code)
          : await supabase.auth.setSession({ access_token: payload.accessToken!, refresh_token: payload.refreshToken! });
        if (!result.error && !removed) {
          setSession(result.data.session);
          setIsPasswordRecovery(true);
          setIsAuthReady(true);
        }
        return;
      }

      const confirmation = parseConfirmationUrl(url);
      if (confirmation) {
        const result = confirmation.code
          ? await supabase.auth.exchangeCodeForSession(confirmation.code)
          : await supabase.auth.setSession({ access_token: confirmation.accessToken!, refresh_token: confirmation.refreshToken! });
        if (!result.error && !removed) {
          setSession(result.data.session);
          setIsPasswordRecovery(false);
          setIsAuthReady(true);
        }
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
    const requestedUserId = session.user.id;
    const generation = userRequestGeneration.current;
    const requestId = ++latestProfileRequest.current;
    
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .single();
        
      if (error && error.code !== 'PGRST116') { // PGRST116 is "Row not found"
        console.error('Error fetching profile:', error);
        if (requestId === latestProfileRequest.current && generation === userRequestGeneration.current && requestedUserId === session?.user?.id) {
          setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'profile', false));
        }
        return;
      }

      if (requestId === latestProfileRequest.current && generation === userRequestGeneration.current && requestedUserId === session?.user?.id) {
        setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'profile', true));
      }
      if (data && requestId === latestProfileRequest.current && generation === userRequestGeneration.current && requestedUserId === session?.user?.id) {
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
      if (requestId === latestProfileRequest.current && generation === userRequestGeneration.current && requestedUserId === session?.user?.id) {
        setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'profile', false));
      }
    }
  };

  // Update Profile
  const updateProfile = async (updates: { name?: string; avatar?: string; avatarFile?: File }) => {
    if (!session?.user?.id) return;

    const previousProfile = { ...userProfile };
    let newAvatarUrl = updates.avatar ?? userProfile.avatar;
    let uploadedAvatar: Awaited<ReturnType<typeof uploadImmutableAvatar>> | null = null;

    // Handle File Upload
    if (updates.avatarFile) {
      try {
        const prepared = await prepareAvatarImage(updates.avatarFile);
        uploadedAvatar = await uploadImmutableAvatar(session.user.id, prepared);
        newAvatarUrl = uploadedAvatar.publicUrl;
      } catch (error: any) {
        console.error('Error uploading avatar:', error);
        alert(`头像处理或上传失败：${error.message || '请换一张图片重试'}`);
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
      if (uploadedAvatar && userProfile.avatar && userProfile.avatar !== newAvatarUrl) {
        void removeOwnedAvatar(session.user.id, userProfile.avatar)
          .catch((cleanupError) => console.warn('Previous avatar cleanup was deferred.', cleanupError));
      }
    } catch (error: any) {
      console.error('Error updating profile:', error);
      if (uploadedAvatar?.created) {
        void removeOwnedAvatar(session.user.id, uploadedAvatar.path)
          .catch((cleanupError) => console.warn('Uncommitted avatar cleanup was deferred.', cleanupError));
      }
      setUserProfile(previousProfile);
      alert('个人信息同步失败，原头像保持不变');
    }
  };

  useEffect(() => {
    if (session) {
      fetchProfile();
    }
  }, [session]);
  
  // Modals
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [adjustmentMode, setAdjustmentMode] = useState<'inventory' | 'transit-arrival'>('inventory');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOutboundModal, setShowOutboundModal] = useState(false);
  const [showTransitModal, setShowTransitModal] = useState(false);
  const [showRecycleBin, setShowRecycleBin] = useState(false);
  const [showDataHealth, setShowDataHealth] = useState(false);
  const [showBackupRestore, setShowBackupRestore] = useState(false);
  const [showFeeSchemes, setShowFeeSchemes] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showFirstWarehouseModal, setShowFirstWarehouseModal] = useState(false);
  const [transferProductTarget, setTransferProductTarget] = useState<Product | null>(null);
  
  // Warehouse State
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehousesReady, setWarehousesReady] = useState(false);
  const [warehousesError, setWarehousesError] = useState('');
  const [orphanWarehouseIssueCount, setOrphanWarehouseIssueCount] = useState(0);
  const inventoryAnalytics = analytics;
  useLayoutEffect(() => {
    const nextUserId = session?.user?.id || null;
    if (previousUserId.current === nextUserId) return;
    previousUserId.current = nextUserId;
    userRequestGeneration.current += 1;
    latestDataRequest.current += 1;
    latestWarehouseRequest.current += 1;
    latestProfileRequest.current += 1;

    setIsLoading(false);
    setActivities([]);
    setRecentActivitiesReady(false);
    setRecentActivitiesError('');
    setSupportDiagnosticState(createEmptySupportDiagnosticState());
    setAnalytics(emptyInventoryAnalytics());
    setAnalyticsReady(false);
    setAnalyticsError('');
    setWarehouses([]);
    setWarehousesReady(false);
    setWarehousesError('');
    setOrphanWarehouseIssueCount(0);
    setUserProfile({ name: '卖家用户', avatar: '' });
    setEditingProduct(null);
    setAdjustingProduct(null);
    setAdjustmentMode('inventory');
    setTransferProductTarget(null);
    setShowAddModal(false);
    setShowOutboundModal(false);
    setShowTransitModal(false);
    setShowRecycleBin(false);
    setShowDataHealth(false);
    setShowBackupRestore(false);
    setShowFeeSchemes(false);
    setShowTransferModal(false);
    setShowFirstWarehouseModal(false);
    setCurrentTab(Tab.HOME);
    setRefreshTrigger(0);
  }, [session?.user?.id]);

  const uploadProductImage = async (userId: string, product: Product) => {
    const file = product.imageFile;
    if (!file) {
      return product.imageStorageRef || product.imageUrl;
    }
    return uploadImmutableProductImage(userId, product.sku, file);
  };

  const registerUploadedImageReceipt = async (userId: string, imageRef: string) => {
    try {
      await enqueueProductImageCleanup(userId, imageRef);
    } catch (queueError) {
      try {
        await removeProductImageRefIfUnreferenced(userId, imageRef);
      } catch (cleanupError) {
        console.warn('The uploaded image receipt and immediate cleanup both failed.', cleanupError);
      }
      throw new Error('图片已上传，但设备无法建立安全回收记录；已停止本次保存，请重试');
    }
  };

  const cleanupCommittedPreviousImage = async (userId: string, imageRef?: string) => {
    if (!imageRef) return;
    try {
      await enqueueProductImageCleanup(userId, imageRef);
      await processProductImageCleanupQueue(userId);
    } catch (error) {
      console.warn('Previous product image cleanup was deferred.', error);
      try {
        await removeProductImageRefIfUnreferenced(userId, imageRef);
      } catch (cleanupError) {
        console.warn('Previous product image remains preserved for a later cleanup.', cleanupError);
      }
    }
  };

  // Fetch Warehouses
  const fetchWarehouses = async () => {
    if (!session?.user?.id) return false;
    const requestedUserId = session.user.id;
    const generation = userRequestGeneration.current;
    const requestId = ++latestWarehouseRequest.current;
    try {
      const nextWarehouses = await listWarehouses(requestedUserId);
      if (requestId !== latestWarehouseRequest.current || generation !== userRequestGeneration.current || requestedUserId !== session?.user?.id) return false;
      setWarehouses(nextWarehouses);
      setWarehousesReady(true);
      setWarehousesError('');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'warehouses', true));
      if (nextWarehouses.length > 0) {
        void clearPendingFirstWarehouseCreation(requestedUserId).catch(() => {});
      }
      return true;
    } catch (error) {
      console.error('Error fetching warehouses:', error);
      if (requestId !== latestWarehouseRequest.current || generation !== userRequestGeneration.current) return false;
      setWarehousesError((error as any)?.message || '仓库同步失败');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'warehouses', false));
      return false;
    }
  };

  useEffect(() => {
    if (session && cleanupStartedForUser.current !== session.user.id) {
      cleanupStartedForUser.current = session.user.id;
      fetchWarehouses();
      processProductImageCleanupQueue(session.user.id).catch((error) => {
        console.warn('Deferred product image cleanup remains queued.', error);
      });
    }
    if (!session) cleanupStartedForUser.current = null;
  }, [session]);

  const handleSetDefaultWarehouse = async (id: string) => {
    try {
      const updated = await setDefaultWarehouse(id);
      setWarehouses((current) => current.map((warehouse) => ({ ...warehouse, is_default: warehouse.id === updated.id })));
      setWarehousesReady(true);
      const synced = await fetchWarehouses();
      alert(synced ? '已设置默认仓库' : '默认仓库已设置，但列表刷新失败；请只重试同步，不要重复操作。');
    } catch (error: any) {
      console.error('Set default warehouse error:', error);
      alert(`设置失败：${error?.message || '请稍后重试'}`);
      await fetchWarehouses();
    }
  };

  const handleRenameWarehouse = async (id: string, _oldName: string, newName: string) => {
    try {
      const updated = await renameWarehouse(id, newName);
      setWarehouses((current) => current.map((warehouse) => warehouse.id === id ? updated : warehouse));
      setWarehousesReady(true);
      const [synced] = await Promise.all([fetchWarehouses(), fetchData()]);
      setRefreshTrigger(prev => prev + 1);
      alert(synced ? '仓库名称修改成功，历史流水名称保持不变' : '仓库名称已修改，但列表刷新失败；历史流水名称保持不变，请只重试同步。');
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
        const hasNewImage = Boolean(normalizedProducts[0].imageFile);
        const previousImageRef = normalizedProducts[0].previousImageStorageRef || normalizedProducts[0].imageStorageRef;
        const uploadedImageUrl = await uploadProductImage(session.user.id, normalizedProducts[0]);
        if (hasNewImage && isProductImageRef(uploadedImageUrl)) {
          await registerUploadedImageReceipt(session.user.id, uploadedImageUrl);
        }
        const productsToSave = normalizedProducts.map((product) => ({
          ...product,
          imageUrl: uploadedImageUrl || product.imageUrl || '',
          imageStorageRef: isProductImageRef(uploadedImageUrl) ? uploadedImageUrl : product.imageStorageRef,
          imageDataUrl: '',
          imageFile: undefined,
        }));

        try {
          await batchInboundProducts(productsToSave, session.user.id);
        } catch (batchError) {
          if (hasNewImage && isProductImageRef(uploadedImageUrl)) {
            await enqueueProductImageCleanup(session.user.id, uploadedImageUrl).catch(() => {});
            await processProductImageCleanupQueue(session.user.id).catch(() => {});
          }
          throw batchError;
        }
        if (hasNewImage) {
          await processProductImageCleanupQueue(session.user.id).catch(() => {});
        }
        if (hasNewImage && previousImageRef && previousImageRef !== uploadedImageUrl) {
          void cleanupCommittedPreviousImage(session.user.id, previousImageRef);
        }
        await fetchData();
        setRefreshTrigger((previous) => previous + 1);
        setShowAddModal(false);
        setEditingProduct(null);
        return;
      }

      const product = productInput;
      if (!editingProduct || editingProduct.id !== product.id) {
        throw new Error('普通新增库存必须使用原子入库流程');
      }
      if (Number(product.stock) < 0 || Number(editingProduct.stock) < 0) {
        setShowAddModal(false);
        setEditingProduct(null);
        setShowDataHealth(true);
        throw new Error('该记录存在负库存异常，只能通过数据体检修正');
      }
      if (!session?.user?.id) return;
      const hasNewImage = Boolean(product.imageFile);
      const previousImageRef = product.previousImageStorageRef || editingProduct.imageStorageRef;
      const uploadedImageRef = hasNewImage ? await uploadProductImage(session.user.id, product) : undefined;
      if (hasNewImage && isProductImageRef(uploadedImageRef)) {
        await registerUploadedImageReceipt(session.user.id, uploadedImageRef);
      }
      try {
        await updateProductMetadata(product, session.user.id, uploadedImageRef);
      } catch (metadataError) {
        if (hasNewImage && isProductImageRef(uploadedImageRef)) {
          await enqueueProductImageCleanup(session.user.id, uploadedImageRef).catch(() => {});
          await processProductImageCleanupQueue(session.user.id).catch(() => {});
        }
        throw metadataError;
      }
      if (hasNewImage) {
        await processProductImageCleanupQueue(session.user.id).catch(() => {});
      }
      if (hasNewImage && previousImageRef && previousImageRef !== uploadedImageRef) {
        void cleanupCommittedPreviousImage(session.user.id, previousImageRef);
      }

      await fetchData();
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

  const handleAdjustProduct = (product: Product) => {
    if (Number(product.stock) < 0) {
      setShowDataHealth(true);
      alert('负库存异常只能先通过数据体检修正，不能进入普通盘点调整。');
      return;
    }
    setAdjustmentMode('inventory');
    setAdjustingProduct(product);
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

  const applyVerifiedWarehouses = (nextWarehouses: Warehouse[]) => {
    setWarehouses(nextWarehouses);
    setWarehousesReady(true);
    setWarehousesError('');
  };

  const verifyWarehouseByName = async (name: string): Promise<Warehouse | null> => {
    if (!session?.user?.id) throw new Error('登录状态已失效，请重新登录');
    const requestedUserId = session.user.id;
    const generation = userRequestGeneration.current;
    const nextWarehouses = await listWarehouses(requestedUserId);
    if (generation !== userRequestGeneration.current || requestedUserId !== session?.user?.id) {
      throw new Error('账号已切换，请在当前账号重新操作');
    }
    applyVerifiedWarehouses(nextWarehouses);
    const normalizedName = name.trim().toLocaleLowerCase('zh-CN');
    return nextWarehouses.find((warehouse) => warehouse.name.trim().toLocaleLowerCase('zh-CN') === normalizedName) || null;
  };

  const handleAddWarehouse = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !session?.user?.id) throw new Error('请输入仓库名称');
    let created: Warehouse;
    try {
      created = await createWarehouse(trimmedName);
    } catch (createError) {
      try {
        const verified = await verifyWarehouseByName(trimmedName);
        if (verified) return verified;
      } catch {
        const unknownError = new Error('创建结果暂时无法核对，请先恢复网络后核对，不要重复创建') as Error & { code: string };
        unknownError.code = 'WAREHOUSE_CREATE_UNKNOWN';
        throw unknownError;
      }
      throw createError;
    }
    setWarehouses((current) => current.some((warehouse) => warehouse.id === created.id) ? current : [...current, created]);
    setWarehousesReady(true);
    const synced = await fetchWarehouses();
    if (!synced) alert('仓库已创建，但列表刷新失败；请只重试同步，不要再次创建。');
    return created;
  };

  const handleDeleteWarehouse = async (id: string) => {
    await deleteWarehouse(id);
    setWarehouses((current) => {
      const remaining = current.filter((warehouse) => warehouse.id !== id);
      if (remaining.length > 0 && !remaining.some((warehouse) => warehouse.is_default)) {
        return remaining.map((warehouse, index) => ({ ...warehouse, is_default: index === 0 }));
      }
      return remaining;
    });
    setWarehousesReady(true);
    const synced = await fetchWarehouses();
    if (!synced) alert('仓库已删除，但列表刷新失败；请只重试同步，不要重复删除。');
    setRefreshTrigger((value) => value + 1);
  };

  const handleInboundEntry = async () => {
    if (!warehousesReady) {
      alert('仓库信息尚未同步成功，请先重试，避免重复创建仓库。');
      return;
    }
    if (warehouses.length === 0 && warehousesError) {
      alert('仓库列表刷新失败，暂时无法确认账号仍为空。请先重新同步，避免重复创建。');
      return;
    }
    if (warehouses.length === 0) {
      setShowFirstWarehouseModal(true);
      return;
    }
    setEditingProduct(null);
    setShowAddModal(true);
  };

  const handleOutboundEntry = async () => {
    if (!warehousesReady) {
      alert('仓库信息尚未同步成功，请先重试。');
      return;
    }
    setShowOutboundModal(true);
  };

  const handleTransitEntry = async () => {
    if (!warehousesReady) {
      alert('仓库信息尚未同步成功，请先重试。');
      return;
    }
    setShowTransitModal(true);
  };

  const handleBatchDeleteProducts = async (productIds: string[]) => {
    if (!session?.user?.id || productIds.length === 0) return;

    try {
      await deleteProducts(productIds);
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

  const handleOutboundProduct = async (product: Product, price: number, quantity: number, feeSelection: OutboundFeeSelection, operationId: string, mode: OutboundExecutionMode, orderMetadata?: { externalOrderNo?: string; note?: string }, platform: string = '得物') => {
    if (!session?.user?.id) return;
    
    try {
      if (mode === 'sales_order') {
        await createSalesOrder({ product, userId: session.user.id, unitSalePrice: price, quantity, platform, feeSelection, operationId, ...orderMetadata });
      } else {
        await outboundProduct({ product, userId: session.user.id, salePrice: price, quantity, platform, feeSelection, operationId });
      }

      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowOutboundModal(false);
      alert(mode === 'sales_order' ? `销售订单已创建，已预留库存 ${quantity} 件` : `出库成功 (x${quantity})`);
      
    } catch (error: any) {
      console.error('Outbound error:', error);
      alert(`出库失败: ${error.message || JSON.stringify(error)}`);
      throw error;
    }
  };

  // Fetch Data
  const fetchData = async () => {
    if (!session?.user?.id) return;
    const requestedUserId = session.user.id;
    const generation = userRequestGeneration.current;
    const requestId = ++latestDataRequest.current;
    if (!analyticsReady) setIsLoading(true);
    const [analyticsResult, recentResult, orphanResult] = await Promise.allSettled([
      getInventoryAnalytics(),
      listRecentActivities(requestedUserId, 10),
      countOrphanWarehouseProducts(),
    ]);
    if (requestId !== latestDataRequest.current || generation !== userRequestGeneration.current || requestedUserId !== session?.user?.id) return;

    if (analyticsResult.status === 'fulfilled') {
      setAnalytics(analyticsResult.value);
      setAnalyticsReady(true);
      setAnalyticsError('');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'analytics', true));
    } else {
      console.error('Analytics fetch error:', analyticsResult.reason);
      setAnalyticsError(analyticsResult.reason?.message || '库存与经营摘要同步失败');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'analytics', false));
    }
    if (recentResult.status === 'fulfilled') {
      setActivities(recentResult.value);
      setRecentActivitiesReady(true);
      setRecentActivitiesError('');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'recentActivities', true));
    } else {
      console.error('Recent activities fetch error:', recentResult.reason);
      setRecentActivitiesError(recentResult.reason?.message || '最近动态加载失败');
      setSupportDiagnosticState((current) => recordDiagnosticDomainResult(current, 'recentActivities', false));
    }
    if (orphanResult.status === 'fulfilled') setOrphanWarehouseIssueCount(orphanResult.value);
    setIsLoading(false);
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
  if (session && isLoading && !analyticsReady && warehouses.length === 0) {
      return (
        <div className="h-full w-full bg-slate-50 dark:bg-black flex flex-col items-center justify-center">
           <Loader2 className="w-8 h-8 animate-spin mb-2 text-dewu-500" />
           <span className="text-xs text-slate-400">加载资源中...</span>
        </div>
      );
  }

  const renderContent = () => {
    switch (currentTab) {
      case Tab.HOME:
        return (
          <Home 
            userId={session.user.id}
            warehouses={warehouses}
            warehousesReady={warehousesReady}
            warehousesError={warehousesError}
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={handleInboundEntry}
            onOutboundClick={handleOutboundEntry}
            onTransitClick={handleTransitEntry}
            activities={activities}
            transitProductCount={inventoryAnalytics.dashboard.shippingProductCount}
            todaySalesAmount={inventoryAnalytics.dashboard.todaySalesAmount}
            todaySalesCount={inventoryAnalytics.dashboard.todaySalesCount}
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            analytics={inventoryAnalytics}
            analyticsReady={analyticsReady}
            analyticsError={analyticsError}
            recentActivitiesReady={recentActivitiesReady}
            recentActivitiesError={recentActivitiesError}
            onRetryData={fetchData}
            onRetryWarehouses={fetchWarehouses}
            onStartFirstWarehouse={() => setShowFirstWarehouseModal(true)}
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
            onAdjustProduct={handleAdjustProduct}
            onTransferProduct={(product) => {
              setTransferProductTarget(product);
              setShowTransferModal(true);
            }}
            onDeleteProduct={handleDeleteProduct}
            onBatchDeleteProducts={handleBatchDeleteProducts}
            warehouses={warehouses}
            warehousesReady={warehousesReady}
            warehousesError={warehousesError}
            onRetryWarehouses={fetchWarehouses}
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
            analytics={inventoryAnalytics}
            analyticsReady={analyticsReady}
            analyticsError={analyticsError}
            onRetryData={fetchData}
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
            diagnosticState={supportDiagnosticState}
          />
        );
      default:
        return <Home 
            userId={session.user.id}
            warehouses={warehouses}
            warehousesReady={warehousesReady}
            warehousesError={warehousesError}
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={handleInboundEntry}
            onOutboundClick={handleOutboundEntry}
            onTransitClick={handleTransitEntry}
            activities={activities}
            transitProductCount={inventoryAnalytics.dashboard.shippingProductCount}
            todaySalesAmount={inventoryAnalytics.dashboard.todaySalesAmount}
            todaySalesCount={inventoryAnalytics.dashboard.todaySalesCount}
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            analytics={inventoryAnalytics}
            analyticsReady={analyticsReady}
            analyticsError={analyticsError}
            recentActivitiesReady={recentActivitiesReady}
            recentActivitiesError={recentActivitiesError}
            onRetryData={fetchData}
            onRetryWarehouses={fetchWarehouses}
            onStartFirstWarehouse={() => setShowFirstWarehouseModal(true)}
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
            {showAddModal && (
              <AddProductModal
                isOpen
                onClose={() => {
                  setShowAddModal(false);
                  setEditingProduct(null);
                }}
                onSave={handleAddOrUpdateProduct}
                onDelete={handleDeleteProduct}
                initialData={editingProduct}
                warehouses={warehouses}
                userId={session.user.id}
              />
            )}
            {showFirstWarehouseModal && (
              <FirstWarehouseModal
                isOpen
                userId={session.user.id}
                onClose={() => setShowFirstWarehouseModal(false)}
                onCreate={handleAddWarehouse}
                onVerify={verifyWarehouseByName}
                onCreated={() => {
                  setShowFirstWarehouseModal(false);
                  setEditingProduct(null);
                  setShowAddModal(true);
                }}
              />
            )}
            {adjustingProduct && (
              <InventoryAdjustmentModal
                isOpen
                userId={session.user.id}
                product={adjustingProduct}
                mode={adjustmentMode}
                onClose={() => {
                  setAdjustingProduct(null);
                  setAdjustmentMode('inventory');
                }}
                onSaved={async () => {
                  await fetchData();
                  setRefreshTrigger((value) => value + 1);
                }}
              />
            )}
            {showOutboundModal && (
              <OutboundModal
                isOpen
                onClose={() => setShowOutboundModal(false)}
                userId={session.user.id}
                onOutbound={handleOutboundProduct}
              />
            )}
            {showTransitModal && (
              <TransitInventoryModal
                isOpen
                onClose={() => setShowTransitModal(false)}
                userId={session.user.id}
                onReviewArrival={(product) => {
                  setShowTransitModal(false);
                  setAdjustmentMode('transit-arrival');
                  setAdjustingProduct(product);
                }}
              />
            )}
            {showRecycleBin && (
              <RecycleBinModal
                isOpen
                onClose={() => setShowRecycleBin(false)}
                userId={session.user.id}
                onRestored={() => {
                  fetchData();
                  setRefreshTrigger((value) => value + 1);
                }}
              />
            )}
            {showDataHealth && (
              <DataHealthModal
                isOpen
                userId={session.user.id}
                onClose={() => setShowDataHealth(false)}
                onRepaired={() => {
                  fetchData();
                  setRefreshTrigger((value) => value + 1);
                }}
              />
            )}
            {showBackupRestore && (
              <BackupRestoreModal
                isOpen
                userId={session.user.id}
                onClose={() => setShowBackupRestore(false)}
                onRestored={() => {
                  fetchData();
                  setRefreshTrigger((value) => value + 1);
                }}
              />
            )}
            {showFeeSchemes && (
              <FeeSchemeModal
                isOpen
                userId={session.user.id}
                onClose={() => setShowFeeSchemes(false)}
              />
            )}
            {showTransferModal && transferProductTarget && (
              <TransferProductModal
                isOpen
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
            )}
          </>
        )}
        
      </div>
    </div>
  );
}
