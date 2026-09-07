var MANAGED_ACCOUNT_ROLES_ = ["admin", "reviewer", "editor", "viewer"];

function requireAccountAdmin_(user) {
  if (!user || user.role !== "admin") throw new Error("僅管理員可管理帳號與權限。");
}

function readManagedAccountRows_() {
  var values = getSheet(APP.SHEETS.USERS).getDataRange().getValues();
  var headers = values[0] || [];
  APP.USER_COLUMNS.forEach(function(key) {
    if (headers.indexOf(key) < 0) throw new Error("帳號資料表欄位不完整，請先檢查設定。");
  });
  var rows = [];
  values.slice(1).forEach(function(values, index) {
    var row = { _row: index + 2 };
    headers.forEach(function(key, column) { row[key] = values[column]; });
    if (String(row.email || "").trim()) rows.push(row);
  });
  return rows;
}

function managedAccountRecord_(row, actorEmail) {
  var record = {
    email: String(row.email || "").trim().toLowerCase(),
    name: String(row.name || ""),
    role: String(row.role || "viewer"),
    office: String(row.office || ""),
    enabled: String(row.enabled).toUpperCase() === "TRUE",
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || "")
  };
  // Compare the saved fields, not just a timestamp that may have second precision.
  record.revision = JSON.stringify(record);
  record.isSelf = record.email === String(actorEmail || "").toLowerCase();
  return record;
}

function getManagedAccounts_(user) {
  requireAccountAdmin_(user);
  return {
    ok: true,
    users: readManagedAccountRows_().map(function(row) { return managedAccountRecord_(row, user.email); }),
    autoAllowSchoolAccounts: APP.AUTO_ALLOW_DOMAIN_USERS === true,
    defaultRole: APP.DEFAULT_DOMAIN_ROLE || "viewer",
    domain: APP.ALLOWED_EMAIL_DOMAIN || ""
  };
}

function saveManagedAccount_(payload, user) {
  requireAccountAdmin_(user);
  var input = payload.account || {};
  var email = String(input.email || "").trim().toLowerCase();
  var name = String(input.name || "").trim();
  var office = String(input.office || "").trim();
  var domain = String(APP.ALLOWED_EMAIL_DOMAIN || "").toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) ||
      (domain && email.split("@").pop() !== domain) || /^[=+@-]/.test(email)) {
    throw new Error("請填寫有效的學校帳號。");
  }
  if (name.length > 80 || office.length > 80 || /[\r\n\t]/.test(name + office) || /^[=+@-]/.test(name) || /^[=+@-]/.test(office)) {
    throw new Error("姓名及處室限 80 字，不可含換行或公式字元。");
  }
  if (MANAGED_ACCOUNT_ROLES_.indexOf(input.role) < 0 || typeof input.enabled !== "boolean" || typeof payload.create !== "boolean") {
    throw new Error("請確認角色及啟用狀態。");
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error("另一位管理員正在更新帳號，請稍後再試。");
  try {
    var rows = readManagedAccountRows_();
    var actors = rows.filter(function(row) { return String(row.email || "").trim().toLowerCase() === user.email; });
    if (actors.length !== 1 || actors[0].role !== "admin" || String(actors[0].enabled).toUpperCase() !== "TRUE") {
      throw new Error("管理權限已變更，請重新登入。");
    }
    var matches = rows.filter(function(row) { return String(row.email || "").trim().toLowerCase() === email; });
    if (matches.length > 1) throw new Error("此帳號有重複設定，請先整理資料表。");
    var existing = matches[0];
    if (payload.create && existing) throw new Error("此帳號已存在，請從清單選擇後修改。");
    if (!payload.create && (!existing || payload.revision !== managedAccountRecord_(existing, user.email).revision)) {
      throw new Error("帳號資料已變更，請重新載入後再修改。");
    }
    if (!input.enabled || input.role !== "admin") {
      var remainingAdmins = rows.filter(function(row) {
        return String(row.email || "").trim().toLowerCase() !== email && row.role === "admin" && String(row.enabled).toUpperCase() === "TRUE";
      });
      if (existing && existing.role === "admin" && String(existing.enabled).toUpperCase() === "TRUE" && remainingAdmins.length === 0) {
        throw new Error("不能停用或降級最後一位管理員。");
      }
      if (email === user.email) throw new Error("不能在此變更自己的管理員角色或停用自己，請由其他管理員處理。");
    }
    var saved = Object.assign({}, existing || {}, {
      email: email, name: name, role: input.role, office: office,
      enabled: input.enabled ? "TRUE" : "FALSE", updated_at: nowText()
    });
    if (existing) writeRowByHeaders(APP.SHEETS.USERS, existing._row, saved);
    else appendRowByHeaders(APP.SHEETS.USERS, saved);
    SpreadsheetApp.flush();
    // Read back exactly as Sheets stores it so subsequent version checks are stable.
    var stored = readManagedAccountRows_().find(function(row) { return String(row.email || "").trim().toLowerCase() === email; });
    logAction("", "accountSave", "", "ok", "account settings updated");
    return { ok: true, user: managedAccountRecord_(stored, user.email) };
  } finally {
    lock.releaseLock();
  }
}
