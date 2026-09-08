export const PUBLICATION_COMMANDS = new Set([
  "saveDirectoryResource", "deleteDirectoryResource", "batchDeleteDirectoryResources",
  "restoreDirectoryResources", "reorderDirectoryItems", "batchUpdateDirectoryResources",
  "saveDirectoryShortcut", "deleteDirectoryShortcut"
]);

export const PUBLISH_SQL = `INSERT INTO directory_publication
  (id, source_version, started_at, published_at, body) VALUES (1, ?1, ?2, ?3, ?4)
  ON CONFLICT(id) DO UPDATE SET source_version=excluded.source_version,
    started_at=excluded.started_at, published_at=excluded.published_at, body=excluded.body
  WHERE excluded.source_version > directory_publication.source_version
    OR (excluded.source_version = directory_publication.source_version
      AND excluded.started_at >= directory_publication.started_at)`;

// Only accept the public Google endpoint. Never publish POST payloads or admin lists.
export function publicDirectory(data) {
  const version = Number(data && data.cache_version);
  if (!data || data.ok !== true || !Number.isSafeInteger(version) || version <= 0 ||
      !Array.isArray(data.resources) || !data.shortcuts || typeof data.shortcuts !== "object" ||
      Array.isArray(data.shortcuts)) throw new Error("INVALID_PUBLIC_DIRECTORY");
  const fields = ["id", "category", "office", "title", "type", "status", "note", "situation",
    "summary", "updated", "task", "featured", "sort_order"];
  const resources = data.resources.filter(r => r && r.visible === true && !r.archived && !r.trash).map(r => {
    const item = {visible:true};
    for (const field of fields) if (r[field] !== undefined) item[field] = r[field];
    item.tags = Array.isArray(r.tags) ? r.tags.filter(t => typeof t === "string") : [];
    item.links = Array.isArray(r.links) ? r.links.filter(l => l && /^https?:\/\//i.test(l.url))
      .map(l => ({label:String(l.label || "開啟"), url:l.url})) : [];
    return item;
  });
  const shortcuts = Object.fromEntries(Object.entries(data.shortcuts).map(([office, entries]) => {
    if (!Array.isArray(entries)) throw new Error("INVALID_SHORTCUTS");
    return [office, entries.filter(e => e && e.enabled !== false).map(e => {
      const result = {};
      for (const field of ["id", "label", "hint", "query", "resourceCategory", "targetId", "tag", "enabled", "sort_order"])
        if (e[field] !== undefined) result[field] = e[field];
      return result;
    })];
  }));
  return {ok:true, app_version:String(data.app_version || ""), cache_version:version,
    generated_at:String(data.generated_at || ""), resources, shortcuts};
}

async function sourceJson(env, action, signal) {
  const url = new URL(env.GAS_URL);
  url.searchParams.set("action", action);
  const response = await fetch(url, {headers:{Accept:"application/json"}, signal, cache:"no-store"});
  if (!response.ok) throw new Error("SOURCE_UNAVAILABLE");
  return response.json();
}

export async function publishDirectory(env, minimumVersion = 0) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const data = publicDirectory(await sourceJson(env, "getDirectory", controller.signal));
    // A concurrent edit during the read must not be labelled as a complete newer snapshot.
    const config = await sourceJson(env, "getConfig", controller.signal);
    if (config.ok !== true || Number(config.cache_version) !== data.cache_version ||
        data.cache_version < Number(minimumVersion || 0)) throw new Error("SOURCE_CHANGED");
    const result = await env.REPORTS_DB.prepare(PUBLISH_SQL)
      .bind(data.cache_version, startedAt, Date.now(), JSON.stringify(data)).run();
    if (!result.success) throw new Error("PUBLISH_FAILED");
    const current = await env.REPORTS_DB.prepare("SELECT source_version FROM directory_publication WHERE id = 1").first();
    if (!current || current.source_version < data.cache_version) throw new Error("PUBLISH_FAILED");
    return {status:"published", version:current.source_version};
  } catch (err) {
    return {status:"pending", message:"資料已儲存，但尚未發布到前台。請按「同步發布」重試。"};
  } finally {
    clearTimeout(timer);
  }
}

export async function readPublishedDirectory(env) {
  const row = await env.REPORTS_DB.prepare("SELECT body FROM directory_publication WHERE id = 1").first();
  if (!row) return null;
  return new Response(row.body, {headers:{
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store", "X-Handbook-Publication":"snapshot"
  }});
}
