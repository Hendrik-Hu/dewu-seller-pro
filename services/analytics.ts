import { supabase } from '../lib/supabase';
import type { InventoryAnalytics } from '../lib/inventoryMetrics';
import { parseInventoryAnalytics, parseWarehouseSummary } from '../lib/analyticsValidation';

export const emptyInventoryAnalytics = (): InventoryAnalytics => ({
  dataQuality: { negativeStockCount: 0, invalidActivityCount: 0 },
  dashboard: { pendingOrderCount: 0, totalSkuCount: 0, totalVariantCount: 0, todaySalesAmount: 0, todaySalesCount: 0, todayInboundCount: 0, totalStock: 0, totalInventoryValue: 0 },
  lifetime: { totalInboundCount: 0, totalOutboundCount: 0 },
  monthly: {
    salesAmount: 0, costedSalesAmount: 0, costAmount: 0, grossProfitAmount: 0, grossMarginRate: 0,
    costCoverageRate: 100, missingCostCount: 0, costedOutboundCount: 0,
    estimatedNetProfitAmount: 0, estimatedProfitCount: 0, estimatedProfitCoverageRate: 100,
    actualNetProfitAmount: 0, actualProfitCount: 0, actualProfitCoverageRate: 100,
    settlementCoverageRate: 100, pendingSettlementCount: 0, inboundCount: 0, outboundCount: 0,
  },
  charts: { salesTrend: [], topBrands: [], topProducts: [], topStockProducts: [] },
  pendingProducts: [],
});

export const getInventoryAnalytics = async (asOf?: Date): Promise<InventoryAnalytics> => {
  const { data, error } = await supabase.rpc('get_inventory_analytics', asOf ? { p_as_of: asOf.toISOString() } : {});
  if (error) throw error;
  return parseInventoryAnalytics(data, emptyInventoryAnalytics());
};

export interface WarehouseInventorySummary {
  totalCount: number;
  totalValue: number;
  warehouseCount: number;
  warehouseValue: number;
}

export const getInventoryWarehouseSummary = async (warehouse: string): Promise<WarehouseInventorySummary> => {
  const { data, error } = await supabase.rpc('get_inventory_warehouse_summary', { p_warehouse: warehouse });
  if (error) throw error;
  return parseWarehouseSummary(data);
};
