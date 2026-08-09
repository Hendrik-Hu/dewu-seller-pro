import React from 'react';
import { Package } from 'lucide-react';

interface ProductImageProps {
  src?: string;
  alt: string;
  className: string;
}

export const ProductImage: React.FC<ProductImageProps> = ({ src, alt, className }) => {
  if (src?.trim()) {
    return <img src={src} alt={alt} className={className} />;
  }

  return (
    <div className={`${className} flex items-center justify-center text-slate-300`} role="img" aria-label={`${alt} 暂无图片`}>
      <Package size={22} />
    </div>
  );
};
