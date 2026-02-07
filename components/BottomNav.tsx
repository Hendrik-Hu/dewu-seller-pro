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
    { id: Tab.PRODUCTS, label: '商品', icon: Package },
    { id: Tab.STATS, label: '统计', icon: BarChart3 },
    { id: Tab.ME, label: '我的', icon: User },
  ];

  return (
    <div className="bg-white dark:bg-zinc-900 border-t border-gray-100 dark:border-zinc-800 pb-safe pt-2 px-6 fixed bottom-0 w-full z-40 max-w-md left-0 right-0 mx-auto transition-colors duration-300">
      <div className="flex justify-between items-center h-16">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onTabChange(item.id)}
              className="flex flex-col items-center justify-center w-16 space-y-1 transition-all active:scale-95"
            >
              <div className={`p-1.5 rounded-xl transition-colors ${isActive ? 'bg-dewu-50 dark:bg-dewu-900/20' : 'bg-transparent'}`}>
                <Icon 
                  size={24} 
                  className={`transition-colors ${isActive ? 'text-dewu-500 dark:text-dewu-400 fill-dewu-500/10' : 'text-slate-400 dark:text-zinc-500'}`} 
                  strokeWidth={isActive ? 2.5 : 2}
                />
              </div>
              <span className={`text-[10px] font-medium ${isActive ? 'text-dewu-600 dark:text-dewu-400' : 'text-slate-400 dark:text-zinc-500'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};