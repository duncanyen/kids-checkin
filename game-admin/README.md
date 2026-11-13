# Nexus Game Admin — 第一階段交付與部署前檢查

## 四個管理模組擴充（2026-11-09）

已新增玩家管理、遊戲數值、活動管理及系統設定。功能範圍、實際操作、32 項後端／182 項單元測試結果、索引與部署步驟見 [第二階段說明](OPERATIONS_PHASE2.md)。尚未正式部署；雞種與武器唯讀，護衛犬價格／開放狀態可由後端即時調整。

## 目前狀態

已實作獨立管理站、獨立 `nexus-ops` Functions codebase、公告、系統通知、禮包、兌換及稽核；玩家通知面板新增公告與兌換分頁。

**目前程式已啟用玩家公告，禮包兌換程式開關已開啟，App Check 改為選用，登入與後端獎勵驗證仍必須保留。線上接收需更新 Functions 與索引，詳見 [公告啟用說明](../docs/farm-announcements.md)。以下保留第一階段交付限制。**

兩項必要阻擋：

1. `storage.googleapis.com` 的 Emulator JAR 下載遭環境代理 403 拒絕，因此真實 Firebase Emulator 整合／Security Rules 測試尚未執行。允許此網域並套用環境設定後，必須執行下列測試。
2. 儲存庫沒有正式 Firestore 規則；既有遊戲、歡迎禮等直接從玩家瀏覽器寫入農場經濟資料。新 API 雖採可信任後端，無法單靠新增集合規則封鎖既有直接寫入而不影響舊遊戲。必須取得正式規則、收斂既有廣泛 allow，並將舊經濟交易遷移至可信任後端後，才能滿足「玩家不能直接增加金幣、雞蛋、母雞」的完整要求。此相容性遷移尚未完成。不可將測試的全拒絕規則直接覆蓋正式環境。

公告與禮包已拆分開關：`GAME_ANNOUNCEMENTS_ENABLED=true`、`GAME_REDEMPTION_ENABLED=true`。唯讀公告由後端驗證登入、群組、帳號狀態、公告對象與有效期間；不開放玩家直接存取公告集合。原有遊戲及通知照常運作。

## 啟動與本機驗證

使用 Node.js 22、Java 21，沿用既有工作目錄，不另建 worktree。

```sh
cd /workspace/kids-checkin
node scripts/prepare-game-admin.cjs
npm --prefix game-admin/functions ci
python3 -m http.server 8030 --bind 127.0.0.1
```

管理登入頁為 `/game-admin/site/login.html`，首頁為 `/game-admin/site/index.html`。預設使用 Firebase 正式 Auth 配置；只有在 localhost 或 127.0.0.1 並加上 `?emulators=1` 時才連到 demo-nexus-ops 的本機 Auth／Functions。沒有預設管理員帳密、註冊入口或正式登入繞過。

隔離測試：

```sh
node --test game-admin/tests/service.test.cjs
node --test tests/*.test.mjs tests/*.test.cjs
node game-admin/tests/ui.browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-operations-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs
```

瀏覽器測試依賴環境既有 Playwright、Chromium 與 `/tmp/kids-phaser.js`（專案原用 Phaser 3.60.0）。UI 測試使用隔離的 Auth transport；管理 API 使用同一份後端 service 搭配記憶體交易替身，並非正式 Firebase。

### 必要 Emulator 測試（目前未執行）

網域解鎖後：

本環境使用 firebase-tools 14.18.0，CLI 路徑為 `/workspace/.kids-checkin-tools/node_modules/.bin/firebase`。使用：

```sh
cd /workspace/kids-checkin/game-admin
/workspace/.kids-checkin-tools/node_modules/.bin/firebase emulators:exec \
  --config firebase.test.json --project demo-nexus-ops --only firestore,auth \
  'node --test tests/emulator.integration.cjs'
```

測試程式在缺少 Emulator 環境變數時直接失敗，絕不回退正式服務。涵蓋 Admin SDK 原子發獎、真正並發交易爭搶單一名額、失敗回滾與同請求重試、匿名／玩家／管理員客戶端對新增集合的禁止讀寫，以及直接增加農場資產被拒絕。Auth Emulator 測試驗證原生登入取得角色，但具有 admin 角色而未使用 MFA 的 token 可正常存取管理 API。

TOTP 實際註冊及第二因素登入仍須在擁有者設定好的 Firebase 專案／測試專案人工驗證；不可把 UI 替身的 MFA 測試當作 Firebase 真實 MFA 已驗證。

## 第一位管理員與 Firebase 設定

由專案擁有者在可信任環境完成，**本次未執行以下正式操作**：

