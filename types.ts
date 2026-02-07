import React from 'react';

export enum Tab {
  HOME = 'home',
  PRODUCTS = 'products',
  STATS = 'stats',
  ME = 'me'
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  size: string;
  sku: string;
  price: number;
  stock: number;
  imageUrl: string;
  status: 'instock' | 'shipping' | 'sold';
  location?: string;
  warehouse?: string;
}

export interface Activity {
  id: string;
  type: 'inbound' | 'outbound' | 'pending';
  productName: string;
  time: string;
  sku: string;
  size?: string;
  price: number; // For outbound, this is the SELLING PRICE
  cost?: number; // For outbound, this is the COST PRICE (for profit calc)
  imageUrl: string;
  createdAt: string; // CamelCase for internal usage
  created_at?: string; // SnakeCase for DB compatibility
  warehouse?: string;
  count?: number;
}

export interface SalesStat {
  name: string;
  value: number;
}

export interface Warehouse {
  id: string;
  name: string;
  is_default?: boolean;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  action?: () => void;
}