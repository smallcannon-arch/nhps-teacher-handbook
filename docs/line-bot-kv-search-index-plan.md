# LINE Bot KV 搜尋索引規劃

## 1. 本階段目標

本文件只規劃 LINE Bot 使用 Workers KV 作為「教師手冊常用資料搜尋索引」的設計方向，不進行實作、不建立 KV namespace、不修改 Worker、不部署。

目標是讓 LINE Bot 在使用者輸入關鍵字時，可以先從 Worker 記憶體與 Workers KV 讀取已整理好的搜尋索引，降低每次 webhook 都即時查詢 GAS / Google Sheets 的延遲與風險。

本階段不做：

- 不新增或修改 `cloudflare/worker.js`
- 不修改 `wrangler.toml`
- 不修改 `index.html`
- 不修改 `admin.html`
- 不修改 `gas/`
- 不建立 Workers KV namespace
- 不新增 KV binding
- 不部署 Worker
- 不處理 Rich Menu
- 不處理 Flex / Carousel
- 不處理 Push API
- 不寫入或輸出 token、secret、LINE userId、replyToken、試算表 ID、Google OAuth Client ID 或任何敏感值

## 2. 目前專案基準線

本輪安全修補已關帳，後續 LINE Bot / KV 搜尋索引應以此狀態為基準：

- `origin/main` 最新 commit：`6c2e265 docs: record publish permission and xss review`
- `main` 與 `origin/main` 同步
- 工作區乾淨
- GitHub Pages：completed / success
- Commit A `bd96b5c frontend: sanitize public content links` 已封存在 `archive/xss-sanitize-old-index`，不推 main
- Commit B `154c117 gas: require reviewer to publish chapters` 已 push，GAS Web App 既有 deployment 已更新
- editor / reviewer UI 權限驗收因目前 `admin.html` 為維護頁，待後台恢復後補驗

## 3. Cloudflare 技術前提

本規劃採用 Cloudflare 官方文件中的幾個前提：

- Workers KV 適合讀取頻繁、可快取的 key-value 資料，但屬於 eventual consistency，不適合需要強一致性的即時寫入判斷。
- Cache API 的內容不會跨資料中心自動複製，因此不適合作為 LINE Bot 全域搜尋索引的主要資料層。
- `ctx.waitUntil()` 可在回應送出後繼續執行背景工作，適合用來做索引更新、快取回填或非阻塞記錄。
- KV namespace 需透過 Worker binding 供 Worker 使用，後續才會在 `wrangler.toml` 規劃 binding。
- Cron Triggers / scheduled handler 可用於週期性更新索引，但本階段只規劃，不實作。

參考文件：

- Cloudflare Workers KV：`https://developers.cloudflare.com/kv/concepts/how-kv-works/`
- Cloudflare Workers Cache API：`https://developers.cloudflare.com/workers/runtime-apis/cache/`
- Cloudflare Workers Context / waitUntil：`https://developers.cloudflare.com/workers/runtime-apis/context/`
- Wrangler configuration：`https://developers.cloudflare.com/workers/wrangler/configuration/`
- Cron Triggers：`https://developers.cloudflare.com/workers/configuration/cron-triggers/`

## 4. 架構定位

建議 LINE Bot 搜尋索引採四層讀取順序：

1. Worker module memory
2. Workers KV
3. GAS `getDirectory` 即時讀取
4. fallback 文字回覆

讀取策略：

- memory 命中：最快，直接搜尋並回覆
- memory miss：讀 KV
- KV 命中但 stale：先用舊資料回覆，再用 `ctx.waitUntil()` 背景刷新
- KV miss：timeout 內嘗試 live fetch GAS `getDirectory`
- live fetch 成功：建立索引，寫入 memory / KV，再回覆
- live fetch 失敗：回覆友善 fallback，不阻塞 webhook

不建議每次 webhook 都直接打 GAS，原因是：

- webhook 回覆有時間壓力
- GAS / Sheets 延遲不穩
- LINE Bot 查詢通常是讀取頻繁、寫入少的情境
- 過度依賴即時 GAS 會讓 Bot 體感速度變差

## 5. KV namespace 與 key 規劃

建議 KV binding 名稱：

```text
HANDBOOK_BOT_KV
```

