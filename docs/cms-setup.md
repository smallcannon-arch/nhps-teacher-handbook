# 內湖國小教師手冊 CMS 原型設定步驟

本原型採用：

```text
前台 index.html
  → Cloudflare Worker GET 快取
  → GAS doGet
  → Google Sheets

後台 admin.html
  → Google 登入
  → Cloudflare Worker POST 代理（不快取）
  → GAS doPost
  → Google Sheets
```

目前 `index.html` 已採「動態優先、靜態回退」模式：會先嘗試讀取 Worker/GAS 的已發布內容；若讀取失敗或尚未匯入資料，會回退到檔案內建的靜態內容。

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
   - `07_CurrentContentSeed.gs`
   - `08_DirectoryCurrentSeed.gs`

## 三、填入 Apps Script 設定

在 `01_Config.gs` 中找到：

```js
SPREADSHEET_ID: "PASTE_SPREADSHEET_ID_HERE",
GOOGLE_CLIENT_ID: "PASTE_GOOGLE_CLIENT_ID_HERE",
ALLOWED_EMAIL_DOMAIN: "nhps.hc.edu.tw",
AUTO_ALLOW_DOMAIN_USERS: true,
DEFAULT_DOMAIN_ROLE: "editor",
```

請先填入：

1. `SPREADSHEET_ID`：第一步複製的 Google Sheet ID。
2. `GOOGLE_CLIENT_ID`：完成第四步後再回來填。
3. `ALLOWED_EMAIL_DOMAIN`：預設為 `nhps.hc.edu.tw`，用來限制只有學校網域帳號可登入後台。
4. `AUTO_ALLOW_DOMAIN_USERS`：設為 `true` 時，所有學校網域帳號都可登入。
5. `DEFAULT_DOMAIN_ROLE`：未列在 `Users` 工作表中的校內帳號預設角色；目前設定為 `editor`，代表校內網域帳號登入後可編輯、儲存草稿並直接發布。

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
   - `DirectoryResources`
   - `DirectoryShortcuts`
   - `Users`
   - `Config`
   - `Logs`
6. `setupTeacherHandbookCms` 會同步建立目前前台用到的資源目錄資料；若之後只想補缺漏、不覆蓋已修改內容，可再執行 `importCurrentDirectoryContent`。

## 六、匯入目前前台內容

後台預設資料表建立後，請先把目前 `index.html` 的內容匯入 Sheets，讓後台以「修改目前內容」的方式運作。

1. 回到 Apps Script。
2. 函式下拉選單選 `forceImportCurrentFrontendContent`。
3. 點選 `執行`。
4. 完成後檢查：
   - `Chapters` 有 9 章，狀態為 `已發布`。
   - `ContentBlocks` 有每章六段內容。
   - `draft_body` 與 `published_body` 都已帶入目前前台文字。
5. 之後若只想補缺漏、不覆蓋已修改內容，可執行 `importCurrentFrontendContent`。

注意：這一步只匯入後台資料，不會直接改寫 `index.html`。前台會優先讀 Worker/GAS 的已發布內容；若沒有可用資料，仍會回退到靜態內容。

資源目錄另有兩個匯入函式：

- `importCurrentDirectoryContent`：只補目前缺少的資源卡片與第二層入口。
- `forceImportCurrentDirectoryContent`：用目前 GitHub 版本覆蓋 `DirectoryResources` 與 `DirectoryShortcuts` 中同 ID 的資料。

通常第一次部署只要執行 `setupTeacherHandbookCms` 即可；若前台原型資料又大幅調整，才需要執行 `forceImportCurrentDirectoryContent`。

## 七、加入第一位後台管理者

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

## 八、部署 GAS Web App

1. 在 Apps Script 點選 `部署` → `新增部署作業`。
2. 類型選 `網頁應用程式`。
3. 執行身分選：`我`。
4. 存取權限選：`任何人`。
5. 部署後複製 Web App URL。
6. 先保留 Web App URL，等第九步 Worker 部署完成後，再把後台 endpoint 改成 Worker URL。

