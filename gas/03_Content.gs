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
        number: formatChapterNo_(chapter.chapter_no),
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

function getPublishedDirectory() {
  ensureDirectoryCmsReady_();
  return {
    ok: true,
    app_version: getConfigValue("app_version", APP.VERSION),
    cache_version: getConfigValue("cache_version", ""),
    generated_at: nowText(),
    resources: getDirectoryResources_(false),
    shortcuts: getDirectoryShortcuts_(false)
  };
}

function getAdminDirectory(user) {
  ensureDirectoryCmsReady_();
  return {
    ok: true,
    app_version: getConfigValue("app_version", APP.VERSION),
    cache_version: getConfigValue("cache_version", ""),
    user: user || null,
    resources: getDirectoryResources_(true),
    trash: getDirectoryTrash_(),
    shortcuts: getDirectoryShortcuts_(true)
  };
}

function ensureDirectoryCmsReady_() {
  var ss = openSpreadsheet();
  ensureSheet_(ss, APP.SHEETS.DIRECTORY_RESOURCES, APP.DIRECTORY_RESOURCE_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.DIRECTORY_SHORTCUTS, APP.DIRECTORY_SHORTCUT_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.CONFIG, APP.CONFIG_COLUMNS);
  ensureSheet_(ss, APP.SHEETS.LOGS, APP.LOG_COLUMNS);
  if (getConfigValue("app_version", "") !== APP.VERSION) {
    setConfigValue("app_version", APP.VERSION);
    bumpCacheVersion();
  }
  var resources = readTable(APP.SHEETS.DIRECTORY_RESOURCES);
  if (resources.length === 0 && typeof importCurrentDirectoryContent_ === "function") {
    importCurrentDirectoryContent_(false);
  } else {
    seedDirectoryShortcuts_();
  }
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
        number: formatChapterNo_(chapter.chapter_no),
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

function getDirectoryResources_(includeHidden) {
  return readTable(APP.SHEETS.DIRECTORY_RESOURCES)
    .filter(function(row) {
      if (isTrue_(row.archived)) return false;
      return includeHidden || isTrue_(row.visible);
    })
    .sort(function(a, b) {
      var sortDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
      if (sortDiff !== 0) return sortDiff;
      return String(b.updated || "").localeCompare(String(a.updated || ""));
    })
    .map(function(row) {
      return {
        id: row.resource_id,
        category: row.category || row.office || "其他",
        office: row.office || "",
        title: row.title || "",
        type: row.type || "連結",
        status: row.resource_status || "",
        note: row.note || "",
        links: parseJson_(row.links_json, []),
        updated: row.updated || "",
        tags: parseJson_(row.tags_json, []),
        visible: isTrue_(row.visible),
        featured: isTrue_(row.featured),
        sort_order: Number(row.sort_order || 0)
      };
    });
}

function getDirectoryTrash_() {
  return readTable(APP.SHEETS.DIRECTORY_RESOURCES)
    .filter(function(row) {
      return isTrue_(row.archived);
    })
    .sort(function(a, b) {
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    })
    .map(function(row) {
      return {
        id: row.resource_id,
        category: row.category || row.office || "其他",
        office: row.office || "",
        title: row.title || "",
        type: row.type || "連結",
        status: row.resource_status || "",
        note: row.note || "",
        links: parseJson_(row.links_json, []),
        updated: row.updated || "",
        tags: parseJson_(row.tags_json, []),
        visible: isTrue_(row.visible),
        featured: isTrue_(row.featured),
        sort_order: Number(row.sort_order || 0),
        deleted_at: row.updated_at || ""
      };
    });
}

function getDirectoryShortcuts_(includeDisabled) {
  var rows = readTable(APP.SHEETS.DIRECTORY_SHORTCUTS)
    .filter(function(row) { return includeDisabled || isTrue_(row.enabled); })
    .sort(function(a, b) {
      return Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
  var grouped = {};
  rows.forEach(function(row) {
    var parent = row.parent_office || "常用入口";
    if (!grouped[parent]) grouped[parent] = [];
    grouped[parent].push({
      id: row.shortcut_id || "",
      label: row.label || "",
      hint: row.hint || "",
      query: row.query || "",
      resourceCategory: row.resource_category || "",
      targetId: row.target_id || "",
      tag: row.tag || "",
      enabled: isTrue_(row.enabled),
      sort_order: Number(row.sort_order || 0)
    });
  });
  return grouped;
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

function stringifyTags_(tags) {
  if (!tags) return "[]";
  if (!Array.isArray(tags)) return "[]";
  return JSON.stringify(tags.map(function(tag) {
    return String(tag || "").trim();
  }).filter(Boolean));
}

function isTrue_(value) {
  if (value === true) return true;
  var text = String(value || "").trim().toUpperCase();
  return text === "TRUE" || text === "Y" || text === "YES" || text === "1";
}

function formatChapterNo_(value) {
  var text = String(value || "").trim();
  if (/^\d+$/.test(text) && text.length < 2) return ("0" + text).slice(-2);
  return text;
}

function hasHighRiskText_(text) {
  var value = String(text || "");
  return HIGH_RISK_KEYWORDS.some(function(keyword) {
    return value.indexOf(keyword) >= 0;
  });
}
