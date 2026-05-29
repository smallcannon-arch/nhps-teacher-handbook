function getPublishedHandbook() {
  var chapters = readTable(APP.SHEETS.CHAPTERS)
    .filter(function(chapter) { return chapter.status === "已發布"; })
    .sort(function(a, b) { return Number(a.sort_order) - Number(b.sort_order); });

  var blocks = readTable(APP.SHEETS.BLOCKS)
    .filter(function(block) { return block.review_status === "已發布" && block.review_status !== "deleted"; })
    .sort(function(a, b) { return Number(a.sort_order) - Number(b.sort_order); });

  return {
    ok: true,
    app_version: getConfigValue("app_version", APP.VERSION),
    cache_version: getConfigValue("cache_version", ""),
    generated_at: nowText(),
    section_labels: SECTION_LABELS,
    chapters: chapters.map(function(chapter) {
      var content = {};
      var chapterBlocks = [];
      blocks.filter(function(block) {
        return block.chapter_id === chapter.chapter_id;
      }).forEach(function(block) {
        var isLinks = block.block_key === "相關資源";
        var value = isLinks ? parseJson_(block.published_links_json, []) : block.published_body;
        content[block.block_key] = value;
        chapterBlocks.push({
          block_id: block.block_id,
          key: block.block_key,
          title: block.block_title || block.block_key,
          body: isLinks ? "" : block.published_body,
          links: isLinks ? value : [],
          risk_level: block.risk_level || "低",
          sort_order: Number(block.sort_order)
        });
      });
      return {
        id: chapter.chapter_id,
        number: chapter.chapter_no,
        title: chapter.chapter_title,
        status: chapter.status,
        content: content,
        blocks: chapterBlocks
      };
    })
  };
}

function getConfigPayload() {
  return {
    ok: true,
    app_version: getConfigValue("app_version", APP.VERSION),
    cache_version: getConfigValue("cache_version", ""),
    generated_at: nowText()
  };
}

function getAdminHandbook(user) {
  var chapters = readTable(APP.SHEETS.CHAPTERS)
    .filter(function(chapter) { return chapter.status !== "deleted"; })
    .sort(function(a, b) { return Number(a.sort_order) - Number(b.sort_order); });
  var blocks = readTable(APP.SHEETS.BLOCKS)
    .filter(function(block) { return block.review_status !== "deleted"; })
    .sort(function(a, b) { return Number(a.sort_order) - Number(b.sort_order); });

  return {
    ok: true,
    app_version: getConfigValue("app_version", APP.VERSION),
    cache_version: getConfigValue("cache_version", ""),
    user: user || null,
    section_labels: SECTION_LABELS,
    chapters: chapters.map(function(chapter) {
      return {
        id: chapter.chapter_id,
        number: chapter.chapter_no,
        title: chapter.chapter_title,
        status: chapter.status,
        sort_order: Number(chapter.sort_order),
        blocks: blocks.filter(function(block) {
          return block.chapter_id === chapter.chapter_id;
        }).map(function(block) {
          return {
            block_id: block.block_id,
            key: block.block_key,
            title: block.block_title,
            draft_body: block.draft_body,
            draft_links: parseJson_(block.draft_links_json, []),
            published_body: block.published_body,
            published_links: parseJson_(block.published_links_json, []),
            risk_level: block.risk_level || "低",
            owner_office: block.owner_office || "",
            review_status: block.review_status || "草稿",
            sort_order: Number(block.sort_order)
          };
        })
      };
    })
  };
}

function parseJson_(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function stringifyLinks_(links) {
  if (!links) return "[]";
  if (!Array.isArray(links)) return "[]";
  return JSON.stringify(links.map(function(link) {
    return {
      label: String(link.label || "").trim(),
      url: String(link.url || "").trim()
    };
  }).filter(function(link) {
    return link.label && link.url;
  }));
}

function hasHighRiskText_(text) {
  var value = String(text || "");
  return HIGH_RISK_KEYWORDS.some(function(keyword) {
    return value.indexOf(keyword) >= 0;
  });
}
