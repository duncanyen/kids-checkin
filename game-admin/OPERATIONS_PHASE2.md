# 咕咕村落營運中心：玩家、數值、活動及系統設定

日期：2026-11-09。本版是可操作的第一版擴充，沿用獨立管理站、Firebase Authentication、Custom Claims `role: admin` 及 `nexus-ops` Cloud Functions。未部署正式環境，也未修改正式玩家資料。

## 功能與操作

| 頁面 | 已完成 | 範圍限制 |
| --- | --- | --- |
| 玩家管理 | accountId 精確搜尋、分頁、最新名稱、村落農場摘要、管理備註、營運功能限制、金幣增減 | 不提供刪除玩家、重設密碼、設定管理員或全面遊戲封禁 |
| 遊戲數值 | 護衛犬日租／週租／是否開放，可儲存並由實際交易使用；雞種價格、產蛋、武器及怪物攻擊次數查看 | 雞種、武器、怪物仍是版本設定，唯讀；不提供未接入玩家端的數值編輯 |
| 活動管理 | 建立、編輯、草稿、排程、發布、結束、取消；指定玩家、活動碼、彈出公告、搜尋及分頁 | 活動與公告連動；不自動發獎、產生怪物或重置排行榜 |
| 系統設定 | 公告／營運系統通知、禮包兌換、新租犬交易三個開關及暫停說明 | 不是 Nexus 全站維護；不影響已付款護衛犬租約與原有村落通知 |

### 玩家管理

1. 進入「玩家管理」，輸入完整 accountId，或留白分頁查看玩家。
2. 「查看／管理」顯示目前名稱、管理備註，以及最多前 20 個群組中的農場摘要。UID 與 accountId 分別處理；不以可變的顯示名稱串接。
3. 修改備註或限制狀態，填寫原因並確認。「限制營運功能」會拒絕該帳號的公告、兌換、護衛犬 API；不變更原本 users、登入權限或遊戲角色。
4. 點選農場的「調整金幣」，輸入正數增加或負數扣除，每次上限一百萬，必填原因並再次確認。扣除後不可為負。

後端重新核對玩家與群組關係。餘額自讀取後已變動時，不以舊數字強行覆寫，必須重新讀取；成功寫入、請求收據與稽核為同一筆交易。重送相同請求只回傳原結果，不再扣款／加款。

玩家清單只傳回白名單欄位，不回傳 users 中的密碼、PIN、私人電子郵件或驗證憑證。管理備註另存於營運集合，不給玩家讀取。

### 遊戲數值

護衛犬設定直接供商店及後端使用。玩家開啟租用視窗前重新查詢，送出時後端再次確認當前價格、商品開放及服務開關。報價變動則拒絕交易，要求重新確認，不按未確認的新價格扣款。

週租須介於日租與日租七倍之間。攔截率、行為與既有租約內容不在本版修改範圍。尚未儲存覆寫時，沿用目前版本預設：邊境牧羊犬 200／1,000 且尚未開放；不因開啟管理頁自動改變商品。

雞種、武器、怪物值由部署時的共用遊戲模型產生，避免另造一套數值。這些欄位是「後端部署版本」快照；仍須保持玩家網站與 Functions 版本同步。

### 活動管理

活動可設定類型、內容、台灣時間起訖、對象、優先順序、彈出及活動碼。時間轉為 UTC Unix 毫秒儲存。排程依伺服器時間判定生效與到期，不需排程程式改寫狀態；列表同時顯示設定狀態及實際狀態。

每個活動對應 `ops_announcements/event-{eventId}`，活動與公告在同一交易更新。結束／取消會將公告下架。連動公告不可從一般公告編輯器另外修改，請回活動管理調整。公告既有登入、對象及有效期檢查維持適用，純文字顯示避免 HTML 執行。

活動碼沿用玩家通知的複製與帶入兌換功能。**請先在禮包管理建立對應的有效禮包**；輸入活動碼本身不會建立獎勵或保證禮包可兌換。

### 系統設定

關閉公告時，新查詢不再提供營運公告／營運系統通知；玩家每次輪詢後更新顯示，不會撤回已讀到的內容。關閉禮包或新租犬時，後端也拒絕新交易，不能只改前端繞過。已成功完成的請求收據仍可安全重送取回結果。

護衛犬啟用、解除、到期仍可處理；不取消既有租約。暫停訊息會顯示於新版玩家通知面板。原有前端程式開關仍是上層限制，本頁不能開啟被部署版本完全停用的能力。

## 安全、狀態及資料

所有管理功能經 `gameOpsAdmin` 驗證 Firebase Auth、token 與 Auth 中目前 admin claim／帳號狀態，沿用選用 MFA／App Check 政策。一般客戶端（包含管理員瀏覽器）不直接寫營運集合。

| 集合／文件 | 用途 |
| --- | --- |
| `ops_player_controls/{users文件UID}` | blocked、notes、reason、revision、更新時間與管理員 |
| `ops_game_config/guard-dogs` | 各犬種日租、週租、rentable 覆寫，整份文件 revision |
| `ops_events/{eventId}` | 活動內容、類型、狀態、對象、有效期、碼、revision、建立／更新者 |
| `ops_settings/global` | 三個服務開關、暫停訊息、revision、更新者 |
| `ops_announcements/event-{eventId}` | 含 sourceEventId 的連動公告 |
| `ops_admin_requests/{hash}` | 沿用管理操作冪等紀錄；UID、requestId 及 payload fingerprint 防止混用 |
| `ops_audit/{id}` | 沿用稽核：操作人、時間、目標、前後差異、原因、成功／失敗 |

