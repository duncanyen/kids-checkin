# 每日簽到／每日任務：群組分開記錄

## 根因與變更

原本後端的 `ops_daily_states`、`ops_daily_days`、`ops_daily_grants` 文件識別只包含 UID、挑戰類型與日期，因此同一登入帳號在不同群組共用簽到循環、任務進度及每日發獎收據。原有測試也曾明確要求跨群組共用同一獎勵。

本版以版本 2 的 `[uid, accountId, groupId, type, date]` JSON 雜湊建立文件識別。同帳號的 A、B 群組各自擁有：

- 每日簽到、七日循環、漏領重置及第七天後的新一輪。
- 收蛋、協助清潔、擊退怪物的有效次數。
- 每日任務循環、完成條件與領獎收據。
- 自己群組農場的金幣入帳；同群組多裝置／重試仍只能發獎一次。

沿用原有登入、群組權限、獎勵金額、三項遊戲事件有效判定及每筆操作加一次的規則，不建立新登入帳號。

前端分頁偏好、待確認領獎請求與唯讀預覽都使用群組＋帳號鍵；預覽版本升為 v2。完整狀態、增量進度及領獎結果均帶群組／帳號／版本標記，不能把 A 的回應套入 B。舊後端回應缺少標記時，顯示更新提示並保持領獎鎖定。

## 舊紀錄銜接

不刪除舊文件，不調整已存在的金幣餘額，也不把共用總進度複製到每個群組。

首次讀取各群組時，後端在同筆交易內：

1. 按舊發獎收據的 `groupId`、`accountId`、`uid` 確認實際收款農場。若今日已發給 A，只讓 A 繼承已領取狀態，沿用原收據 ID 重播，不再發錢；B 可獨立完成自己的挑戰。
2. 按可確認的前一日發獎紀錄延續該群組循環。`continue` 策略另從既有 UID／時間索引尋找最近的該群組舊發獎紀錄，最多檢查 1,000 筆；未找到可信證據時從第一天開始。
3. 未領取的當日任務，按有群組標記、結果為 `counted` 的事件收據恢復各任務次數。缺少群組／有效收據的舊共用進度無法可靠歸屬，不猜測分配。已被舊制忽略的操作也不追溯發獎。
4. 建立群組獨立狀態；後續正常請求不再重跑舊制銜接。

一般 `reset` 策略不掃描歷史紀錄；進度恢復只讀取該 UID／群組／日期／任務的必要收據，最多為任務目標筆數。既有當日快照的暖讀取量不增加。使用原有集合與索引（等值索引合併、既有 UID／createdAt 索引），不需部署新 Rules 或建立新資料集合。

## 管理 API

`dailyPlayer` 必須提供 `{uid, accountId, groupId, dateKey?}`，才能準確檢查指定農場；`dailyGrants` 保留原本 UID 發獎稽核列表，每筆包含實際群組。原先只有 UID 的每日狀態查詢不再代表所有群組。

## 測試

- 群組專項測試：A／B 各自簽到、所有三種事件、任務獎勵與餘額；同群組防重；獨立七日循環與漏領；舊簽到及任務獎勵不重發；舊混合進度依收據分離；舊 `continue` 循環銜接。
- 預覽快取測試：不同群組的快取／進度不可混用，日期與循環相同也不能套用其他群組資料。
- 真實 Phaser、現有後端服務及隔離 SDK：從原有每日任務入口簽到 A、收蛋 A，再切換 B 簽到；B 任務為 0，回 A 仍保留已領取及收蛋 1 次。截圖為 390×844 手機尺寸，非正式玩家資料。
- 已擴充真實 Auth／Functions／Firestore Emulator 案例，驗證同帳號兩個群組 Token、獨立領獎及並行防重。實際 Emulator 是否執行成功以附帶報告為準。

## 發布

本次不修改正式資料、不推送、不部署。發布時更新前端，並將以下三支 Functions 一起部署，避免狀態 API 與遊戲事件 producer 使用不同版本：

- `gameOpsDailyChallenges`：群組獨立狀態、舊資料銜接及發獎。
- `gameOpsFarmTransaction`：遊戲事件在同筆交易寫入群組獨立任務進度。
- `gameOpsAdmin`：指定群組的每日狀態查詢。

沿用 `game-admin/firebase.json` 的 `nexus-ops` 部署設定。正式部署前先在 Cloud Shell 完成最新版本的 Emulator 驗證；不需另行搬移玩家帳號或執行清除舊紀錄腳本。發布後重新開啟遊戲，確認兩個群組各自的狀態。

## 修改檔案

- `docs/FARM_DAILY_GROUP_SCOPE.md`
- `game-admin/functions/daily-challenges.cjs`
- `game-admin/functions/daily-scope.cjs`
- `game-admin/tests/daily-challenges.test.cjs`
- `game-admin/tests/daily-group-scope.test.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `js/farm/daily-preview-cache.js`
- `js/farm/daily-ui.js`
- `scripts/test-private-farm.cjs`
- `tests/farm-daily-browser.cjs`
- `tests/farm-daily-preview.test.cjs`
- `tests/farm-private-backend-browser.cjs`

## 本次執行結果

完整單元測試 436/436 通過；完整隔離瀏覽器回歸及每日介面 320／390／430／768 尺寸、網路重試、七日循環、關閉／快取測試通過。驗證報告 unitPassed=true、browserPassed=true、emulatorPassed=false。Firestore Emulator JAR 下載遭 `403: Domain forbidden` 阻擋，尚未執行 Emulator 合約案例，需在 Cloud Shell 補跑；本次沒有啟用正式環境。
