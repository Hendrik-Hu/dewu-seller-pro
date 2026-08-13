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
  imageStorageRef?: string;
  deletedAt?: string;
  status: 'instock' | 'shipping' | 'sold' | 'flaw';
  location?: string;
  warehouse?: string;
  source?: string;
  imageFile?: File;
  imageDataUrl?: string;
  imageDraftId?: string;
  previousImageStorageRef?: string;
}

export interface Activity {
  id: string;
  type: 'inbound' | 'outbound' | 'pending' | 'restore' | 'transfer';
  productName: string;
  time: string;
  sku: string;
  size?: string;
  price: number; // For outbound, this is the SELLING PRICE
  cost?: number; // For outbound, this is the COST PRICE (for profit calc)
  imageUrl: string;
  imageStorageRef?: string;
  createdAt: string; // CamelCase for internal usage
  created_at?: string; // SnakeCase for DB compatibility
  warehouse?: string;
  count?: number;
  source?: string;
  platform?: string;
  feeSnapshot?: Record<string, unknown>;
  estimatedPlatformFee?: number;
  estimatedNetProceeds?: number;
  estimatedNetProfit?: number;
  actualPlatformFee?: number;
  actualNetProceeds?: number;
  actualNetProfit?: number;
  settledAt?: string;
  settlementOrderNo?: string;
  settlementNote?: string;
  settlementRevision?: number;
}

export interface OutboundSettlementAudit {
  id: string;
  activityId: string;
  revision: number;
  previousSnapshot?: Record<string, unknown>;
  settlementSnapshot: Record<string, unknown>;
  createdAt: string;
}

export type SalesOrderStatus =
  | 'pending_shipment'
  | 'shipped'
  | 'authenticating'
  | 'authenticated'
  | 'settled'
  | 'canceled'
  | 'auth_failed'
  | 'returning'
  | 'returned'
  | 'refunded';

export interface SalesOrder {
  id: string;
  status: SalesOrderStatus;
  productId: string;
  productName: string;
  brand: string;
  sku: string;
  size: string;
  warehouse: string;
  quantity: number;
  unitSalePrice: number;
  frozenUnitCost: number;
  platform: string;
  externalOrderNo?: string;
  note?: string;
  feeSnapshot: Record<string, unknown>;
  estimatedPlatformFee?: number;
  estimatedNetProceeds?: number;
  estimatedNetProfit?: number;
  outboundActivityId?: string;
  inventoryRestored: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type OutboundExecutionMode = 'sales_order' | 'quick_ledger';

export interface SalesStat {
  name: string;
  value: number;
}

export interface Warehouse {
  id: string;
  name: string;
  is_default?: boolean;
}

export interface FeeScheme {
  id: string;
  name: string;
  saleMode: string;
  category: string;
  percentRate: number;
  percentMin?: number;
  percentMax?: number;
  percentageUnit: 'transaction' | 'item';
  fixedFee: number;
  fixedFeeUnit: 'transaction' | 'item';
  shippingFee: number;
  shippingFeeUnit: 'transaction' | 'item';
  otherFee: number;
  otherFeeUnit: 'transaction' | 'item';
  effectiveFrom: string;
  isDefault: boolean;
  updatedAt: string;
}

export interface FeeQuote {
  known: boolean;
  grossAmount: number;
  costAmount: number;
  percentageCalculated?: number;
  percentageApplied?: number;
  percentageUnit?: 'transaction' | 'item';
  percentageUnitCount?: number;
  fixedFee?: number;
  fixedFeeUnit?: 'transaction' | 'item';
  fixedFeeMultiplier?: number;
  shippingFee?: number;
  shippingFeeUnit?: 'transaction' | 'item';
  shippingFeeMultiplier?: number;
  otherFee?: number;
  otherFeeUnit?: 'transaction' | 'item';
  otherFeeMultiplier?: number;
  calculatedFee?: number;
  manualFeeOverride?: number;
  totalFee?: number;
  netProceeds?: number;
  netProfit?: number;
  netMarginRate?: number;
  breakEvenUnitPrice?: number;
}

export interface OutboundFeeSelection {
  schemeId?: string;
  schemeUpdatedAt?: string;
  manualFeeOverride?: number;
  quote: FeeQuote;
}

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  action?: () => void;
}
