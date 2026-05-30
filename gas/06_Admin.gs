function saveDraft_(payload, user) {
  requireEditor_(user);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapterId = payload.chapter_id;
    var blocks = payload.blocks || [];
    if (!chapterId) throw new Error("缺少 chapter_id");

    var chapter = findOrCreateChapter_(payload);
    var allBlocks = readTable(APP.SHEETS.BLOCKS);
    blocks.forEach(function(input, index) {
      var block = allBlocks.find(function(row) {
        return (input.block_id && row.block_id === input.block_id) ||
          (row.chapter_id === chapterId && row.block_key === input.key);
      });
      var isCore = SECTION_LABELS.indexOf(input.key) >= 0;
      if (input.deleted) {
        if (isCore) throw new Error("核心六段不可刪除：" + input.key);
        if (block) {
          block.review_status = "deleted";
          block.updated_at = nowText();
          writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
        }
        return;
      }
      if (!block) {
        block = {
          block_id: chapterId + "-custom-" + Date.now() + "-" + index,
          chapter_id: chapterId,
          block_key: input.key || ("custom-" + Date.now()),
          sort_order: allBlocks.length + index + 1
        };
      }

      var body = String(input.draft_body || "");
      var linksJson = stringifyLinks_(input.draft_links || []);
      var risk = input.risk_level || block.risk_level || "低";
      if (hasHighRiskText_(body) && risk === "低") risk = "中";

      block.block_title = input.title || block.block_title || block.block_key;
      block.draft_body = body;
      block.draft_links_json = input.key === "相關資源" ? linksJson : "";
      block.risk_level = risk;
      block.owner_office = input.owner_office || block.owner_office || "";
      block.review_status = "草稿";
      block.sort_order = index + 1;
      block.updated_at = nowText();
      if (block._row) {
        writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
      } else {
        appendRowByHeaders(APP.SHEETS.BLOCKS, block);
      }
    });

    chapter.chapter_no = payload.chapter_no || chapter.chapter_no || "";
    chapter.chapter_title = payload.chapter_title || chapter.chapter_title || "";
    chapter.status = chapter.status || "草稿";
    chapter.sort_order = chapter.sort_order || readTable(APP.SHEETS.CHAPTERS).length + 1;
    chapter.updated_at = nowText();
    if (chapter._row) {
      writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    } else {
      appendRowByHeaders(APP.SHEETS.CHAPTERS, chapter);
    }
    logAction(user.email, "saveDraft", chapterId, "ok", "draft saved");
    return { ok: true, chapter_id: chapterId };
  } finally {
    lock.releaseLock();
  }
}

function submitReview_(payload, user) {
  requireEditor_(user);
  var chapterId = payload.chapter_id;
  if (!chapterId) throw new Error("缺少 chapter_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapter = findChapter_(chapterId);
    var blocks = readTable(APP.SHEETS.BLOCKS).filter(function(row) {
      return row.chapter_id === chapterId && row.review_status !== "deleted";
    });
    blocks.forEach(function(block) {
      block.review_status = "待審核";
      block.updated_at = nowText();
      writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
    });
    if (chapter.status !== "已發布") chapter.status = "待審核";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    logAction(user.email, "submitReview", chapterId, "ok", "submitted for review");
    return { ok: true, chapter_id: chapterId };
  } finally {
    lock.releaseLock();
  }
}

