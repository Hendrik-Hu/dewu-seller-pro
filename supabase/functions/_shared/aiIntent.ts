export type InventoryExecutionType = "inbound" | "outbound";

export const requiresWarehouseSetup = (message: string, warehouseCount: number) =>
  warehouseCount === 0 && /入库|进货|补货|新增库存|出库|卖了|卖掉|卖出|售出|发货/.test(message.trim().toLowerCase());

export const evaluateExplicitExecutionIntent = (
  message: string,
  actionType: InventoryExecutionType,
  brand: string,
) => {
  const normalizedMessage = message.trim().toLowerCase();
  const normalizedBrand = brand.trim().toLowerCase();
  const hasInboundIntent = /入库|进货|补货|新增库存/.test(normalizedMessage);
  const hasOutboundIntent = /出库|卖了|卖掉|卖出|售出|发货/.test(normalizedMessage);
  const hasOneDirection = hasInboundIntent !== hasOutboundIntent;

  return {
    brandExplicit: Boolean(normalizedBrand && normalizedMessage.includes(normalizedBrand)),
    operationExplicit: hasOneDirection,
    directionMatches: hasOneDirection && (
      (actionType === "inbound" && hasInboundIntent) ||
      (actionType === "outbound" && hasOutboundIntent)
    ),
    salePriceExplicit: actionType === "inbound" ||
      /(?:(?:售价|卖价|实收|成交价)\s*[:：]?\s*(?:¥|￥)?\s*\d+(?:\.\d+)?|(?:¥|￥)\s*\d+(?:\.\d+)?)/.test(normalizedMessage),
  };
};
