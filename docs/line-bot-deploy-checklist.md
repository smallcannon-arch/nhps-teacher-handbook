# LINE Bot Worker 部署操作清單

本文件是 LINE Bot Worker shell 部署前後的操作清單，用來避免誤刪 `GAS_URL`、誤把 secrets 寫入 repo、誤把 webhook URL 填錯。本文件只保存操作步驟與檢查項目，不保存任何實際 token、secret、email、金鑰或敏感值。

## 1. 目的

LINE Bot webhook shell 已在 Worker 程式中完成，但正式接上 LINE 前，仍需要建立 Cloudflare Workers Secrets、部署 Worker、測試既有 API 與 webhook 安全回應，最後才到 LINE Developers 設定 webhook URL。

目前狀態：尚未建立 Cloudflare Workers Secrets、尚未 deploy Worker、尚未設定 LINE webhook URL。

本清單目的：

- 避免部署時誤刪既有 `GAS_URL`。
- 避免把 LINE secrets 寫入 repo 或 `wrangler.toml`。
- 避免把 LINE webhook URL 填成 Worker 根路徑或 `?action=...`。
- 確認部署後不影響教師手冊前台、後台與 GAS proxy。

## 2. 目前 Worker 設定

目前 `wrangler.toml` 設定：

- Worker name：`nhps-teacher-handbook-api`
- main：`cloudflare/worker.js`
- compatibility_date：`2026-05-28`
- `[vars] GAS_URL` 是既有教師手冊 API 與後台 proxy 必要設定，必須保留。

提醒：

- LINE secrets 不得放入 `[vars]`。
- 不得修改或刪除 `GAS_URL`。
- `GAS_URL` 仍維持既有 GAS Web App URL，不要替換成 LINE 相關設定。

## 3. 需要建立的 Secrets

未來需要建立：

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`

Secrets 管理規則：

- 只能放 Cloudflare Workers Secrets。
- 不得放 repo。
- 不得放 `wrangler.toml`。
- 不得放 log。
- 不得放 response header。
- 不得寫入文件內容。
- 不得在錯誤訊息中輸出。

## 4. 建議操作順序

- [ ] 確認 git 狀態乾淨。
- [ ] 確認最新 commit 是 `d0baeaa worker: add line webhook shell`。
- [ ] 確認 `wrangler.toml` 保留 `GAS_URL`。
- [ ] 建立 LINE secrets。
- [ ] deploy Worker shell。
- [ ] 測 `?action=health`。
- [ ] 測 `?action=getDirectory`。
- [ ] 測 `POST /line/webhook` missing signature。
- [ ] 測 `POST /line/webhook` invalid signature。
- [ ] 測後台 POST proxy。
- [ ] 到 LINE Developers 設定 webhook URL。
- [ ] 啟用 LINE webhook。
- [ ] 測輸入「選單」。

## 5. Worker URL 與 Webhook URL

預期 URL：

- Worker base URL：`https://nhps-teacher-handbook-api.smallcannon.workers.dev`
- LINE webhook URL：`https://nhps-teacher-handbook-api.smallcannon.workers.dev/line/webhook`

提醒：

- 不要填 Worker 根路徑。
- 不要填 `?action=...`。
- 不要把 LINE webhook URL 設成 GitHub Pages URL。

## 6. Deploy 前本機檢查

部署前先執行：

```bash
git status -sb
git log --oneline -5
git show --name-only --oneline HEAD
git diff --check -- cloudflare/worker.js
```

Windows / Node.js 語法檢查：

```powershell
Get-Content -Raw cloudflare\worker.js | node --input-type=module --check
```

部署前也應確認：

- `wrangler.toml` 中 `[vars] GAS_URL` 仍存在。
- `cloudflare/worker.js` 沒有 `console.log` 洩漏敏感資訊。
- `cloudflare/worker.js` 沒有實際 token、secret、email、金鑰。
- 最新 commit 只包含預期的 Worker shell 變更。

## 7. Deploy 後驗收

部署後需確認：

- `GET ?action=health` 正常。
- `GET ?action=getDirectory` 正常。
- `POST /line/webhook` missing signature 安全拒絕。
- `POST /line/webhook` invalid signature 回 `401`。
- 後台 POST proxy 正常。
- response 不含 token、secret、replyToken、userId。
- LINE 輸入「選單」可回 Quick Reply。

建議測試 URL：

```text
GET  https://nhps-teacher-handbook-api.smallcannon.workers.dev?action=health
GET  https://nhps-teacher-handbook-api.smallcannon.workers.dev?action=getDirectory
POST https://nhps-teacher-handbook-api.smallcannon.workers.dev/line/webhook
```

## 8. 風險提醒

- `wrangler secret put` 可能建立或部署新的 Worker version，應視為部署窗口的一部分。
- 不得誤刪 `GAS_URL`。
- 不得把 LINE secrets 放入 `[vars]`。
- 不得在 secrets 未建立前接 LINE webhook。
- 不得將 webhook URL 填成根路徑或 `?action=...`。
- deploy 後必須先測既有 API 與後台 proxy。
- 若 LINE webhook 驗證失敗，不要在 log 或 response 中輸出設定細節。
- 若 Reply API 失敗，不要記錄 token、replyToken、userId 或完整 webhook body。

## 9. 回退方式

1. 先停用 LINE webhook。
2. Cloudflare Dashboard 回退 Worker 到上一版本，或重新部署上一穩定 commit。
3. 重測：
   - `?action=health`
   - `?action=getDirectory`
   - 後台 POST proxy
4. secrets 不需寫入 repo，也不得在回退過程輸出。
