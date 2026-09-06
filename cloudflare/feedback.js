const REPORT_ORIGIN = "https://smallcannon-arch.github.io";
const REPORT_ISSUES = ["連結無法開啟", "需要權限／帳號不符", "內容過期或不正確", "其他問題"];
const REPORT_STATUSES = ["待處理", "處理中", "已完成"];
const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reportResponse(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": REPORT_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
      "Vary": "Origin"
    }
  });
}

function reportError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function readReportBody(request) {
  if (!request.body) throw reportError("缺少回報內容。", 400);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 8192) {
      await reader.cancel();
      throw reportError("內容太長，請縮短後再送出。", 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch (_) {
    throw reportError("回報格式不正確。", 400);
  }
}

async function reportGasJson(env, options, action) {
  const url = new URL(env.GAS_URL);
  if (action) url.searchParams.set("action", action);
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw reportError("目前無法驗證資料，請稍後重試。", 503);
  try { return await response.json(); }
  catch (_) { throw reportError("目前無法驗證資料，請稍後重試。", 503); }
}

async function requireReportEditor(env, token) {
  if (typeof token !== "string" || !token || token.length > 6000) {
    throw reportError("請先登入管理後台。", 401);
  }
  // Reuse the live school's account and role checks. Never trust a client role.
  const data = await reportGasJson(env, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ cmd: "directoryList", idToken: token })
  });
  if (data.ok !== true || !data.user) throw reportError("登入已失效或未獲授權，請重新登入。", 401);
  if (!["admin", "editor", "reviewer"].includes(data.user.role)) {
    throw reportError("需要資料編輯權限才能管理回報。", 403);
  }
}

async function submitReport(env, body) {
  if (!REPORT_ID.test(body.id || "") || typeof body.resourceId !== "string" || !body.resourceId || body.resourceId.length > 160 ||
      !REPORT_ISSUES.includes(body.issue) || typeof body.detail !== "string" || body.detail.length > 500 || body.website) {
    throw reportError("請確認資料卡及問題類型，補充說明限 500 字。", 400);
  }
  // Stable client id makes a retry safe if the response was lost after insertion.
  const existing = await env.REPORTS_DB.prepare("SELECT id, resource_id, issue, detail FROM feedback_reports WHERE id = ?").bind(body.id).first();
  if (existing) {
    if (existing.resource_id !== body.resourceId || existing.issue !== body.issue || existing.detail !== body.detail.trim()) {
      throw reportError("這筆回報已送出，請重新整理後再建立新的回報。", 409);
    }
    return reportResponse({ ok: true, id: existing.id });
  }
  const directory = await reportGasJson(env, { method: "GET" }, "getDirectory");
  if (directory.ok !== true || !Array.isArray(directory.resources)) throw reportError("目前無法驗證資料卡，請稍後重試。", 503);
  const resource = directory.resources.find((item) => String(item.id || item.resource_id) === body.resourceId && item.visible !== false);
  if (!resource) throw reportError("這筆資料已變更或下架，請重新整理教師手冊。", 404);
  const links = (Array.isArray(resource.links) ? resource.links : []).slice(0, 20)
    .filter((link) => /^https?:\/\//i.test(String(link.url || "")))
    .map((link) => ({ label: String(link.label || "連結").slice(0, 200), url: String(link.url).slice(0, 4000) }));
  const now = new Date().toISOString();
  const result = await env.REPORTS_DB.prepare(`INSERT INTO feedback_reports
    (id, resource_id, title, office, links_json, issue, detail, status, created_at, updated_at, version)
    VALUES (?, ?, ?, ?, ?, ?, ?, '待處理', ?, ?, 1) ON CONFLICT(id) DO NOTHING`)
    .bind(body.id, body.resourceId, String(resource.title || "").slice(0, 300), String(resource.office || "").slice(0, 100),
      JSON.stringify(links), body.issue, body.detail.trim(), now, now).run();
  if (result.meta.changes === 0) {
    const prior = await env.REPORTS_DB.prepare("SELECT resource_id, issue, detail FROM feedback_reports WHERE id = ?").bind(body.id).first();
    if (!prior || prior.resource_id !== body.resourceId || prior.issue !== body.issue || prior.detail !== body.detail.trim()) {
      throw reportError("回報編號衝突，請重新整理再試。", 409);
    }
  }
  return reportResponse({ ok: true, id: body.id });
}

async function manageReports(env, body) {
  await requireReportEditor(env, body.idToken);
  if (body.action === "list") {
    if (body.status && !REPORT_STATUSES.includes(body.status)) throw reportError("狀態不正確。", 400);
    const before = Number(body.before || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) throw reportError("分頁不正確。", 400);
    const result = await env.REPORTS_DB.prepare(`SELECT rowid AS sequence, * FROM feedback_reports
      WHERE rowid < ? AND (? = '' OR status = ?) ORDER BY rowid DESC LIMIT 51`)
      .bind(before, body.status || "", body.status || "").all();
    const hasMore = result.results.length > 50;
    const items = result.results.slice(0, 50).map(({ links_json, ...row }) => ({ ...row, links: JSON.parse(links_json) }));
    return reportResponse({ ok: true, items, next: hasMore ? items[items.length - 1].sequence : null });
  }
  if (body.action === "update") {
    if (!REPORT_ID.test(body.id || "") || !REPORT_STATUSES.includes(body.status) || !Number.isSafeInteger(body.version) || body.version < 1) {
      throw reportError("回報狀態不正確。", 400);
    }
    const row = await env.REPORTS_DB.prepare(`UPDATE feedback_reports SET status = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND version = ? RETURNING id, status, updated_at, version`)
      .bind(body.status, new Date().toISOString(), body.id, body.version).first();
    if (!row) throw reportError("這筆回報已由其他人更新，請重新載入再確認。", 409);
    return reportResponse({ ok: true, item: row });
  }
  throw reportError("不支援的回報操作。", 400);
}

export async function handleReports(request, env) {
  if (request.headers.get("Origin") !== REPORT_ORIGIN) return reportResponse({ ok: false, error: "不支援的來源。" }, 403);
  if (request.method === "OPTIONS") return reportResponse(null, 204);
  if (request.method !== "POST") return reportResponse({ ok: false, error: "不支援的操作。" }, 405);
  if (!env.REPORTS_DB || !env.REPORT_RATE_LIMITER || !env.GAS_URL) return reportResponse({ ok: false, error: "回報服務尚未準備完成。" }, 503);
  try {
    const body = await readReportBody(request);
    const path = new URL(request.url).pathname;
    if (path === "/reports/submit") {
      // Anonymous submission; a generous per-network limit allows a shared school connection.
      const quota = await env.REPORT_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
      if (!quota.success) throw reportError("目前回報較頻繁，請一分鐘後再試。", 429);
      return await submitReport(env, body);
    }
    if (path === "/reports/admin") return await manageReports(env, body);
    throw reportError("找不到這個回報功能。", 404);
  } catch (error) {
    // Do not return or log upstream errors, tokens, addresses, or report contents.
    return reportResponse({ ok: false, error: error.status ? error.message : "回報服務暫時無法使用，請稍後重試。" }, error.status || 503);
  }
}