1. 使用既有 Firebase 專案 `homebasedb`。啟用 Authentication Email/Password；MFA 為選用，只有希望使用驗證器時才需啟用 Identity Platform／TOTP MFA（依專案方案要求），設定密碼政策與電子郵件列舉保護。
2. 在 Firebase Console 建立專用管理員 Auth 帳號並完成電子郵件驗證。不要以玩家 `users.role` 或玩家 App 的 admin 身分作為後台管理權限。
3. 在具有最小必要 IAM 權限及 Application Default Credentials 的可信任機器執行：

   ```sh
   node scripts/set-game-admin-claim.cjs --project homebasedb --uid AUTH_UID --grant-admin
   ```

   工具只修改既有 Auth 使用者 Custom Claims 的 `role: admin`，保留其他 claims，不接受或輸出密碼／憑證。沒有從前端設定管理員權限的功能。
4. 以電子郵件及密碼登入即可進入管理站。後端驗證 token 的 `role`，以及 Auth 使用者當前未停用且仍有 admin claim；不強制要求 MFA。管理員可由頂部「雙重驗證（選用）」自行設定 TOTP，未啟用專案 TOTP 不影響一般登入。已綁定 MFA 的帳號仍須完成 Firebase 原生第二因素挑戰，不會繞過既有 MFA；本次不自動解除任何帳號的綁定。
5. 撤銷管理權限時，在可信任後端移除 role claim 並撤銷 refresh tokens；管理 API 每次重新讀取 Auth claims，角色撤銷立即生效。登出使用 Firebase signOut 清除該管理工作階段。
6. 管理端 App Check 為選用，`site/config.js` 的 `adminAppCheckRequired:false` 預設不初始化 reCAPTCHA，`gameOpsAdmin` 仍強制 Firebase Auth 與伺服器端當前 admin claim。依擁有者選擇，玩家唯讀 `gameOpsAnnouncements` 不要求 App Check，但保留 Firebase Auth 與後端資格檢查；`gameOpsRedeem` 的 App Check 亦改為選用，前端預設不初始化 reCAPTCHA。前端兌換已開放，仍經後端登入、群組、帳號狀態、限額、速率與交易驗證。Functions Emulator 保留原本的隔離測試設定。
7. 建立獨立 Firebase Hosting site，不可部署到玩家既有 site。以 `firebase target:apply hosting nexus-game-admin SITE_ID --project homebasedb` 綁定本地 target；`firebase.json` 的 hosting target 已明確指定 `nexus-game-admin`。站台只發布 `site/`，不含 Admin SDK、測試或後端檔案。`firebase.json` 也包含 CSP 與防嵌入標頭。
8. 取得並審查現有 Firestore 規則，處理上述舊經濟寫入問題，合併新增集合保護與 `rules/firestore.indexes.json` 索引。不要以新索引檔覆蓋既有整份索引；應保留原索引後合併。
9. 只有經使用者另行確認，才部署 `nexus-ops` codebase／管理站 target／合併後的規則與索引。既有 `nexus-live` codebase 不必由此配置重新部署。
10. 確認既有 `photoSession` 可用。玩家端沿用此伺服器驗證橋接取得 Firebase Auth token，新後端以 Auth UID 重新核對 `users/{uid}`、accountId、群組及農場，而不信任提交的 accountId。
11. 公告已單獨啟用，依 [公告部署流程](../docs/farm-announcements.md) 更新前後端及索引。禮包開關已啟用，App Check 選用模式需同步更新前後端並驗證登入玩家實際兌換。

## 集合、API 與資料流

新增集合均以 `ops_` 為前綴，不變更既有 users／groups 的結構。

| 集合 | 用途 |
| --- | --- |
| ops_notifications | 系統通知，欄位沿用公告並以 notificationId 識別；僅後端存取 |
| ops_announcements | 指定欄位的公告、前綴搜尋 tokens 及 audienceKeys |
| ops_gifts | 指定欄位的禮包，僅保存 codeHash；claims 子集合記錄跨群組每帳號次數 |
| ops_code_index | SHA-256 碼雜湊對應禮包 ID，建立時保證唯一 |
| ops_receipts | UID＋requestId 雜湊的冪等收據，綁定碼雜湊及群組 |
| ops_redemptions | 成功／失敗紀錄、玩家、原因及獎勵明細；成功紀錄與發獎同筆交易 |
| ops_audit | 後端寫入管理員 UID、時間、對象、前後內容與結果；不含完整碼或 token |
| ops_admin_requests | 管理寫入冪等紀錄，不保存明文兌換碼 |
| ops_guard_requests | 後端護衛犬操作冪等收據，禁止玩家直接存取 |
| ops_limits | 每使用者／IP 雜湊的限流桶，不保存明文 IP |

