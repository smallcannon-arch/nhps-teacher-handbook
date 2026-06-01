# LINE Bot Worker Webhook 實作方案

本文件僅作為 LINE Bot Worker webhook 的實作方案規劃，不代表本輪直接實作、部署、建立 Cloudflare Workers Secrets、修改 Worker 或新增 webhook。

## 1. 實作目標

本階段目標是規劃未來在現有 Cloudflare Worker 中新增 LINE webhook 旁路，讓 LINE Bot 可以接收教師查詢並回覆教師手冊資源。

實作時應維持既有架構：

- 不拆原網站 API。
- 不影響既有 `GET ?action=getDirectory`。
- 不影響後台 `POST -> proxyPostToGas()`。
- 不修改前台 `index.html` 或後台 `admin.html`。
- 不新增 Google Sheets 欄位作為 MVP 必要條件。

## 2. 現有 Worker 結構摘要

目前 `cloudflare/worker.js` 是單一 Worker 入口，採 method 與 action 分流。

現有流程：

- `OPTIONS`：直接回 CORS response。
- `POST`：目前全部走 `proxyPostToGas()`，代理到 GAS，供後台管理流程使用。
- `GET`：採 `?action=` 分流。
- 支援 action：`getHandbook`、`getDirectory`、`getConfig`、`health`。
- `getDirectory`：先透過 `getConfig` 取得 `cache_version`，再用 `caches.default` 依 `action + cache_version` 快取；cache miss 時向 GAS 取得資料。

現有 `getDirectory` 是公開讀取路徑，LINE Bot MVP 應沿用這份資料，不改資料結構、不改 GAS、不改 Sheets 欄位。

## 3. 新增路由位置

未來實作 `POST /line/webhook` 時，路由判斷必須放在泛用 `POST -> proxyPostToGas()` 之前。

建議順序：

1. 建立 `url = new URL(request.url)`。
2. 先處理 `OPTIONS`。
3. 檢查 `POST /line/webhook`。
4. 其他 `POST` 才維持走 `proxyPostToGas()`。
5. 既有 `GET ?action=` 流程維持不變。

原因：

如果不先 path-gate，LINE webhook 的 POST request 會被當成後台 POST proxy 到 GAS，造成 webhook 無法處理，也可能干擾後台錯誤排查。

## 4. 第一個 Commit：Webhook Shell

建議 commit message：

```text
worker: add line webhook shell
```

最小範圍：

- 只修改 `cloudflare/worker.js`。
- 新增 `POST /line/webhook`。
- 使用 raw body 驗證 `x-line-signature`。
- 驗證通過後才 `JSON.parse`。
- 僅處理文字訊息。
- 輸入「選單」回 Quick Reply。
- 非文字訊息回簡短提示與選單。
- 查不到或未支援輸入時回首頁 fallback。
- 新增 Reply API helper。
- 不讀取 `getDirectory`。
- 不加入搜尋排序。
- 不修改既有 GET action。
- 不修改既有 GAS POST proxy。

Shell commit 的目標是先建立安全的 webhook 骨架與回覆通道，降低一次實作過多邏輯的風險。

## 5. 第二個 Commit：Directory Search

建議 commit message：

```text
worker: add line directory search
```

範圍：

- 仍只修改 `cloudflare/worker.js`。
- 讀取既有 `getDirectory`。
- 搜尋欄位：`title`、`office`、`category`、`tags`、`summary || note`、`links`。
- 回覆 1 到 5 筆結果。
- MVP 建議用 1 則文字訊息整理多筆結果，避免 Reply API 5 message objects 限制。

建議權重：

- `title` 命中最高。
- `tags` / `category` 次之。
- `office` / `note` 再次之。
- `links` 作為輔助。

搜尋結果只應回覆教師手冊既有資料與連結，不讓 AI 自行生成法規答案或案件處理結論。

## 6. Signature 驗證設計

signature 驗證必須使用：

