# 2026-09-06 專案狀態與核對紀錄

## 結論

公開網站並非部署失敗。本機原停在 2026-06-05 的 `800ef5f`，落後遠端主線 55 個提交；遠端已於 6 月 18 至 20 日恢復網站並改良功能。本次先將目前工作分支快轉至 `ce22a8923fbf62e43a55a9b9796b65377bfac484`，保留原有未提交修改。後續經使用者同意，已套用 LINE V1.3；未部署網站或 Worker、未修改 Sheets 或刪除檔案。

## 已驗證

- GitHub Pages 設定為 `main` 分支根目錄，狀態 `built`。
- 最近一次 Pages 工作流程：`27870768739`，2026-06-20，結果 success，部署提交 `ce22a89`。
- 本次逐一讀取公開 index、admin、login、prototype；HTTP 均為 200，統一換行後內容與同步後本機檔案完全一致。
- 首頁、登入及後台已恢復；prototype 仍是維護頁。
- 公開 Worker `health` 與 `getDirectory` 均為 HTTP 200、`ok: true`。這不代表登入、寫入、發布或 LINE 功能已全面驗收。
- 本機 Worker 保留 LINE webhook、簽章驗證、搜尋及記憶體／KV 索引程式；設定檔已有 `HANDBOOK_BOT_KV` 綁定宣告。

## LINE 目標與尚未完成事項

- 使用者於本次確認：「線上會議」改連教師手冊首頁。
- 目標為 `https://smallcannon-arch.github.io/nhps-teacher-handbook/`，目前 JSON 已符合。
- 後續使用者已同意調整按鈕名稱。另備 V1.3 圖片與 JSON，第五格為「手冊首頁」，見 `docs/line-rich-menu-v1-3-plan.md`；原圖保留。
- 已透過既有憑證確認 Bot 身分及舊 default；V1.3 已通過 API 驗證、圖片上傳及 default 讀回驗證，舊選單保留。手機驗收待確認。
- Cloudflare 管理工具授權失效，仍無法確認部署版本、Secrets 名稱及 KV 線上設定；本次 LINE 更新不需要重新部署 Worker。
- 後續已依使用者同意停用固定維護回覆、啟用既有 webhook，讀回 active=true、連線測試 HTTP 200。使用者回報測試 OK，但行事曆連結可能導向 App 下載；替代網頁連結尚未驗證成功，保留原連結並列為待處理事項。
- 使用者已同意保存提交及推送；未重新簽發 token、不刪除舊選單、不在文件記錄憑證。個別使用者專屬選單未枚舉。

## 文件與範圍

- CMS 設定、LINE 部署清單及 KV 規劃已加入歷史／現況區分。
- 學生手冊在本 repo 中仍只有企劃及初始化規格，本次沒有查核其他 repo 是否另有實作。
- 後續公開目錄初查：60 筆皆有處室與更新欄位，18 筆標題含 114 或更早年度；仍需內容與連結核對，不能僅依年度認定過期。
- 本次沒有停用 API 或 LINE：查證後確認網站已恢復，無依據將整體系統重新切回維護。

## 證據入口

- Pages 工作流程：https://github.com/smallcannon-arch/nhps-teacher-handbook/actions/runs/27870768739
- 已部署提交：https://github.com/smallcannon-arch/nhps-teacher-handbook/commit/ce22a8923fbf62e43a55a9b9796b65377bfac484
- 網站：https://smallcannon-arch.github.io/nhps-teacher-handbook/
