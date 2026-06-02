# LINE Rich Menu V1.1 Plan

## 1. 目的

LINE Rich Menu V1.1 記錄目前線上 default Rich Menu 的實際設定，讓 repo 中的 JSON 與文件能對齊線上狀態，避免未來重建 Rich Menu 時把「線上會議」退回舊的 message action。

本輪只補 repo 內的 JSON 與規劃文件，不建立 Rich Menu、不上傳圖片、不設定 default rich menu，也不呼叫 LINE API。

## 2. 與 V1 差異

V1.1 與 V1 的圖片與 6 格座標相同，唯一差異是第 5 格「線上會議」：

- V1：`message` action，text 為 `線上會議`
- V1.1：`uri` action，uri 為 `https://meet.google.com/vvf-djns-hzd`

目前線上 default richMenuId：

`richmenu-4eed337f5d70fa50e48d70b9e5baacd0`

## 3. 檔案

- 圖片檔：`assets/line-rich-menu/nhps-rich-menu-v1.jpg`
- JSON 檔：`assets/line-rich-menu/nhps-rich-menu-v1-1.json`

圖片文字仍維持「線上會議」，不需要重製圖片。

## 4. 按鈕區域與 Action

| 區塊 | bounds | action |
| --- | --- | --- |
| 教師手冊 | `x: 0, y: 0, width: 833, height: 843` | `uri`: `https://smallcannon-arch.github.io/nhps-teacher-handbook/` |
| 報修服務 | `x: 833, y: 0, width: 834, height: 843` | `message`: `報修` |
| 行事曆 | `x: 1667, y: 0, width: 833, height: 843` | `message`: `行事曆` |
| 週報 | `x: 0, y: 843, width: 833, height: 843` | `message`: `週報` |
| 線上會議 | `x: 833, y: 843, width: 834, height: 843` | `uri`: `https://meet.google.com/vvf-djns-hzd` |
| 學生通報 | `x: 1667, y: 843, width: 833, height: 843` | `message`: `疾病通報 學生事件通報` |

## 5. 安全提醒

- Channel access token 只可使用環境變數或本機安全互動輸入。
- Channel access token 與 Channel secret 不得寫入 repo。
- 不得把 token、secret 或 Authorization header 寫入 log。
- 不得把 token、secret 或 Authorization header 貼到聊天。
- JSON 與 Markdown 文件不得包含 token、secret 或任何實際憑證值。

## 6. 本輪不做事項

- 不呼叫 LINE API。
- 不建立 Rich Menu。
- 不上傳圖片。
- 不設定 default rich menu。
- 不刪除任何既有 Rich Menu。
- 不修改 Worker。
- 不修改前台、後台或 GAS。
- 不做 Push API。
- 不主動推播。
- 不全校群發。
