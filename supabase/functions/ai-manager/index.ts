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
  status: "success" | "failed";
  summary: string;
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

const findWarehouseName = (input: Record<string, unknown>, context: any) => {
  const requested = toText(input.warehouse);
  if (requested) return requested;
  const defaultWarehouse = context?.warehouses?.find((warehouse: any) => warehouse.is_default);
  return defaultWarehouse?.name || context?.warehouses?.[0]?.name || "杭州一号仓";
};

const callCozeAgent = async (payload: Record<string, unknown>) => {
  const cozeAgentUrl = Deno.env.get("COZE_AGENT_URL");
  const cozeAgentToken = Deno.env.get("COZE_AGENT_TOKEN");
  const cozeProjectId = Deno.env.get("COZE_PROJECT_ID");

  if (!cozeAgentUrl) return null;

  const message = toText(payload.message);
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
                text: JSON.stringify({
                  message,
                  history: payload.history || [],
                  context: payload.context || {},
                  actionSchema: payload.actionSchema || {},
                }),
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

const parseCozeStreamResponse = (streamText: string) => {
  const answerParts: string[] = [];
  let parsedResult: unknown = null;

  for (const line of streamText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;

    const rawData = trimmed.slice(5).trim();
    if (!rawData || rawData === "[DONE]") continue;

    try {
      const eventPayload = JSON.parse(rawData);
      const data = eventPayload.data || eventPayload;
      const content = data?.content;

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

  if (parsedResult) return parsedResult;

  const joined = answerParts.join("").trim();
  const possible = parsePossibleJson(joined);
  if (possible && typeof possible === "object") return possible;

  return {
    reply: joined || "Coze 未返回可解析内容。",
    actions: [],
  };
};

const parseFallbackActions = (message: string): AgentAction[] => {
  const normalized = message.replace(/\s+/g, " ").trim();
  const sku = normalized.match(/[A-Z0-9]{2,8}-\d{3}|[A-Z]{1,3}\d{3,6}/i)?.[0]?.toUpperCase();
  const size = normalized.match(/(\d{2}(?:\.\d)?|均码)\s*(?:码|size)?/i)?.[1];
  const quantity = toNumber(normalized.match(/(\d+)\s*(?:双|件|个|只|条|台)/)?.[1], 1);
  const moneyValues = [...normalized.matchAll(/(?:¥|￥|楼)?\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
  const lastMoney = moneyValues.length ? moneyValues[moneyValues.length - 1] : 0;

  if (/出库|卖了|售出|发货/.test(normalized)) {
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
        brand: "Unknown",
      },
    }];
  }

  return [{ type: "answer", message: "我可以帮你做入库、出库和库存查询。请告诉我货号、尺码、数量和价格。" }];
};

const normalizeAgentResponse = (raw: any, message: string): { reply: string; actions: AgentAction[] } => {
  if (!raw) {
    const actions = parseFallbackActions(message);
    return {
      reply: actions[0]?.type === "answer" ? actions[0].message || "" : "收到，我会按你的描述处理库存。",
      actions,
    };
  }

  const actions = raw.actions || raw.data?.actions || raw.output?.actions || [];
  const reply = raw.reply || raw.message || raw.data?.reply || raw.output?.reply || "收到，正在处理。";
  return {
    reply,
    actions: Array.isArray(actions) ? actions : [],
  };
};

const executeInbound = async (db: any, userId: string, input: Record<string, unknown>, context: any): Promise<ActionResult> => {
  const sku = toText(input.sku).toUpperCase();
  const size = toText(input.size, "均码");
  const quantity = Math.max(1, Math.floor(toNumber(input.quantity ?? input.count, 1)));
  const cost = toNumber(input.cost ?? input.price, 0);
  const warehouse = findWarehouseName(input, context);

  if (!sku) {
    return { type: "inbound", status: "failed", summary: "入库失败：缺少货号 sku。" };
  }

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
  const productName = toText(input.name, existing?.name || sku);
  const brand = toText(input.brand, existing?.brand || "Unknown");
  const imageUrl = toText(input.imageUrl ?? input.image_url, existing?.image_url || `https://picsum.photos/200/200?random=${Date.now()}`);
  const location = toText(input.location, existing?.location || "待分配");

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

const executeOutbound = async (db: any, userId: string, input: Record<string, unknown>): Promise<ActionResult> => {
  const sku = toText(input.sku).toUpperCase();
  const size = toText(input.size);
  const quantity = Math.max(1, Math.floor(toNumber(input.quantity ?? input.count, 1)));
  const salePrice = toNumber(input.salePrice ?? input.sellingPrice ?? input.price, 0);
  const warehouse = toText(input.warehouse);

  if (!sku) {
    return { type: "outbound", status: "failed", summary: "出库失败：缺少货号 sku。" };
  }

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

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
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
    if (!message) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    const agentPayload = {
      message,
      history: body.history || [],
      context: body.context || {},
      actionSchema: {
        actions: [
          {
            type: "inbound",
            input: { sku: "string", size: "string", quantity: "number", cost: "number", name: "string", brand: "string", warehouse: "string", location: "string", imageUrl: "string" },
          },
          {
            type: "outbound",
            input: { sku: "string", size: "string", quantity: "number", salePrice: "number", warehouse: "string" },
          },
          { type: "answer", message: "string" },
        ],
      },
    };

    const rawAgent = await callCozeAgent(agentPayload);
    const agent = normalizeAgentResponse(rawAgent, message);
    const db = createClient(supabaseUrl, serviceRoleKey);

    const results: ActionResult[] = [];
    for (const action of agent.actions) {
      try {
        if (action.type === "inbound") {
          results.push(await executeInbound(db, authData.user.id, action.input || {}, body.context));
        } else if (action.type === "outbound") {
          results.push(await executeOutbound(db, authData.user.id, action.input || {}));
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
    const replyParts = [agent.reply];
    if (successful.length) replyParts.push(successful.map((result) => result.summary).join("\n"));
    if (failed.length) replyParts.push(failed.map((result) => result.summary).join("\n"));

    return jsonResponse({
      reply: replyParts.filter(Boolean).join("\n"),
      actions: results,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
