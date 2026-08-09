import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateExplicitExecutionIntent } from "../_shared/aiIntent.ts";
import { buildAiInventorySummary, formatAiInventorySummaryAnswer } from "../_shared/aiInventorySummary.ts";
import { isExecutablePlan } from "../_shared/aiPlanPolicy.ts";
import { serializeAiContext } from "../_shared/aiContext.ts";
import { parseBasicInventoryCommand } from "../_shared/aiFallbackParsing.ts";
import { getTrustedAiInboundImageUrl } from "../_shared/aiMediaPolicy.ts";
import { buildDeterministicInventoryAnswer } from "../_shared/aiQueryResponse.ts";
import { resolveAiInboundProductName } from "../_shared/aiMasterDataPolicy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type AgentActionType = "inbound" | "outbound" | "answer";

interface AgentAction {
  type: AgentActionType;
  input?: Record<string, unknown>;
  message?: string;
}

interface ActionResult {
  type: string;
  status: "success" | "failed" | "planned" | "answered";
  summary: string;
}

interface PlanEnvelope {
  version: 1;
  planId: string;
  userId: string;
  actions: AgentAction[];
  issuedAt: string;
  expiresAt: string;
}

const PLAN_TTL_MS = 10 * 60 * 1000;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const toNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value: unknown, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const normalizeSku = (value: unknown) => toText(value).toUpperCase();

const normalizeSize = (value: unknown, fallback = "") => {
  const raw = toText(value, fallback).trim();
  if (!raw) return "";
  if (/^均(?:码)+$/u.test(raw)) return "均码";
  const normalized = raw.replace(/(?:\s*码)+$/u, "").trim();
  return !normalized || normalized === "均码" ? "均码" : normalized;
};

const formatSize = (value: unknown) => {
  const size = normalizeSize(value, "均码");
  return size === "均码" ? size : `${size}码`;
};

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeys((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
};

const stableStringify = (value: unknown) => JSON.stringify(sortKeys(value));

const encodeBase64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const decodeBase64Url = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return new Uint8Array([...binary].map((char) => char.charCodeAt(0)));
};

const importCryptoKey = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

const signPlanEnvelope = async (secret: string, envelope: PlanEnvelope) => {
  const key = await importCryptoKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(stableStringify(envelope)),
  );
  return encodeBase64Url(new Uint8Array(signature));
};

const verifyPlanEnvelope = async (secret: string, envelope: PlanEnvelope, token: string) => {
  const key = await importCryptoKey(secret);
  return crypto.subtle.verify(
    "HMAC",
    key,
    decodeBase64Url(token),
    new TextEncoder().encode(stableStringify(envelope)),
  );
};

const createPlanToken = async (secret: string, envelope: PlanEnvelope) => {
  const payload = encodeBase64Url(new TextEncoder().encode(stableStringify(envelope)));
  const signature = await signPlanEnvelope(secret, envelope);
  return `${payload}.${signature}`;
};

const readVerifiedPlanToken = async (secret: string, token: string): Promise<PlanEnvelope | null> => {
  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length > 0) return null;

  try {
    const envelope = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload))) as PlanEnvelope;
    if (
      envelope.version !== 1 ||
      !envelope.planId ||
      !envelope.userId ||
      !Array.isArray(envelope.actions) ||
      !envelope.issuedAt ||
      !envelope.expiresAt
    ) return null;

    return await verifyPlanEnvelope(secret, envelope, signature) ? envelope : null;
  } catch {
    return null;
  }
};

const findWarehouseName = (input: Record<string, unknown>, context: any) => {
  const requested = toText(input.warehouse);
  const warehouses = Array.isArray(context?.warehouses) ? context.warehouses : [];

  if (requested) {
    const matchedWarehouse = warehouses.find(
      (warehouse: any) => toText(warehouse.name).toLowerCase() === requested.toLowerCase(),
    );
    return toText(matchedWarehouse?.name);
  }

  const defaultWarehouse = warehouses.find((warehouse: any) => warehouse.is_default);
  return toText(defaultWarehouse?.name) || toText(warehouses[0]?.name);
};

const parsePossibleJson = (value: unknown) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const firstJson = candidate.match(/\{[\s\S]*\}/)?.[0];

  if (!firstJson) return candidate;

  try {
    return JSON.parse(firstJson);
  } catch {
    return candidate;
  }
};