建議 KV key：

```text
teacher-handbook:bot-search-index
```

後續若要支援多環境，可延伸為：

```text
teacher-handbook:bot-search-index:production
teacher-handbook:bot-search-index:preview
```

本階段不建立 namespace，也不寫入 `wrangler.toml`。

後續實作時，`wrangler.toml` 只應出現 binding 與 namespace id，不可把 LINE secrets 放入 `[vars]`。

LINE secrets 應使用 Workers Secrets 管理。

## 6. Search Index 資料格式

建議 KV value 使用 JSON：

```json
{
  "version": "cache_version-or-generated_at",
  "updatedAt": 1760000000000,
  "source": "getDirectory",
  "items": [
    {
      "id": "link-it-equipment-repair",
      "title": "資訊設備報修",
      "office": "資訊組",
      "category": "資訊系統與帳號",
      "tags": ["設備", "報修", "資訊"],
      "summary": "教室資訊設備故障時的報修入口與處理提醒。",
      "url": "https://example.invalid"
    }
  ]
}
```

欄位說明：

- `version`：可使用 GAS `cache_version`、`generated_at` 或索引產生版本
- `updatedAt`：索引產生時間，Unix milliseconds
- `source`：索引來源，例如 `getDirectory`
- `items`：可搜尋項目清單
- `id`：穩定識別碼
- `title`：顯示標題
- `office`：處室或承辦單位
- `category`：分類
- `tags`：搜尋輔助關鍵字
- `summary`：短摘要，避免放敏感資料
- `url`：第一個安全、可公開的 `http(s)` 連結

不放入索引：

- token
- secret
- email
- header
- Cookie
- LINE userId
- replyToken
- 個人資料
- 學生事件細節
- 內部簽核資訊
- 未公開文件
- 試算表 ID
- Google OAuth Client ID
- 任何金鑰或敏感值

## 7. 索引來源與過濾規則

建議索引來源為既有 GAS `getDirectory` 回傳資料，而不是直接讀 Sheets。

建議只納入：

- 可公開給校內教師查詢的入口型資料
- 常用表單入口
- Padlet 或校務常用連結
- 教師手冊章節入口
- 無個資、無事件細節、無內部簽核內容的流程性資料

建議排除：

- `visible === false`
- 未發布或未確認資料
- 無有效標題的資料
- 無公開連結且摘要不足以回答的資料
- URL scheme 不是 `http:` 或 `https:` 的連結
- 涉及學生、家長、個案、成績、特教、輔導、校安、霸凌、性平、採購、工程、財產細節的敏感資料

若資料來源含 `note` 但無 `summary`，可使用 `note` 產生短摘要，但需先做敏感詞與長度保守處理。

## 8. Webhook 查詢流程

建議 webhook 流程：

1. 驗證 `x-line-signature`
2. 解析 LINE webhook body
3. 若收到 `目錄` / `menu`，回 Quick Reply，不查搜尋索引
4. 若收到一般文字，先讀 Worker memory index
5. memory miss 時讀 Workers KV
6. KV 命中但過舊時，先使用舊索引回覆，再用 `ctx.waitUntil()` 背景刷新
7. memory / KV 都 miss 時，短 timeout live fetch GAS `getDirectory`
8. live fetch 成功時，建立 index，寫入 memory 與 KV，再搜尋回覆
9. live fetch 失敗時，回 fallback 文字
10. Reply API 失敗時只記錄非敏感錯誤，不改用 Push API

不建議：

- webhook 主流程同步等待長時間 GAS 查詢
- 將完整 webhook body 寫入 log
- 將 replyToken / userId 寫入 log
- 在錯誤訊息中輸出 LINE secrets 或內部 URL

## 9. 搜尋策略

MVP 搜尋不使用 AI，採保守關鍵字比對。

建議搜尋欄位：

- `title`
- `tags`
- `category`
- `office`
- `summary`

建議評分：

- title 完全或部分命中：最高
- tags 命中：高
- category / office 命中：中
- summary 命中：低

建議回覆：

- 最多 5 筆結果
- 每筆包含標題、處室/分類、短摘要、連結
- 結果過多時提示使用更明確關鍵字
- 無結果時提供常用入口與 Quick Reply

