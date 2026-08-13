import React from 'react';
import { Home, Package, BarChart3, User } from 'lucide-react';
import { Tab } from '../types';

interface BottomNavProps {
  currentTab: Tab;
  onTabChange: (tab: Tab) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onTabChange }) => {
  const navItems = [
    { id: Tab.HOME, label: '首页', icon: Home },
    { id: Tab.PRODUCTS, label: '库存', icon: Package },
    { id: Tab.STATS, label: '统计', icon: BarChart3 },
    { id: Tab.ME, label: '我的', icon: User },
  ];

  return (
    <nav aria-label="主导航" className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-slate-200 bg-white/95 px-3 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      <div className="flex h-16 items-center justify-around">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              className="app-touch flex w-[72px] flex-col items-center justify-center gap-0.5 rounded-lg transition-colors active:bg-slate-100 dark:active:bg-zinc-800"
            >
              <div className={`flex h-8 w-10 items-center justify-center rounded-lg transition-colors ${isActive ? 'bg-dewu-50 dark:bg-dewu-900/20' : 'bg-transparent'}`}>
                <Icon 
                  size={24} 
                  className={`transition-colors ${isActive ? 'text-dewu-500 dark:text-dewu-400 fill-dewu-500/10' : 'text-slate-400 dark:text-zinc-500'}`} 
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </div>
              <span className={`text-xs font-semibold ${isActive ? 'text-dewu-600 dark:text-dewu-400' : 'text-slate-500 dark:text-zinc-400'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
