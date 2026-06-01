const DEFAULT_CACHE_SECONDS = 300;
const CACHE_VERSION_TTL_MS = 30000;
const ALLOWED_ACTIONS = new Set(["getHandbook", "getDirectory", "getConfig", "health"]);
const LINE_REPLY_API_URL = "https://api.line.me/v2/bot/message/reply";
const HANDBOOK_HOME_URL = "https://smallcannon-arch.github.io/nhps-teacher-handbook/";
const LINE_QUICK_REPLY_LABELS = ["總務", "教務", "學務", "輔導", "人事", "會計", "系統入口", "線上填報", "表件", "流程", "校內規範"];
const LINE_SEARCH_RESULT_LIMIT = 5;
const LINE_SEARCH_TEXT_LIMIT = 4800;
const LINE_DIRECTORY_CACHE_KEY = "https://line-directory.local/latest";
const LINE_DIRECTORY_MEMORY_TTL_MS = 300000;
const LINE_DIRECTORY_EDGE_TTL_SECONDS = 600;
const LINE_DIRECTORY_FETCH_TIMEOUT_MS = 1500;
const LINE_DIRECTORY_WARMUP_TIMEOUT_MS = 10000;

let cachedCacheVersion = "";
let cachedCacheVersionAt = 0;
let lineDirectoryMemoryCache = null;
let lineDirectoryMemoryCacheAt = 0;
let lineDirectoryWarmupPromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsResponse(null, 204);
    if (isLineWebhookRequest(request, url)) {
      return handleLineWebhook(request, env, ctx);
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

async function handleLineWebhook(request, env, ctx) {
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
  const replyJobs = [];
  for (const event of events) {
    if (!event || event.type !== "message" || !event.replyToken) continue;
    const message = event.message && event.message.type === "text"
      ? await handleLineTextMessage(event.message.text, env, ctx)
      : createLineFallbackMessage("目前只支援文字訊息。請輸入關鍵字，或使用下方選單。");
    replyJobs.push({ replyToken: event.replyToken, messages: [message] });
  }

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

async function handleLineTextMessage(text, env, ctx) {
  const value = String(text || "").trim();
  if (value === "選單" || value.toLowerCase() === "menu") {
    return createLineQuickReplyMessage();
  }
  if (!value) {
    return createLineFallbackMessage("請輸入關鍵字，或使用下方選單快速查詢。");
  }

  const directory = await fetchLineDirectory(env, ctx);
  if (!directory.ok) {
    return createLineDirectoryErrorMessage(value);
  }

  const results = searchLineDirectory(value, directory.data.resources);
  if (!results.length) {
    return createLineNoResultsMessage(value);
  }
  return createLineSearchResultsMessage(value, results);
}

async function fetchLineDirectory(env, ctx) {
  if (!env.GAS_URL) return { ok: false, data: null };

  const cachedDirectory = getLineDirectoryMemoryCache();
  if (cachedDirectory) return { ok: true, data: cachedDirectory };

  const cacheKey = new Request(LINE_DIRECTORY_CACHE_KEY);
  const cache = caches.default;

  try {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const data = await hit.clone().json();
      if (isValidLineDirectory(data)) {
        setLineDirectoryMemoryCache(data);
        return { ok: true, data };
      }
    }
  } catch (err) {}

  const warmupPromise = scheduleLineDirectoryWarmup(env, ctx);
  const warmedDirectory = await resolveLineDirectoryBeforeTimeout(warmupPromise, LINE_DIRECTORY_FETCH_TIMEOUT_MS);
  if (isValidLineDirectory(warmedDirectory)) return { ok: true, data: warmedDirectory };

  return { ok: false, data: null };
}

function scheduleLineDirectoryWarmup(env, ctx) {
  if (!lineDirectoryWarmupPromise) {
    lineDirectoryWarmupPromise = warmLineDirectoryCache(env)
      .catch(() => null)
      .finally(() => {
        lineDirectoryWarmupPromise = null;
      });
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(lineDirectoryWarmupPromise.catch(() => null));
  }
  return lineDirectoryWarmupPromise;
}

async function warmLineDirectoryCache(env) {
  if (!env.GAS_URL) return null;
  try {
    const gasUrl = new URL(env.GAS_URL);
    gasUrl.searchParams.set("action", "getDirectory");

    const upstream = await fetchWithTimeout(gasUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    }, LINE_DIRECTORY_WARMUP_TIMEOUT_MS);
    const text = await upstream.text();
    if (!upstream.ok || !looksLikeJson(text)) return null;

    const parsed = safeParseJson(text);
    const directory = createLineDirectorySnapshot(parsed.data);
    if (!parsed.ok || !isValidLineDirectory(directory)) return null;

    await putLineDirectoryCache(directory);
    return directory;
  } catch (err) {
    return null;
  }
}

