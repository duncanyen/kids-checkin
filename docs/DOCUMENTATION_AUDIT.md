# Nexus 文件化盤點與驗收紀錄

日期：2026-11-09。基準 commit：`be1d067`。本次僅程式註解與 Markdown 文件，不開發功能、不重構、不調整 UI／CSS／資料模型／Rules／索引，也不部署正式環境。

## 第一階段：盤點結果與註解清單

已掃描主要 HTML 入口、js 模組、兩個 Functions codebase、現有 docs、Firebase 設定與規則／片段及測試。主線為原生多頁網站，沒有單一 SPA 初始化框架。先前專題文件保留其日期；新的五份總覽補齊跨模組關係與目前開關。

註解優先順序：

1. 固定帳號、群組選擇、舊制登入及 Firebase Auth 橋接。
2. 首頁、聊天、記帳、待辦與相簿資料查詢、分頁、重入與清理。
3. 成長森林傳輸／交易適配，農場建檔可信度、養殖／放風、素材與通知。
4. 營運服務權限、兌換／管理操作冪等及管理頁生命週期。
5. 舊內嵌設定、打卡與本機寵物的責任及限制。

本次於 50 個核心來源檔案新增 79 段 JSDoc／模組說明，覆蓋重要函式／模組，不為每個簡單 DOM 函式、怪物動畫或歷史測試加註，也未宣稱所有歷史英文註解皆已翻譯。新增說明統一繁體中文、標準 JSDoc，並將範圍內 91 段既有英文說明轉為繁體中文；未更動函式名稱、參數、查詢或控制流程。

### 新增註解的檔案

- `checkin.html`
- `functions/index.cjs`
- `functions/mirror.cjs`
- `game-admin/functions/callables.cjs`
- `game-admin/functions/management.cjs`
- `game-admin/functions/service.cjs`
- `game-admin/site/management.js`
- `game-admin/site/runtime.js`
- `js/account-identity.js`
- `js/admin.js`
- `js/app-navigation.js`
- `js/auth.js`
- `js/calendar.js`
- `js/chart-loader.js`
- `js/chat-core.js`
- `js/chat-history.js`
- `js/chat-membership.js`
- `js/dashboard.js`
- `js/expense.js`
- `js/farm/assets.js`
- `js/farm/entry.js`
- `js/farm/guard-dog-core.js`
- `js/farm/mail-store.js`
- `js/farm/mail-ui.js`
- `js/farm/operations-client.js`
- `js/farm/poultry-housing.js`
- `js/farm/poultry.js`
- `js/farm/save-store.js`
- `js/farm/scene-cleanup.js`
- `js/food-decision.js`
- `js/food-store.js`
- `js/gallery-profiles.js`
- `js/gallery-storage.js`
- `js/gallery-viewer.js`
- `js/gallery.js`
- `js/game-context.js`
- `js/game-members.js`
- `js/games.js`
- `js/group.js`
- `js/growth-forest/client.js`
- `js/growth-forest/direct-client.js`
- `js/growth-forest/firestore-store.js`
- `js/growth-forest/main.js`
- `js/growth-forest/scene.js`
- `js/main.js`
- `js/personal-layout.js`
- `js/scoped-profiles.js`
- `js/todo.js`
- `pet.html`
- `settings.html`

### 明確排除

- 第三方 SDK、node_modules、素材、壓縮檔及建置產物不修改。
- `js/growth-forest/direct-domain.js`／`direct-service.js` 由建置腳本產生；共用 `functions/growth-domain.cjs`／`growth-service.cjs` 有逐字同步測試。為避免只加來源註解卻迫使更新產物，本次不改這四份檔案，其規則與交易改由技術文件說明。
- 不修改任何 Security Rules、索引或 Firebase 專案設定。不存在正式資料讀寫、Functions deploy 或批次遷移。

## 第二、三階段：文件交付

| 文件 | 內容 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 技術堆疊、元件圖、多頁導覽、身分與群組、目前傳輸開關、部署界線 |
| [MODULES.md](MODULES.md) | 實際入口、主要函式、責任、資料庫及跨模組相依 |
| [DATABASE.md](DATABASE.md) | users／groups、生活功能、森林、farm、ops_*、時間型別、常用查詢及規則證據 |
| [DEVELOPMENT_GUIDE.md](DEVELOPMENT_GUIDE.md) | 註解標準、命名、Firestore 交易、初始化／清理、測試及驗收方式 |
| [PERFORMANCE.md](PERFORMANCE.md) | 現有訂閱、並行、lazy、相簿增量、SDK／素材、快取與冪等，不虛構正式量測 |
| 本文件 | 盤點、完整修改檔案、模組完成狀態、問題及驗證 |
| [根目錄 README](../README.md) | 新增上述文件入口，原使用說明保留 |

