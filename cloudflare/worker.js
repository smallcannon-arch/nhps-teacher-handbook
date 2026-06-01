const DEFAULT_CACHE_SECONDS = 300;
const CACHE_VERSION_TTL_MS = 30000;
const ALLOWED_ACTIONS = new Set(["getHandbook", "getDirectory", "getConfig", "health"]);

let cachedCacheVersion = "";
let cachedCacheVersionAt = 0;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return corsResponse(null, 204);
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
