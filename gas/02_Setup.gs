function setupTeacherHandbookCms() {
  var ss = openSpreadsheet();
  ensureSheet_(ss, APP.SHEETS.CHAPTERS, APP.CHAPTER_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.BLOCKS, APP.BLOCK_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.DIRECTORY_RESOURCES, APP.DIRECTORY_RESOURCE_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.DIRECTORY_SHORTCUTS, APP.DIRECTORY_SHORTCUT_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.USERS, APP.USER_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.CONFIG, APP.CONFIG_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.LOGS, APP.LOG_COLUMNS);
  seedConfig_();
  seedChaptersAndBlocks_();
  if (typeof importCurrentDirectoryContent_ === "function") {
    importCurrentDirectoryContent_(false);
  } else {
    seedDirectoryShortcuts_();
  }
}

function seedDirectoryShortcuts_() {
  var existing = readTable(APP.SHEETS.DIRECTORY_SHORTCUTS);
  if (existing.length > 0) return;

  var shortcuts = [
    ["common-attendance", "常用入口", "差勤系統", "請假、補休", "差勤", "", "", "", true],
    ["common-facility-repair", "常用入口", "硬體設備報修", "門窗、燈具、桌椅", "硬體 報修", "", "", "", true],
    ["common-it-repair", "常用入口", "資訊設備報修", "電腦、網路、平板", "資訊 報修", "", "", "", true],
    ["common-school-info", "常用入口", "學校資料", "抬頭、統編、電話", "學校資料", "", "", "", true],
    ["common-year-114", "常用入口", "114年度資料", "防災、課後班、行事曆", "114", "", "", "", true],
    ["common-campus-safety", "常用入口", "校安／學生事件", "校安、受傷、通報", "校安", "", "", "", true],
    ["common-booking", "常用入口", "場地／平板借用", "場地、平板、平板車", "借用", "", "", "", true],
    ["common-field-trip", "常用入口", "戶外教育", "校外教學、保險", "戶外", "", "", "", true],
    ["common-counseling", "常用入口", "輔導轉介", "轉介、支持", "輔導 轉介", "", "", "", true],
    ["common-systems", "常用入口", "常用系統", "Meet、行事曆、通報", "", "內小常用連結", "", "", true],
    ["academic-it", "教務處", "資訊設備報修", "電腦、網路、平板", "資訊 報修", "", "", "", true],
    ["academic-substitution", "教務處", "調課代課", "調課、代課", "調課 代課", "", "", "", true],
    ["academic-teaching", "教務處", "教學與評量", "學扶、評量、課務", "學扶 評量", "", "", "", true],
    ["student-safety", "學務處", "校安／學生事件", "校安、受傷、通報", "校安", "", "", "", true],
    ["student-insurance", "學務處", "學生平安保險", "保險、理賠", "保險", "", "", "", true],
    ["student-duty", "學務處", "導護與交通", "導護、交通、安全", "導護 交通", "", "", "", true],
    ["student-forms", "學務處", "學務常用表單", "表單、名冊", "學務 表單", "", "", "", true],
    ["general-repair", "總務處", "硬體設備報修", "門窗、燈具、桌椅", "硬體 報修", "", "", "", true],
    ["general-booking", "總務處", "場地／平板借用", "場地、平板、平板車", "借用", "", "", "", true],
    ["general-ac", "總務處", "冷氣使用", "冷氣、異常", "冷氣", "", "", "", true],
    ["general-disaster", "總務處", "防災與校園安全", "防災、施工、區域", "防災", "", "", "", true],
    ["counseling-referral", "輔導室", "輔導轉介", "轉介、支持", "輔導 轉介", "", "", "", true],
    ["counseling-after-school", "輔導室", "課後班資訊", "課後班、教室", "課後班", "", "", "", true],
    ["personnel-attendance", "人事室", "差勤系統", "請假、補休、代理", "差勤", "", "", "", true],
    ["accounting-school-info", "會計室", "學校資料", "抬頭、統編、電話", "學校資料", "", "", "", true],
    ["other-school-links", "其他", "校內常用連結", "Meet、行事曆、通報", "", "內小常用連結", "", "", true],
    ["other-city-links", "其他", "市府常用系統", "校務、研習、單一入口", "", "竹市常用連結", "", "", true],
    ["other-cloud", "其他", "內湖雲端", "N114、N113、N112", "", "內湖雲端", "", "", true],
    ["other-info", "其他", "資訊分享", "教學工具、影片", "", "資訊分享", "", "", true]
  ];

  shortcuts.forEach(function(item, index) {
    appendRowByHeaders(APP.SHEETS.DIRECTORY_SHORTCUTS, {
      shortcut_id: item[0],
      parent_office: item[1],
      label: item[2],
      hint: item[3],
      query: item[4],
      resource_category: item[5],
      target_id: item[6],
      tag: item[7],
      enabled: item[8] ? "TRUE" : "FALSE",
      sort_order: index + 1,
      updated_at: nowText()
    });
  });
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
