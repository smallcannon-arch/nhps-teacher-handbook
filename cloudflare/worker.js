import { handleReports } from "./feedback.js";
import { PUBLICATION_COMMANDS, publishDirectory, readPublishedDirectory } from "./directory-publication.js";

const DEFAULT_CACHE_SECONDS = 300;
const CACHE_VERSION_TTL_MS = 30000;
const ALLOWED_ACTIONS = new Set(["getHandbook", "getDirectory", "getConfig", "health"]);
const LINE_REPLY_API_URL = "https://api.line.me/v2/bot/message/reply";
const HANDBOOK_HOME_URL = "https://smallcannon-arch.github.io/nhps-teacher-handbook/";
const LINE_QUICK_REPLY_LABELS = ["總務", "教務", "學務", "輔導", "人事", "會計", "系統入口", "線上填報", "表件", "流程", "校內規範"];
const LINE_QUERY_ALIASES = {
  "請假": ["差勤", "補休", "假單"],
  "補休": ["請假", "差勤"],
  "報修": ["設備", "維修", "修繕", "故障"],
  "冷氣": ["報修", "異常", "設備"],
  "霸凌": ["疑似霸凌", "學生事件", "校安", "通報"],
  "性平": ["疑似性平", "性別平等", "學生事件", "校安", "通報"],
  "學生通報": ["疾病通報", "學生事件通報", "校安", "通報"],
  "表件": ["表單", "申請"],
  "表單": ["表件", "申請"],
  "線上填報": ["Google 表單", "表單", "填報"],
  "系統入口": ["系統", "入口", "登入"],
  "採購": ["請購", "核銷"]
};
const LINE_SEARCH_RESULT_LIMIT = 3;
const LINE_BOT_INDEX_KEY = "teacher-handbook:bot-search-index";
const LINE_BOT_INDEX_STALE_MS = 60 * 60 * 1000;
const LINE_BOT_INDEX_FETCH_TIMEOUT_MS = 1500;
const LINE_BOT_INDEX_REFRESH_TIMEOUT_MS = 10000;

let cachedCacheVersion = "";
let cachedCacheVersionAt = 0;
let lineBotIndexMemoryCache = null;
let lineBotIndexMemoryCacheAt = 0;
let lineBotIndexRefreshPromise = null;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/reports/")) return handleReports(request, env);

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

    if (action === "getDirectory") {
      try {
        let snapshot = await readPublishedDirectory(env);
        if (!snapshot) {
          await publishDirectory(env);
          snapshot = await readPublishedDirectory(env);
        }
        return snapshot ? withCors(snapshot, "PUBLISHED")
          : corsResponse(JSON.stringify({ok:false, error:"公開資料尚未發布，請稍後重試。"}), 503);
      } catch (err) {
        return corsResponse(JSON.stringify({ok:false, error:"公開資料暫時無法讀取，請稍後重試。"}), 503);
      }
    }
    const cacheVersionResult = await getCacheVersion(env, request, ctx);
    const cacheVersion = cacheVersionResult.value;
    const cacheVersionSource = cacheVersionResult.source;
    const gasUrl = new URL(env.GAS_URL);
    gasUrl.searchParams.set("action", action);
    if (cacheVersion) gasUrl.searchParams.set("cache_version", cacheVersion);

    const cacheKey = new Request(`${url.origin}${url.pathname}?action=${action}&cache_version=${cacheVersion || "bypass"}`, request);
    const cache = caches.default;

    if (action !== "health" && cacheVersion) {
      const hit = await cache.match(cacheKey);
      if (hit) return withCors(directoryBrowserCache(hit, action), "HIT", cacheVersionSource);
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
    return withCors(directoryBrowserCache(response, action, cacheable), cacheable ? "MISS" : "BYPASS", cacheVersionSource);
  }
};

function directoryBrowserCache(response, action, cacheable = true) {
  if (action !== "getDirectory") return response;
  const remaining = Math.max(0, Math.min(30,
    Math.floor((cachedCacheVersionAt + CACHE_VERSION_TTL_MS - Date.now()) / 1000)));
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheable && remaining > 0
    ? `private, max-age=${remaining}, must-revalidate` : "no-store");
  // The response was validated against the version now; retain only its remaining window.
  headers.set("Date", new Date().toUTCString());
  headers.delete("Age");
  return new Response(response.body, { status: response.status, headers });
}