### 各模組文件化狀態

| 模組 | 本次狀態 |
| --- | --- |
| 首頁／帳號／群組 | 已記錄核心函式、穩定識別、初始化與集中清理 |
| 聊天 | 已記錄固定成員相容、訊息歷史游標、訂閱與可信度限制 |
| 行事曆 | 已記錄實際查詢／儲存；姓名與清理限制明列 |
| 記帳本 | 已記錄清單／月曆差異、聚合、延遲圖表、optional note |
| 待辦 | 已記錄聚合文件、交易、成員頭像、循環實例與計時清理 |
| Photo Dump | 已記錄作者識別、範圍訂閱、圖片增量、Storage 補償 |
| 吃什麼 | 已記錄固定投票文件、舊票匯入與晚到訂閱清理 |
| 成長森林 | 已記錄暫行／cloud 邊界、資源模型、資料適配與 Phaser 生命週期 |
| 咕咕村落 | 已記錄場景、建檔、養殖／放風、素材、戰鬥模組、護衛及營運關聯 |
| 設定／導覽／主題 | 已記錄帳號快取、雲端 hydrate、舊設定歸屬與多頁導覽 |
| 舊遊戲／打卡／通知／寵物 | 已記錄入口及實際資料範圍，未假定皆有群組隔離 |
| 玩家站管理 | 已區分 users 角色與營運 Custom Claims |
| 獨立營運中心 | 已記錄兩階段現有能力、操作稽核、冪等與數值／活動限制 |
| RTDB／照片後端 | 已記錄非同步鏡像、目前關閉開關、登入橋接與規則來源 |

「已記錄」指主要流程與模型有可查依據，不代表已修復既有問題或每個內部函式均有 JSDoc。

## 既有問題與待確認事項

下列為本次閱讀發現，沒有修正：

| 項目／依據 | 影響／待辦 |
| --- | --- |
| 舊制登入及憑證：auth.js、functions/index.cjs、gallery-storage.js | 部分驗證資料仍由瀏覽器處理／橋接；應獨立規劃 Firebase Auth 遷移與敏感欄位保護，不在文件化提交變更 |
| 正式 Firestore Rules 未納入 root 配置 | 無法確認正式最小權限；fragment／Emulator rules 不能代表現行正式規則，亦不能直接部署替代 |
| 舊經濟寫入：ShopScene、MyFarmScene、mail-store 等 | 交易原子性不等同後端授權；新營運 API 安全不能替代整個遊戲防作弊遷移 |
| calendar.listenToEvents／dashboard.checkCalendarAlerts | 私密／本人可見仍依 operator 姓名；改名後相容與伺服器保護需另案 |
| calendar.listenToEvents | 未保存 unsubscribe，沒有明確 pagehide 清理；bfcache 長期行為待補測與修復 |
| expense.js 的 currentGroupId／canViewIncome | 缺群組時回退固定群組，收入顯示權限含姓名判斷；不可當後端授權 |
| checkin.html、notifications.html | 打卡房間讀全集合、打卡／舊通知部分資料未帶 groupId；共用設定與群組隔離待遷移 |
| games.js 的 userDocId | 舊紀錄與權限以群組＋姓名組鍵，更名後完整資料整併待確認 |
| account-identity.findAccountsById | 為舊大小寫相容讀取 users 全集合；帳號數增加會帶來讀取成本，應另設遷移方案 |
| gallery.renderPhotoCard | caption 等部分既有欄位仍直接插入 HTML 字串；應另案盤點純文字轉義／XSS，不能宣稱全站已安全處理 |
| Storage 與 Firestore 不同服務 | 檔案補償清理可能失敗，孤立檔案回收／正式保留政策待建立 |
| 森林 direct 模式 | 前端角色檢查不是可信任授權；2000 筆候選上限、群組修訂鎖競爭與正式 Rules 相容待確認 |
| 聚合文件 | todos、hensState、內嵌 comments 等有文件大小與寫入競爭限制，規模門檻待量測 |
| 舊專題文件版本 | 2026-11-04 架構與早期效能報告含當時開關／載入策略；應按日期閱讀，以目前程式及新總覽交叉核對 |

