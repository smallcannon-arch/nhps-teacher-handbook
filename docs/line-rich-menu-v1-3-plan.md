# LINE 圖文選單 V1.3：手冊首頁

> 行事曆後續已取得正式網頁網址並更新線上資料，見 `docs/calendar-web-link-2026-09-06.md`；本檔保留選單與維護回覆恢復歷程。

## 目標與素材

使用者於 2026-09-06 同意將第五格改連教師手冊首頁，並調整容易誤解的按鈕名稱。新圖第五格為「手冊首頁」及首頁圖示；其他五格的文字和動作維持既有設計。AI 圖片編輯可能帶來細微筆畫差異，原始 V1 圖片保留。

- 套用設定：`assets/line-rich-menu/nhps-rich-menu-v1-3.json`
- 上傳圖片：`assets/line-rich-menu/nhps-rich-menu-v1-3.jpg`
- 編輯來源留存：`assets/line-rich-menu/nhps-rich-menu-v1-3.png`（超過上傳大小限制，不直接上傳）
- 新圖尺寸：1527 × 1030；六格各 509 × 515，座標已同步更新，不能沿用 V1.2 的 2500 × 1686 設定。
- 第一格與第五格均連到 `https://smallcannon-arch.github.io/nhps-teacher-handbook/`，符合本次指定的第五格目標。
- V1.2 保留為前階段紀錄；本次部署應使用 V1.3 圖片與 JSON 配對。

## 驗證與正式狀態

- 圖片已視覺檢查六格文字；JPEG 已另存以符合 LINE 1 MB 限制。
- JSON 可解析，尺寸、六格邊界、按鈕名稱及第五格網址需於上傳前再驗證。
- 已登入 LINE Official Account Manager，帳號 `nhpsoffical`（`@143jthut`），具管理員權限。
- 管理頁未列出既有圖文選單；此結果不代表 API 沒有設定選單。
- 使用者後續提供專案外的本機憑證檔；未輸出或保存憑證內容至 repo。
- 2026-09-06 已完成 API validate、create、JPEG upload、set-default 及讀回驗證；目前 default 為 V1.3。手機驗收尚待使用者確認。
- 舊 default：`richmenu-970ce30a51f30269fa3fb0329e0ad94a`；新 default：`richmenu-019a731ed7c8c641912498fadff85c37`。舊選單未刪除，必要時可重新設為 default 回復。
- 已逐欄比對其餘五格動作，與原正式 V1.2 一致。部署紀錄見 `docs/line-rich-menu-v1-3-deployment.json`。
- 不因管理頁清單空白就另設一份並宣稱完成：API default 與 per-user 選單的顯示優先級較高。

## 待授權連線完成後的操作

### 手機驗收發現與待確認修正

使用者回報點選後在 LINE 聊天室收到未開放使用提示。現場確認 Manager 的自動回應訊息為開啟，Default 規則為「一律回應／永遠」，內容為「本系統目前暫停開放使用」等維護公告。API 讀取 webhook active=false；官方 webhook test 回傳 success=true、HTTP 200。公開首頁及 health/getDirectory 正常。

預定修正：停用固定自動回覆、啟用現有 webhook，保留舊回覆內容；因涉及全帳號查詢服務恢復，等待使用者確認後才變更。Webhook 測試僅證明端點接受測試事件，尚不代表關鍵字回覆端到端成功，須再做手機測試。提交及推送仍待驗收。

同日後續：使用者明確同意後，已關閉 autoResponse 並啟用 webhook，原 Default 回覆內容保留。LINE API 讀回 active=true，官方 webhook test 為 success=true、HTTP 200。手機查詢結果尚待回報；未修改 Worker 或 Sheets。

手機回報：使用者確認「測試OK」，但行事曆連結似乎導向下載 App。已確認公開目錄 `padlet-002` 使用 Google Calendar `/calendar/u/0?cid=...` 連結。嘗試同一日曆的 embed 網頁網址時，本次瀏覽器回報重複轉址，尚未驗證替代連結，因此保留原資料與權限。此項列為後續相容性問題，不是固定維護回覆或 webhook 未啟用問題。

1. 用既有 Channel access token 讀取 Bot 身分，須符合上述帳號；不得重新簽發 token。
2. 讀取現有 default 與完整選單設定，保留舊選單供回退；不枚舉好友個資。
3. 驗證 V1.3 JSON，建立新選單，上傳 JPEG，再設定 default。
4. 重新讀取 default 及選單內容核對。若第五格以外動作與現行設定不同，先釐清，不覆蓋較新的動作。
5. 手機重新進入聊天室，確認新圖片、第五格網址及其餘五格功能。per-user 選單可能覆蓋 default，需實機確認。
6. 記錄實際結果後再提交、推送。不得將待部署素材描述為已上線；不刪除舊圖或舊選單。

## 官方依據

- 圖片規格與 API：https://developers.line.biz/en/reference/messaging-api/nojs/#upload-rich-menu-image
- 顯示優先序：https://developers.line.biz/en/docs/messaging-api/rich-menus-overview/