const clipText = (value: unknown, max = 32) => toText(value).slice(0, max);

const loadAllRows = async (
  db: any,
  table: string,
  select: string,
  userId: string,
  configure?: (query: any) => any,
) => {
  const rows: any[] = [];
  const pageSize = 1000;

  for (let offset = 0; ; offset += pageSize) {
    let query = db
      .from(table)
      .select(select)
      .eq("user_id", userId)
      .range(offset, offset + pageSize - 1);
    if (configure) query = configure(query);

    const { data, error } = await query;
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  return rows;
};

const loadAuthoritativeContext = async (db: any, userId: string, message = "") => {
  const [products, warehouses, activities] = await Promise.all([
    loadAllRows(
      db,
      "products",
      "id,sku,name,brand,size,stock,price,warehouse,location,image_url,source,status,created_at",
      userId,
      (query) => query.is("deleted_at", null).order("created_at", { ascending: false }),
    ),
    loadAllRows(
      db,
      "warehouses",
      "id,name,is_default,created_at",
      userId,
      (query) => query.order("created_at", { ascending: true }),
    ),
    loadAllRows(
      db,
      "activities",
      "type,sku,size,count,price,cost,warehouse,created_at",
      userId,
      (query) => query.order("created_at", { ascending: false }),
    ),
  ]);

  const normalizedMessage = message.toUpperCase();
  const relevantProducts = products.filter((item) => {
    const sku = normalizeSku(item.sku);
    return sku && normalizedMessage.includes(sku);
  });

  return {
    products,
    warehouses,
    relevantProducts,
    summary: buildAiInventorySummary(products, activities),
  };
};

const serializeCompactHistory = (history: unknown, maxLength = 220) => {
  const entries = Array.isArray(history) ? history : [];
  const compact = entries.slice(-3).map((item: any) => ({
    role: clipText(item?.role, 12),
    content: clipText(item?.content || item?.message || item?.text, 60),
  }));

  const serialized = stableStringify(compact);
  return serialized.length <= maxLength ? serialized : "[]";
};

const callDifyWorkflow = async (payload: Record<string, unknown>, userId: string) => {
  const difyApiKey = Deno.env.get("DIFY_API_KEY");
  const difyBaseUrl = toText(Deno.env.get("DIFY_BASE_URL"), "https://api.dify.ai/v1").replace(/\/+$/, "");

  if (!difyApiKey) return null;

  const response = await fetch(`${difyBaseUrl}/workflows/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${difyApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: {
        message: toText(payload.message),
        context_json: serializeAiContext(payload.context || {}),
        history_json: serializeCompactHistory(payload.history || []),
      },
      response_mode: "blocking",
      user: userId,
    }),
    signal: AbortSignal.timeout(12000),
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Dify workflow failed: ${response.status}${responseText ? ` ${responseText}` : ""}`);
  }

  const parsed = JSON.parse(responseText);
  const workflowError = toText(parsed?.data?.error);
  if (workflowError) {
    throw new Error(`Dify workflow failed: ${workflowError}`);
  }

  return parsed;
};

const normalizeActionType = (value: unknown): AgentActionType | null => {
  const type = toText(value).toLowerCase();
  if (type === "inbound" || type === "outbound" || type === "answer") return type;
  return null;
};

const isMeaningfulText = (value: unknown) => {
  const text = toText(value);
  if (!text) return false;

  const normalized = text.trim().toLowerCase();
  return !["unknown", "未知", "n/a", "na", "null", "undefined", "未填写", "未设置"].includes(normalized);
};

const findMatchingContextProducts = (input: Record<string, unknown>, context: any) => {
  const sku = normalizeSku(input.sku);
  const size = normalizeSize(input.size);
  const warehouse = toText(input.warehouse);
  const brand = toText(input.brand).toLowerCase();
  const products = Array.isArray(context?.products) ? context.products : [];

  if (!sku) return [];

  return products.filter((item: any) => {
    const skuMatches = normalizeSku(item.sku) === sku;
    const sizeMatches = !size || normalizeSize(item.size, "均码") === size;
    const warehouseMatches = !warehouse || toText(item.warehouse) === warehouse;
    const brandMatches = !brand || toText(item.brand).toLowerCase() === brand;
    return skuMatches && sizeMatches && warehouseMatches && brandMatches;
  });
};