首次森林測試遇到的 nav SVG 點擊攔截，在未改程式的重跑及修改前基準均未重現。因此只列為自動化點擊／版面穩定性待追蹤，不能據此判定是本次新增缺陷或宣稱已修復。

### 尚待補充文件

- 正式 Firestore Rules、部署版本、索引 READY、IAM／Auth／App Check Console 設定的可追溯紀錄。
- 舊 group_requests 建立端、歷史混合欄位、各舊遊戲資料鍵與現存資料品質的實庫核對；本次沒有查正式玩家資料。
- TTL／備份／還原、資料與稽核保留、孤立 Storage 清理及成本警示政策。
- 真機 iOS／Android、慢網、十五分鐘以上、GPU／heap／電池與正式 Firebase 成本量測。
- 全部怪物內部動畫／美術產生器及歷史腳本的逐函式說明；目前提供模組入口與既有專題文件，不大量重複註解。

## 第四階段：驗證

| 檢查 | 實際結果與範圍 |
| --- | --- |
| Git Diff | 僅 50 個來源檔案的註解、六份新 Markdown 及 README 入口；CSS、Rules、索引、套件、素材及產生檔無變更 |
| 語法與行為不變性 | 使用 Node 內附 Acorn，比對 HEAD 與工作目錄的 50 檔、56 個 script 本體：去除位置資訊後 AST 完全相同；可執行 token 的型別及原始字面值亦完全相同 |
| HTML | 三個 HTML 的 script 以外內容逐位元組相同；沒有 DOM、樣式、文字或互動設定改動 |
| 單元測試 | `node --test tests/*.test.mjs tests/*.test.cjs`：182／182 通過 |
| 營運後端 | `npm --prefix game-admin/functions test`：32／32 通過 |
| 導覽瀏覽器 | navigation-browser 通過；權限／帳號隔離、七個功能外殼、原生導覽與返回標籤，使用隔離 SDK |
| 管理頁瀏覽器 | management.browser 通過；玩家／調幣、數值、活動、設定、稽核、桌面與手機，API transport 為替身 |
| 相簿瀏覽器 | gallery-performance 的 10／100／500／1000 筆案例通過；增量更新保留圖片／留言節點及草稿，沒有把替身讀取計數當正式計費 |
| 森林瀏覽器 | 首次在 #buyPlot 點擊遭底部 nav SVG 攔截而逾時；修改前 be1d067 基準及修改後重跑均通過完整流程，含真實 Phaser、審核／資源、種植／澆水、擴地、兌換及手機／桌面；不隱藏首次失敗 |
| Markdown／敏感值 | 六份文件的本機檔案連結存在；新文件未加入 API key 字面值、JWT 格式 token 或私鑰材料；人工檢查不記實際玩家／憑證資料 |
| 空白檢查 | `git diff --check` 通過 |

有會執行 prepare/build 的既有測試放到 `/tmp/nexus-doc-validation` 的隔離副本，測試產生檔不回寫工作目錄；基準用 `/tmp/nexus-doc-baseline`，來源為 be1d067。前端瀏覽器在本機 HTTP 與隔離資料／傳輸運作，沒有正式資料讀寫。

本次沒有執行正式部署、真機或正式 Rules 驗證。Emulator 沒有重跑：未修改 Rules 或執行邏輯，儲存庫又缺正式 Firestore 規則；既有環境紀錄的 JAR 下載 403 仍是待處理事項，不能把記憶體測試列為 Emulator 已通過。

測試的輸出保留於執行環境 `/tmp/nexus-doc-unit.log`、`nexus-doc-backend.log`、`nexus-doc-navigation-ui.log`、`nexus-doc-management-ui.log`、`nexus-doc-gallery.json` 及 `nexus-doc-growth-*.log`，這些暫存檔不加入 Git，也不是長期正式稽核。

## 第五階段：提交

使用獨立 commit：`docs: standardize Nexus code comments and technical documentation`。本次只建立本機 Git commit，不自動推送或部署；commit ID 以交付回覆及 `git log -1 --oneline` 為準。