- Secret 名稱：`LINE_CHANNEL_SECRET`
- 來源：Cloudflare Workers Secrets
- 演算法：使用原始 request body 做 HMAC-SHA256
- 比對目標：request header `x-line-signature`

驗證失敗時：

- 回 `401 Unauthorized`。
- response 內容保持簡短。
- 不透露 secret 是否存在、signature 計算細節或環境設定狀態。

request body 只能安全消耗一次，因此流程應為：

1. `await request.text()` 取得 `rawBody`。
2. 使用 `rawBody` 驗證 signature。
3. 驗證成功後才 `JSON.parse(rawBody)`。

不要先使用 `request.json()`，否則會失去原始 body，造成 signature 驗證流程不可靠。

## 7. Secrets 管理

未來建立 secrets 時使用 Cloudflare Workers Secrets：

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

管理原則：

- 不放 `wrangler.toml [vars]`。
- 不進 repo。
- 不寫 log。
- 不放 response header。
- 不在錯誤訊息中輸出。
- 不在文件中保存實際 secret、token、金鑰或其他敏感值。

Worker 程式只使用 `env.LINE_CHANNEL_SECRET` 與 `env.LINE_CHANNEL_ACCESS_TOKEN` 這類變數名稱，不寫入實際值。

## 8. Reply API 策略

LINE Reply API endpoint：

```text
https://api.line.me/v2/bot/message/reply
```

使用方式：

- 使用 webhook event 的 `replyToken`。
- 使用 Cloudflare Workers Secret `LINE_CHANNEL_ACCESS_TOKEN` 作為 Authorization bearer token。
- 採 best-effort 回覆。
- 單次 reply message objects 不超過 LINE 限制。

Reply API 失敗時：

- 不記錄 access token。
- 不記錄 channel secret。
- 不記錄 replyToken。
- 不記錄 LINE userId。
- 不記錄完整 webhook body。
- 不記錄 request headers 全量。

是否讓 LINE 重試，需在實作時決定。建議 shell 階段先以安全、簡短、可觀察但不洩密為原則。

## 9. Logging 原則

只允許記錄：

- 非敏感錯誤類型。
- HTTP status。
- 階段名稱。
- 時間。

禁止記錄：

- access token。
- channel secret。
- replyToken。
- LINE userId。
- 完整 webhook body。
- 使用者輸入全文。
- request headers 全量。

若需要除錯，應使用短錯誤碼或階段代號，例如 `line_signature_invalid`、`line_reply_failed`、`directory_fetch_failed`，避免包含個資或敏感資訊。

## 10. Fallback 策略

- signature invalid：回 `401 Unauthorized`。
- 非文字訊息：回提示與選單。
- 空白訊息：回提示與選單。
- 查不到：回教師手冊首頁與建議關鍵字。
- `getDirectory` 失敗：回首頁與稍後再試提示。
- Reply API 失敗：Worker 不洩密，必要時只回 webhook HTTP 結果。

Fallback 文字應保持簡短，避免讓使用者誤以為 Bot 能提供法規判斷、案件處理結論或個資查詢。

## 11. 驗收清單

Shell commit 驗收：

- 既有 `GET ?action=getDirectory` 正常。
- 既有後台 POST proxy 正常。
- `POST /line/webhook` signature invalid 回 401。
- 文字「選單」可產生 Quick Reply payload。
- 非文字訊息有 fallback。
- 無 secrets 時不洩漏設定資訊。

Search commit 驗收：

- 輸入「報修」回報修相關連結。
- 輸入「霸凌」只回既有教師手冊連結，不自行生成法律答案。
- 輸入「請假」可回差勤／請假相關資源。
- 無結果有 fallback。
- API 失敗有 fallback。
- 回覆不超過 LINE 限制。

## 12. 暫不做事項

- 不做 Push API。
- 不主動推播。
- 不全校群發。
- 不保存查詢紀錄。
- 不碰學生個資。
- 不碰霸凌／性平案件資料。
- 不讓 AI 自行編法規答案。
- 不新增 Sheets 欄位作為 MVP 必要條件。
- 不修改前台或後台。
