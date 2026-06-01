# LINE Bot MVP 規格書

本文件僅作為 LINE Bot MVP 的規格規劃，不代表本輪直接實作、部署、建立 secrets、修改 Worker 或新增 webhook。

## 1. 目標與定位

LINE Bot MVP 目標是讓教師可在 LINE 中快速查詢教師手冊資源，作為教師手冊網站之外的第二入口。

本 Bot 不取代教師手冊網站，不拆原有前台、後台、GAS 或 Worker 架構，也不改變既有 `getDirectory` 對外資料結構。MVP 僅提供查詢與導流，不主動推播，不保存使用者查詢紀錄。

## 2. 使用情境

- 老師輸入「選單」，Bot 回覆 Quick Reply 主選單。
- 老師點選 Quick Reply，例如「總務」、「表件」、「流程」。
- 老師直接輸入關鍵字，例如：報修、霸凌、性平、請假、冷氣、採購。
- 查不到資料時，Bot 回覆教師手冊首頁與提示文字。
- 查詢逾時或 API 失敗時，Bot 回覆教師手冊首頁與稍後再試提示。

## 3. 輸入類型

- 選單指令：`選單`、`menu`
- 處室分類：總務、教務、學務、輔導、人事、會計
- 資料類別：系統入口、線上填報、表件、流程、校內規範
- 關鍵字查詢：以使用者輸入文字比對既有資料
- 無結果 fallback：回覆首頁與建議關鍵字

## 4. Quick Reply 主選單設計

Quick Reply 項目：

- 總務
- 教務
- 學務
- 輔導
- 人事
- 會計
- 系統入口
- 線上填報
- 表件
- 流程
- 校內規範
- 教師手冊首頁

備註：LINE Quick Reply 官方限制為最多 13 個 items，本 MVP 共 12 個，符合限制。

## 5. 搜尋資料來源與欄位

MVP 優先使用既有 `getDirectory` 資料來源。

搜尋欄位包含：

- `title`
- `office`
- `category`
- `tags`
- `summary`
- `links`

其中 `links` 可包含連結標籤與 URL 文字，但只作為輔助比對，不應優先於標題與標籤。

## 6. 搜尋邏輯 MVP

MVP 採用關鍵字與欄位文字比對，不使用 AI 自行生成答案。

建議權重：

- `title` 命中最高
- `tags` / `category` 次之
- `office` / `summary` 再次之
- `links` 作為輔助

回傳 1 到 5 筆最相關結果。排序可先依命中分數，再以既有 `sort_order`、是否有連結、更新時間作為輔助排序。

## 7. 回覆格式

查到結果時，回覆 1 到 5 筆教師手冊資源。每筆包含：

- 標題
- 處室／類別
- 簡短摘要
- 連結

查不到結果時，回覆：

- 教師手冊首頁
- 簡短提示，例如「目前找不到完全符合的資料，可換個關鍵字，或回教師手冊首頁查詢。」

API 失敗或逾時時，回覆：

- 教師手冊首頁
- 稍後再試提示

LINE Reply API 單次最多可回覆 5 個 message objects；MVP 應控制在此限制內，或將多筆結果合併為單一文字訊息。

## 8. Worker Webhook 架構

在 Cloudflare Worker 新增 LINE webhook 旁路，例如：

- `POST /line/webhook`

此路徑只處理 LINE webhook，不拆原網站 API，不改既有 `getDirectory` 對外資料結構。

流程：

1. Worker 接收 LINE webhook event。
2. 驗證 `x-line-signature`。
3. 只處理文字訊息。
4. 若文字為「選單」，回覆 Quick Reply。
5. 若文字為分類或關鍵字，讀取既有 `getDirectory` 資料。
6. 依 MVP 搜尋邏輯找出 1 到 5 筆結果。
7. 使用 LINE Reply API 回覆。
8. 非文字訊息回覆簡短提示與選單。

## 9. 安全與 Secrets

必須驗證 LINE `x-line-signature`。驗證方式為使用 channel secret 對原始 request body 做 HMAC-SHA256，並與 header 簽章比對。

Secrets 規則：

- `LINE_CHANNEL_SECRET` 放 Cloudflare Workers Secrets。
- `LINE_CHANNEL_ACCESS_TOKEN` 放 Cloudflare Workers Secrets。
- 不得寫入前端。
- 不得 commit 到 repo。
- 不得寫入 log。
- 不得放入 response header。

Cloudflare Workers Secrets 透過 Wrangler 設定，Worker 內以 `env.SECRET_NAME` 存取。文件與程式碼只能保留變數名稱或設定步驟，不得保存實際 secret、token、金鑰或其他敏感值。

## 10. 明確不做事項

- 不做 Push API。
- 不主動推播。
- 不全校群發。
- 不碰學生個資。
- 不碰霸凌／性平案件資料。
- 不讓 AI 自行編法規答案。
- 不新增 Sheets 欄位作為 MVP 必要條件。

## 11. 驗收標準

- 輸入「選單」可看到 Quick Reply。
- 點「總務」可回總務相關資源。
- 輸入「報修」可回報修相關連結。
- 輸入「霸凌」只回教師手冊既有相關連結，不自行生成法律答案。
- 查不到時有安全 fallback。
- API 失敗或逾時時回首頁與稍後再試提示。
- signature 驗證失敗時拒絕處理。
- secrets 不出現在 repo、log、header。

## 12. 測試案例

- 正常選單：輸入「選單」。
- 正常關鍵字：輸入「報修」。
- 多結果排序：輸入「請假」或「採購」。
- 無結果：輸入不存在的詞。
- API 失敗：模擬 `getDirectory` 失敗或逾時。
- signature invalid：使用錯誤簽章送 webhook。
- 非文字訊息：貼圖、圖片、檔案。
- 空白訊息：空字串或只含空白。
