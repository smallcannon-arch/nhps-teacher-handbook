function setupTeacherHandbookCms() {
  var ss = openSpreadsheet();
  ensureSheet_(ss, APP.SHEETS.CHAPTERS, APP.CHAPTER_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.BLOCKS, APP.BLOCK_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.USERS, APP.USER_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.CONFIG, APP.CONFIG_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.LOGS, APP.LOG_COLUMNS);
  seedConfig_();
  seedChaptersAndBlocks_();
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    return;
  }
  var current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
  var needsHeader = headers.some(function(header, index) {
    return current[index] !== header;
  });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

function seedConfig_() {
  if (!getConfigValue("app_version", "")) setConfigValue("app_version", APP.VERSION);
  if (!getConfigValue("cache_version", "")) setConfigValue("cache_version", String(Date.now()));
}

function seedChaptersAndBlocks_() {
  var existingChapters = readTable(APP.SHEETS.CHAPTERS);
  if (existingChapters.length > 0) return;

  var chapters = [
    ["week-one", "01", "新進教師第一週"],
    ["campus-safety", "02", "校園空間與安全"],
    ["academic-affairs", "03", "教務工作"],
    ["student-affairs", "04", "學務與學生事件"],
    ["counseling-special", "05", "輔導與特教支持"],
    ["general-affairs", "06", "總務設備與場地"],
    ["accounts", "07", "資訊系統與帳號"],
    ["forms-padlet", "08", "常用表單與 Padlet 入口"],
    ["faq", "09", "常見問題 FAQ"]
  ];

  chapters.forEach(function(chapter, chapterIndex) {
    appendRowByHeaders(APP.SHEETS.CHAPTERS, {
      chapter_id: chapter[0],
      chapter_no: chapter[1],
      chapter_title: chapter[2],
      status: "草稿",
      sort_order: chapterIndex + 1,
      updated_at: nowText()
    });

    SECTION_LABELS.forEach(function(label, sectionIndex) {
      appendRowByHeaders(APP.SHEETS.BLOCKS, {
        block_id: chapter[0] + "-" + sectionIndex,
        chapter_id: chapter[0],
        block_key: label,
        block_title: label,
        draft_body: defaultBlockText_(chapter[2], label),
        draft_links_json: label === "相關資源" ? "[]" : "",
        published_body: "",
        published_links_json: "",
        risk_level: riskLevelForChapter_(chapter[0]),
        owner_office: "",
        review_status: "草稿",
        sort_order: sectionIndex + 1,
        updated_at: nowText(),
        published_at: ""
      });
    });
  });
}

function defaultBlockText_(chapterTitle, label) {
  if (label === "相關資源") return "";
  return "TODO：請補充「" + chapterTitle + "」的「" + label + "」。";
}

function riskLevelForChapter_(chapterId) {
  if (chapterId === "student-affairs" || chapterId === "counseling-special") return "高";
  if (chapterId === "general-affairs" || chapterId === "accounts") return "中";
  return "低";
}

function addAdminUser(email, name, role, office) {
  appendRowByHeaders(APP.SHEETS.USERS, {
    email: String(email || "").toLowerCase(),
    name: name || "",
    role: role || "admin",
    office: office || "",
    enabled: "TRUE",
    updated_at: nowText()
  });
}