建議測試關鍵字：

- 報修
- 行事曆
- 表單
- Padlet
- 資訊
- 總務
- 場地
- 帳號
- 請假

## 10. 更新策略

可分三階段：

### 10.1 Background refresh

- webhook 發現 index stale 時觸發
- 使用 `ctx.waitUntil()` 背景更新 KV
- 不阻塞 LINE 回覆

### 10.2 Manual refresh endpoint

候選端點：

```text
POST /line/admin/refresh-index
```

要求：

- 必須有管理用 shared secret 或等效保護
- secret 不可寫在 repo
- 不可用 GET 直接公開刷新
- 回應不輸出敏感資訊

### 10.3 Scheduled refresh

- 使用 Cron Triggers / scheduled handler
- 例如每 30 分鐘或每 1 小時更新一次
- 本階段只規劃，不設定 cron

## 11. 錯誤處理

需要處理的情境：

- memory miss
- KV miss
- KV read failure
- index stale
- live fetch timeout
- live fetch failure
- index build failure
- no results
- Reply API failure
- invalid signature

錯誤策略：

- 不阻塞 webhook
- 不回傳內部錯誤細節給使用者
- 不把 webhook body、headers、replyToken、userId、token、secret 寫入 log
- 使用簡短 fallback，例如：
  `目前暫時無法查詢教師手冊資料，請稍後再試，或先使用教師常用網入口。`

## 12. 安全與隱私規則

必守規則：

- 不記錄 LINE userId
- 不記錄 replyToken
- 不記錄 webhook headers
- 不記錄完整 webhook body
- 不記錄 token / secret
- 不把敏感資料寫入 KV
- 不把學生個資、個案、成績、通報、採購工程細節納入索引
- 不在 response header 放 debug secret
- 不把內部設定值輸出到前端或 LINE 回覆

若需要診斷，只記錄：

- request 類型
- 是否驗簽成功
- 是否命中 memory / KV / live fetch
- 搜尋結果數量
- 高層級錯誤代碼

## 13. 建議 commit 切分

後續若進入實作，建議拆成小步：

### Commit A：建立 KV namespace 的操作紀錄

- 僅記錄 Cloudflare dashboard / CLI 建立結果
- 不修改 Worker
- 不 deploy

### Commit B：加入 KV binding 設定

- 修改 `wrangler.toml`
- 僅加入 KV binding
- 不加入 secrets
- 不 deploy，除非另行確認

### Commit C：Worker 讀取 KV search index

- 修改 `cloudflare/worker.js`
- 加入 memory / KV / fallback 讀取流程
- 加入搜尋與 Quick Reply / Reply API 基礎回覆
- 不加入 Rich Menu / Flex / Carousel / Push API

### Commit D：refresh endpoint / scheduled refresh

- 加入受保護的 refresh endpoint
- 視需要加入 scheduled handler
- 加入驗收與失敗處理

## 14. 驗收清單

實作前驗收：

- `git status -sb` 乾淨
- `git status --short --untracked-files=all` 無非預期檔案
- 未修改 `wrangler.toml`
- 未修改 `cloudflare/worker.js`
- 未建立 KV namespace
- 未 deploy Worker

實作後功能驗收：

- `目錄` / `menu` 仍回 Quick Reply
- `報修` 可回傳相關入口
- `行事曆` 可回傳相關入口
- `表單` 可回傳相關入口
- `Padlet` 可回傳相關入口
- 無結果時有友善 fallback
- KV miss 時可 fallback live fetch
- KV stale 時可先回覆舊資料並背景刷新
- `getDirectory` 正常時可建立索引
- invalid signature 回 401
- 未輸出 token / secret / replyToken / userId

## 15. 下一步建議

本文件完成後，下一步不要直接改 Worker。

建議下一輪先確認：

1. 是否真的要使用 Workers KV，而不是僅使用 Worker memory + GAS fallback。
2. 是否已有 Cloudflare KV namespace 命名慣例。
3. 是否要先做測試環境 KV namespace。
4. 是否要新增一份「KV namespace 建立與綁定核對清單」。
5. LINE webhook 目前實際可用的測試方式與測試帳號。

確認後再進入 KV namespace 建立與 binding 設計。