注意：GitHub Pages 前端若直接 `fetch` GAS `doPost`，可能被瀏覽器 CORS 擋下。正式後台建議透過 Cloudflare Worker 代理 POST。

## 九、Cloudflare Worker 設定

1. 到 Cloudflare Workers。
2. 建立 Worker。
3. 貼上 `cloudflare/worker.js`。
4. 新增環境變數：
   - 名稱：`GAS_URL`
   - 值：第八步取得的 GAS Web App URL
5. 部署 Worker。
6. 測試：
   - `https://你的-worker-url/?action=health`
   - `https://你的-worker-url/?action=getConfig`
   - `https://你的-worker-url/?action=getHandbook`
7. 回到 `admin.html`，將：

```js
const GAS_ENDPOINT = "PASTE_GAS_WEB_APP_URL_HERE";
```

替換成 Worker URL，例如：

```js
const GAS_ENDPOINT = "https://你的-worker-url.workers.dev";
```

Worker 對 GET 讀取會依 `cache_version` 快取；對 POST 後台寫入一律 `BYPASS`，不快取。

## 十、安全提醒

- 後台可編輯內容，但高風險資訊仍需人工確認。
- 不應放入學生個資、成績、個案內容、通報細節、採購工程細節或未公告內部資料。
- `Users` 工作表是後台權限來源，離職、調職或不再維護者應改為 `enabled = FALSE`。
- `Logs` 不應記錄 token、authorization header 或完整表單敏感內容。
- 後台登入採網域限制：Google token 必須符合 `ALLOWED_EMAIL_DOMAIN`。
- 若 `AUTO_ALLOW_DOMAIN_USERS = true`，所有校內網域帳號都可登入，未列在 `Users` 的帳號會套用 `DEFAULT_DOMAIN_ROLE`。
- 目前 `DEFAULT_DOMAIN_ROLE` 設為 `editor`，校內網域帳號可編輯與直接發布；需要收回或封存的人，再於 `Users` 工作表指定 `reviewer` 或 `admin`。

## 十一、小卡管理原則

目前新版首頁主要使用「資源目錄」：

- `DirectoryResources`：一列就是前台一張資源卡片，可控制標題、處室、第二層分類、連結、是否顯示、是否列入常用入口候選。
- `DirectoryShortcuts`：控制前台第一層處室標籤下方的第二層入口。
- 後台 `admin.html` 會優先維護這兩張表。

以下章節/小卡 CMS 是舊版手冊內容架構，仍保留供既有 `index.html` 使用。

- 核心六段小卡固定保留：`項目說明`、`適用情境`、`辦理方式`、`注意事項`、`承辦單位`、`相關資源`。
- 後台可以新增「補充小卡」，例如 `處室提醒`、`版本紀錄`、`附件說明`。
- 核心六段不可刪除；補充小卡可移除。
- 補充小卡會寫入 `ContentBlocks`，狀態被移除時會標記為 `deleted`，不會直接刪除歷史資料。
- 前台讀到 Worker/GAS 的已發布資料後，會在核心六段後方呈現補充小卡。

## 十二、章節管理原則

- 後台可新增章節。
- 後台可修改章節編號與章節名稱。
- 章節不做硬刪除；封存章節時會將 `Chapters.status` 與該章 `ContentBlocks.review_status` 標記為 `deleted`。
- 核心 9 章建議只改名或調整內容，不建議封存；若要大幅更動章節架構，請先由維護者確認。

## 十三、前台讀取模式

`index.html` 目前使用以下策略：

1. 頁面先用內建靜態資料立即渲染，避免空白。
2. 背景嘗試從 Worker 讀取 `getHandbook`。
3. Worker/GAS 回傳 `ok:true` 且有章節時，前台替換成後台發布資料。
4. Worker 失敗、GAS 失敗、或尚無發布章節時，維持靜態回退內容。
5. 發布章節時由 GAS 更新 `cache_version`，Worker 依版本更新快取。