async function proxyPostToGas(request, env) {
  const body = await request.text();
  let command;
  try { command = JSON.parse(body.startsWith("payload=") ? new URLSearchParams(body).get("payload") : body); }
  catch (err) { command = {}; }
  const manualPublish = command.cmd === "publishDirectory";
  const upstream = await fetch(env.GAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "text/plain;charset=utf-8",
      "Accept": "application/json"
    },
    body: manualPublish ? JSON.stringify({cmd:"directoryList", idToken:command.idToken}) : body,
    redirect: "follow"
  });
  let text = await upstream.text();
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
  try {
    const data = JSON.parse(text);
    if (manualPublish) {
      if (!upstream.ok || data.ok !== true || !["admin", "editor", "reviewer"].includes(data.user && data.user.role)) {
        text = JSON.stringify({ok:false, error:"請使用具發布權限的學校帳號登入。"});
      } else {
        text = JSON.stringify({ok:true, publication:await publishDirectory(env, data.cache_version)});
      }
    } else if (upstream.ok && data.ok === true && PUBLICATION_COMMANDS.has(command.cmd)) {
      data.publication = await publishDirectory(env, data.cache_version);
      text = JSON.stringify(data);
    }
  } catch (err) {
    if (manualPublish) text = JSON.stringify({ok:false, error:"無法確認發布權限，請重新登入後再試。"});
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

  const index = await getLineBotIndex(env, ctx);
  if (!index.ok) {
    return createLineDirectoryErrorMessage(value);
  }

  const resources = lineBotIndexItemsToResources(index.data);
  const results = searchLineDirectory(value, resources);
  if (!results.length) {
    return createLineNoResultsMessage(value);
  }
  return createLineSearchResultsMessage(value, results);
}

async function getLineBotIndex(env, ctx) {
  const cachedIndex = readLineBotIndexFromMemory();
  if (cachedIndex) {
    if (isLineBotIndexStale(cachedIndex)) scheduleLineBotIndexRefresh(env, ctx);
    return { ok: true, data: cachedIndex };
  }

  const kvIndex = await readLineBotIndexFromKv(env);
  if (kvIndex) {
    setLineBotIndexMemoryCache(kvIndex);
    if (isLineBotIndexStale(kvIndex)) scheduleLineBotIndexRefresh(env, ctx);
    return { ok: true, data: kvIndex };
  }

  const refreshPromise = scheduleLineBotIndexRefresh(env, ctx);
  const refreshedIndex = await resolveLineBotIndexBeforeTimeout(refreshPromise, LINE_BOT_INDEX_FETCH_TIMEOUT_MS);
  if (isValidLineBotIndex(refreshedIndex)) return { ok: true, data: refreshedIndex };

  return { ok: false, data: null };
}

function readLineBotIndexFromMemory() {
  if (!isValidLineBotIndex(lineBotIndexMemoryCache)) {
    lineBotIndexMemoryCache = null;
    lineBotIndexMemoryCacheAt = 0;
    return null;
  }
  return lineBotIndexMemoryCache;
}

async function readLineBotIndexFromKv(env) {
  if (!env.HANDBOOK_BOT_KV || typeof env.HANDBOOK_BOT_KV.get !== "function") return null;
  try {
    const index = await env.HANDBOOK_BOT_KV.get(LINE_BOT_INDEX_KEY, { type: "json" });
    return isValidLineBotIndex(index) ? index : null;
  } catch (err) {
    return null;
  }
}

function scheduleLineBotIndexRefresh(env, ctx) {
  if (!lineBotIndexRefreshPromise) {
    lineBotIndexRefreshPromise = refreshLineBotIndex(env)
      .catch(() => null)
      .finally(() => {
        lineBotIndexRefreshPromise = null;
      });
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(lineBotIndexRefreshPromise.catch(() => null));
  }
  return lineBotIndexRefreshPromise;
}

async function refreshLineBotIndex(env) {
  if (!env.GAS_URL) return null;
  try {
    const gasUrl = new URL(env.GAS_URL);
    gasUrl.searchParams.set("action", "getDirectory");

    const upstream = await fetchWithTimeout(gasUrl.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    }, LINE_BOT_INDEX_REFRESH_TIMEOUT_MS);
    const text = await upstream.text();
    if (!upstream.ok || !looksLikeJson(text)) return null;

    const parsed = safeParseJson(text);
    if (!parsed.ok) return null;
    const index = buildLineBotIndexFromDirectory(parsed.data);
    if (!isValidLineBotIndex(index)) return null;

    await writeLineBotIndexToKv(env, index);
    return index;
  } catch (err) {
    return null;
  }
}

