import React, { useEffect, useState } from 'react';
import { Package } from 'lucide-react';

interface WelcomeScreenProps {
  onComplete: () => void;
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onComplete }) => {
  const [fade, setFade] = useState(false);

  useEffect(() => {
    // Start fade out animation
    const timer1 = setTimeout(() => {
      setFade(true);
    }, 2000);

    // Complete transition
    const timer2 = setTimeout(() => {
      onComplete();
    }, 2500);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [onComplete]);

  return (
    <div 
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-white transition-opacity duration-500 ${fade ? 'opacity-0' : 'opacity-100'}`}
    >
      <div className="bg-dewu-50 p-6 rounded-3xl mb-6 shadow-sm animate-bounce">
        <Package className="w-16 h-16 text-dewu-500" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900 mb-2">得物卖家助手</h1>
      <p className="text-slate-400 text-sm">专业的潮牌仓储管理</p>
      
      <div className="absolute bottom-10 flex flex-col items-center">
        <div className="w-8 h-8 border-4 border-dewu-200 border-t-dewu-500 rounded-full animate-spin mb-4"></div>
        <span className="text-xs text-slate-300 font-medium">LOADING...</span>
      </div>
    </div>
  );
};