const inferBrandFromContext = (input: Record<string, unknown>, context: any) => {
  if (isMeaningfulText(input.brand)) return toText(input.brand);

  const exactMatches = findMatchingContextProducts(input, context);
  const candidates = exactMatches.length > 0
    ? exactMatches
    : (Array.isArray(context?.products) ? context.products : []).filter((item: any) => normalizeSku(item.sku) === normalizeSku(input.sku));

  const brands = Array.from(
    new Set(
      candidates
        .map((item: any) => toText(item.brand))
        .filter((value) => isMeaningfulText(value)),
    ),
  );

  return brands.length === 1 ? brands[0] : "";
};

const buildCanonicalActionInput = (
  type: Exclude<AgentActionType, "answer">,
  input: Record<string, unknown>,
  context: any,
) => {
  const matchedProduct = findMatchingContextProducts(input, context)[0];
  const rawQuantity = input.quantity ?? input.count;
  const canonicalInput: Record<string, unknown> = {
    sku: normalizeSku(input.sku),
    size: normalizeSize(input.size),
    quantity: rawQuantity === undefined || rawQuantity === null || rawQuantity === ""
      ? 1
      : toNumber(rawQuantity, 0),
    warehouse: findWarehouseName(input, context),
    brand: toText(input.brand) || inferBrandFromContext(input, context) || toText(matchedProduct?.brand),
    _brandExplicit: input._brandExplicit === true,
    _operationExplicit: input._operationExplicit === true,
    _salePriceExplicit: input._salePriceExplicit === true,
  };

  if (type === "inbound") {
    canonicalInput.cost = toNumber(input.cost ?? input.price, 0);
    canonicalInput.name = resolveAiInboundProductName(
      canonicalInput.sku,
      Array.isArray(context?.products) ? context.products : [],
      input.name,
    );
    canonicalInput.location = toText(input.location, "");
    canonicalInput.source = toText(input.source, "");
    canonicalInput.imageUrl = toText(input.imageUrl ?? input.image_url, "");
  } else {
    canonicalInput.salePrice = toNumber(input.salePrice ?? input.sellingPrice, 0);
  }

  return canonicalInput;
};

const hydrateActionWithContext = (action: AgentAction, context: any): AgentAction => {
  if (action.type === "answer") return action;

  return {
    ...action,
    input: buildCanonicalActionInput(action.type, action.input || {}, context),
  };
};

const getMissingRequiredFields = (action: AgentAction) => {
  if (action.type === "answer") return [] as Array<"operation" | "brand" | "sku" | "size" | "warehouse">;

  const input = action.input || {};
  const missing: Array<"operation" | "brand" | "sku" | "size" | "warehouse"> = [];
  if (input._operationExplicit !== true) missing.push("operation");
  if (!isMeaningfulText(input.brand) || input._brandExplicit !== true) missing.push("brand");
  if (!isMeaningfulText(input.sku)) missing.push("sku");
  if (!isMeaningfulText(input.size)) missing.push("size");
  if (!isMeaningfulText(input.warehouse)) missing.push("warehouse");
  return missing;
};

const fieldLabelMap: Record<"operation" | "brand" | "sku" | "size" | "warehouse", string> = {
  operation: "操作类型（入库或出库）",
  brand: "品牌",
  sku: "货号",
  size: "尺码",
  warehouse: "有效仓库",
};

const buildValidationFailure = (action: AgentAction, missingFields: Array<"operation" | "brand" | "sku" | "size" | "warehouse">): ActionResult => {
  const typeLabel = action.type === "inbound" ? "入库" : "出库";
  const missingText = missingFields.map((field) => fieldLabelMap[field]).join("、");

  return {
    type: action.type,
    status: "failed",
    summary: `计划失败：AI 管理执行${typeLabel}时必须能确认品牌、货号、尺码和有效仓库。当前缺少或无法识别：${missingText}。数量未写默认 1，仓库未写默认主仓库，成本未写默认 0。`,
  };
};

const buildQuantityValidationFailure = (action: AgentAction): ActionResult | null => {
  if (action.type === "answer") return null;
  const quantity = toNumber(action.input?.quantity, 0);
  if (Number.isInteger(quantity) && quantity > 0) return null;

  return {
    type: action.type,
    status: "failed",
    summary: "计划失败：出入库数量必须是正整数。数量未写时默认 1。",
  };
};

