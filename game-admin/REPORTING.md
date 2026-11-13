# 跨群組營運報表（第一版）

日期：2026-11-14（台灣）。程式已建置，尚未推送或部署。本文件區分可執行功能與正式上線前置，不將開發測試等同正式驗證。

## 使用方式

登入營運中心後點選側邊「營運報表」，只需輸入開始、結束時間並按「查詢報表」。時間以台灣時區輸入，後端以 UTC 毫秒查詢，包含開始、不包含結束；結束不得晚於現在，單次最多 366 天。進頁不自動掃描資料。

列出目前所有群組 members 中的帳號，依 users.accountId 帶出最新名稱。同一帳號在不同群組各列一筆，沒有農場也列出並標示「未建農場」。已離開群組的舊成員不列入「目前成員」，但其報表事件不會被刪除。

| 欄位 | 實際定義 |
| --- | --- |
| 區間收蛋 | 成功收進倉庫的蛋顆數，所有雞種合計；不是收蛋點擊次數，不包含偷來或禮包贈送的蛋 |
| 區間偷蛋 | 成功偷到的蛋顆數，包含公開及非公開村落；與僅計公開村落的排行榜分開，不改排行榜 |
| 各怪物 | 野狼、老虎、巨飛鷹、飛龍、大猩猩、眼鏡蛇、地鼠、遠古巨人。地鼠一場勝利計一次，不按三個動畫分身計三次 |
| 金幣增加額 | 加總每筆農場餘額的正向淨變化，包含出售、禮包、簽到及管理調整等實際增加 |
| 金幣減少額 | 加總每筆餘額負向淨變化的絕對值 |
| 金幣淨變化 | 上述增加減少的差額；若同一交易同時有收入及支出，只看得到該筆淨值，不宣稱為完整毛收入／消費流水 |
| 目前金幣餘額／雞數 | 查詢當下的存檔，不是選定區間結束時的存檔；雞數包含留在雞舍內的雞 |
| 備註 | 個人檔案缺失／accountId 對應不唯一、無效餘額或累計欄位重設等異常 |

畫面提供無歷史資料、部分紀錄、已觀測紀錄等狀態；無法取得歷史時不以目前累計回推，也不以 0 冒充歷史結果。收蛋／偷蛋沒有累計欄位時另外顯示「尚無累計紀錄」。

## 為何不能立即還原舊區間

目前專案沒有完整收蛋、偷蛋及金幣流水。野狼／老虎只有累計擊殺，其他 Boss 只保留最近 32 場結果，而且結果沒有完整時間戳。依庫存、戰利品或目前金幣推算會受出售、贈送、消耗與遊戲獎勵干擾，因此此次不回填、不清空或重設玩家資料。

新增 Firestore 觸發器觀測「部署之後」實際提交的農場變更，依 after.updateTime 記錄時間，並以 CloudEvent.id＋groupId＋accountId 雜湊去重。收集起點是最早實際觀測事件，並非憑空補一個部署前起點。非同步觸發器可能延遲，報表不是即時結算工具。

## 收蛋／偷蛋累計目前預設關閉

`js/farm/reporting-config.js` 的 `FARM_REPORT_COUNTERS_ENABLED` 預設 **false**。現有 Repository 僅包含 `game-admin/rules/firestore.ops.fragment.rules` 等片段，該檔已明載「This is NOT a complete production ruleset」。無法確認正式規則是否有農場欄位白名單，所以不直接讓既有遊戲交易寫入新欄位。

確認正式 Rules 允許目前成員在原交易中更新下列附加欄位後，再將開關改為 true，重新發布前端：

- `farm.reportHarvestedEggs`：與成功收蛋的同筆交易增加實際顆數；倉庫滿、空點擊或交易失敗不增加。
- `farm.reportStolenEggs`：與成功偷蛋的同筆交易增加 1；被護衛阻止或交易失敗不增加。

這是額外統計欄位，不修改既有金幣、物品、產蛋時間、偷蛋成功率或排行榜欄位。舊客戶端／尚未啟用的版本不會產生這兩項新紀錄；即使其他指標已收集，收蛋／偷蛋仍可能不完整。

金幣及怪物可由觸發器觀測既有欄位，不需此開關。尚未有正式 Rules 時，不以新增寬鬆 allow 規則或變更原遊戲權限來強行開啟。

## 架構與資料

1. `gameOpsAdmin` 新增唯讀 `farmReport` action。每次查詢仍由伺服器重新驗證 Firebase Auth 與 admin Custom Claim，使用者角色或前端選單不能授權。
2. `gameOpsFarmReportCapture` 是 Firestore 觸發器，監看 `groups/{groupId}/users/{accountId}`，沒有對外的報表寫入 callable。
3. `reporting.cjs` 比較已提交存檔：收蛋／偷蛋新增累計、野狼／老虎 combatKills 增量，以及其餘六種 Boss 新增的 win 結果；失敗不計勝利。
4. 報表事件與收集起點在同一 Firestore transaction 寫入。首次農場建立、刪除、純產蛋或相同數值寫入不製造活動；重送同一事件不重複計入，亂序送達可調整最早觀測時間。
5. 報表按 groupId／accountId 加總事件，再讀取目前群組、成員、名稱與農場。只回傳必要資料，沒有回傳密碼、PIN、Token 或完整原始個人檔案。

| 新集合 | 主要欄位／用途 |
| --- | --- |
| `ops_farm_report_events/{hash}` | groupId、accountId、occurredAt、recordedAt、metrics、warnings、source；metrics 含蛋數、三項金幣變化與 monsters 八種數值 |
| `ops_report_meta/farm` | version、firstObservedAt，提供歷史覆蓋範圍 |

