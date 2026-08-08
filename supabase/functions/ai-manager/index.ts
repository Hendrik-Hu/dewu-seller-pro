import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  status: "success" | "failed" | "planned";
  summary: string;
}

interface PlanEnvelope {
  userId: string;
  actions: AgentAction[];
}

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

const findWarehouseName = (input: Record<string, unknown>, context: any) => {
  const requested = toText(input.warehouse);
  if (requested) return requested;
  const defaultWarehouse = context?.warehouses?.find((warehouse: any) => warehouse.is_default);
  return defaultWarehouse?.name || context?.warehouses?.[0]?.name || "杭州一号仓";
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

const serializeCompactContext = (context: any, maxLength = 220) => {
  const products = Array.isArray(context?.products) ? context.products : [];
  const warehouses = Array.isArray(context?.warehouses) ? context.warehouses : [];

  const compact = {
    summary: {
      productCount: products.length,
      totalStock: products.reduce((sum: number, item: any) => sum + toNumber(item.stock), 0),
      warehouseCount: warehouses.length,
    },
    warehouses: warehouses.slice(0, 3).map((warehouse: any) => clipText(warehouse.name, 16)),
    products: products.slice(0, 4).map((item: any) => ({
      sku: clipText(item.sku, 16).toUpperCase(),
      size: clipText(item.size, 8),
      stock: toNumber(item.stock),
      warehouse: clipText(item.warehouse, 12),
    })),
  };

  let serialized = stableStringify(compact);
  if (serialized.length <= maxLength) return serialized;

  const lighter = {
    summary: compact.summary,
    warehouses: compact.warehouses.slice(0, 2),
    products: compact.products.slice(0, 2),
  };
  serialized = stableStringify(lighter);
  if (serialized.length <= maxLength) return serialized;

  return stableStringify({ summary: compact.summary }).slice(0, maxLength);
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

const parseCozeStreamResponse = (streamText: string) => {
  const answerParts: string[] = [];
  let parsedResult: unknown = null;
  let streamError = "";

  for (const line of streamText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const rawData = trimmed.slice(5).trim();
    if (!rawData || rawData === "[DONE]") continue;

    try {
      const eventPayload = JSON.parse(rawData);
      const data = eventPayload.data || eventPayload;
      const content = data?.content;
      const messageEnd = content?.message_end;

      if (messageEnd?.message) {
        streamError = toText(messageEnd.message, streamError);
      }

      if (content?.error?.message) {
        streamError = toText(content.error.message, streamError);
      }

      if (typeof content === "string") {
        answerParts.push(content);
        const possible = parsePossibleJson(content);
        if (possible && typeof possible === "object") parsedResult = possible;
      } else if (content && typeof content === "object") {
        parsedResult = content;
      }
    } catch {
      const possible = parsePossibleJson(rawData);
      if (possible && typeof possible === "object") parsedResult = possible;
    }
  }

  if (streamError) {
    throw new Error(`Coze agent failed: ${streamError}`);
  }

  if (parsedResult) return parsedResult;

  const joined = answerParts.join("").trim();
  const possible = parsePossibleJson(joined);
  if (possible && typeof possible === "object") return possible;

  return {
    reply: joined || "Coze 未返回可解析内容。",
    actions: [],
  };
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
        context_json: serializeCompactContext(payload.context || {}),
        history_json: serializeCompactHistory(payload.history || []),
      },
      response_mode: "blocking",
      user: userId,
    }),
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