function buildLineBotIndexFromDirectory(directory) {
  const resources = directory && Array.isArray(directory.resources) ? directory.resources : [];
  const items = resources
    .filter((resource) => resource && resource.visible !== false)
    .map((resource) => {
      const link = getFirstValidLineLink(resource);
      if (!link) return null;
      return {
        id: String(resource.id || resource.resource_id || "").trim(),
        title: String(resource.title || "").trim(),
        office: String(resource.office || "").trim(),
        category: String(resource.category || "").trim(),
        tags: Array.isArray(resource.tags) ? resource.tags.map((tag) => String(tag || "").trim()).filter(Boolean) : [],
        summary: getLineResourceSummary(resource),
        url: String(link.url || "").trim()
      };
    })
    .filter((item) => item && item.title && /^https?:\/\//i.test(item.url));

  return {
    version: String(directory && (directory.cache_version || directory.generated_at) || ""),
    updatedAt: Date.now(),
    items
  };
}

function isLineBotIndexStale(index) {
  const updatedAt = Number(index && index.updatedAt || 0);
  return !updatedAt || Date.now() - updatedAt > LINE_BOT_INDEX_STALE_MS;
}

async function writeLineBotIndexToKv(env, index) {
  setLineBotIndexMemoryCache(index);
  if (!env.HANDBOOK_BOT_KV || typeof env.HANDBOOK_BOT_KV.put !== "function") return index;
  try {
    await env.HANDBOOK_BOT_KV.put(LINE_BOT_INDEX_KEY, JSON.stringify(index));
  } catch (err) {}
  return index;
}

function setLineBotIndexMemoryCache(index) {
  lineBotIndexMemoryCache = index;
  lineBotIndexMemoryCacheAt = Date.now();
}

function isValidLineBotIndex(index) {
  return !!(index && Array.isArray(index.items));
}

async function resolveLineBotIndexBeforeTimeout(refreshPromise, timeoutMs) {
  let timeoutId = null;
  try {
    return await Promise.race([
      refreshPromise,
      new Promise((resolve) => {
        timeoutId = setTimeout(() => resolve(null), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function lineBotIndexItemsToResources(index) {
  if (!isValidLineBotIndex(index)) return [];
  return index.items.map((item) => ({
    id: item.id,
    title: item.title,
    office: item.office,
    category: item.category,
    tags: Array.isArray(item.tags) ? item.tags : [],
    note: item.summary || "",
    summary: item.summary || "",
    links: item.url ? [{ label: "開啟連結", url: item.url }] : [],
    visible: true
  }));
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
  for (const [term, values] of Object.entries(LINE_QUERY_ALIASES)) {
    const normalizedTerm = normalizeLineSearchText(term);
    const normalizedValues = values.map((value) => normalizeLineSearchText(value)).filter(Boolean);
    if (terms.has(normalizedTerm) || normalizedValues.some((value) => terms.has(value))) {
      terms.add(normalizedTerm);
      normalizedValues.forEach((value) => terms.add(value));
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
  const items = results.slice(0, LINE_SEARCH_RESULT_LIMIT);
  const contents = [];
  items.forEach((item, index) => {
    if (index) contents.push({ type: "separator", margin: "md" });
    contents.push({
      type: "box", layout: "vertical", spacing: "sm", margin: "md",
      contents: [
        { type: "text", text: truncateLineText(item.resource.title || "未命名資源", 48), weight: "bold", size: "md", wrap: true },
        { type: "text", text: truncateLineText(item.resource.office || "教師手冊", 24), size: "sm", color: "#666666", wrap: true },
        { type: "button", style: "link", height: "sm", action: { type: "uri", label: "開啟", uri: String(item.link.url || "").trim() } }
      ]
    });
  });

  return {
    type: "flex",
    altText: `「${safeQuery}」相關資源：${items.map((item) => truncateLineText(item.resource.title || "未命名資源", 48)).join("、")}。請開啟聊天室查看。`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical",
        contents: [{ type: "text", text: `「${safeQuery}」相關資源`, size: "sm", color: "#666666", wrap: true }, ...contents]
      },
      footer: {
        type: "box", layout: "vertical",
        contents: [{ type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "更多資源・教師手冊", uri: HANDBOOK_HOME_URL } }]
      }
    },
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
    text: fallbackText,
    quickReply: {
      items: createLineQuickReplyItems()
    }
  };
}

function createLineQuickReplyItems() {
  return [
    {
      type: "action",
      action: {
        type: "uri",
        label: "教師手冊",
        uri: HANDBOOK_HOME_URL
      }
    },
    ...LINE_QUICK_REPLY_LABELS.map((label) => ({
      type: "action",
      action: {
        type: "message",
        label,
        text: label
      }
    }))
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

async function getCacheVersion(env, request, ctx) {
  const now = Date.now();
  if (cachedCacheVersion && now - cachedCacheVersionAt < CACHE_VERSION_TTL_MS) {
    return { value: cachedCacheVersion, source: "memory-cache" };
  }

  // Share the existing 30-second check window across isolates in this location.
  // Keep the original timestamp so an edge hit cannot restart that window.
  const versionKey = new Request(new URL(
    "/__handbook-version?upstream=" + encodeURIComponent(env.GAS_URL), request.url));
  try {
    const hit = await caches.default.match(versionKey);
    if (hit) {
      const entry = await hit.json();
      if (typeof entry.value === "string" && entry.value && Number.isFinite(entry.checkedAt) &&
          now >= entry.checkedAt && now - entry.checkedAt < CACHE_VERSION_TTL_MS) {
        cachedCacheVersion = entry.value;
        cachedCacheVersionAt = entry.checkedAt;
        return { value: entry.value, source: "edge-cache" };
      }
    }
  } catch (err) {
    // A cache failure must not prevent checking the authoritative source.
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
      const versionResponse = new Response(JSON.stringify({
        value: cacheVersion, checkedAt: cachedCacheVersionAt
      }), { headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_VERSION_TTL_MS / 1000}`
      } });
      ctx.waitUntil(caches.default.put(versionKey, versionResponse).catch(() => {}));
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
