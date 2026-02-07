import React, { useState, useEffect } from 'react';
import { WelcomeScreen } from './components/WelcomeScreen';
import { AuthScreen } from './components/AuthScreen';
import { BottomNav } from './components/BottomNav';
import { Home } from './components/Home';
import { ProductList } from './components/ProductList';
import { Stats } from './components/Stats';
import { Profile } from './components/Profile';
import { AddProductModal } from './components/AddProductModal';
import { OutboundModal } from './components/OutboundModal';
import { PendingOrdersModal } from './components/PendingOrdersModal';
import { WidgetSettingsModal } from './components/WidgetSettingsModal';
import { updateWidgetData } from './utils/widget';
import { Tab, Product, Activity, Warehouse } from './types';
import { supabase } from './lib/supabase';
import { Loader2 } from 'lucide-react';
import { Session } from '@supabase/supabase-js';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [showWelcome, setShowWelcome] = useState(true);
  const [currentTab, setCurrentTab] = useState<Tab>(Tab.HOME);
  const [isLoading, setIsLoading] = useState(false);
  
  // App State
  const [products, setProducts] = useState<Product[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  
  // Dashboard Stats State
  const [pendingCount, setPendingCount] = useState(0);
  const [todaySales, setTodaySales] = useState({ amount: 0, count: 0 });
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
    avatar: 'https://picsum.photos/200/200?random=user'
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
        let avatarUrl = data.avatar_url || 'https://picsum.photos/200/200?random=user';
        
        // Fix for legacy data: if avatar is a blob URL (which is temporary), revert to default
        if (avatarUrl.startsWith('blob:')) {
            console.warn('Found invalid blob URL in profile, reverting to default.');
            avatarUrl = 'https://picsum.photos/200/200?random=user';
            // Optional: Auto-fix in background
            updateProfile({ avatar: avatarUrl });
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

    let newAvatarUrl = updates.avatar || userProfile.avatar;

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
  
  // Warehouse State
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

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

  const handleAddOrUpdateProduct = async (product: Product) => {
    try {
      // Check for existing product with same SKU and Size (Unique constraint logic)
      const existingProduct = products.find(
        p => p.sku === product.sku && p.size === product.size && p.id !== product.id
      );

      let finalProduct = { ...product };
      let isMerge = false;

      // If adding new product and duplicate found
      if (existingProduct && !editingProduct) {
        const confirmMerge = confirm(
          `检测到仓库中已存在 [${existingProduct.sku} - ${existingProduct.size}码]。\n\n` +
          `现有库存: ${existingProduct.stock} 件\n` +
          `现有成本: ¥${existingProduct.price}\n\n` +
          `将执行合并入库，并自动计算平均成本。是否继续？`
        );
        
        if (!confirmMerge) return;

        isMerge = true;
        // Weighted average price calculation
        const totalValue = (existingProduct.price * existingProduct.stock) + (product.price * product.stock);
        const totalStock = existingProduct.stock + product.stock;
        const avgPrice = parseFloat((totalValue / totalStock).toFixed(2));

        finalProduct = {
          ...existingProduct,
          price: avgPrice,
          stock: totalStock,
          location: product.location || existingProduct.location,
          warehouse: product.warehouse || existingProduct.warehouse || '杭州一号仓',
          status: 'instock'
        };
      }

      // Map to DB
      const dbProduct = {
        id: finalProduct.id,
        name: finalProduct.name,
        brand: finalProduct.brand,
        size: finalProduct.size,
        sku: finalProduct.sku,
        price: finalProduct.price,
        stock: finalProduct.stock,
        image_url: finalProduct.imageUrl,
        status: finalProduct.status,
        location: finalProduct.location,
        warehouse: finalProduct.warehouse,
        created_at: new Date().toISOString(),
        user_id: session?.user.id
      };

      const { error } = await supabase
        .from('products')
        .upsert(dbProduct);

      if (error) throw error;

      // Add Activity Log
      if (!editingProduct || isMerge) {
         const newActivity = {
            id: `act-${Date.now()}`,
            type: 'inbound',
            product_name: finalProduct.name,
            time: '刚刚',
            sku: finalProduct.sku,
            size: finalProduct.size,
            price: isMerge ? product.price : finalProduct.price, // Cost price for inbound
            cost: isMerge ? product.price : finalProduct.price,
            image_url: finalProduct.imageUrl,
            created_at: new Date().toISOString(),
            warehouse: finalProduct.warehouse,
            count: Number(product.stock), // Force number type
            user_id: session?.user.id
         };
         const { error: insertActError } = await supabase.from('activities').insert(newActivity);
         if (insertActError) {
             console.error('Activity Insert Error:', insertActError);
             // alert('日志记录失败: ' + insertActError.message); // Optional: alert user
         }
      }

      fetchData();
      setRefreshTrigger(prev => prev + 1); // Trigger refresh for ProductList
      setShowAddModal(false);
      setEditingProduct(null);

    } catch (error: any) {
      console.error('Error saving product:', error);
      alert(`保存失败: ${error.message || JSON.stringify(error)}`);
    }
  };

  const handleEditClick = (product: Product) => {
    setEditingProduct(product);
    setShowAddModal(true);
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!confirm('确定要删除该商品吗？')) return;
    
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', productId)
        .eq('user_id', session?.user?.id);
        
      if (error) throw error;
      
      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowAddModal(false);
      
    } catch (error: any) {
      console.error('Delete error:', error);
      alert('删除失败');
    }
  };

  const handleOutboundProduct = async (product: Product, price: number, platform: string = '得物') => {
    if (!session?.user?.id) return;
    
    try {
      if (product.stock < 1) {
        alert('库存不足');
        return;
      }

      // 1. Update Product
      const { error: prodError } = await supabase
        .from('products')
        .update({ stock: product.stock - 1 })
        .eq('id', product.id)
        .eq('user_id', session.user.id);
        
      if (prodError) throw prodError;

      // 2. Create Activity
      const newActivity = {
        id: `act-${Date.now()}`,
        type: 'outbound',
        product_name: product.name,
        time: '刚刚',
        sku: product.sku,
        size: product.size,
        price: price, // Sale Price
        cost: product.price, // Cost Price
        image_url: product.imageUrl,
        created_at: new Date().toISOString(),
        warehouse: product.warehouse,
        count: 1,
        platform: platform,
        user_id: session.user.id
      };
      
      const { error: actError } = await supabase
        .from('activities')
        .insert(newActivity);
        
      if (actError) throw actError;

      fetchData();
      setRefreshTrigger(prev => prev + 1);
      setShowOutboundModal(false);
      alert('出库成功');
      
    } catch (error: any) {
      console.error('Outbound error:', error);
      alert('出库失败');
    }
  };

  // Fetch Data
  const fetchData = async () => {
    if (!session?.user?.id) return;
    setIsLoading(true);
    try {
      const { data: productsData, error: prodError } = await supabase
        .from('products')
        .select('*')
        .eq('user_id', session.user.id);
      
      if (prodError) throw prodError;

      const { data: activitiesData, error: actError } = await supabase
        .from('activities')
        .select('*')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (actError) throw actError;

      // Ensure count is number
      const typedActivities = (activitiesData || []).map(a => ({
        ...a,
        count: a.count ? Number(a.count) : 1, // Fallback to 1 if count is null/0/undefined
        price: Number(a.price),
        cost: Number(a.cost),
        createdAt: a.created_at || a.createdAt // Unify date field
      }));

      setProducts(productsData || []);
      setActivities(typedActivities || []);

      // Calculate Dashboard Stats
      const pending = typedActivities.filter(a => a.type === 'pending').length;
      setPendingCount(pending);

      const today = new Date().toISOString().split('T')[0];
      const todaySalesData = typedActivities.filter(a => a.type === 'outbound' && a.created_at.startsWith(today));
      setTodaySales({
        amount: todaySalesData.reduce((sum, a) => sum + (a.price || 0), 0),
        count: todaySalesData.length
      });

      // Update Widget Data
      const currentTotalStock = (productsData || []).reduce((sum, p) => sum + (p.status === 'instock' ? p.stock : 0), 0);
      const currentTodayInbound = (typedActivities || [])
        .filter(a => a.type === 'inbound' && (a.created_at || a.createdAt || '').startsWith(today))
        .reduce((sum, a) => sum + (a.count || 1), 0);
        
      updateWidgetData({
        totalStock: currentTotalStock,
        inboundToday: currentTodayInbound,
        lastUpdated: new Date().toLocaleTimeString()
      });

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
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={() => {
              setEditingProduct(null);
              setShowAddModal(true);
            }} 
            onOutboundClick={() => setShowOutboundModal(true)}
            onPendingClick={() => setShowPendingModal(true)}
            activities={activities}
            pendingOrderCount={pendingCount} // Pass real data
            todaySalesAmount={todaySales.amount} // Pass real data
            todaySalesCount={todaySales.count} // Pass real data
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            products={products} // Pass products for inventory stats
          />
        );
      case Tab.PRODUCTS:
        return (
          <ProductList 
            onAddClick={() => {
              setEditingProduct(null);
              setShowAddModal(true);
            }}
            onEditProduct={handleEditClick}
            onDeleteProduct={handleDeleteProduct}
            warehouses={warehouses}
            onRenameWarehouse={handleRenameWarehouse}
            onSetDefaultWarehouse={handleSetDefaultWarehouse}
            refreshTrigger={refreshTrigger}
          />
        );
      case Tab.STATS:
        return <Stats products={products} activities={activities} />;
      case Tab.ME:
        // Calculate Stats for Profile
        const totalStock = products.reduce((sum, p) => sum + (p.status === 'instock' ? p.stock : 0), 0);
        
        // Use the 'count' field if available (for new data), otherwise 1 (for legacy)
        const totalInbound = activities
            .filter(a => a.type === 'inbound')
            .reduce((sum, a) => sum + (a.count || 1), 0);
            
        const totalOutbound = activities
            .filter(a => a.type === 'outbound')
            .length; // Outbound is always 1 per activity currently (logic in handleOutboundProduct)

        return (
          <Profile 
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onUpdateName={(name) => updateProfile({ name })}
            onUpdateAvatar={(file) => updateProfile({ avatarFile: file })}
            totalStock={totalStock}
            totalInbound={totalInbound}
            totalOutbound={totalOutbound}
            isDarkMode={isDarkMode}
            onToggleTheme={() => setIsDarkMode(!isDarkMode)}
            onLogout={handleLogout}
            email={session?.user?.email}
            onWidgetClick={() => setShowWidgetModal(true)}
          />
        );
      default:
        return <Home 
            username={userProfile.name}
            avatarUrl={userProfile.avatar}
            onInboundClick={() => setShowAddModal(true)} 
            onOutboundClick={() => setShowOutboundModal(true)}
            onPendingClick={() => setShowPendingModal(true)}
            activities={activities}
            pendingOrderCount={pendingCount}
            todaySalesAmount={todaySales.amount}
            todaySalesCount={todaySales.count}
            onAvatarClick={() => setCurrentTab(Tab.ME)}
            products={products}
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
            />
            <WidgetSettingsModal
              isOpen={showWidgetModal}
              onClose={() => setShowWidgetModal(false)}
              totalStock={products.reduce((sum, p) => sum + (p.status === 'instock' ? p.stock : 0), 0)}
              todayInbound={activities
                .filter(a => a.type === 'inbound' && (a.created_at || a.createdAt || '').startsWith(new Date().toISOString().split('T')[0]))
                .reduce((sum, a) => sum + (a.count || 1), 0)}
            />
          </>
        )}
        
      </div>
    </div>
  );
}