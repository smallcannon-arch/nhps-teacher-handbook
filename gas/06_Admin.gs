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