function publishChapter_(payload, user) {
  requireEditor_(user);
  var chapterId = payload.chapter_id;
  if (!chapterId) throw new Error("缺少 chapter_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapter = findChapter_(chapterId);
    var blocks = readTable(APP.SHEETS.BLOCKS).filter(function(row) {
      return row.chapter_id === chapterId && row.review_status !== "deleted";
    });
    validatePublish_(chapter, blocks);

    blocks.forEach(function(block) {
      block.published_body = block.draft_body;
      block.published_links_json = block.draft_links_json;
      block.review_status = "已發布";
      block.updated_at = nowText();
      block.published_at = nowText();
      writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
    });
    chapter.status = "已發布";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    bumpCacheVersion();
    logAction(user.email, "publishChapter", chapterId, "ok", "published and cache bumped");
    return { ok: true, chapter_id: chapterId, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function withdrawChapter_(payload, user) {
  requireReviewer_(user);
  var chapterId = payload.chapter_id;
  if (!chapterId) throw new Error("缺少 chapter_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapter = findChapter_(chapterId);
    chapter.status = "草稿";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    bumpCacheVersion();
    logAction(user.email, "withdrawChapter", chapterId, "ok", "withdrawn and cache bumped");
    return { ok: true, chapter_id: chapterId };
  } finally {
    lock.releaseLock();
  }
}

function deleteChapter_(payload, user) {
  requireReviewer_(user);
  var chapterId = payload.chapter_id;
  if (!chapterId) throw new Error("缺少 chapter_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapter = findChapter_(chapterId);
    chapter.status = "deleted";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    var blocks = readTable(APP.SHEETS.BLOCKS).filter(function(row) {
      return row.chapter_id === chapterId;
    });
    blocks.forEach(function(block) {
      block.review_status = "deleted";
      block.updated_at = nowText();
      writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
    });
    bumpCacheVersion();
    logAction(user.email, "deleteChapter", chapterId, "ok", "chapter soft deleted");
    return { ok: true, chapter_id: chapterId };
  } finally {
    lock.releaseLock();
  }
}

function findChapter_(chapterId) {
  var chapter = readTable(APP.SHEETS.CHAPTERS).find(function(row) {
    return row.chapter_id === chapterId;
  });
  if (!chapter) throw new Error("找不到章節：" + chapterId);
  return chapter;
}

function findOrCreateChapter_(payload) {
  var chapterId = payload.chapter_id;
  var chapter = readTable(APP.SHEETS.CHAPTERS).find(function(row) {
    return row.chapter_id === chapterId;
  });
  if (chapter) return chapter;
  return {
    chapter_id: chapterId || ("custom-chapter-" + Date.now()),
    chapter_no: payload.chapter_no || "",
    chapter_title: payload.chapter_title || "未命名章節",
    status: "草稿",
    sort_order: readTable(APP.SHEETS.CHAPTERS).length + 1,
    updated_at: nowText()
  };
}

function validatePublish_(chapter, blocks) {
  if (!chapter.chapter_title) throw new Error("章節標題不可空白");
  if (!blocks || blocks.length === 0) throw new Error("章節至少要有核心六段小卡，不能發布空章節");
  var labels = blocks.map(function(block) { return block.block_key; });
  SECTION_LABELS.forEach(function(label) {
    if (labels.indexOf(label) < 0) throw new Error("章節核心六段內容不完整：" + label);
  });
  blocks.forEach(function(block) {
    if (block.block_key !== "相關資源" && !String(block.draft_body || "").trim()) {
      throw new Error(block.block_key + "不可空白");
    }
  });
}

function saveDirectoryResource_(payload, user) {
  requireEditor_(user);
  var input = payload.resource || payload;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var resources = readTable(APP.SHEETS.DIRECTORY_RESOURCES);
    var resourceId = String(input.id || input.resource_id || "").trim();
    if (!resourceId) resourceId = "resource-" + Date.now();
    var existing = resources.find(function(row) {
      return row.resource_id === resourceId;
    });
    var title = String(input.title || "").trim();
    if (!title) throw new Error("資源標題不可空白");

    var item = existing || {};
    item.resource_id = resourceId;
    item.title = title;
    item.office = String(input.office || "").trim() || "其他";
    item.category = String(input.category || input.office || "").trim() || item.office;
    item.type = String(input.type || "").trim() || "連結";
    item.resource_status = String(input.status || input.resource_status || "").trim();
    item.note = String(input.note || "").trim();
    item.links_json = stringifyLinks_(input.links || []);
    item.tags_json = stringifyTags_(input.tags || []);
    item.updated = String(input.updated || "").trim() || Utilities.formatDate(new Date(), APP.TIMEZONE, "yyyy-MM-dd");
    item.visible = input.visible === false ? "FALSE" : "TRUE";
    item.featured = input.featured === true ? "TRUE" : "FALSE";
    item.sort_order = Number(input.sort_order || item.sort_order || resources.length + 1);
    item.archived = "FALSE";
    item.updated_at = nowText();

    if (existing) {
      writeRowByHeaders(APP.SHEETS.DIRECTORY_RESOURCES, existing._row, item);
    } else {
      appendRowByHeaders(APP.SHEETS.DIRECTORY_RESOURCES, item);
    }
    bumpCacheVersion();
    logAction(user.email, "saveDirectoryResource", resourceId, "ok", "directory resource saved");
    return { ok: true, resource_id: resourceId, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function deleteDirectoryResource_(payload, user) {
  requireReviewer_(user);
  var resourceId = String(payload.resource_id || payload.id || "").trim();
  if (!resourceId) throw new Error("缺少 resource_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var resource = readTable(APP.SHEETS.DIRECTORY_RESOURCES).find(function(row) {
      return row.resource_id === resourceId;
    });
    if (!resource) throw new Error("找不到資源：" + resourceId);
    resource.visible = "FALSE";
    resource.archived = "TRUE";
    resource.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.DIRECTORY_RESOURCES, resource._row, resource);
    bumpCacheVersion();
    logAction(user.email, "deleteDirectoryResource", resourceId, "ok", "directory resource archived");
    return { ok: true, resource_id: resourceId, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function reorderDirectoryItems_(payload, user) {
  requireEditor_(user);
  var kind = String(payload.kind || "resource");
  var items = payload.items || [];
  if (!Array.isArray(items) || items.length === 0) throw new Error("缺少排序資料");

  var isShortcut = kind === "shortcut";
  var sheetName = isShortcut ? APP.SHEETS.DIRECTORY_SHORTCUTS : APP.SHEETS.DIRECTORY_RESOURCES;
  var idColumn = isShortcut ? "shortcut_id" : "resource_id";
  var actionName = isShortcut ? "reorderDirectoryShortcuts" : "reorderDirectoryResources";

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var rows = readTable(sheetName);
    items.forEach(function(input) {
      var id = String(input.id || input[idColumn] || "").trim();
      var sortOrder = Number(input.sort_order);
      if (!id || !sortOrder) return;
      var row = rows.find(function(item) {
        return item[idColumn] === id;
      });
      if (!row) throw new Error("找不到要排序的項目：" + id);
      row.sort_order = sortOrder;
      row.updated_at = nowText();
      writeRowByHeaders(sheetName, row._row, row);
    });
    bumpCacheVersion();
    logAction(user.email, actionName, items.map(function(item) { return item.id; }).join(","), "ok", "directory order updated");
    return { ok: true, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function batchUpdateDirectoryResources_(payload, user) {
  requireEditor_(user);
  var resourceIds = payload.resource_ids || payload.ids || [];
  var changes = payload.changes || {};
  if (!Array.isArray(resourceIds) || resourceIds.length === 0) throw new Error("缺少要批次整理的內容");
  if (!changes || Object.keys(changes).length === 0) throw new Error("缺少批次變更欄位");

  var hasOffice = Object.prototype.hasOwnProperty.call(changes, "office") && String(changes.office || "").trim();
  var hasCategory = Object.prototype.hasOwnProperty.call(changes, "category") && String(changes.category || "").trim();
  var hasFeatured = Object.prototype.hasOwnProperty.call(changes, "featured");
  var hasVisible = Object.prototype.hasOwnProperty.call(changes, "visible");
  if (!hasOffice && !hasCategory && !hasFeatured && !hasVisible) throw new Error("沒有可套用的批次變更");

  var idSet = {};
  resourceIds.forEach(function(id) {
    id = String(id || "").trim();
    if (id) idSet[id] = true;
  });

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var count = 0;
    var rows = readTable(APP.SHEETS.DIRECTORY_RESOURCES);
    rows.forEach(function(row) {
      if (!idSet[row.resource_id]) return;
      if (hasOffice) row.office = String(changes.office || "").trim();
      if (hasCategory) row.category = String(changes.category || "").trim();
      if (hasFeatured) row.featured = changes.featured === true ? "TRUE" : "FALSE";
      if (hasVisible) row.visible = changes.visible === false ? "FALSE" : "TRUE";
      row.updated_at = nowText();
      writeRowByHeaders(APP.SHEETS.DIRECTORY_RESOURCES, row._row, row);
      count += 1;
    });
    if (count === 0) throw new Error("找不到可批次整理的內容");
    bumpCacheVersion();
    logAction(user.email, "batchUpdateDirectoryResources", resourceIds.join(","), "ok", "batch updated " + count + " directory resources");
    return { ok: true, count: count, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function saveDirectoryShortcut_(payload, user) {
  requireEditor_(user);
  var input = payload.shortcut || payload;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var shortcuts = readTable(APP.SHEETS.DIRECTORY_SHORTCUTS);
    var shortcutId = String(input.id || input.shortcut_id || "").trim();
    if (!shortcutId) shortcutId = "shortcut-" + Date.now();
    var existing = shortcuts.find(function(row) {
      return row.shortcut_id === shortcutId;
    });
    var label = String(input.label || "").trim();
    if (!label) throw new Error("入口名稱不可空白");

    var item = existing || {};
    item.shortcut_id = shortcutId;
    item.parent_office = String(input.parent_office || input.parentOffice || "").trim() || "常用入口";
    item.label = label;
    item.hint = String(input.hint || "").trim();
    item.query = String(input.query || "").trim();
    item.resource_category = String(input.resource_category || input.resourceCategory || "").trim();
    item.target_id = String(input.target_id || input.targetId || "").trim();
    item.tag = String(input.tag || "").trim();
    item.enabled = input.enabled === false ? "FALSE" : "TRUE";
    item.sort_order = Number(input.sort_order || item.sort_order || shortcuts.length + 1);
    item.updated_at = nowText();

    if (existing) {
      writeRowByHeaders(APP.SHEETS.DIRECTORY_SHORTCUTS, existing._row, item);
    } else {
      appendRowByHeaders(APP.SHEETS.DIRECTORY_SHORTCUTS, item);
    }
    bumpCacheVersion();
    logAction(user.email, "saveDirectoryShortcut", shortcutId, "ok", "directory shortcut saved");
    return { ok: true, shortcut_id: shortcutId, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}

function deleteDirectoryShortcut_(payload, user) {
  requireReviewer_(user);
  var shortcutId = String(payload.shortcut_id || payload.id || "").trim();
  if (!shortcutId) throw new Error("缺少 shortcut_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var shortcut = readTable(APP.SHEETS.DIRECTORY_SHORTCUTS).find(function(row) {
      return row.shortcut_id === shortcutId;
    });
    if (!shortcut) throw new Error("找不到入口：" + shortcutId);
    shortcut.enabled = "FALSE";
    shortcut.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.DIRECTORY_SHORTCUTS, shortcut._row, shortcut);
    bumpCacheVersion();
    logAction(user.email, "deleteDirectoryShortcut", shortcutId, "ok", "directory shortcut disabled");
    return { ok: true, shortcut_id: shortcutId, cache_version: getConfigValue("cache_version", "") };
  } finally {
    lock.releaseLock();
  }
}