API 為 `gameOpsAdmin`、`gameOpsAnnouncements`、`gameOpsRedeem`，區域 asia-southeast1。管理操作包含 dashboard、list、catalog、saveAnnouncement、saveGift；不同資源由 handler 分流，已加入玩家管理、數值、活動與設定，詳細 API、集合及限制見第二階段說明。

所有時間存為 UTC Unix 毫秒，由伺服器判斷是否有效；管理畫面輸入及顯示採 Asia/Taipei。排程公告不用排程工作改寫狀態：scheduled 在開始時間到達後，由讀取 API 判定生效，到期即不回傳。公告內容以純文字 textContent 顯示，沒有富文字或 HTML 執行。指定公告只經後端過濾後回傳，不能直接讀取集合。玩家通知每分鐘刷新，保留舊通知／歡迎禮；新公告提供 popup 與本機已讀標記，沒有推播。

禮包模式為 universal／limited／single／targeted，狀態 draft／active／inactive。安全隨機碼為 96-bit 隨機十六進位字串；自訂碼經 NFKC、移除空白與連字號、轉大寫，限制 8–64 個英數字。明文只在建立回應顯示一次，管理者需立即保存；若首次回應丟失，重試不重建禮包，但無法重取明文，須停用並建立新禮包。已有兌換的禮包不允許修改獎勵、模式及指定對象。

兌換支援金幣、既有各品種蛋、母雞及明確道具白名單；其他雞種獎勵／遊戲模型沒有的寶石選項停用。重用現有 poultry／inventory 純邏輯（prepare script 打包，未複製修改遊戲主程式），雞隻共用容量、獨立 id 與時鐘，蛋進入對應 inventory 欄位，物品計入倉庫。容量不足整筆失敗、不占名額。已完成收據重送不發第二份；玩家端以 sessionStorage 保存待完成 requestId，重試不換號。每 UID 每分鐘 10 次、同 IP 每分鐘 60 次，格式錯誤亦計數，App Check 預設為選用。

獎勵只寫 Firestore，既有 RTDB 由原鏡像非同步更新；沒有跨資料庫交易，也不新增一份可重複領取的 RTDB 獎勵。新收據、個人次數、全服額度、農場獎勵與成功紀錄都在同一 Firestore transaction 內。一般客戶端（含 admin）不得直接讀寫 ops 集合，管理讀取亦透過驗證後 API。

列表支援分頁、狀態／類型篩選；公告／禮包搜尋為標題／名稱前綴，兌換紀錄以完整 accountId／禮包 ID 及結果查詢。儀表板使用伺服器 count aggregation；玩家總數定義為 users 文件總數（含停用），沒有可靠來源時呈現錯誤，不以假數字代替。

## 測試結果與尚未完成

已通過：後端 service 10 項隔離測試、既有 120 項單元測試、管理站桌面／手機瀏覽器流程。玩家公告／兌換與舊通知瀏覽器回歸均通過（隔離資料與 transport）。

未完成／需人工設定：真實 Emulator 整合與規則測試、正式規則取得與舊經濟寫入遷移、Firebase Auth／Identity Platform／MFA／App Check／獨立 Hosting site、合併索引、選用 TOTP 的實際登入驗證。本次已開啟公告程式開關，禮包程式開關亦已開啟，App Check 改為選用；正式後端與索引需在有權限的環境部署驗證。GitHub 原始碼發布與正式部署是分開的狀態，詳見 DEPLOYMENT.md。

請保留操作／兌換紀錄；ops_limits 可由未來可信任排程清理過期桶，但收據、個人次數及稽核不可隨意清理，以免重複發獎。限制／紀錄保留排程目前沒有部署。

登入政策更新（2026-11-05）：管理員 MFA 改為選用。此變更須同時更新管理站前端及 `nexus-ops` 的 `gameOpsAdmin` 後端；只推送前端無法解除舊後端的強制 MFA 檢查。

## 2026-11-09 商店狀態與護衛犬 API

新增 gameOpsGuardDog，由 Firebase Auth 與後端資格驗證處理租用、啟用、解除及到期。邊牧設定為 200／1,000 金幣且停止新租用；日本長尾雞開賣。正式 Security Rules 尚需取得並合併，不能僅靠 callable 阻止直接 Firestore 寫入。發布順序及驗證見 [商店狀態說明](../docs/farm-shop-availability.md)。

## 跨群組營運報表

新增「營運報表」提供區間活動與目前農場查詢；歷史來源、預設關閉的收蛋／偷蛋累計、部署及正式 Rules 前置請見 [REPORTING.md](REPORTING.md)。