const buildMoneyValidationFailure = (action: AgentAction): ActionResult | null => {
  if (action.type === "answer") return null;
  const field = action.type === "inbound" ? "cost" : "salePrice";
  if (action.type === "outbound" && action.input?._salePriceExplicit !== true) {
    return {
      type: action.type,
      status: "failed",
      summary: "计划失败：出库售价必须由用户明确填写，0 元售价可以执行，但不能省略。",
    };
  }
  const amount = toNumber(action.input?.[field], Number.NaN);
  if (Number.isFinite(amount) && amount >= 0) return null;

  return {
    type: action.type,
    status: "failed",
    summary: action.type === "inbound"
      ? "计划失败：成本必须是大于或等于 0 的有效数字，未填写时默认 0。"
      : "计划失败：售价必须是大于或等于 0 的有效数字。",
  };
};

const sanitizeAction = (action: unknown): AgentAction | null => {
  if (!action || typeof action !== "object") return null;

  const raw = action as Record<string, unknown>;
  const type = normalizeActionType(raw.type);
  if (!type) return null;

  if (type === "answer") {
    return {
      type,
      message: toText(raw.message || raw.reply || raw.summary, "我可以继续帮你分析库存。"),
    };
  }

  const input = raw.input && typeof raw.input === "object" ? raw.input as Record<string, unknown> : {};
  const normalizedInput: Record<string, unknown> = {
    sku: normalizeSku(input.sku),
    size: normalizeSize(input.size),
    quantity: input.quantity === undefined && input.count === undefined
      ? 1
      : toNumber(input.quantity ?? input.count, 0),
    warehouse: toText(input.warehouse),
    _brandExplicit: input._brandExplicit === true,
    _operationExplicit: input._operationExplicit === true,
    _salePriceExplicit: input._salePriceExplicit === true,
  };

  if (type === "inbound") {
    normalizedInput.cost = toNumber(input.cost ?? input.price, 0);
    normalizedInput.name = toText(input.name, normalizedInput.sku as string);
    normalizedInput.brand = toText(input.brand, "");
    normalizedInput.location = toText(input.location, "");
    normalizedInput.source = toText(input.source, "");
    normalizedInput.imageUrl = toText(input.imageUrl ?? input.image_url, "");
  } else if (type === "outbound") {
    normalizedInput.brand = toText(input.brand, "");
    normalizedInput.salePrice = toNumber(input.salePrice ?? input.sellingPrice, 0);
  }

  return {
    type,
    input: normalizedInput,
  };
};

const sanitizeAgentActions = (actions: unknown[]): AgentAction[] =>
  actions
    .map(sanitizeAction)
    .filter((action): action is AgentAction => Boolean(action));

const markExplicitExecutionFields = (action: AgentAction, message: string): AgentAction => {
  if (action.type === "answer") return action;

  const input = action.input || {};
  const explicit = evaluateExplicitExecutionIntent(message, action.type, toText(input.brand));

  return {
    ...action,
    input: {
      ...input,
      _brandExplicit: explicit.brandExplicit,
      _operationExplicit: explicit.operationExplicit && explicit.directionMatches,
      _salePriceExplicit: explicit.salePriceExplicit,
    },
  };
};

const parseFallbackActions = (message: string, context: any): AgentAction[] => {
  const parsed = parseBasicInventoryCommand(message);
  const { normalized, sku, size, quantity, brand } = parsed;
  const asksForAnalysis = /总结|分析|库存情况|库存总|经营情况|多少库存|库存有多少/.test(normalized);

  if (asksForAnalysis && !/入库|进货|补货|新增|出库|卖了|卖掉|卖出|售出|发货/.test(normalized)) {
    return [{
      type: "answer",
      message: formatAiInventorySummaryAnswer(context.summary),
    }];
  }

  if (/出库|卖了|卖掉|卖出|售出|发货/.test(normalized)) {
    return [{
      type: "outbound",
      input: { sku, size, quantity, salePrice: parsed.outboundPrice.value, brand },
    }];
  }

  if (/入库|进货|补货|新增/.test(normalized)) {
    return [{
      type: "inbound",
      input: {
        sku,
        size,
        quantity,
        cost: parsed.inboundCost.value,
        name: sku,
        brand,
      },
    }];
  }

  return [{ type: "answer", message: "我可以帮你做入库、出库和库存查询。请告诉我品牌、货号、尺码、数量和价格。" }];
};

