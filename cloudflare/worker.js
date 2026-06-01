const DEFAULT_CACHE_SECONDS = 300;
const CACHE_VERSION_TTL_MS = 30000;
const ALLOWED_ACTIONS = new Set(["getHandbook", "getDirectory", "getConfig", "health"]);
const LINE_REPLY_API_URL = "https://api.line.me/v2/bot/message/reply";
const HANDBOOK_HOME_URL = "https://smallcannon-arch.github.io/nhps-teacher-handbook/";
const LINE_QUICK_REPLY_LABELS = ["總務", "教務", "學務", "輔導", "人事", "會計", "系統入口", "線上填報", "表件", "流程", "校內規範"];

let cachedCacheVersion = "";
let cachedCacheVersionAt = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsResponse(null, 204);
    if (isLineWebhookRequest(request, url)) {
      return handleLineWebhook(request, env);
    }
    if (!env.GAS_URL) {
      return corsResponse(JSON.stringify({ ok: false, error: "MISSING_GAS_URL" }), 500);
    }

    if (request.method === "POST") {
      return proxyPostToGas(request, env);
    }

    if (request.method !== "GET") return corsResponse(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), 405);

    const action = url.searchParams.get("action") || "getHandbook";
    if (!ALLOWED_ACTIONS.has(action)) {
      return corsResponse(JSON.stringify({ ok: false, error: "ACTION_NOT_ALLOWED" }), 400);
    }

    const cacheVersionResult = await getCacheVersion(env);
    const cacheVersion = cacheVersionResult.value;
    const cacheVersionSource = cacheVersionResult.source;
    const gasUrl = new URL(env.GAS_URL);
    gasUrl.searchParams.set("action", action);
    if (cacheVersion) gasUrl.searchParams.set("cache_version", cacheVersion);

    const cacheKey = new Request(`${url.origin}${url.pathname}?action=${action}&cache_version=${cacheVersion || "bypass"}`, request);
    const cache = caches.default;

    if (action !== "health" && cacheVersion) {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(hit, "HIT", cacheVersionSource);
    }

    const upstream = await fetch(gasUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
    const text = await upstream.text();
    const isJson = (upstream.headers.get("content-type") || "").includes("json") || looksLikeJson(text);
    const cacheable = upstream.ok && isJson && action !== "health" && cacheVersion && !hasFalseOk(text);

    const response = new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
        "Cache-Control": cacheable ? `public, max-age=${DEFAULT_CACHE_SECONDS}` : "no-store",
        "X-Handbook-Cache": cacheable ? "MISS" : "BYPASS"
      }
    });

    if (cacheable) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return withCors(response, cacheable ? "MISS" : "BYPASS", cacheVersionSource);
  }
};

async function proxyPostToGas(request, env) {
  const upstream = await fetch(env.GAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "text/plain;charset=utf-8",
      "Accept": "application/json"
    },
    body: await request.text(),
    redirect: "follow"
  });
  const text = await upstream.text();
  const isJson = (upstream.headers.get("content-type") || "").includes("json") || looksLikeJson(text);
  if (!isJson) {
    return withCors(new Response(JSON.stringify({
      ok: false,
      error: "GAS 回傳非 JSON。請檢查 Apps Script 是否已設定 SPREADSHEET_ID 並重新部署 Web App。",
      status: upstream.status
    }), {
      status: upstream.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Handbook-Cache": "BYPASS"
      }
    }), "BYPASS");
  }
  const response = new Response(text, {
    status: upstream.status,
    headers: {
      "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Handbook-Cache": "BYPASS"
    }
  });
  return withCors(response, "BYPASS");
}

function isLineWebhookRequest(request, url) {
  return request.method === "POST" && url.pathname === "/line/webhook";
}

