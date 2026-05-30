var APP = {
  VERSION: "0.2.0-directory-admin",
  TIMEZONE: "Asia/Taipei",
  SPREADSHEET_ID: "1kuS5S6q6Z6sY003L43xKdlgSv7thuVEtgJ4EtIXG7Fg",
  GOOGLE_CLIENT_ID: "179214705510-kasellaj6et3bm507ia539fd7sacujth.apps.googleusercontent.com",
  ALLOWED_EMAIL_DOMAIN: "nhps.hc.edu.tw",
  AUTO_ALLOW_DOMAIN_USERS: true,
  DEFAULT_DOMAIN_ROLE: "editor",
  SHEETS: {
    CHAPTERS: "Chapters",
    BLOCKS: "ContentBlocks",
    DIRECTORY_RESOURCES: "DirectoryResources",
    DIRECTORY_SHORTCUTS: "DirectoryShortcuts",
    USERS: "Users",
    CONFIG: "Config",
    LOGS: "Logs"
  },
  CHAPTER_COLUMNS: [
    "chapter_id",
    "chapter_no",
    "chapter_title",
    "status",
    "sort_order",
    "updated_at"
  ],
  BLOCK_COLUMNS: [
    "block_id",
    "chapter_id",
    "block_key",
    "block_title",
    "draft_body",
    "draft_links_json",
    "published_body",
    "published_links_json",
    "risk_level",
    "owner_office",
    "review_status",
    "sort_order",
    "updated_at",
    "published_at"
  ],
  DIRECTORY_RESOURCE_COLUMNS: [
    "resource_id",
    "title",
    "office",
    "category",
    "type",
    "resource_status",
    "note",
    "links_json",
    "tags_json",
    "updated",
    "visible",
    "featured",
    "sort_order",
    "archived",
    "updated_at"
  ],
  DIRECTORY_SHORTCUT_COLUMNS: [
    "shortcut_id",
    "parent_office",
    "label",
    "hint",
    "query",
    "resource_category",
    "target_id",
    "tag",
    "enabled",
    "sort_order",
    "updated_at"
  ],
  USER_COLUMNS: [
    "email",
    "name",
    "role",
    "office",
    "enabled",
    "updated_at"
  ],
  CONFIG_COLUMNS: ["key", "value", "updated_at"],
  LOG_COLUMNS: ["time", "email", "action", "target", "result", "message"]
};

var SECTION_LABELS = [
  "項目說明",
  "適用情境",
  "辦理方式",
  "注意事項",
  "承辦單位",
  "相關資源"
];

var HIGH_RISK_KEYWORDS = [
  "學生事件",
  "性平",
  "霸凌",
  "校安",
  "特教",
  "輔導",
  "人事",
  "會計",
  "採購",
  "請購",
  "工程",
  "校舍安全",
  "危險建築"
];

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowText() {
  return Utilities.formatDate(new Date(), APP.TIMEZONE, "yyyy-MM-dd HH:mm:ss");
}

function openSpreadsheet() {
  if (!APP.SPREADSHEET_ID || APP.SPREADSHEET_ID.indexOf("PASTE_") === 0) {
    throw new Error("尚未設定 APP.SPREADSHEET_ID");
  }
  return SpreadsheetApp.openById(APP.SPREADSHEET_ID);
}

function getSheet(name) {
  var sheet = openSpreadsheet().getSheetByName(name);
  if (!sheet) throw new Error("找不到工作表：" + name);
  return sheet;
}

function readTable(sheetName) {
  var sheet = getSheet(sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).filter(function(row) {
    return row.join("") !== "";
  }).map(function(row, rowIndex) {
    var item = { _row: rowIndex + 2 };
    headers.forEach(function(header, index) {
      item[header] = row[index];
    });
    return item;
  });
}

function writeRowByHeaders(sheetName, rowNumber, item) {
  var sheet = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function(header) {
    return item[header] === undefined ? "" : item[header];
  });
  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function appendRowByHeaders(sheetName, item) {
  var sheet = getSheet(sheetName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  sheet.appendRow(headers.map(function(header) {
    return item[header] === undefined ? "" : item[header];
  }));
}

function getConfigValue(key, fallback) {
  var rows = readTable(APP.SHEETS.CONFIG);
  var found = rows.find(function(row) { return row.key === key; });
  return found ? found.value : fallback;
}

function setConfigValue(key, value) {
  var rows = readTable(APP.SHEETS.CONFIG);
  var found = rows.find(function(row) { return row.key === key; });
  var item = { key: key, value: value, updated_at: nowText() };
  if (found) {
    writeRowByHeaders(APP.SHEETS.CONFIG, found._row, item);
  } else {
    appendRowByHeaders(APP.SHEETS.CONFIG, item);
  }
}

function bumpCacheVersion() {
  setConfigValue("cache_version", String(Date.now()));
}

function logAction(email, action, target, result, message) {
  appendRowByHeaders(APP.SHEETS.LOGS, {
    time: nowText(),
    email: email || "",
    action: action || "",
    target: target || "",
    result: result || "",
    message: message || ""
  });
}
