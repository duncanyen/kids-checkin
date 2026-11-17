# 咕咕村落讀取優化：公告、共用交易、排行榜

本次完成三項開發，正式部署依下方順序執行；開發與隔離測試未讀寫正式資料。未更改遊戲機率、怪物門檻、冷卻、收蛋/偷蛋數量、每日任務金額、排名活動及排序規則。未修改 Rules、登入遷移狀態或 RTDB 開關。

## 第一步：公告輪詢

- 公告與系統通知改為一支合併請求；前景保持原本每分鐘更新節奏。
- `ops_feed_versions/global` 保存不含公告內容的失效版本。相同版本且尚未到排程邊界時，不查詢兩份公告集合。
- 發布、修改、封存公告及活動的既有管理 API 於原交易內更新版本。新增兩個單區 Firestore 觸發器，涵蓋 Console 修改、刪除及舊後端的活動修改。
- 版本是隨機失效 nonce，事件重送／亂序不會恢復成舊快取版本；不是權限或領獎依據。
- 首次回覆計算排程開始、到期時間；到邊界後即使版本未變仍重新查詢。每次請求都重新核對帳號、群組與控制狀態，設定開關也不快取。
- 背景暫停輪詢、回前景補查；開啟或手動重新整理公告強制取得資料。維持分頁、未讀、指定對象及不打斷戰鬥的既有處理。
- 版本文件未初始化時會走完整查詢，不會把未初始化誤認為無公告。

## 第二步：交易重複驗證

- 交易外只檢查 Token 結構與 Firebase Auth 使用者是否停用；帳號憑證版本、群組、玩家控制、全域就緒狀態都在每次原子交易內重新核對。
- 移除原本外層重複讀取，不新增跨請求的權限快取。
- 限流在交易內身分通過後，以獨立交易計次，仍會計入已授權但操作失敗的請求；失效登入不能消耗有效玩家限流額度。Firestore 重試時只計一次限流，但每次重新驗證目前權限。
- 收據重播、扣蛋、入庫、任務累計及報表寫入維持原交易流程。
- `MemoryDB` 測試工具補上獨立巢狀交易與集合群組查詢，以測試上述行為；正式環境仍用 Firebase Admin SDK。

## 第三步：排行榜候選查詢

- 透過既有 `gameOpsAnnouncements` 的 `action: ranking` 查詢，另有獨立排行榜限流，不新增玩家端可寫資料。
- 後端對既有本期欄位 `farm.stolenEggs20261116` 查分數大於零的候選者，每批 25 筆，取得足夠 Top 10 且已越過同分範圍便停止。
- 保留 `rankFarmPlayers` 排序。同分會完整查完該分數，再使用原 accountId／groupId 比較，不以 Firestore 文件順序取代同分規則。
- 排除私有群組、已移除成員／帳號及非農場文件，回傳前重新核對群組公開狀態與成員；過濾後不足十人會繼續查詢。
- 一般不再讀取所有玩家；大量同分或無效候選仍可能需要更多讀取。超過 5,000 候選明確提示，不悄悄回傳錯榜。
- SDK 連線於同一玩家／群組重用，排名資料與權限不跨請求快取。
- 舊後端或索引建立中時保留原查詢相容路徑；授權或網路錯誤直接保留既有錯誤/重試提示，不另外全量重查。

## 隔離量測

基準版本 `32eeacf`，同一 MemoryDB 資料集及真實服務程式，無交易衝突重試；每列為後端文件讀取，不含第一次 Auth 橋接、前端監聽更新、額外報表觸發器、索引計費及正式網路重試。

| 情境 | 修改前 | 修改後 | 下降 |
| --- | ---: | ---: | ---: |
| 每分鐘公告＋通知：各10筆、內容未變 | 34 | 8 | 約76% |
| 一般買藥交易 | 15 | 9 | 40% |
| 一次有效收蛋（已有當日狀態） | 18 | 12 | 約33% |
| 排行榜：1,000位候選分數不同，另有兩個零分農場 | 2,007 | 58 | 約97% |

