import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readHostedApiKey } from "../_shared/apiKeys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const MAX_BYTES = 512 * 1024;
const MAX_DIMENSION = 512;

const parseJpegDimensions = (bytes: Uint8Array) => {
  if (bytes.length < 11 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return null;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8) { offset += 2; continue; }
    const segmentLength = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
};

const decodeBase64 = (value: unknown) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 750_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("头像数据格式无效");
  }
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error("头像不能超过 512 KB");
  return bytes;
};

const sha256Hex = async (bytes: Uint8Array) => {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const body = await request.json();
    const bytes = decodeBase64(body?.contentBase64);
    const dimensions = parseJpegDimensions(bytes);
    if (!dimensions || dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
      return jsonResponse({ error: "头像必须是真实 JPEG，且宽高不能超过 512 像素" }, 400);
    }
    const hash = await sha256Hex(bytes);
    if (typeof body?.sha256 !== "string" || body.sha256.toLowerCase() !== hash) {
      return jsonResponse({ error: "头像完整性校验失败" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const publishableKey = readHostedApiKey(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS"));
    const secretKey = readHostedApiKey(Deno.env.get("SUPABASE_SECRET_KEYS"));
    if (!supabaseUrl || !publishableKey || !secretKey) return jsonResponse({ error: "头像服务暂时不可用" }, 503);
    const userClient = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: authorization } } });
    const serviceClient = createClient(supabaseUrl, secretKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return jsonResponse({ error: "登录状态已失效" }, 401);

    const path = `${user.id}/avatars/${hash}.jpg`;
    const { error: uploadError } = await serviceClient.storage.from("avatars").upload(path, bytes, {
      upsert: false,
      contentType: "image/jpeg",
      cacheControl: "31536000",
    });
    const duplicate = Boolean(uploadError && (/already exists|duplicate/i.test(uploadError.message || "") || String((uploadError as any).statusCode) === "409"));
    if (uploadError && !duplicate) throw uploadError;
    const { data } = serviceClient.storage.from("avatars").getPublicUrl(path);
    return jsonResponse({ path, publicUrl: data.publicUrl, created: !duplicate });
  } catch (error) {
    const message = error instanceof Error ? error.message : "头像上传失败";
    const isInputError = /格式|不能超过|完整性|真实 JPEG/.test(message);
    if (!isInputError) console.error("upload-avatar failed", error);
    return jsonResponse({ error: isInputError ? message : "头像上传失败，请稍后重试" }, isInputError ? 400 : 500);
  }
});
