# 偷蛋操作回饋與等待時間優化

## 量測範圍與原因

使用真正的 Phaser 3.60.0、真正的交易服務及隔離資料庫，以瀏覽器滑鼠點擊雞隻。測試中單次點擊有收到，但舊版等待期間沒有處理中提示；正常已確認拜訪的雞舍，每次偷蛋仍依序執行 `visitEncounter` 與 `stealEgg` 兩次 callable。

每次相關 callable 人工加入 400ms 等待，觀察單次點擊：

| 項目 | 修改前 | 修改後 |
| --- | ---: | ---: |
| 請求次數 | 2 | 1 |
| 本次隔離量測的結果時間 | 829ms | 439ms |
| 點擊後處理中提示 | 無 | 立即顯示 |
| 同條件私有登入 fixture 的文件讀取呼叫 | 36 | 18 |

這是相同人工延遲情境的單次比較，不是正式網路平均或 iPhone 真機效能。初次拜訪尚未確認、戰鬥補結算、舊 Functions 相容與 Functions 冷啟動仍可能需要更多時間。

## 實作

- `visitEncounter` 增加選用的 `stealWhenClear`。伺服器確認可偷蛋後，在同一原子交易執行原本的偷蛋邏輯，避免兩次重複身分與目標驗證。
- 直接 `stealEgg` 與合併模式共用交易實作。權限、私人村落、原戰鬥目標、守衛犬、倉庫容量、品種、冷卻、道德值及排行榜期間規則保留。
- 使用獨立的怪物／護衛犬／雞蛋抽樣亂數，避免條件機率因合併而改變；Firestore 重試仍使用同批亂數。
- 怪物未結束時只回傳原挑戰；補結算只做原戰鬥結算，不順便發雞蛋。
- 首次拜訪的怪物與里程碑檢查照原順序執行；初次確認未完成時共用同一工作，不因連點重複偷蛋。
- 點擊立即顯示「確認雞舍中…」，需要第二階段時顯示「正在偷蛋…」。成功、攔截、失敗與離開場景均不留下處理鎖。
- 回傳伺服器決定的絕對冷卻期限，快照未回來時也不重送剛完成的操作；重播收據不會延長本機冷卻期限。
- 拜訪雞隻保持至少 44px 的點擊範圍並隨畫面縮放調整，處理中不堆疊點擊動畫。
- 蛋數、金幣、冷卻更新不重建全部雞隻；雞種、數量、放風成員或疾病外觀改變仍會更新。
- 舊 Functions 忽略新旗標時，前端保留原本兩段流程，不會因發布順序而無法偷蛋。

沒有提前增加雞蛋或自行推算成功結果，所有庫存、排行榜及營運統計仍以後端成功交易為準。

## 驗證

334 項 Node 測試通過，新增合併偷蛋、防重重播、冷卻、怪物阻擋、護衛犬獨立亂數、倉庫／私人村落限制、失敗回滾及讀取量比較。

Phaser 隔離整合通過：

- 實際點擊雞隻一次即可完成偷蛋；等待時重複操作不新增交易。
- 快照尚未更新時再點，不重送已在冷卻的操作。
- 蛋數更新後保留原雞隻精靈與互動事件。
- 新後端一次請求，舊版協定相容時兩次請求仍正常完成。
- 慢網路拜訪確認、其他分頁改變目標、原戰鬥逾時、重試與野狼阻擋。
- 原有收蛋、商店、拜訪清潔、真實怪物攻擊／結算與每日任務整合。
- `git diff --check` 通過。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
STEAL_SPEED_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
STEAL_SPEED_TESTS=1 LEGACY_STEAL_BACKEND=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
VISIT_PERMISSION_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

未操作正式玩家資料，也未部署 Firebase。完整效益需要發布前端並部署 `functions:nexus-ops`，不需要修改 Rules 或遷移玩家資料。

## 修改檔案

- `js/farm/VisitScene.js`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/tests/farm-backend-integration.test.cjs`
- `game-admin/tests/harvest-combined.test.cjs`
- `tests/farm-private-backend-browser.cjs`
- 本文件。

## 正式仍約 3 秒時的第二階段處理

第一階段的 400ms 人工延遲比較不能證明正式服務可在相同時間完成。第二階段針對後端串行等待進行改善：

- 身分文件與全域開關平行讀取，但仍保留開關、憑證、群組、帳號停用等全部檢查。
- Firebase Auth 查詢與 Firestore 玩家確認平行執行；格式／作用域錯誤仍在任何 RPC 前拒絕。
- 交易內的農場、戰鬥會話平行讀取；收據仍先查，重送不增加不必要的農場讀取。
- 目標農場與目標名稱平行取得。
- 不跨請求快取權限；再次驗證期間若撤銷憑證或封鎖帳號，交易仍拒絕。

隔離環境對每次文件／Auth 查詢加入 40ms 等待，暖執行個體的一筆合併偷蛋由 565ms 降至 410ms；文件讀取仍是 18 次。這只驗證等待波數確實減少，不是正式平均或保證時間。

新增的成功請求量測不包含帳號、群組、Token 或交易 payload，也不新增 Firestore 紀錄：

- Cloud Logging：`farm-theft-timing`。
- 瀏覽器 Console：`farm-theft-latency`，含 `roundTripMs`、`serverTimingAvailable`。
- 伺服器回傳：`identityMs`、`rateLimitMs`、`transactionMs`、`handlerMs`。

`roundTripMs` 明顯大於 `handlerMs` 時，差額可能包含 SDK 連線、網路、初始化或處理器開始之前的冷啟動；不能只靠差額斷定冷啟動。`transactionMs` 高時應檢查 Firestore 區域、交易衝突與服務延遲；`identityMs` 高時檢查 Auth／登入驗證路徑。

目前 Functions 程式使用 `asia-southeast1`，正式 Firestore 位置尚未在本環境核對。可於 Cloud Shell 唯讀確認：

```bash
gcloud firestore databases describe \
  --database='(default)' \
  --project homebasedb \
  --format='value(locationId)'
```

沒有啟用付費常駐執行個體，也沒有遷移區域。若量測顯示冷啟動是主要延遲，可評估只讓農場交易函式保留一個執行個體；這會增加待機費用。若考慮區域搬移，需另處理前端 endpoint 與既有函式切換，不能直接改區域後移除舊服務。

第二階段另修改 `game-admin/functions/service.cjs`、`js/farm/backend-client.js` 及對應驗證；334 項 Node 測試與真實 Phaser 隔離偷蛋／完整遊戲整合通過。新增計時不是正式環境實測結果，本次仍未執行正式部署。
