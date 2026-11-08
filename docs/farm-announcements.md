# 咕咕村落公告啟用與接收

## 本次修正

原先玩家端營運開關關閉，公告查詢又強制尚未配置成功的 App Check，因此管理員能發布，玩家仍無法接收。

現在以獨立開關啟用公告（`GAME_ANNOUNCEMENTS_ENABLED=true`），禮包兌換維持關閉（`GAME_REDEMPTION_ENABLED=false`）。唯讀公告不初始化 App Check，透過既有 `photoSession` 建立 Firebase Auth 工作階段；後端仍驗證目前帳號、停用狀態、群組成員資格、指定對象與有效期間。玩家不能直接讀寫公告集合。兌換 API 仍強制 App Check，沒有改動獎勵發放權限或正式資料庫規則。

## 正式環境更新

GitHub Pages 只發布前端，不會更新 Functions。在具有 homebasedb 部署權限的 Cloud Shell 執行：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
node scripts/ensure-announcement-index.cjs --project homebasedb
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

索引腳本只檢查／建立 `ops_announcements` 的 `status + audienceKeys + priority + createdAt` 複合索引，不刪除其他索引。建立為非同步，請再執行腳本確認顯示 READY，或至 Firebase Console 的 Firestore 索引頁確認。不可用測試規則覆蓋正式規則。

玩家登入橋接使用既有 `nexus-live` 的 `photoSession`；若它尚未部署，需先依專案既有流程部署該橋接。本次沒有修改橋接。

本次隔離測試沒有讀寫正式資料，不能代替線上 Functions、IAM 與索引確認。

## 玩家接收方式

1. 營運中心公告為 `published`，或開始時間已到的 `scheduled`；草稿、下架及到期公告不回傳。
2. 對象為全體或包含玩家的 accountId。開始／結束時間以 UTC 儲存，管理介面顯示台灣時間。
3. 更新前後端並等索引 READY 後，強制重新整理村落。公告顯示於通知的「營運公告」，未讀公告計入通知徽章。
4. 玩家在村落中每 60 秒查詢一次。`showPopup=true` 的未讀公告會自動提示；戰鬥、結算、載入與既有選單結束後才顯示。未勾彈出仍可於通知閱讀。
5. 已讀標記保存在目前瀏覽器，依 accountId、公告 ID、updatedAt 區分。重新編輯公告可再次提示；更換裝置也可能重新提示，沒有手機推播。

## 驗證

```bash
node --test tests/*.test.mjs tests/*.test.cjs
node --test game-admin/tests/admin-app-check.test.cjs game-admin/tests/callable-http.test.cjs game-admin/tests/service.test.cjs
node tests/farm-announcements-client-browser.cjs
# 先啟動儲存庫靜態伺服器，並提供測試所需的 Phaser 本機檔案：
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-operations-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs
```

測試涵蓋 callable HTTP 權限、指定對象與到期排除、停用與非群組玩家拒絕、公告提示延後、已讀不重複、徽章更新、既有通知回歸、玩家工作階段隔離及兌換維持停用。使用隔離資料／SDK 或傳輸替身，並非正式 Firebase Emulator 或線上驗證。
