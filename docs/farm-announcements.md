# 咕咕村落營運公告、系統通知與禮包

## 管理與玩家介面

- 營運中心「使用者公告」管理公告，「系統通知」獨立管理通知。兩者都能新增、預覽、編輯、儲存草稿、立即／排程發布及下架；對象為所有帳號或最多 100 個指定 accountId，並支援搜尋、類型／狀態篩選與分頁。
- 系統通知存在 `ops_notifications`；欄位沿用公告的 title、content、type、priority、targetType、targetAccountIds、startAt、endAt、showPopup、status 與建立／更新資訊，識別欄位為 notificationId。所有管理寫入及操作稽核均經後端 admin 驗證。
- 村落「系統」分頁合併既有系統通知與營運中心通知；「公告」分頁使用相同的列表、內容詳情、勾選、全選與刪除樣式。既有歡迎禮與訪客通知維持原本邏輯。
- 營運公告／通知的已讀與隱藏標記依 accountId、來源、文件 ID、updatedAt 存在目前瀏覽器；不刪除伺服器原文、不影響其他玩家。換裝置可能重新顯示，編輯後也會成為新版本。既有個人通知仍使用原本的 Firestore 已讀／刪除方式。
- 發布狀態必須為 published 或已到開始時間的 scheduled，且符合對象與有效期間。UTC 儲存，管理端以台灣時間顯示。每 60 秒刷新；showPopup=true 的未讀訊息會等待戰鬥、結算、載入及選單結束後提示，沒有手機推播。
- 禮包兌換程式開關已開啟；玩家於「禮包兌換」輸入營運中心建立的有效兌換碼。兌換期間鎖定送出、關閉與分頁操作，避免重複點擊。

## 驗證與獎勵

`GAME_ANNOUNCEMENTS_ENABLED=true`、`GAME_REDEMPTION_ENABLED=true`。公告與系統通知共用唯讀 `gameOpsAnnouncements`，以 channel 選擇 announcements／notifications；省略時仍回公告，維持舊玩家端相容。後端驗證 Firebase Auth、帳號停用狀態、目前群組資格、指定對象與有效期間；玩家不能以請求中的 accountId 冒用其他人。資料庫規則不因啟用而開放玩家直接存取。

依專案擁有者選擇，`gameOpsRedeem` 的 App Check 改為選用。前端 `REDEMPTION_APP_CHECK_REQUIRED=false`，後端 `createCallables` 的 `redemptionAppCheckRequired=false`，預設不初始化 reCAPTCHA、不換取 App Check Token，也不因缺少 Token 拒絕兌換。Firebase Auth 與後端資格／獎勵驗證仍為必須。

未來若要恢復強制模式，先完成同一 Web App 的 provider、網站金鑰及允許網域設定，再同步啟用前端 `REDEMPTION_APP_CHECK_REQUIRED` 與後端 `redemptionAppCheckRequired` 並發布。只改前端或只部署前端不足以改變伺服器政策。

兌換沿用可信任後端：有效期間、指定對象、全服／個人次數、獎勵白名單、空間與速率限制均在伺服器驗證。農場獎勵、次數、收據及成功紀錄在同一 Firestore 交易完成；請求重試沿用相同 requestId，回應遺失時不重複發獎。玩家端不自行增加金幣或道具。農場畫面沿用既有存檔監聽及鏡像更新。

## 正式環境更新

GitHub Pages 只發布前端，不會更新 Functions。在已取得 homebasedb 部署權限的 Cloud Shell 執行：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
node scripts/ensure-announcement-index.cjs --project homebasedb --notifications
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

索引腳本只新增缺少的公告查詢與系統通知管理／查詢索引，不刪除其他索引。建立為非同步，請再執行同一腳本或至 Firebase Console 確認全部 READY。重新整理營運中心與村落後驗證全體／指定通知與禮包實際兌換。

`game-admin/rules/firestore.ops.fragment.rules` 已補上 ops_notifications 的前端讀寫禁止範例，需合併至正式規則，不能把測試用規則覆蓋正式環境。既有廣泛 allow 若涵蓋 ops 集合，必須由規則管理者收斂，因 Firestore deny 不能覆蓋其他 match 的 allow。

玩家登入橋接使用既有 nexus-live 的 photoSession；若尚未部署，需依專案既有流程部署。本次沒有修改橋接。此環境沒有正式部署身分；本次不直接部署或讀寫正式玩家資料。前後端皆更新後，禮包不再以 App Check 設定完成作為前置條件。

## 測試

```bash
node --test tests/*.test.mjs tests/*.test.cjs
npm --prefix game-admin/functions test
node tests/farm-announcements-client-browser.cjs
# 先啟動靜態伺服器並提供測試所需的 Phaser 本機檔案：
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-operations-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs
node game-admin/tests/ui.browser.cjs
```

涵蓋管理員權限、通知全體／指定對象、草稿／排程／到期／下架、操作稽核、公告樣式、個人／批次刪除、未讀與彈出、既有通知回歸、禮包在缺少 App Check 時仍須登入、群組資格及停用檢查、原子發放、並發限額、防重送與失敗重試。瀏覽器與後端使用隔離資料、SDK 或傳輸替身；不代表正式 Firebase provider 或 Emulator 驗證成功。Emulator 規則測試已加入通知集合保護案例，但執行環境的 Emulator 下載限制仍未解除。