不修改 users／groups 的 schema；只有明確確認的金幣調整會更新原有 farm.coins，保留農場與同文件其他資料。畫面不會在進入頁面時寫入預設設定。所有新寫入要求原因、確認、伺服器驗證及錯誤提示，版本不符拒絕覆寫。前端待完成請求識別碼存在該管理員工作階段，重試可取回原結果。

新增 Security Rules 片段禁止客戶端存取上述營運集合。**正式規則仍未取得，不能宣稱正式環境已完成規則整合。** Firestore 多個 allow 是 OR，必須合併並收斂既有遞迴寬鬆規則；不能只添加 deny，也不能直接部署測試的全拒絕規則。既有遊戲仍有前端寫入經濟資料的流程，本版金幣 API 的交易保護不等同已完成全遊戲防作弊遷移。

## 啟動與發布

本機靜態站：

```bash
cd /workspace/kids-checkin
node scripts/prepare-game-admin.cjs
npm --prefix game-admin/functions ci
python3 -m http.server 8030 --bind 127.0.0.1
```

管理登入：`http://127.0.0.1:8030/game-admin/site/login.html`。一般本機頁仍使用配置的 Firebase 專案；僅測試 `?emulators=1` 才使用既有隔離 Emulator 配置。沒有預設管理員帳密。第一位管理員沿用 [README](README.md) 的可信任環境 claim 設定。

**正式更新需要前端與 Functions 都發布，只推 GitHub 不會部署後端。** 舊後端不認得新 action 時會回傳 400。確認部署後，在有權限的 Cloud Shell 執行：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
node scripts/ensure-announcement-index.cjs --project homebasedb --notifications --management
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

索引腳本只新增必要索引，不刪除原索引；等待 ops_events 三個複合索引 READY，再驗收搜尋／篩選。Functions predeploy 會準備共用模型。管理站與玩家前端另由既有 GitHub Pages 流程發布；使用獨立 Firebase Hosting 的環境則沿用其既有 target。正式規則應先合併、經 Emulator 驗證再另外發布，不包含於上述 Functions 指令。

本次沒有執行上述正式操作，尚需部署授權、部署身分與正式規則。

## 驗證結果

| 驗證 | 結果 |
| --- | --- |
| 專案單元測試 | 182／182 通過 |
| 營運後端測試 | 32／32 通過，新增 10 項玩家／設定／活動測試 |
| 新管理頁瀏覽器 | 通過；真實頁面與 CSS，隔離資料、API transport，桌面與手機、搜尋、玩家限制／金幣、數值、活動、設定、稽核與 XSS |
| 原管理頁瀏覽器 | 通過 |
| 玩家護衛犬瀏覽器 | 通過；原租用／巡邏／防守，加上實際後端動態定價與舊報價拒絕 |
| 玩家通知／禮包瀏覽器 | 通過；原通知與兌換流程，加上管理開關使玩家兌換欄位停用 |
| Firebase Emulator／正式 Rules | 尚未完成；Emulator JAR 下載遭環境代理 403 拒絕，正式規則未提供 |
| 正式部署與真人帳號驗收 | 未執行 |

後端測試包含未登入／非管理員拒絕、UID 與 accountId 不同、禁止傳回私密資料、金幣過期餘額與並行衝突、重送、失敗回滾與重試、設定生效、活動指定對象／排程／到期／取消，以及同筆稽核。記憶體交易測試不取代真實 Firebase Emulator 驗證。

```bash
node scripts/prepare-game-admin.cjs
npm --prefix game-admin/functions test
node --test tests/*.test.mjs tests/*.test.cjs
node game-admin/tests/management.browser.cjs
node game-admin/tests/ui.browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-guard-dog-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-operations-browser.cjs
```

真實 Emulator 指令及環境前置見 [README](README.md)。新增四個集合也已納入 Emulator 權限案例，待可下載執行環境補驗。

## 修改檔案

- 後端：`functions/management.cjs`（新增）、`functions/service.cjs`。
- 管理頁：`site/management.js`（新增）、`site/app.js`、`site/index.html`、`site/styles.css`。
- 玩家端：`../js/farm/ShopScene.js`、`guard-dog-core.js`、`guard-dog-store.js`、`guard-dog-ui.js`、`mail-ui.js`。
- 規則與索引：`rules/firestore.ops.fragment.rules`、`rules/firestore.indexes.json`、`../firestore.indexes.json`、`../scripts/ensure-announcement-index.cjs`。
- 測試：`tests/management.test.cjs`、`tests/management.browser.cjs`（新增）、`tests/emulator.integration.cjs`、`../tests/farm-announcement-index.test.cjs`、`../tests/farm-guard-dog-browser.cjs`、`../tests/farm-operations-browser.cjs`。
- 文件：本文件、README、DEPLOYMENT、FILES 與商店狀態說明。

## 後續擴充

先完成正式規則與 Emulator 驗證，再逐步將雞種、武器與怪物規則遷移至共用後端配置。活動自動發獎、怪物及排行榜週期需要獨立排程與冪等狀態機，不能僅靠活動公告的起訖時間代替。更細的管理員職責分權、玩家完整封禁與資料匯出亦尚未實作。
