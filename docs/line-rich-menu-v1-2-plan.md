# LINE Rich Menu V1.2 Plan

## 1. 目的

LINE Rich Menu V1.2 記錄目前要更新的官方 Bot 選單設定，讓 repo 中保留可重建的 JSON 與操作依據。此版只調整第 5 格「線上會議」連結，其他入口維持 V1.1 行為。

## 2. 與 V1.1 差異

V1.2 與 V1.1 的圖片、尺寸與 6 格座標相同，唯一差異是第 5 格「線上會議」URI：

- 舊 URI：`https://meet.google.com/vvf-djns-hzd`
- 新 URI：`https://meet.google.com/gjx-nbsg-twb`

## 3. 檔案

- 圖片檔：`assets/line-rich-menu/nhps-rich-menu-v1.jpg`
- JSON 檔：`assets/line-rich-menu/nhps-rich-menu-v1-2.json`

圖片文字仍維持「線上會議」，不需要重製圖片。

## 4. Rich Menu 設定

- size.width：2500
- size.height：1686
- selected：true
- name：內湖國小教師手冊 V1.2
- chatBarText：教師手冊
- areas：6 個

JSON 不包含 `richMenuId`，也不包含 token、secret 或 Authorization header。

## 5. 區域與 Action

| 區域 | bounds | action |
| --- | --- | --- |
| 教師手冊 | `x: 0, y: 0, width: 833, height: 843` | `uri`: `https://smallcannon-arch.github.io/nhps-teacher-handbook/` |
| 報修服務 | `x: 833, y: 0, width: 834, height: 843` | `message`: `報修` |
| 行事曆 | `x: 1667, y: 0, width: 833, height: 843` | `message`: `行事曆` |
| 週報 | `x: 0, y: 843, width: 833, height: 843` | `message`: `週報` |
| 線上會議 | `x: 833, y: 843, width: 834, height: 843` | `uri`: `https://meet.google.com/gjx-nbsg-twb` |
| 學生通報 | `x: 1667, y: 843, width: 833, height: 843` | `message`: `疾病通報 學生事件通報` |

「學生通報」維持導向教師手冊既有查詢文字，不導向法律判斷或個案建議。

## 6. 後續 LINE API 流程

本文件只補 repo 圖紙，不呼叫 LINE API。後續若要套用到官方 Bot，流程應為：

1. 使用現有 `LINE_CHANNEL_ACCESS_TOKEN` 測 `/v2/bot/info`。
2. validate rich menu object。
3. create rich menu。
4. upload image。
5. set default rich menu。
6. 手機端確認「線上會議」開啟新 URI。
7. 確認新 default 後，再清理舊 Rich Menu。

## 7. 安全提醒

- Channel access token 不寫入 repo。
- Channel access token 不寫入 log。
- Channel access token 不貼到聊天。
- 不輸出 Authorization header。
- 不 reissue token。

## 8. 本輪範圍

本輪只補 V1.2 JSON 與文件，不建立 Rich Menu、不上傳圖片、不設 default、不刪除舊 Rich Menu。