const callCozeAgent = async (payload: Record<string, unknown>) => {
  const cozeAgentUrl = Deno.env.get("COZE_AGENT_URL");
  const cozeAgentToken = Deno.env.get("COZE_AGENT_TOKEN");
  const cozeProjectId = Deno.env.get("COZE_PROJECT_ID");

  if (!cozeAgentUrl) return null;

  const sessionId = `inventory_${crypto.randomUUID()}`;
  const response = await fetch(cozeAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cozeAgentToken ? { Authorization: `Bearer ${cozeAgentToken}` } : {}),
    },
    body: JSON.stringify({
      content: {
        query: {
          prompt: [
            {
              type: "text",
              content: {
                text: JSON.stringify(payload),
              },
            },
          ],
        },
      },
      type: "query",
      session_id: sessionId,
      ...(cozeProjectId ? { project_id: Number(cozeProjectId) } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Coze agent failed: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const responseText = await response.text();

  if (contentType.includes("application/json")) {
    return JSON.parse(responseText);
  }

  return parseCozeStreamResponse(responseText);
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
  const sku = toText(input.sku).toUpperCase();
  const size = toText(input.size);
  const warehouse = toText(input.warehouse);
  const brand = toText(input.brand).toLowerCase();
  const products = Array.isArray(context?.products) ? context.products : [];

  if (!sku) return [];

  return products.filter((item: any) => {
    const skuMatches = toText(item.sku).toUpperCase() === sku;
    const sizeMatches = !size || toText(item.size) === size;
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
    : (Array.isArray(context?.products) ? context.products : []).filter((item: any) => toText(item.sku).toUpperCase() === toText(input.sku).toUpperCase());

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
  const canonicalInput: Record<string, unknown> = {
    sku: toText(input.sku).toUpperCase(),
    size: toText(input.size),
    quantity: Math.max(1, Math.floor(toNumber(input.quantity ?? input.count, 1))),
    warehouse: findWarehouseName(input, context),
    brand: toText(input.brand) || inferBrandFromContext(input, context) || toText(matchedProduct?.brand),
  };

  if (type === "inbound") {
    canonicalInput.cost = toNumber(input.cost ?? input.price, 0);
    canonicalInput.name = toText(input.name, toText(matchedProduct?.name, ""));
    canonicalInput.location = toText(input.location, "");
    canonicalInput.imageUrl = toText(input.imageUrl ?? input.image_url, "");
  } else {
    canonicalInput.salePrice = toNumber(input.salePrice ?? input.sellingPrice ?? input.price, 0);
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
  if (action.type === "answer") return [] as Array<"brand" | "sku" | "size">;

  const input = action.input || {};
  const missing: Array<"brand" | "sku" | "size"> = [];
  if (!isMeaningfulText(input.brand)) missing.push("brand");
  if (!isMeaningfulText(input.sku)) missing.push("sku");
  if (!isMeaningfulText(input.size)) missing.push("size");
  return missing;
};

const fieldLabelMap: Record<"brand" | "sku" | "size", string> = {
  brand: "品牌",
  sku: "货号",
  size: "尺码",
};

const buildValidationFailure = (action: AgentAction, missingFields: Array<"brand" | "sku" | "size">): ActionResult => {
  const typeLabel = action.type === "inbound" ? "入库" : "出库";
  const missingText = missingFields.map((field) => fieldLabelMap[field]).join("、");

  return {
    type: action.type,
    status: "failed",
    summary: `计划失败：AI 管理执行${typeLabel}时必须包含品牌、货号、尺码。当前缺少：${missingText}。数量未写默认 1，仓库未写默认主仓库，成本未写默认 0。`,
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
    sku: toText(input.sku).toUpperCase(),
    size: toText(input.size),
    quantity: Math.max(1, Math.floor(toNumber(input.quantity ?? input.count, 1))),
    warehouse: toText(input.warehouse),
  };

  if (type === "inbound") {
    normalizedInput.cost = toNumber(input.cost ?? input.price, 0);
    normalizedInput.name = toText(input.name, normalizedInput.sku as string);
    normalizedInput.brand = toText(input.brand, "");
    normalizedInput.location = toText(input.location, "");
    normalizedInput.imageUrl = toText(input.imageUrl ?? input.image_url, "");
  } else if (type === "outbound") {
    normalizedInput.brand = toText(input.brand, "");
    normalizedInput.salePrice = toNumber(input.salePrice ?? input.sellingPrice ?? input.price, 0);
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

const parseFallbackActions = (message: string): AgentAction[] => {
  const normalized = message.replace(/\s+/g, " ").trim();
  const sku = normalized.match(/[A-Z0-9]{2,8}-\d{3}|[A-Z]{1,3}\d{3,6}/i)?.[0]?.toUpperCase();
  const size = normalized.match(/(?:尺码|size)?\s*[:：]?\s*(\d{2}(?:\.\d)?|均码)\s*(?:码|size)/i)?.[1];
  const quantity = toNumber(normalized.match(/(\d+)\s*(?:双|件|个|只|条|台)/)?.[1], 1);
  const moneyValues = [...normalized.matchAll(/(?:¥|￥)?\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const lastMoney = moneyValues.length ? moneyValues[moneyValues.length - 1] : 0;

  if (/出库|卖了|卖掉|卖出|售出|发货/.test(normalized)) {
    return [{
      type: "outbound",
      input: { sku, size, quantity, salePrice: lastMoney || undefined },
    }];
  }

  if (/入库|进货|补货|新增/.test(normalized)) {
    return [{
      type: "inbound",
      input: {
        sku,
        size,
        quantity,
        cost: lastMoney || undefined,
        name: sku,
        brand: "",
      },
    }];
  }

  return [{ type: "answer", message: "我可以帮你做入库、出库和库存查询。请告诉我品牌、货号、尺码、数量和价格。" }];
};

const normalizeAgentResponse = (raw: any, message: string): { reply: string; actions: AgentAction[] } => {
  if (!raw) {
    const actions = parseFallbackActions(message);
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

  const canonicalInput = action.input || {};
  const sku = toText(canonicalInput.sku).toUpperCase();
  const brand = toText(canonicalInput.brand);
  const size = toText(canonicalInput.size, "均码");
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const cost = toNumber(canonicalInput.cost ?? canonicalInput.price, 0);
  const warehouse = findWarehouseName(canonicalInput, context);
  const productName = toText(canonicalInput.name, sku);

  const existing = Array.isArray(context?.products)
    ? context.products.find((item: any) =>
        toText(item.sku).toUpperCase() === sku &&
        toText(item.size, "均码") === size &&
        toText(item.warehouse) === warehouse)
    : null;

  if (existing) {
    return {
      type: "inbound",
      status: "planned",
      summary: `计划入库 ${brand} / ${productName} / ${sku} / ${size}码 x${quantity}，仓库 ${warehouse}。将与现有库存合并，当前库存 ${toNumber(existing.stock)}。`,
    };
  }

  return {
    type: "inbound",
    status: "planned",
    summary: `计划新增入库 ${brand} / ${productName} / ${sku} / ${size}码 x${quantity}，成本 ${cost || 0}，仓库 ${warehouse}。`,
  };
};

const previewOutbound = (input: Record<string, unknown>, context: any): ActionResult => {
  const action = hydrateActionWithContext({ type: "outbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);

  const canonicalInput = action.input || {};
  const sku = toText(canonicalInput.sku).toUpperCase();
  const brand = toText(canonicalInput.brand);
  const size = toText(canonicalInput.size);
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const warehouse = toText(canonicalInput.warehouse);

  const matches = Array.isArray(context?.products)
    ? context.products.filter((item: any) =>
        toText(item.sku).toUpperCase() === sku &&
        (!size || toText(item.size) === size) &&
        (!warehouse || toText(item.warehouse) === warehouse))
    : [];

  const product = matches.sort((a: any, b: any) => toNumber(b.stock) - toNumber(a.stock))[0];
  if (!product) {
    return {
      type: "outbound",
      status: "failed",
      summary: `计划失败：库存中未找到 ${sku}${size ? ` ${size}码` : ""}${warehouse ? ` / ${warehouse}` : ""}。`,
    };
  }

  if (toNumber(product.stock) < quantity) {
    return {
      type: "outbound",
      status: "failed",
      summary: `计划失败：${sku} ${toText(product.size)}码库存不足，当前仅剩 ${toNumber(product.stock)}。`,
    };
  }

  return {
    type: "outbound",
    status: "planned",
    summary: `计划出库 ${brand} / ${toText(product.name, sku)} / ${sku} / ${toText(product.size)}码 x${quantity}，仓库 ${toText(product.warehouse, "未设置")}。`,
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
    status: "planned",
    summary: action.message || "AI 已返回文字建议。",
  };
};

const executeInbound = async (db: any, userId: string, input: Record<string, unknown>, context: any): Promise<ActionResult> => {
  const action = hydrateActionWithContext({ type: "inbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);

  const canonicalInput = action.input || {};
  const sku = toText(canonicalInput.sku).toUpperCase();
  const size = toText(canonicalInput.size, "均码");
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const cost = toNumber(canonicalInput.cost ?? canonicalInput.price, 0);
  const warehouse = findWarehouseName(canonicalInput, context);

  const { data: existing, error: findError } = await db
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .eq("sku", sku)
    .eq("size", size)
    .eq("warehouse", warehouse)
    .maybeSingle();

  if (findError) throw findError;

  const now = new Date().toISOString();
  const productName = toText(canonicalInput.name, existing?.name || sku);
  const brand = toText(canonicalInput.brand, existing?.brand || "Unknown");
  const imageUrl = toText(canonicalInput.imageUrl ?? canonicalInput.image_url, existing?.image_url || `https://picsum.photos/200/200?random=${Date.now()}`);
  const location = toText(canonicalInput.location, existing?.location || "待分配");

  if (existing) {
    const nextStock = Number(existing.stock || 0) + quantity;
    const nextCost = cost > 0
      ? Number((((Number(existing.price || 0) * Number(existing.stock || 0)) + (cost * quantity)) / nextStock).toFixed(2))
      : Number(existing.price || 0);

    const { error } = await db
      .from("products")
      .update({
        name: productName,
        brand,
        price: nextCost,
        stock: nextStock,
        image_url: imageUrl,
        status: "instock",
        location,
        warehouse,
      })
      .eq("id", existing.id)
      .eq("user_id", userId);

    if (error) throw error;
  } else {
    const { error } = await db.from("products").insert({
      id: `ai-${Date.now()}`,
      name: productName,
      brand,
      size,
      sku,
      price: cost,
      stock: quantity,
      image_url: imageUrl,
      status: "instock",
      location,
      warehouse,
      created_at: now,
      user_id: userId,
    });

    if (error) throw error;
  }

  const { error: activityError } = await db.from("activities").insert({
    id: `act-${Date.now()}`,
    type: "inbound",
    product_name: productName,
    time: "刚刚",
    sku,
    size,
    price: cost,
    cost,
    image_url: imageUrl,
    created_at: now,
    warehouse,
    count: quantity,
    user_id: userId,
  });

  if (activityError) throw activityError;

  return {
    type: "inbound",
    status: "success",
    summary: `已入库 ${sku} ${size} x${quantity}，仓库：${warehouse}`,
  };
};

const executeOutbound = async (db: any, userId: string, input: Record<string, unknown>, context: any): Promise<ActionResult> => {
  const action = hydrateActionWithContext({ type: "outbound", input }, context);
  const missingFields = getMissingRequiredFields(action);
  if (missingFields.length > 0) return buildValidationFailure(action, missingFields);

  const canonicalInput = action.input || {};
  const sku = toText(canonicalInput.sku).toUpperCase();
  const size = toText(canonicalInput.size);
  const quantity = Math.max(1, Math.floor(toNumber(canonicalInput.quantity ?? canonicalInput.count, 1)));
  const salePrice = toNumber(canonicalInput.salePrice ?? canonicalInput.sellingPrice ?? canonicalInput.price, 0);
  const warehouse = toText(canonicalInput.warehouse);

  let query = db
    .from("products")
    .select("*")
    .eq("user_id", userId)
    .eq("sku", sku)
    .gt("stock", 0)
    .order("created_at", { ascending: false })
    .limit(1);

  if (size) query = query.eq("size", size);
  if (warehouse) query = query.eq("warehouse", warehouse);

  const { data: matches, error: findError } = await query;
  if (findError) throw findError;

  const product = matches?.[0];
  if (!product) {
    return { type: "outbound", status: "failed", summary: `出库失败：没有找到可出库的 ${sku}${size ? ` ${size}` : ""}。` };
  }

  if (Number(product.stock || 0) < quantity) {
    return { type: "outbound", status: "failed", summary: `出库失败：${sku} 库存不足，当前 ${product.stock}。` };
  }

  const nextStock = Number(product.stock || 0) - quantity;
  const { error: updateError } = await db
    .from("products")
    .update({
      stock: nextStock,
      status: nextStock <= 0 ? "sold" : product.status,
    })
    .eq("id", product.id)
    .eq("user_id", userId);

  if (updateError) throw updateError;

  const { error: activityError } = await db.from("activities").insert({
    id: `act-${Date.now()}`,
    type: "outbound",
    product_name: product.name,
    time: "刚刚",
    sku: product.sku,
    size: product.size,
    price: salePrice || product.price,
    cost: product.price,
    image_url: product.image_url,
    created_at: new Date().toISOString(),
    warehouse: product.warehouse,
    count: quantity,
    user_id: userId,
  });

  if (activityError) throw activityError;

  return {
    type: "outbound",
    status: "success",
    summary: `已出库 ${product.sku} ${product.size} x${quantity}，售价 ${salePrice || product.price}`,
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
    const context = body.context || {};

    if (!message) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    if (!confirm) {
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
              input: { sku: "string", size: "string", quantity: "number", cost: "number", name: "string", brand: "string", warehouse: "string", location: "string", imageUrl: "string" },
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
      let agentSource: "dify" | "coze" | "fallback" = "fallback";

      try {
        rawAgent = await callDifyWorkflow(agentPayload, authData.user.id);
        if (rawAgent) {
          agentSource = "dify";
        } else {
          rawAgent = await callCozeAgent(agentPayload);
          if (rawAgent) agentSource = "coze";
        }
      } catch (error) {
        agentWarning = error instanceof Error ? error.message : "Agent unavailable";
      }

      const agent = normalizeAgentResponse(rawAgent, message);
      const canonicalActions = sanitizeAgentActions(agent.actions).map((action) => hydrateActionWithContext(action, context));
      const actionPreviews = canonicalActions.map((action) => previewAction(action, context));
      const actionableActions = canonicalActions.filter((action) => action.type !== "answer");
      const failedPreviews = actionPreviews.filter((preview) => preview.status === "failed");
      const executable = actionableActions.length > 0 && actionPreviews.every((preview) => preview.status !== "failed");
      const planToken = actionableActions.length > 0
        ? await signPlanEnvelope(signingSecret, {
          userId: authData.user.id,
          actions: canonicalActions,
        })
        : null;

      return jsonResponse({
        reply: failedPreviews.length > 0
          ? `信息不足，暂不能执行。${failedPreviews[0].summary}`
          : agentWarning
            ? `${agent.reply || "已生成库存执行计划。"}\n\n当前 AI 工作流不可用，已自动切换到基础规则模式。`
            : agent.reply || "已生成库存执行计划。",
        actions: actionPreviews,
        plannedActions: canonicalActions,
        planToken,
        requiresConfirmation: executable,
        executionConfirmed: false,
        dryRun: true,
        executed: false,
        executable,
        agentSource: agentWarning ? "fallback" : agentSource,
        agentWarning: agentWarning || null,
      });
    }

    const plannedActions = sanitizeAgentActions(Array.isArray(body.plannedActions) ? body.plannedActions : [])
      .map((action) => hydrateActionWithContext(action, context));
    const planToken = toText(body.planToken);

    if (!plannedActions.length || !planToken) {
      return jsonResponse({ error: "缺少待确认的执行计划。" }, 400);
    }

    const verified = await verifyPlanEnvelope(signingSecret, {
      userId: authData.user.id,
      actions: plannedActions,
    }, planToken);

    if (!verified) {
      return jsonResponse({ error: "执行计划校验失败，请重新生成执行计划。" }, 400);
    }

    const results: ActionResult[] = [];
    for (const action of plannedActions) {
      try {
        if (action.type === "inbound") {
          results.push(await executeInbound(db, authData.user.id, action.input || {}, context));
        } else if (action.type === "outbound") {
          results.push(await executeOutbound(db, authData.user.id, action.input || {}, context));
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

    return jsonResponse({
      reply: replyParts.filter(Boolean).join("\n"),
      actions: results,
      plannedActions: [],
      planToken: null,
      requiresConfirmation: false,
      executionConfirmed: true,
      dryRun: false,
      executed: successful.some((result) => result.type !== "answer"),
      executable: failed.length === 0,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
