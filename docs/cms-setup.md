# 內湖國小教師手冊 CMS 原型設定步驟

本原型採用：

```text
前台 index.html
  → Cloudflare Worker GET 快取
  → GAS doGet
  → Google Sheets

後台 admin.html
  → Google 登入
  → GAS doPost
  → Google Sheets
```

目前 `index.html` 仍是穩定靜態版，尚未改成動態讀取。這批檔案先建立後台與資料層原型。

## 一、建立 Google Sheet

1. 到 Google Drive。
2. 新增一份 Google 試算表。
3. 建議名稱：`內湖國小教師手冊 CMS`
4. 複製網址中的 Spreadsheet ID。
   - 例如網址是：
     `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`
   - 只複製中間的 `SPREADSHEET_ID`。

## 二、建立 Apps Script 專案

1. 打開剛建立的 Google Sheet。
2. 點選 `擴充功能` → `Apps Script`。
3. 將專案名稱改成：`內湖國小教師手冊 CMS API`
4. 依序建立並貼上本專案 `gas` 資料夾中的檔案：
   - `01_Config.gs`
   - `02_Setup.gs`
   - `03_Content.gs`
   - `04_Code.gs`
   - `05_Auth.gs`
   - `06_Admin.gs`

## 三、填入 Apps Script 設定

在 `01_Config.gs` 中找到：

```js
SPREADSHEET_ID: "PASTE_SPREADSHEET_ID_HERE",
GOOGLE_CLIENT_ID: "PASTE_GOOGLE_CLIENT_ID_HERE",
ALLOWED_EMAIL_DOMAIN: "nhps.hc.edu.tw",
```

請先填入：

1. `SPREADSHEET_ID`：第一步複製的 Google Sheet ID。
2. `GOOGLE_CLIENT_ID`：完成第四步後再回來填。
3. `ALLOWED_EMAIL_DOMAIN`：預設為 `nhps.hc.edu.tw`，用來限制只有學校網域帳號可登入後台。

## 四、建立 Google OAuth Client ID

1. 到 Google Cloud Console。
2. 選擇或建立一個專案。
3. 到 `API 和服務` → `OAuth 同意畫面`。
4. 設定應用程式名稱，例如：`內湖國小教師手冊後台`。
5. 到 `API 和服務` → `憑證`。
6. 點選 `建立憑證` → `OAuth 用戶端 ID`。
7. 應用程式類型選 `網頁應用程式`。
8. 授權的 JavaScript 來源加入後台網址。
   - 本機測試可先用：`http://localhost`
   - 正式部署後加入 GitHub Pages 或後台所在網域。
9. 建立後複製 `Client ID`。
10. 回到：
    - `gas/01_Config.gs`
    - `admin.html`
11. 將 `PASTE_GOOGLE_CLIENT_ID_HERE` 都替換成這個 Client ID。

## 五、初始化資料表

1. 回到 Apps Script。
2. 在上方函式下拉選單選 `setupTeacherHandbookCms`。
3. 點選 `執行`。
4. 第一次會要求授權，請用管理者帳號授權。
5. 執行後 Google Sheet 會建立：
   - `Chapters`
   - `ContentBlocks`
   - `Users`
   - `Config`
   - `Logs`

## 六、加入第一位後台管理者

1. Apps Script 函式下拉選單選 `addAdminUser`。
2. 若介面無法直接傳參數，可暫時新增一個測試函式：

```js
function addFirstAdmin() {
  addAdminUser("你的信箱@example.com", "管理者姓名", "admin", "總務處");
}
```

3. 執行 `addFirstAdmin`。
4. 確認 `Users` 工作表出現該帳號，且 `enabled` 是 `TRUE`。
5. 完成後可刪除 `addFirstAdmin` 測試函式。

## 七、部署 GAS Web App

1. 在 Apps Script 點選 `部署` → `新增部署作業`。
2. 類型選 `網頁應用程式`。
3. 執行身分選：`我`。
4. 存取權限選：`任何人`。
5. 部署後複製 Web App URL。
6. 回到 `admin.html`，將：

```js
const GAS_ENDPOINT = "PASTE_GAS_WEB_APP_URL_HERE";
```

替換成 Web App URL。

## 八、Cloudflare Worker 設定

1. 到 Cloudflare Workers。
2. 建立 Worker。
3. 貼上 `cloudflare/worker.js`。
4. 新增環境變數：
   - 名稱：`GAS_URL`
   - 值：第七步取得的 GAS Web App URL
5. 部署 Worker。
6. 測試：
   - `https://你的-worker-url/?action=health`
   - `https://你的-worker-url/?action=getConfig`
   - `https://你的-worker-url/?action=getHandbook`

## 九、安全提醒

- 後台可編輯內容，但高風險資訊仍需人工確認。
- 不應放入學生個資、成績、個案內容、通報細節、採購工程細節或未公告內部資料。
- `Users` 工作表是後台權限來源，離職、調職或不再維護者應改為 `enabled = FALSE`。
- `Logs` 不應記錄 token、authorization header 或完整表單敏感內容。
- 後台登入採雙重限制：Google token 必須符合 `ALLOWED_EMAIL_DOMAIN`，且帳號必須存在於 `Users` 工作表並設為 `enabled = TRUE`。

## 十、後續接前台

目前 `index.html` 還沒有改成動態讀取。確認 GAS 與後台可用後，再進行下一步：

1. 讓 `index.html` 先嘗試從 Worker 讀取 `getHandbook`。
2. Worker 失敗時回退到目前內建靜態章節。
3. 保留 GitHub Pages 可直接部署。
4. 發布章節時由 GAS 更新 `cache_version`，Worker 依版本更新快取。