公告限流寫入從每分鐘2次減為1次。經濟交易寫入數維持原樣。上述結果不是整個專案每日讀取下降承諾，仍須正式監測其他 Nexus 模組、使用量及重連。

可重現量測：

```bash
node scripts/prepare-game-admin.cjs
node scripts/measure-farm-read-cost.cjs
```

## 驗證結果

- Node 測試386項通過，包含排程、目標對象、停用設定、群組撤銷、交易中憑證核對、限流及交易重試防重、排名同分、跨群組與私有狀態改變、索引保留及部署區域設定。
- 真實 Phaser 3.60.0、Chromium 390×844＋隔離 SDK＋真實 createService：合併輪詢、版本未變、背景三分鐘不發輪詢、回前景取得新公告、手動查看、排行榜與關閉恢復操作通過。
- 舊公告後端相容模式通過；不要求新前端與後端同時部署。
- 既有遊戲回歸：收蛋、商店、清潔、偷蛋、怪物擊殺結算、每日任務、防重與輸入生命週期通過；不使用前端直接寫交易資料。
- Firebase Emulator 未完成：下載 cloud-firestore-emulator-v1.19.8.jar 回應403 `Domain forbidden`，不是通過；必須在 Cloud Shell 補測交易後端再部署。
- 證據及截圖：`/workspace/exports/farm-read-optimization/`。上述皆不是正式玩家或 iPhone Safari 實機測試。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js FARM_READ_COST_TESTS=1 node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js FARM_READ_COST_TESTS=1 LEGACY_ANNOUNCEMENT_BACKEND=1 node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

## 上線順序（正式部署尚未執行）

先推送程式、Cloud Shell 拉取最新程式及安裝 Functions 依賴。沿用原本已設定的 Node22、Firebase CLI、Phaser fixture、ADC；不要關閉私有登入或農場後端開關。

1. 在 Cloud Shell 補跑現有完整隔離驗證：`node scripts/test-private-farm.cjs --emulator`。該工具會使用固定 demo 專案及 localhost，不連正式資料；需備妥既有 Chromium、Phaser fixture 及 Emulator。
2. 只新增排行榜欄位索引，保留該欄位原索引，不刪其他索引：

```bash
cd "$HOME/kids-checkin"
node scripts/ensure-farm-ranking-index.cjs --project homebasedb
node scripts/ensure-farm-ranking-index.cjs --project homebasedb --apply
# 建立後重新執行唯讀檢查；等待 READY 再進入下一步。
node scripts/ensure-farm-ranking-index.cjs --project homebasedb
```

3. 更新相關後端與版本觸發器。三支 callable 維持目前兩區設定，兩支新增觸發器單區部署台灣；不搬動其他原有觸發器、不部署 Rules。

```bash
cd "$HOME/kids-checkin/game-admin"
npm --prefix functions ci
firebase deploy --project homebasedb \
  --only "functions:nexus-ops:gameOpsAnnouncements,functions:nexus-ops:gameOpsFarmTransaction,functions:nexus-ops:gameOpsAdmin,functions:nexus-ops:gameOpsAnnouncementVersion,functions:nexus-ops:gameOpsNotificationVersion"
```

4. 確認兩個版本觸發器部署成功後，初始化版本。此腳本只新增缺少的版本文件，不覆蓋既有版本、公告內容或玩家資料：

```bash
cd "$HOME/kids-checkin"
node scripts/initialize-farm-feed-version.cjs --project homebasedb
node scripts/initialize-farm-feed-version.cjs --project homebasedb --apply
```

5. 發布前端後，先小範圍驗證公告發布／排程／指定對象、收蛋、清潔、偷蛋、戰鬥及手動刷新排行榜，再比較至少相同在線時數下的 API 呼叫、Firestore 讀寫與延遲。

