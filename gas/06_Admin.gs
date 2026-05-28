function saveDraft_(payload, user) {
  requireEditor_(user);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapterId = payload.chapter_id;
    var blocks = payload.blocks || [];
    if (!chapterId) throw new Error("缺少 chapter_id");

    var chapter = findChapter_(chapterId);
    var allBlocks = readTable(APP.SHEETS.BLOCKS);
    blocks.forEach(function(input) {
      var block = allBlocks.find(function(row) {
        return row.chapter_id === chapterId && row.block_key === input.key;
      });
      if (!block) throw new Error("找不到內容區塊：" + input.key);

      var body = String(input.draft_body || "");
      var linksJson = stringifyLinks_(input.draft_links || []);
      var risk = input.risk_level || block.risk_level || "低";
      if (hasHighRiskText_(body) && risk === "低") risk = "中";

      block.draft_body = body;
      block.draft_links_json = input.key === "相關資源" ? linksJson : "";
      block.risk_level = risk;
      block.owner_office = input.owner_office || block.owner_office || "";
      block.review_status = "草稿";
      block.updated_at = nowText();
      writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
    });

    chapter.status = "草稿";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
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
      return row.chapter_id === chapterId;
    });
    blocks.forEach(function(block) {
      block.review_status = "待審核";
      block.updated_at = nowText();
      writeRowByHeaders(APP.SHEETS.BLOCKS, block._row, block);
    });
    chapter.status = "待審核";
    chapter.updated_at = nowText();
    writeRowByHeaders(APP.SHEETS.CHAPTERS, chapter._row, chapter);
    logAction(user.email, "submitReview", chapterId, "ok", "submitted for review");
    return { ok: true, chapter_id: chapterId };
  } finally {
    lock.releaseLock();
  }
}

function publishChapter_(payload, user) {
  requireReviewer_(user);
  var chapterId = payload.chapter_id;
  if (!chapterId) throw new Error("缺少 chapter_id");
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var chapter = findChapter_(chapterId);
    var blocks = readTable(APP.SHEETS.BLOCKS).filter(function(row) {
      return row.chapter_id === chapterId;
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

function findChapter_(chapterId) {
  var chapter = readTable(APP.SHEETS.CHAPTERS).find(function(row) {
    return row.chapter_id === chapterId;
  });
  if (!chapter) throw new Error("找不到章節：" + chapterId);
  return chapter;
}

function validatePublish_(chapter, blocks) {
  if (!chapter.chapter_title) throw new Error("章節標題不可空白");
  if (blocks.length !== SECTION_LABELS.length) throw new Error("章節六段內容不完整");
  blocks.forEach(function(block) {
    if (block.block_key !== "相關資源" && !String(block.draft_body || "").trim()) {
      throw new Error(block.block_key + "不可空白");
    }
    if (block.risk_level === "高" && String(block.review_status || "") !== "待審核") {
      throw new Error("高風險內容需先送審：" + block.block_key);
    }
  });
}