const normalizeAgentResponse = (raw: any, message: string, context: any): { reply: string; actions: AgentAction[] } => {
  if (!raw) {
    const actions = parseFallbackActions(message, context);
    return {
      reply: actions[0]?.type === "answer" ? actions[0].message || "" : "收到，我会按你的描述整理执行计划。",
      actions,
    };
  }

  const normalizedPayload =
    raw.result ||
    raw.data?.outputs?.result ||
    raw.data?.outputs ||
    raw.data ||
    raw.output ||
    raw;

  const structuredActions = sanitizeAgentActions(
    normalizedPayload?.actions ||
    raw.actions ||
    raw.data?.actions ||
    raw.output?.actions ||
    [],
  );
  const reply = toText(
    normalizedPayload?.reply ||
    normalizedPayload?.message ||
    raw.reply ||
    raw.message ||
    raw.data?.reply ||
    raw.output?.reply,
    "收到，正在处理。",
  );
  return {
    reply,
    actions: structuredActions,
  };
};

const previewInbound = (input: Record<string, unknown>, context: any): ActionResult => {
  const action = hydrateActionWithContext({ type: "inbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);
  const quantityFailure = buildQuantityValidationFailure(action);
  if (quantityFailure) return quantityFailure;
  const moneyFailure = buildMoneyValidationFailure(action);
  if (moneyFailure) return moneyFailure;

  const canonicalInput = action.input || {};
  const sku = normalizeSku(canonicalInput.sku);
  const brand = toText(canonicalInput.brand);
  const size = normalizeSize(canonicalInput.size, "均码");
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const cost = toNumber(canonicalInput.cost ?? canonicalInput.price, 0);
  const warehouse = findWarehouseName(canonicalInput, context);
  const productName = toText(canonicalInput.name, sku);

  const existing = Array.isArray(context?.products)
    ? context.products.find((item: any) =>
        normalizeSku(item.sku) === sku &&
        normalizeSize(item.size, "均码") === size &&
        toText(item.warehouse) === warehouse)
    : null;

  if (existing) {
    return {
      type: "inbound",
      status: "planned",
      summary: `计划入库 ${brand} / ${productName} / ${sku} / ${formatSize(size)} x${quantity}，仓库 ${warehouse}。将与现有库存合并，当前库存 ${toNumber(existing.stock)}。`,
    };
  }

  return {
    type: "inbound",
    status: "planned",
    summary: `计划新增入库 ${brand} / ${productName} / ${sku} / ${formatSize(size)} x${quantity}，成本 ${cost || 0}，仓库 ${warehouse}。`,
  };
};

const previewOutbound = (input: Record<string, unknown>, context: any): ActionResult => {
  const action = hydrateActionWithContext({ type: "outbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);
  const quantityFailure = buildQuantityValidationFailure(action);
  if (quantityFailure) return quantityFailure;
  const moneyFailure = buildMoneyValidationFailure(action);
  if (moneyFailure) return moneyFailure;

  const canonicalInput = action.input || {};
  const sku = normalizeSku(canonicalInput.sku);
  const brand = toText(canonicalInput.brand);
  const size = normalizeSize(canonicalInput.size);
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const salePrice = toNumber(canonicalInput.salePrice ?? canonicalInput.sellingPrice, 0);
  const warehouse = toText(canonicalInput.warehouse);

  const matches = Array.isArray(context?.products)
    ? context.products.filter((item: any) =>
        normalizeSku(item.sku) === sku &&
        (!size || normalizeSize(item.size, "均码") === size) &&
        (!warehouse || toText(item.warehouse) === warehouse))
    : [];

  const product = matches.sort((a: any, b: any) => toNumber(b.stock) - toNumber(a.stock))[0];
  if (!product) {
    return {
      type: "outbound",
      status: "failed",
      summary: `计划失败：库存中未找到 ${sku}${size ? ` ${formatSize(size)}` : ""}${warehouse ? ` / ${warehouse}` : ""}。`,
    };
  }

  if (toNumber(product.stock) < quantity) {
    return {
      type: "outbound",
      status: "failed",
      summary: `计划失败：${sku} ${formatSize(product.size)}库存不足，当前仅剩 ${toNumber(product.stock)}。`,
    };
  }

  return {
    type: "outbound",
    status: "planned",
    summary: `计划出库 ${brand} / ${toText(product.name, sku)} / ${sku} / ${formatSize(product.size)} x${quantity}，售价 ${salePrice}，仓库 ${toText(product.warehouse, "未设置")}。`,
  };
};

const previewAction = (action: AgentAction, context: any): ActionResult => {
  if (action.type === "inbound") {
    return previewInbound(action.input || {}, context);
  }

  if (action.type === "outbound") {
    return previewOutbound(action.input || {}, context);
  }

  return {
    type: "answer",
    status: "answered",
    summary: action.message || "AI 已返回文字建议。",
  };
};

const executeInbound = async (
  userDb: any,
  userId: string,
  input: Record<string, unknown>,
  context: any,
  planId: string,
  actionIndex: number,
): Promise<ActionResult> => {
  const action = hydrateActionWithContext({ type: "inbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);
  const quantityFailure = buildQuantityValidationFailure(action);
  if (quantityFailure) return quantityFailure;
  const moneyFailure = buildMoneyValidationFailure(action);
  if (moneyFailure) return moneyFailure;

  const canonicalInput = action.input || {};
  const sku = normalizeSku(canonicalInput.sku);
  const size = normalizeSize(canonicalInput.size, "均码");
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const cost = toNumber(canonicalInput.cost ?? canonicalInput.price, 0);
  const warehouse = findWarehouseName(canonicalInput, context);
  const existing = findMatchingContextProducts(canonicalInput, context)[0];
  const productName = resolveAiInboundProductName(
    sku,
    Array.isArray(context?.products) ? context.products : [],
    canonicalInput.name,
  );
  const brand = toText(canonicalInput.brand, toText(existing?.brand, "未知品牌"));
  const imageUrl = getTrustedAiInboundImageUrl(canonicalInput.imageUrl ?? canonicalInput.image_url);
  const location = toText(canonicalInput.location, "");
  const source = toText(canonicalInput.source, "");
  const operationId = `ai-${planId}-${actionIndex}`;

  const { error } = await userDb.rpc("batch_inbound_products", {
    p_batch_id: operationId,
    p_rows: [{
      id: operationId,
      name: productName,
      brand,
      sku,
      size,
      cost,
      quantity,
      image_url: imageUrl,
      status: "instock",
      location,
      warehouse,
      source,
    }],
    p_platform: "AI 管理",
    p_user_id: userId,
  });

  if (error) throw error;

  return {
    type: "inbound",
    status: "success",
    summary: `已入库 ${sku} ${formatSize(size)} x${quantity}，仓库：${warehouse}`,
  };
};

const executeOutbound = async (db: any, userDb: any, userId: string, input: Record<string, unknown>, context: any): Promise<ActionResult> => {
  const action = hydrateActionWithContext({ type: "outbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);
  const quantityFailure = buildQuantityValidationFailure(action);
  if (quantityFailure) return quantityFailure;
  const moneyFailure = buildMoneyValidationFailure(action);
  if (moneyFailure) return moneyFailure;

  const canonicalInput = action.input || {};
  const sku = normalizeSku(canonicalInput.sku);
  const size = normalizeSize(canonicalInput.size);
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const salePrice = toNumber(canonicalInput.salePrice ?? canonicalInput.sellingPrice, 0);
  const warehouse = toText(canonicalInput.warehouse);

  let query = db
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .eq("status", "instock")
    .ilike("sku", sku)
    .gt("stock", 0)
    .order("created_at", { ascending: false })
    .limit(50);

  if (warehouse) query = query.eq("warehouse", warehouse);

  const { data: matches, error: findError } = await query;
  if (findError) throw findError;

  const product = matches?.find((item: any) => !size || normalizeSize(item.size, "均码") === size);
  if (!product) {
    return { type: "outbound", status: "failed", summary: `出库失败：没有找到可出库的 ${sku}${size ? ` ${size}` : ""}。` };
  }

  if (Number(product.stock || 0) < quantity) {
    return { type: "outbound", status: "failed", summary: `出库失败：${sku} 库存不足，当前 ${product.stock}。` };
  }

  const { error: outboundError } = await userDb.rpc("outbound_product", {
    p_product_id: product.id,
    p_user_id: userId,
    p_sale_price: salePrice,
    p_quantity: quantity,
    p_platform: "AI 管理",
  });

  if (outboundError) throw outboundError;

  return {
    type: "outbound",
    status: "success",
    summary: `已出库 ${product.sku} ${product.size} x${quantity}，售价 ${salePrice}`,
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const signingSecret = Deno.env.get("AI_MANAGER_SIGNING_SECRET") || serviceRoleKey;

    if (!supabaseUrl || !anonKey || !serviceRoleKey || !signingSecret) {
      return jsonResponse({ error: "Missing Supabase Edge Function environment variables." }, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser();

    if (authError || !authData.user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json();
    const message = toText(body.message);
    const confirm = Boolean(body.confirm);

    if (!message) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    if (!confirm) {
      const context = await loadAuthoritativeContext(db, authData.user.id, message);
      const deterministicAnswer = buildDeterministicInventoryAnswer(message, context);
      if (deterministicAnswer) {
        return jsonResponse({
          reply: deterministicAnswer,
          actions: [],
          plannedActions: [],
          planToken: null,
          planExpiresAt: null,
          requiresConfirmation: false,
          executionConfirmed: false,
          dryRun: true,
          executed: false,
          executable: false,
          agentSource: "authoritative",
          agentWarning: null,
        });
      }
      const agentPayload = {
        systemPrompt: [
          "你是得物卖家库存管理代理。",
          "你的职责是把用户自然语言转换成结构化动作，不要直接声称已经执行数据库操作。",
          "你只能返回 JSON，格式为 {\"reply\":\"...\",\"actions\":[...]}。",
          "actions 仅支持 inbound、outbound、answer。",
          "如果信息不足，请返回 answer 动作要求用户补充。",
        ].join("\n"),
        message,
        history: body.history || [],
        context,
        actionSchema: {
          actions: [
            {
              type: "inbound",
              input: { sku: "string", size: "string", quantity: "number", cost: "number", name: "string", brand: "string", warehouse: "string", location: "string", source: "string", imageUrl: "string" },
            },
            {
              type: "outbound",
              input: { sku: "string", size: "string", quantity: "number", salePrice: "number", warehouse: "string", brand: "string" },
            },
            { type: "answer", message: "string" },
          ],
        },
      };

      let rawAgent: unknown = null;
      let agentWarning = "";
      let agentSource: "dify" | "fallback" = "fallback";

      try {
        rawAgent = await callDifyWorkflow(agentPayload, authData.user.id);
        if (rawAgent) agentSource = "dify";
      } catch (error) {
        agentWarning = error instanceof Error ? error.message : "Agent unavailable";
      }

      const agent = normalizeAgentResponse(rawAgent, message, context);
      const canonicalActions = sanitizeAgentActions(agent.actions)
        .map((action) => markExplicitExecutionFields(action, message))
        .map((action) => hydrateActionWithContext(action, context));
      const actionPreviews = canonicalActions.map((action) => previewAction(action, context));
      const failedPreviews = actionPreviews.filter((preview) => preview.status === "failed");
      const executable = isExecutablePlan(canonicalActions, actionPreviews);
      const issuedAt = new Date();
      const planEnvelope: PlanEnvelope | null = executable
        ? {
          version: 1,
          planId: crypto.randomUUID(),
          userId: authData.user.id,
          actions: canonicalActions,
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + PLAN_TTL_MS).toISOString(),
        }
        : null;
      const planToken = planEnvelope ? await createPlanToken(signingSecret, planEnvelope) : null;

      return jsonResponse({
        reply: failedPreviews.length > 0
          ? `信息不足，暂不能执行。${failedPreviews[0].summary}`
          : agentWarning
            ? `${agent.reply || "已生成库存执行计划。"}\n\n当前 AI 工作流不可用，已自动切换到基础规则模式。`
            : agent.reply || "已生成库存执行计划。",
        actions: actionPreviews,
        plannedActions: canonicalActions,
        planToken,
        planExpiresAt: planEnvelope?.expiresAt || null,
        requiresConfirmation: executable,
        executionConfirmed: false,
        dryRun: true,
        executed: false,
        executable,
        agentSource: agentWarning ? "fallback" : agentSource,
        agentWarning: agentWarning || null,
      });
    }

    const planToken = toText(body.planToken);

    if (!planToken) {
      return jsonResponse({ error: "缺少待确认的执行计划。" }, 400);
    }

    const envelope = await readVerifiedPlanToken(signingSecret, planToken);
    if (!envelope || envelope.userId !== authData.user.id) {
      return jsonResponse({ error: "执行计划校验失败，请重新生成执行计划。" }, 400);
    }

    if (Date.parse(envelope.expiresAt) <= Date.now()) {
      return jsonResponse({ error: "执行计划已过期，请重新生成后再确认。" }, 410);
    }

    const context = await loadAuthoritativeContext(db, authData.user.id, message);
    const plannedActions = sanitizeAgentActions(envelope.actions)
      .map((action) => hydrateActionWithContext(action, context));
    if (!plannedActions.length) {
      return jsonResponse({ error: "执行计划没有可执行动作。" }, 400);
    }

    const confirmationPreviews = plannedActions.map((action) => previewAction(action, context));
    if (!isExecutablePlan(plannedActions, confirmationPreviews)) {
      return jsonResponse({
        error: "执行计划已不满足当前库存或必填规则，请重新生成计划。",
        actions: confirmationPreviews,
      }, 422);
    }

    const { error: claimError } = await db.from("ai_plan_executions").insert({
      plan_id: envelope.planId,
      user_id: authData.user.id,
      expires_at: envelope.expiresAt,
      status: "processing",
    });

    if (claimError?.code === "23505") {
      const { data: previous } = await db
        .from("ai_plan_executions")
        .select("status, result, created_at")
        .eq("plan_id", envelope.planId)
        .eq("user_id", authData.user.id)
        .maybeSingle();

      if (previous?.status === "completed" && previous.result) {
        return jsonResponse({
          ...previous.result,
          reply: `该计划已经执行过，本次没有重复修改库存。\n${toText(previous.result.reply)}`,
          alreadyExecuted: true,
        });
      }

      const processingAgeMs = previous?.created_at ? Date.now() - Date.parse(previous.created_at) : 0;
      if (previous?.status === "processing" && processingAgeMs >= 2 * 60 * 1000) {
        return jsonResponse({
          reply: "该计划的执行结果未能完成登记，系统不会自动重试，以免重复修改库存。请到首页最近动态逐项核对入库或出库流水，再根据实际差异生成新的计划。",
          actions: [{
            type: "audit",
            status: "failed",
            summary: `计划 ${envelope.planId} 的状态未知，需要人工核对最近动态。`,
          }],
          plannedActions: [],
          planToken: null,
          requiresConfirmation: false,
          executionConfirmed: false,
          dryRun: false,
          executed: false,
          executable: false,
          executionUnknown: true,
        });
      }

      return jsonResponse({ error: "该计划正在执行，请勿重复提交。" }, 409);
    }

    if (claimError) throw claimError;

    const results: ActionResult[] = [];
    for (let actionIndex = 0; actionIndex < plannedActions.length; actionIndex += 1) {
      const action = plannedActions[actionIndex];
      try {
        if (action.type === "inbound") {
          results.push(await executeInbound(authClient, authData.user.id, action.input || {}, context, envelope.planId, actionIndex));
        } else if (action.type === "outbound") {
          results.push(await executeOutbound(db, authClient, authData.user.id, action.input || {}, context));
        } else {
          results.push({
            type: "answer",
            status: "success",
            summary: action.message || "AI 返回了文字建议。",
          });
        }
      } catch (error) {
        results.push({
          type: action.type,
          status: "failed",
          summary: error instanceof Error ? error.message : "操作失败",
        });
      }
    }

    const successful = results.filter((result) => result.status === "success");
    const failed = results.filter((result) => result.status === "failed");
    const replyParts = ["已按确认计划执行。"];
    if (successful.length) replyParts.push(successful.map((result) => result.summary).join("\n"));
    if (failed.length) replyParts.push(failed.map((result) => result.summary).join("\n"));

    const executionResponse = {
      reply: replyParts.filter(Boolean).join("\n"),
      actions: results,
      plannedActions: [],
      planToken: null,
      requiresConfirmation: false,
      executionConfirmed: true,
      dryRun: false,
      executed: successful.some((result) => result.type !== "answer"),
      executable: failed.length === 0,
      alreadyExecuted: false,
    };

    const { error: completionError } = await db
      .from("ai_plan_executions")
      .update({
        status: "completed",
        result: executionResponse,
        completed_at: new Date().toISOString(),
      })
      .eq("plan_id", envelope.planId)
      .eq("user_id", authData.user.id);

    if (completionError) throw completionError;
    return jsonResponse(executionResponse);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