報表事件由 Admin SDK 寫入；規則片段已加入兩集合禁止一般客戶端直接讀寫。必須和完整正式規則合併檢查；Firestore 多個 match 的 allow 以 OR 計算，單加 deny 無法蓋過既有廣泛 allow。不得把片段或測試用 default-deny 規則直接部署覆蓋 Nexus 正式規則。

沿用現有遊戲前端存檔不代表其動作已經由可信任後端驗證。此報表是後端觀測已提交存檔，**不是防作弊驗證**，此次沒有宣稱完成每日任務事件的後端化。

## 第一版容量與生命週期

- 單次最多掃描 500 群組、5,000 個人檔案、2,000 筆目前成員及 10,000 筆區間事件。超過回傳明確錯誤，沒有靜默截斷。
- 農場讀取每批最多八筆並行。時間篩選只需 occurredAt 的單欄索引，不新增複合索引；若專案手動停用該單欄索引，需先恢復。
- 查詢按鈕在進行中停用，保留日期及錯誤提示。切換頁面會使舊結果失效，不新增前端 Firebase listener，也不把報表存入 localStorage。
- 觸發器只寫 ops 集合，不回寫農場，因此不自我觸發；沒有相關統計變化的更新不新增事件。事件沒有自動刪除／TTL，未在本次變更資料保留政策。

## 上線步驟（尚未執行）

1. 取得完整正式 Firestore Rules，合併報表集合限制，驗證沒有廣泛 allow 覆蓋；不要部署規則片段。
2. 部署管理 API 與紀錄觸發器。以已連結 homebasedb 身分的 Cloud Shell 為例：

```bash
set -euo pipefail
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

這是更新整個既有 nexus-ops codebase，包含 `gameOpsAdmin` 與新 `gameOpsFarmReportCapture`；保留現有 App Check／MFA 設定，不在本次調整驗證要求。新 Firestore 觸發器的 Eventarc 服務／部署權限須可用。未部署新版本後端就開啟新頁面，會遇到未知操作，不能以改前端直連資料庫解決。

3. 發布營運中心前端（目前可隨 GitHub Pages；若另用 Firebase Hosting，依原有 target 設定發布）。此時可查目前餘額／雞數，金幣／怪物紀錄從觸發器啟用後累積。
4. 確認新增兩個累計欄位的正式規則後，將 `FARM_REPORT_COUNTERS_ENABLED` 改為 true，重跑 `node scripts/prepare-game-admin.cjs`，發布遊戲新版；玩家需重新整理至新版。若沒有確認，保持預設 false，原收蛋／偷蛋流程不新增欄位。
5. 用測試帳號進行收蛋、成功／失敗偷蛋、戰鬥及金幣變更，比對事件與報表；再驗證一般玩家不能直接讀寫報表集合。本階段沒有正式環境驗收。

## 測試

- 營運後端＋雞隻＋排行榜單元套件：69 項通過，包含 7 項新報表測試與附加累計開關測試。
- 新報表瀏覽器：實際營運中心頁面、隔離後端 fixture；查詢入口、無歷史／部分紀錄、最新名稱、跨群組分列、日期錯誤、320／390／768／1440px 的表格內捲動均通過。
- 原管理工作區瀏覽器回歸通過：玩家管理、金幣調整、活動、設定、權限、確認及手機／桌面。
- 遊戲通知／偷蛋／HUD／排行榜完整回歸通過；隔離 fixture 模擬開啟累計，確認成功偷蛋增加、失敗交易不增加。正式版預設仍關閉。
- 新觸發器確實由 Functions 入口匯出；語法與 Git diff 檢查通過。
- 本次沒有執行 Firestore Emulator、正式觸發器投遞或正式 Rules 驗證；沒有讀寫正式玩家資料。瀏覽器不是 iPhone／Android 真機驗收。

```bash
node scripts/prepare-game-admin.cjs
node --test game-admin/tests/*.test.cjs tests/farm-poultry.test.mjs tests/farm-ranking.test.mjs
# 先於根目錄啟動 python3 -m http.server 8030 --bind 127.0.0.1
node game-admin/tests/reporting.browser.cjs
node game-admin/tests/management.browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs
```

## 修改檔案

- `game-admin/functions/reporting.cjs`：區間報表及事件觀測服務。
- `game-admin/functions/index.cjs`：Firestore 觸發器匯出。
- `game-admin/functions/service.cjs`：受保護的 farmReport API。
- `game-admin/site/report.js`：新報表頁；`management.js`、`app.js`、`index.html`、`styles.css` 接入導覽與版面。
- `game-admin/rules/firestore.ops.fragment.rules`：新集合的最小權限片段，未部署。
- `js/farm/reporting-config.js`：預設關閉的附加累計開關與純函式。
- `js/farm/poultry.js`、`VisitScene.js`：成功交易的附加統計接點，預設不寫新欄位。
- `scripts/prepare-game-admin.cjs`：打包共用純函式新增相依。
- `game-admin/tests/reporting.test.cjs`、`reporting.browser.cjs`、`tests/farm-poultry.test.mjs`、`tests/farm-mail-browser.cjs`：測試。
- `game-admin/REPORTING.md`：本文件。

待完成：完整正式 Rules 比對、累計開關啟用、Firebase 部署及實際事件／正式資料核對。沒有回補缺少的歷史，也沒有自動開放新的遊戲資料寫入權限。
