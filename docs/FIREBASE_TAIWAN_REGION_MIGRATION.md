# Functions 台灣區遷移：第二階段

正式 Firestore 已由操作者確認為 `asia-east1`。使用者已在 Cloud Shell 完成十支 callable 雙區部署，並回報台灣實際交易正常，授權切換正式前端。本工作區準備並發布前端區域設定；不重部署 Functions、不變更正式玩家資料。

## 本階段設定

- `functions/index.cjs`：`nexusIdentity`、`photoSession`、`liveSession`、`growthForest` 正式部署區域為 `[asia-southeast1, asia-east1]`。
- `game-admin/functions/callables.cjs`：`gameOpsAdmin`、`gameOpsAnnouncements`、`gameOpsFarmTransaction`、`gameOpsGuardDog`、`gameOpsDailyChallenges`、`gameOpsRedeem` 同樣兩區並存。
- 六個 live mirror 及 `gameOpsFarmReportCapture` 背景觸發器仍只在新加坡，沒有新增第二份觸發器。
- Emulator 維持既有新加坡端點，避免更動現有測試 URL。
- 玩家前端與營運中心正式 endpoint 改用台灣；管理站 Emulator 保留新加坡端點。RTDB URL、Rules、功能開關、交易與領獎程式保持原設定。兩區共用既有 Firestore 收據，不新增地區性餘額或任務資料。

## 驗證

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
VISIT_PRELOAD_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

部署 metadata 驗證十支 callable 雙區、七支觸發器單區及 Emulator 單區。新增測試以同一 MemoryDB 建立兩個獨立交易處理器，重送相同已提交收蛋收據：庫存、有效事件、交易收據均只一筆。這不是正式跨區併發測試；正式 IAM、環境參數、Token 簽署權限、跨區併發與實際延遲必須在台灣端點部署後驗收。既有多裝置與交易競爭測試照常執行。

## 後續部署與切換原則

1. 保存正式清單及既有可回復版本、盤點 IAM 與環境參數。新的函式需能使用原有私有登入與農場後端開關，不能將預設 false 當成正式設定。
2. 僅部署列出的十支 callable，檢視 CLI 計畫應保留新加坡並新增台灣；若出現移除既有函式要求，停止核對。
3. 前端暫不切換，以隔離測試帳號驗收台灣端點的登入、交易、防重、獎勵、任務與排行，兩區不能重複發獎。OPTIONS 或匿名拒絕成功不足以代表交易驗收完成。
4. 正式前端及營運中心改用台灣，記錄正常與首次連線的中位數/P95。舊分頁仍可能連新加坡，因此繼續保留舊 callable。
5. 異常先將前端回復新加坡；資料共用，不能用還原整個資料庫的方式回滾區域設定。
6. 背景觸發器的遷移另行驗證跨部署防重、切換缺口及補核對，再安排退役。不能將 callable 的雙區設定套到所有觸發器。

RTDB 目前仍在新加坡，並未提供 asia-east1 選項；其資料 URL 不得以字串替換方式變更。Authentication、GitHub Pages 與 Storage 位置也不會隨 Functions 自動移動。此階段不代表所有 Nexus 服務都已在台灣。

## 部分部署的 codebase 篩選語法

此專案使用具名 codebase，指定個別函式必須使用 `functions:<codebase>:<function>`，例如 `functions:nexus-live:nexusIdentity` 及 `functions:nexus-ops:gameOpsFarmTransaction`。新版本 Firebase CLI 會將省略 codebase 的函式篩選歸到 default，造成 `No function matches given --only filters`；這表示篩選階段中止，不能據此判定台灣區部署完成。已核對 Firebase CLI 15.36.0 的 selector 與 codebase 篩選程式。不要改用不帶函式名的整個 codebase 部署來繞過問題。

## 正式前端切換驗證

修改玩家私有登入、農場 operations client、成長森林 cloud client、個人記帳與 Photo Dump 舊制橋接、liveSession 區域設定，以及營運中心 config/runtime。管理站入口與 config 的 URL 版本一併更新，減少快取舊區域。保留新加坡 callable 作為舊分頁相容與回復端點，沒有部署第二份背景觸發器。

- 357 項 Node 測試通過。
- 私有登入／工作階段瀏覽器測試通過，真實 private-auth-client 使用台灣 region。
- 真實 Phaser 私有模式完整收蛋、商店、清潔、偷蛋、Boss 攻擊結算、每日任務整合通過。
- 公開村落入口預載與偷蛋延遲／連點／逾時原收據確認通過；農場 SDK 區域驗證為台灣。
- 真實營運中心 runtime 的 App Check、權限前置與 Emulator 回歸通過；正式選台灣，Emulator 選原新加坡端點。
- 額外嘗試舊成長森林 direct-browser 與個人記帳 browser fixture，兩者於啟動等待逾時；fixture 未涵蓋目前的私有登入（例如 expense SDK 的 getAuth 回傳沒有 authStateReady，growth fixture 沒有 callable SDK）。不將這兩項計為通過，也未改動正式功能來配合舊 fixture。成長森林與舊制記帳／照片橋接的區域另以程式設定回歸檢查。

瀏覽器均為 Linux Chromium 與隔離 Firebase SDK／MemoryDB，不是 iPhone 真機或正式網路延遲量測；正式台灣交易驗收由使用者回報。

玩家網站由 GitHub main 發布；獨立營運中心需要另發布 Firebase Hosting。此工作區嘗試讀取 Hosting sites 時，Firebase CLI 回覆 Failed to authenticate，因此 Hosting 需由已登入的 Cloud Shell 執行。不要因此將 Hosting 與 Functions、Rules 混在同一次完整 deploy。Cloud Shell 的三份手動區域修改先 stash 保存，再 pull 新版本；不要 stash pop 覆蓋已納入的兩區設定。
