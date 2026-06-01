# LINE Rich Menu V1 Plan

## 1. 目的

LINE Rich Menu V1 作為教師手冊 LINE Bot 的固定入口，讓教師在 LINE 中快速開啟教師手冊首頁，或以既有關鍵字觸發教師手冊搜尋。

本輪只整理圖片資產與設定檔，不建立 Rich Menu、不上傳圖片、不設定 default rich menu。

## 2. 圖片資產

- 來源檔：`assets/line-rich-menu/nhps-rich-menu-v1-source.png`
- 正式輸出檔：`assets/line-rich-menu/nhps-rich-menu-v1.jpg`
- 正式尺寸：`2500 x 1686 px`
- 正式格式：JPG
- 檔案大小：需小於 1MB

圖片內容為 2 列 x 3 欄，共 6 格：

第一列：

1. 教師手冊
2. 報修服務
3. 行事曆

第二列：

4. 週報
5. 線上會議
6. 學生通報

## 3. 按鈕區域與 Action

| 區塊 | bounds | action |
| --- | --- | --- |
| 教師手冊 | `x: 0, y: 0, width: 833, height: 843` | `uri`: `https://smallcannon-arch.github.io/nhps-teacher-handbook/` |
| 報修服務 | `x: 833, y: 0, width: 834, height: 843` | `message`: `報修` |
| 行事曆 | `x: 1667, y: 0, width: 833, height: 843` | `message`: `行事曆` |
| 週報 | `x: 0, y: 843, width: 833, height: 843` | `message`: `週報` |
| 線上會議 | `x: 833, y: 843, width: 834, height: 843` | `message`: `線上會議` |
| 學生通報 | `x: 1667, y: 843, width: 833, height: 843` | `message`: `疾病通報 學生事件通報` |

## 4. 學生通報 Action 說明

圖片上的文字維持「學生通報」，但 action text 使用「疾病通報 學生事件通報」。

原因是 LINE Bot 目前以教師手冊既有卡片與關鍵字查詢為核心；「疾病通報」與「學生事件通報」是現有教師手冊資料中可查找的實際文字。此 action 只導向既有教師手冊搜尋結果，不生成法律判斷，也不提供個案處理建議。

## 5. 後續 LINE API 建立流程

後續維護窗口可依序執行：

1. Validate rich menu object.
2. Create rich menu.
3. Upload rich menu image.
4. Set default rich menu.

建立完成後需用 LINE 手機端驗收 6 個區塊是否對應正確 action。

## 6. 安全提醒

- Channel access token 只能使用環境變數或本機安全互動輸入。
- Channel secret 與 access token 不得寫入 repo。
- 不得把 token、secret、authorization header、replyToken、LINE userId 寫入 log。
- 不得將 token 或 secret 放入 JSON、Markdown、圖片檔或 commit。

## 7. 本輪不做事項

- 不建立 Rich Menu。
- 不上傳圖片。
- 不設定 default rich menu。
- 不呼叫 LINE API。
- 不修改 Worker。
- 不做 Push API。
- 不主動推播。
- 不全校群發。
