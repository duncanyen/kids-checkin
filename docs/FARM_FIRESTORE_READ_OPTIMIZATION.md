# 咕咕村落 Firestore 讀取減量

本次保留 Firestore 與現有可信任交易，沒有啟用 RTDB、修改 Rules、重設玩家資料或改變獎勵及遊戲數值。

## 已實作

1. 每日任務視窗的完整狀態輪詢，由每 10 秒改為每 60 秒。關閉視窗停止輪詢，切回可見畫面、重新開啟過期狀態及台灣午夜仍重新確認。
2. 收蛋、協助清潔及怪物勝利的既有交易，附帶同筆交易計算的每日任務進度；前端直接合併顯示，不為同一次成功操作再呼叫完整 status。
3. 較慢回覆／重送不能降低同日進度，也不能把已領取改為未領取。不同帳號、群組、日期、循環或規格的資料不直接混用；跨日或規格不符重新取得正式狀態。
4. 今日簽到／任務快照存在時，不再讀取只供新一天推導使用的前次領獎狀態。建立新一天仍照原規則查詢、決定七日循環及漏做重置。
5. 每日挑戰使用既有的單次交易讀取共用器；同一次嘗試讀過的文件共用 Promise，交易重試重新建立，不跨請求快取權限。
6. 任務已達標時，不重寫完全相同的日進度。遊戲交易、每日事件及防重收據仍保留。
7. 舊 Functions 尚未回傳進度時，前端會使快取失效並在需要顯示時補查 status；新後端的額外回傳欄位也可被舊前端忽略。

所有領獎仍經後端重新驗證，沒有以前端事件或本機預覽授權發獎。金幣、任務及防重紀錄仍原子提交；提交失敗不會把進度通知給前端。

## 隔離量測

以相同私有登入 fixture、相同每日狀態查詢，比較修改前版本與修改後版本的 MemoryDB 文件讀取呼叫：

| 場景 | 修改前 | 修改後 |
| --- | ---: | ---: |
| 今日快照已存在，一次完整 status | 17 次文件讀取 | 14 次文件讀取 |
| 上述查詢中的前次領獎狀態讀取 | 2 次 | 0 次 |
| 任務視窗持續開啟的固定輪詢 | 約 360 次／小時 | 約 60 次／小時 |
| 已有新鮮完整狀態，三次收蛋後的額外 status | 原先依輪詢更新 | 0 次，由成功交易回傳更新 |

固定輪詢請求約減少 83%，單次熱狀態讀取呼叫約減少 18%。兩者是限定情境的隔離量測，不代表整個遊戲的總費用降幅。首次載入、重連、切回視窗、設定變動及必要補查仍有讀取；正式計費還受交易重試、Rules 相依讀取、其他模組與玩家操作影響。

跨裝置或管理設定的被動確認間隔為每分鐘，切回畫面會即時確認；本機成功操作的進度直接更新。金幣發放與有效操作的正式判定不依賴這個顯示更新間隔。

## 驗證

- 329 項 Node 測試通過，包含七日循環、漏做規則、領獎防重、失敗回滾與交易內權限撤銷。
- 真實 Phaser 3.60.0 與隔離後端整合通過：收蛋、商店、偷蛋、清潔、戰鬥及每日進度。
- 新／舊收蛋呼叫流程通過。
- 瀏覽器時鐘測試通過：10 秒不查詢、每分鐘仍確認、關閉後停止、台灣午夜換日。
- 三次真實隔離收蛋交易可直接更新每日任務，沒有額外 status；不同帳號事件不觸發查詢。
- 模擬舊後端缺少進度回傳時，仍能補查並顯示正確進度。
- `git diff --check` 通過。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
READ_OPTIMIZATION_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
READ_OPTIMIZATION_TESTS=1 LEGACY_DAILY_PROGRESS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
LEGACY_HARVEST_BACKEND=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

以上未連接正式 Firebase，不等同正式環境費用或真機驗收。本次未執行正式部署；完整效益需要發布前端並部署 `functions:nexus-ops`，不需要重新部署 Rules 或遷移資料。

## 修改檔案

- `game-admin/functions/daily-challenges.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `js/farm/backend-client.js`
- `js/farm/daily-preview-cache.js`
- `js/farm/daily-ui.js`
- `game-admin/tests/harvest-combined.test.cjs`
- `tests/farm-daily-preview.test.cjs`
- `tests/farm-private-backend-browser.cjs`
- 本文件。
