# LINE Bot KV Search Index Plan

## 1. 背景與問題

LINE Bot 第一版目前只做 Quick Reply 快速選單、關鍵字查詢、文字結果回覆，以及 Reply API 被動回覆。

目前 Worker 已加入 LINE directory 背景暖快取設計，但 `caches.default` 不會自動複製到所有 Cloudflare 資料中心。某個資料中心已經暖好的 cache，不代表其他資料中心也能立即命中。

實測中，`getDirectory` / GAS 延遲曾造成 webhook 查詢走 fallback，甚至發生 LINE 平台取消 webhook request 的情況。為了降低冷 cache 與 GAS 延遲對使用者查詢的影響，需要規劃一層 LINE Bot 專用搜尋索引。

## 2. 目標

- 建立 LINE Bot 專用搜尋索引。
- 查詢時優先使用 module memory。
- module memory miss 後讀 Workers KV。
- KV 有資料時採 stale-first，立即搜尋並回覆。
- index 過期時在背景刷新 `getDirectory`。
- 完全沒有可用資料時，才 fallback 到教師手冊首頁。

## 3. 不做事項

- 不做 Rich Menu。
- 不做 Flex / Carousel。
- 不做 Push API。
- 不主動推播、不全校群發。
- 不碰學生個資、霸凌案件資料、性平案件資料。
- 不讓 AI 自行編法規答案。
- 不新增 Google Sheets 欄位。
- 不把 token、secret、email、headers、LINE userId、replyToken 寫入 index / repo / log / response header。

## 4. Cloudflare 技術依據

- Workers KV 適合 read-heavy、低延遲、全球可讀的 key-value data。
- Workers KV 是 eventual consistency，不適合強一致或秒級即時正確資料。
- Workers Cache API 不會自動複製到所有資料中心。
- `ctx.waitUntil()` 可在 response 回傳後繼續執行背景工作。
- KV namespace 需要在 `wrangler.toml` 設定 binding。
- Cron Triggers / scheduled handler 可作為後續定期刷新索引的階段，本計畫先不實作。

## 5. KV 設計

建議 KV binding：

```text
HANDBOOK_BOT_KV
```

建議 KV key：

```text
teacher-handbook:bot-search-index
```

建議 KV value 格式：

```json
{
  "version": "cache_version-or-generated_at",
  "updatedAt": 1760000000000,
  "items": [
    {
      "id": "link-it-equipment-repair",
      "title": "設備報修",
      "office": "總務處",
      "category": "線上填報",
      "tags": ["常用內容", "總務", "報修"],
      "summary": "設備異常或資訊設備問題回報入口",
      "url": "https://..."
    }
  ]
}
```

索引不得包含：

- token
- secret
- email
- headers
- 金鑰
- LINE userId
- replyToken
- 學生個資
- 霸凌／性平案件資料
- 內部除錯資訊

## 6. 索引來源

- 來源為 `getDirectory.resources`。
- 目前 resource 欄位包含 `id`、`category`、`office`、`title`、`type`、`status`、`note`、`links`、`updated`、`tags`、`visible`、`featured`、`sort_order`。
- `summary` 不存在時使用 `note`。
- `links` 取第一個有效 `http(s)` URL。
- `visible === false` 的 resource 排除。
- `status` 不作為 MVP 排除條件。
- `shortcuts` 第一版不納入索引。

## 7. Webhook 查詢流程

1. 驗證 `x-line-signature`。
2. 驗證通過後才 `JSON.parse`。
3. 「選單」/ `menu` 維持 Quick Reply，不讀 KV。
4. 其他文字先讀 module memory bot index。
5. module memory miss 再讀 KV。
6. KV 有資料就 stale-first 搜尋並回覆。
7. index 過期則用 `ctx.waitUntil()` 背景刷新。
8. module memory / KV 都沒有，才短 timeout live fetch `getDirectory`。
9. live fetch 成功就 build index、寫 module memory、寫 KV、回覆。
10. live fetch 失敗或逾時才 fallback 教師手冊首頁。

## 8. 刷新策略

- index 建議永續保存，不以 `expirationTtl` 作為主要控制。
- 使用 `updatedAt` 判斷 stale。
- stale 門檻建議 1 小時。
- 1 小時可降低 GAS 壓力，也可避免教師手冊更新後長時間無法反映。
- 後續可加 protected refresh endpoint。
- 後續可加 Cron scheduled warmup。
- refresh endpoint 若實作必須保護，secret 不得進 repo。

## 9. 預計 Helper

- `getLineBotIndex()`
- `readLineBotIndexFromMemory()`
- `readLineBotIndexFromKv()`
- `buildLineBotIndexFromDirectory()`
- `refreshLineBotIndex()`
- `isLineBotIndexStale()`
- `writeLineBotIndexToKv()`

## 10. 可沿用 Helper

- `searchLineDirectory()`
- `scoreLineResource()`
- `normalizeLineSearchText()`
- `getLineResourceSummary()`
- `getFirstValidLineLink()`
- `createLineSearchResultsMessage()`
- no results / fallback message helpers

## 11. Commit 拆法

- Commit A：新增設計文件，只新增 `docs/line-bot-kv-search-index-plan.md`。
- Commit B：新增 KV binding 與 Worker 讀 KV。
- Commit C：新增 protected refresh endpoint 或 scheduled warmup。

## 12. 風險與回退

- KV eventual consistency，短時間可能讀到舊資料。
- KV binding 或 namespace 設定錯誤會導致讀取失敗。
- index 建立失敗時應 fallback 教師手冊首頁。
- 回退方式：停用 KV 查詢分支，回到目前 memory / cache / `getDirectory` fallback；或重新部署上一穩定 Worker 版本。