若 GitHub Pages 因推送先更新前端，舊後端相容模式會保留功能，但節省效果需等新後端及索引就緒。回退前端後，新後端仍接受原先的公告與遊戲操作協定，不需還原玩家農場資料。

## 修改檔案

- 公告：`js/farm/mail-ui.js`、`operations-client.js`；`game-admin/functions/service.cjs`、`management.cjs`、`index.cjs`、新增 `feed-version.cjs`。
- 交易：`game-admin/functions/farm-transactions.cjs` 與上述 `service.cjs`。
- 排行榜：`js/farm/rankings.js`、新增 `game-admin/functions/farm-ranking.cjs`；兩份索引宣告。
- 上線及量測工具：新增 `scripts/ensure-farm-ranking-index.cjs`、`initialize-farm-feed-version.cjs`、`measure-farm-read-cost.cjs`。
- 相應 Node、SDK fixture 與 Phaser browser 測試；沒有更動遊戲場景美術或其他 Nexus 功能。


### 可選的部署檢查腳本

本次另提供 `scripts/deploy-farm-read-optimization.sh`。在上述 Emulator 測試通過且索引 READY 後執行：

```bash
bash scripts/deploy-farm-read-optimization.sh /本次證據目錄/verification.json
```

腳本核對三項測試旗標、目前程式 hash、規則 hash、正式環境未殘留 Emulator 連線變數及排行榜索引 READY，任何一項不符便不開始部署。然後僅部署上述五支 Functions，確認台灣端五支皆 ACTIVE，再初始化缺少的公告版本。不部署 Rules、不遷移玩家資料。

發佈前補查發現，舊 `farm-save-browser.cjs` 故意測試缺失／離線存檔時，原生啟動錯誤 alert 未設 handler，可能與 Playwright 導覽／關閉頁面衝突；已補上對話框處理並驗證僅允許測試注入的 farm-save 錯誤，沒有改動正式遊戲診斷功能。

### Cloud Shell 索引工具相容性修正

`gcloud firestore indexes fields update --index` 不支援 `query-scope`，舊工具會在參數解析時失敗，尚未修改索引。修正版保留 gcloud 唯讀查詢，使用 Firestore Admin REST `PATCH Field`，僅更新 `indexConfig`，保留既有 collection/collection-group 索引（包含陣列索引）。登入 access token 僅在程序記憶體中傳給官方 API，不寫入檔案或輸出。無法辨識既有設定時停止更新。

若已持有通過的完整驗證報告，**不要先 git pull**；索引工具也在驗證雜湊範圍內。可將新版獨立工具放在 checkout 外執行，維持已驗證的部署程式不變：

```bash
cd "$HOME/kids-checkin"
git fetch origin main
NEXUS_READOPT_DIR="$(cat "$HOME/nexus-release-evidence/CURRENT_READOPT_DIR")"
git show origin/main:scripts/ensure-farm-ranking-index.cjs \
  > "$NEXUS_READOPT_DIR/ensure-farm-ranking-index-fixed.cjs"
node "$NEXUS_READOPT_DIR/ensure-farm-ranking-index-fixed.cjs" \
  --project homebasedb --apply
# 稍後重查；必須看到 READY 才部署。
node "$NEXUS_READOPT_DIR/ensure-farm-ranking-index-fixed.cjs" \
  --project homebasedb
```

此修正只涉及部署工具；不修改既有驗證報告、不放寬部署腳本的版本雜湊檢查、不更新遊戲 Functions 或正式資料。API 請求若逾時，先唯讀檢查索引狀態，避免盲目重送。工具測試涵蓋 REST URL、PATCH body、舊索引保留、唯讀/已存在時不寫入，以及憑證與 API 錯誤的敏感資訊隔離；正式索引建立及 READY 狀態仍需由 Cloud Shell 確認。
