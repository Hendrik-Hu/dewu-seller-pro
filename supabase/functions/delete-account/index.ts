import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const removeUserObjects = async (serviceClient: ReturnType<typeof createClient>, bucket: string, userId: string) => {
  const folders = [userId];
  const files: string[] = [];
  while (folders.length > 0) {
    const folder = folders.shift()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await serviceClient.storage.from(bucket).list(folder, {
        limit: 100,
        offset,
        sortBy: { column: "name", order: "asc" },
      });
      if (error) {
        if (/bucket not found/i.test(error.message)) break;
        throw error;
      }
      for (const item of data || []) {
        const path = `${folder}/${item.name}`;
        if (item.id) files.push(path);
        else folders.push(path);
      }
      if (!data || data.length < 100) break;
    }
  }
  for (let offset = 0; offset < files.length; offset += 100) {
    const { error } = await serviceClient.storage.from(bucket).remove(files.slice(offset, offset + 100));
    if (error) throw error;
  }
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirmation !== "DELETE_MY_ACCOUNT") return jsonResponse({ error: "请重新输入删除确认词" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "登录状态已失效，请重新登录" }, 401);

    const token = authorization.slice("Bearer ".length);
    const payloadPart = token.split(".")[1] || "";
    const payload = JSON.parse(atob(payloadPart.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payloadPart.length / 4) * 4, "=")));
    const issuedAt = Number(payload?.iat || 0);
    if (!Number.isFinite(issuedAt) || Date.now() / 1000 - issuedAt > 5 * 60) {
      return jsonResponse({ error: "为保护账号安全，请输入当前密码重新验证后再删除" }, 401);
    }

    await removeUserObjects(serviceClient, "product-images", user.id);
    await removeUserObjects(serviceClient, "avatars", user.id);

    const { data, error } = await userClient.rpc("delete_current_user_account", {
      p_user_id: user.id,
      p_confirmation: "DELETE_MY_ACCOUNT",
    });
    if (error || data !== true) throw error || new Error("Account deletion failed");

    return jsonResponse({ deleted: true });
  } catch (error) {
    console.error("delete-account failed", error);
    return jsonResponse({ error: "账号删除失败，您的账号数据尚未全部删除，请稍后重试" }, 500);
  }
});