async function resolveLineDirectoryBeforeTimeout(warmupPromise, timeoutMs) {
  let timeoutId = null;
  try {
    return await Promise.race([
      warmupPromise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function putLineDirectoryCache(directory) {
  setLineDirectoryMemoryCache(directory);
  try {
    await caches.default.put(new Request(LINE_DIRECTORY_CACHE_KEY), new Response(JSON.stringify(directory), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${LINE_DIRECTORY_EDGE_TTL_SECONDS}`
      }
    }));
  } catch (err) {}
}

function getLineDirectoryMemoryCache() {
  if (!lineDirectoryMemoryCache) return null;
  if (Date.now() - lineDirectoryMemoryCacheAt > LINE_DIRECTORY_MEMORY_TTL_MS) {
    lineDirectoryMemoryCache = null;
    lineDirectoryMemoryCacheAt = 0;
    return null;
  }
  return lineDirectoryMemoryCache;
}

function setLineDirectoryMemoryCache(data) {
  lineDirectoryMemoryCache = data;
  lineDirectoryMemoryCacheAt = Date.now();
}

function createLineDirectorySnapshot(data) {
  if (!data || data.ok === false || !Array.isArray(data.resources)) return null;
  return {
    ok: true,
    cache_version: data.cache_version || "",
    generated_at: data.generated_at || "",
    resources: data.resources
  };
}

function isValidLineDirectory(data) {
  return !!(data && data.ok !== false && Array.isArray(data.resources));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function searchLineDirectory(query, resources) {
  const queryTerms = getLineQueryTerms(query);
  if (!queryTerms.length || !Array.isArray(resources)) return [];

  return resources
    .filter((resource) => resource && resource.visible !== false)
    .map((resource) => {
      const link = getFirstValidLineLink(resource);
      return {
        resource,
        link,
        score: scoreLineResource(queryTerms, resource, link)
      };
    })
    .filter((item) => item.score > 0 && item.link)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aOrder = Number.isFinite(Number(a.resource.sort_order)) ? Number(a.resource.sort_order) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.resource.sort_order)) ? Number(b.resource.sort_order) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(b.resource.updated || "").localeCompare(String(a.resource.updated || ""));
    })
    .slice(0, LINE_SEARCH_RESULT_LIMIT);
}

function getLineQueryTerms(query) {
  const normalized = normalizeLineSearchText(query);
  if (!normalized) return [];

  const terms = new Set([normalized, ...normalized.split(" ").filter(Boolean)]);
  const aliases = {
    "表件": ["表單", "申請", "表單 申請"],
    "表單": ["表單", "申請", "表單 申請"]
  };

  for (const [term, values] of Object.entries(aliases)) {
    if (terms.has(term)) {
      values.forEach((value) => terms.add(normalizeLineSearchText(value)));
    }
  }

  return Array.from(terms).filter(Boolean);
}

function scoreLineResource(queryTerms, resource, link) {
  let score = 0;
  score += scoreLineField(resource.title, queryTerms, 12);
  score += scoreLineField(resource.tags, queryTerms, 8);
  score += scoreLineField(resource.category, queryTerms, 8);
  score += scoreLineField(resource.office, queryTerms, 5);
  score += scoreLineField(getLineResourceSummary(resource), queryTerms, 4);
  score += scoreLineField(getLineLinkLabels(resource), queryTerms, 2);
  if (score > 0 && link) score += 1;
  if (score > 0 && !link) score -= 4;
  return score;
}

function scoreLineField(value, queryTerms, weight) {
  const normalized = normalizeLineSearchText(value);
  if (!normalized) return 0;

  return queryTerms.reduce((score, term) => {
    if (!term || !normalized.includes(term)) return score;
    if (normalized === term) return score + weight + 3;
    if (normalized.startsWith(term)) return score + weight + 1;
    return score + weight;
  }, 0);
}

function normalizeLineSearchText(value) {
  if (Array.isArray(value)) return normalizeLineSearchText(value.join(" "));
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getLineResourceSummary(resource) {
  return String(resource && (resource.summary || resource.note) || "").trim();
}

function getLineLinkLabels(resource) {
  if (!resource || !Array.isArray(resource.links)) return "";
  return resource.links.map((link) => link && link.label).filter(Boolean).join(" ");
}

function getFirstValidLineLink(resource) {
  if (!resource || !Array.isArray(resource.links)) return null;
  return resource.links.find((link) => {
    const url = String(link && link.url || "").trim();
    return /^https?:\/\//i.test(url);
  }) || null;
}

function createLineSearchResultsMessage(query, results) {
  const safeQuery = truncateLineText(query, 24);
  const lines = [`找到 ${results.length} 筆「${safeQuery}」相關資源：`, ""];

  results.forEach((item, index) => {
    const resource = item.resource;
    const meta = [resource.office, resource.category].filter(Boolean).join("／") || "教師手冊";
    const summary = truncateLineText(getLineResourceSummary(resource), 72);
    const linkUrl = String(item.link.url || "").trim();
    lines.push(`${index + 1}. ${truncateLineText(resource.title || "未命名資源", 48)}`);
    lines.push(truncateLineText(meta, 36));
    if (summary) lines.push(summary);
    lines.push(linkUrl);
    if (index < results.length - 1) lines.push("");
  });

  return {
    type: "text",
    text: truncateLineText(lines.join("\n"), LINE_SEARCH_TEXT_LIMIT),
    quickReply: {
      items: createLineQuickReplyItems()
    }
  };
}

function createLineNoResultsMessage(query) {
  return createLineFallbackMessage(`找不到「${truncateLineText(query, 24)}」相關資源。可改用「報修、請假、採購、霸凌、性平」等關鍵字，或開啟教師手冊首頁。`);
}

function createLineDirectoryErrorMessage(query) {
  return createLineFallbackMessage(`目前無法查詢「${truncateLineText(query, 24)}」。請稍後再試，或先開啟教師手冊首頁。`);
}

function truncateLineText(text, limit) {
  const chars = Array.from(String(text || "").trim());
  if (chars.length <= limit) return chars.join("");
  return `${chars.slice(0, Math.max(0, limit - 1)).join("")}…`;
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
