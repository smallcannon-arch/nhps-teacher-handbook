// Read-only history: only explicitly authorized administrators may read Logs.
function getEditLogs_(payload, user) {
  if (!user || user.role !== "admin") throw new Error("僅管理員可查看編輯紀錄。");
  var labels = {
    saveDraft: "儲存草稿", submitReview: "送出審核", publishChapter: "發布章節",
    withdrawChapter: "撤下章節", deleteChapter: "刪除章節",
    saveDirectoryResource: "儲存資料卡", deleteDirectoryResource: "移至回收桶",
    batchDeleteDirectoryResources: "批次移至回收桶", restoreDirectoryResources: "還原資料卡",
    reorderDirectoryResources: "調整資料卡排序", reorderDirectoryShortcuts: "調整快速入口排序", batchUpdateDirectoryResources: "批次更新資料卡",
    saveDirectoryShortcut: "儲存快速入口", deleteDirectoryShortcut: "停用快速入口"
  };
  var query = String(payload.account || "").trim().toLowerCase().slice(0, 254);
  var from = String(payload.from || ""), to = String(payload.to || "");
  [from, to].forEach(function(value) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) {
      throw new Error("請填寫有效日期。");
    }
  });
  if (from && to && from > to) throw new Error("開始日期不可晚於結束日期。");
  var before = payload.before == null ? Infinity : Number(payload.before);
  if (before !== Infinity && (!Number.isInteger(before) || before < 2)) throw new Error("無效的分頁位置。");
  var names = {}, targets = {};
  readTable(APP.SHEETS.USERS).forEach(function(r) { names[String(r.email).toLowerCase()] = String(r.name || ""); });
  [[APP.SHEETS.DIRECTORY_RESOURCES, "resource_id", "title"],
   [APP.SHEETS.DIRECTORY_SHORTCUTS, "shortcut_id", "label"],
   [APP.SHEETS.CHAPTERS, "chapter_id", "chapter_title"]].forEach(function(spec) {
    readTable(spec[0]).forEach(function(r) { targets[r[spec[1]]] = String(r[spec[2]] || ""); });
  });
  var values = getSheet(APP.SHEETS.LOGS).getDataRange().getValues();
  var headers = values[0] || [];
  ["time", "email", "action", "target", "result"].forEach(function(key) {
    if (headers.indexOf(key) < 0) throw new Error("操作紀錄欄位不完整。");
  });
  var items = [], next = null;
  for (var i = Math.min(values.length - 1, before - 2); i >= 1; i--) {
    var row = {};
    headers.forEach(function(key, col) { row[key] = values[i][col]; });
    if (!Object.prototype.hasOwnProperty.call(labels, row.action)) continue;
    var email = String(row.email || ""), name = names[email.toLowerCase()] || "";
    if (query && (email + " " + name).toLowerCase().indexOf(query) < 0) continue;
    var time = row.time instanceof Date ? Utilities.formatDate(row.time, APP.TIMEZONE, "yyyy-MM-dd HH:mm:ss") : String(row.time || "");
    var day = time.slice(0, 10);
    if ((from && day < from) || (to && day > to)) continue;
    if (items.length === 100) { next = items[items.length - 1].row; break; }
    var ids = String(row.target || "").split(",").filter(Boolean);
    items.push({ row: i + 1, time: time, email: email, name: name,
      action: labels[row.action], result: row.result === "ok" ? "成功" : "失敗",
      target: ids.map(function(id) { return targets[id] ? targets[id] + "（" + id + "）" : id; }).join("、") || "未記錄目標" });
  }
  return { ok: true, items: items, next: next };
}