async function handleLineWebhook(request, env) {
  if (!env.LINE_CHANNEL_SECRET) {
    return lineJsonResponse({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  if (!signature) {
    return lineJsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  const isValid = await verifyLineSignature(rawBody, signature, env.LINE_CHANNEL_SECRET);
  if (!isValid) {
    return lineJsonResponse({ ok: false, error: "UNAUTHORIZED" }, 401);
  }

  const parsed = safeParseJson(rawBody);
  if (!parsed.ok) {
    return lineJsonResponse({ ok: false, error: "BAD_REQUEST" }, 400);
  }

  const events = parsed.data && Array.isArray(parsed.data.events) ? parsed.data.events : [];
  const replyJobs = events
    .map((event) => {
      if (!event || event.type !== "message" || !event.replyToken) return null;
      const message = event.message && event.message.type === "text"
        ? createLineTextReplyMessage(event.message.text)
        : createLineFallbackMessage("目前只支援文字訊息。請輸入關鍵字，或使用下方選單。");
      return { replyToken: event.replyToken, messages: [message] };
    })
    .filter(Boolean);

  if (!replyJobs.length) {
    return lineJsonResponse({ ok: true }, 200);
  }

  if (!env.LINE_CHANNEL_ACCESS_TOKEN) {
    return lineJsonResponse({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503);
  }

  for (const job of replyJobs) {
    await replyToLine(job.replyToken, job.messages, env);
  }

  return lineJsonResponse({ ok: true }, 200);
}

async function verifyLineSignature(rawBody, signature, channelSecret) {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(channelSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureBytes = Uint8Array.from(atob(signature.trim()), (char) => char.charCodeAt(0));
    return crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(rawBody));
  } catch (err) {
    return false;
  }
}

function safeParseJson(rawBody) {
  try {
    return { ok: true, data: JSON.parse(rawBody) };
  } catch (err) {
    return { ok: false, data: null };
  }
}

async function replyToLine(replyToken, messages, env) {
  if (!replyToken || !env.LINE_CHANNEL_ACCESS_TOKEN) return false;
  try {
    const response = await fetch(LINE_REPLY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({
        replyToken,
        messages: messages.slice(0, 5)
      })
    });
    return response.ok;
  } catch (err) {
    return false;
  }
}

function createLineTextReplyMessage(text) {
  const value = String(text || "").trim();
  if (value === "選單" || value.toLowerCase() === "menu") {
    return createLineQuickReplyMessage();
  }
  if (!value) {
    return createLineFallbackMessage("請輸入關鍵字，或使用下方選單快速查詢。");
  }
  return createLineFallbackMessage("目前 LINE Bot MVP 查詢功能尚未啟用。請先使用教師手冊首頁，或使用下方選單。");
}

function createLineQuickReplyMessage() {
  return {
    type: "text",
    text: "請選擇想查詢的教師手冊分類。",
    quickReply: {
      items: createLineQuickReplyItems()
    }
  };
}

function createLineFallbackMessage(text) {
  const fallbackText = text || "目前無法完成查詢。請稍後再試，或先開啟教師手冊首頁。";
  return {
    type: "text",
    text: `${fallbackText}\n${HANDBOOK_HOME_URL}`,
    quickReply: {
      items: createLineQuickReplyItems()
    }
  };
}

function createLineQuickReplyItems() {
  return [
    ...LINE_QUICK_REPLY_LABELS.map((label) => ({
      type: "action",
      action: {
        type: "message",
        label,
        text: label
      }
    })),
    {
      type: "action",
      action: {
        type: "uri",
        label: "教師手冊首頁",
        uri: HANDBOOK_HOME_URL
      }
    }
  ];
}

function lineJsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function getCacheVersion(env) {
  const now = Date.now();
  if (cachedCacheVersion && now - cachedCacheVersionAt < CACHE_VERSION_TTL_MS) {
    return { value: cachedCacheVersion, source: "memory-cache" };
  }

  try {
    const configUrl = new URL(env.GAS_URL);
    configUrl.searchParams.set("action", "getConfig");
    const response = await fetch(configUrl.toString(), { headers: { "Accept": "application/json" } });
    if (!response.ok) {
      return cachedCacheVersion
        ? { value: cachedCacheVersion, source: "stale-memory-cache" }
        : { value: "", source: "unavailable" };
    }
    const data = await response.json();
    const cacheVersion = data && data.ok ? String(data.cache_version || "") : "";
    if (cacheVersion) {
      cachedCacheVersion = cacheVersion;
      cachedCacheVersionAt = Date.now();
      return { value: cacheVersion, source: "gas" };
    }
    return cachedCacheVersion
      ? { value: cachedCacheVersion, source: "stale-memory-cache" }
      : { value: "", source: "unavailable" };
  } catch (err) {
    return cachedCacheVersion
      ? { value: cachedCacheVersion, source: "stale-memory-cache" }
      : { value: "", source: "unavailable" };
  }
}

function looksLikeJson(text) {
  const value = String(text || "").trim();
  return value.startsWith("{") || value.startsWith("[");
}

function hasFalseOk(text) {
  try {
    const data = JSON.parse(text);
    return data && data.ok === false;
  } catch (err) {
    return true;
  }
}

function withCors(response, cacheStatus, versionSource) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("X-Handbook-Cache", cacheStatus);
  if (versionSource) headers.set("X-Handbook-Version-Source", versionSource);
  return new Response(response.body, { status: response.status, headers });
}

function corsResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "X-Handbook-Cache": "BYPASS"
    }
  });
}
