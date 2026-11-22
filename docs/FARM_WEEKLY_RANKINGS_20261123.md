# 咕咕村落本週排行榜：2026/11/23

## 活動與資料

兩榜活動期間均為 **2026/11/23 06:00:00（含）～2026/11/30 00:00:00（不含），台灣時間**。

| 分頁 | 交易累計欄位 | 計數 |
|---|---|---|
| 偷蛋王 | `farm.stolenEggs20261123` | 原本可信任偷蛋成功交易，每顆 +1 |
| 打怪王 | `farm.monsterKills20261123` | 原本可信任戰鬥成功結算，每次擊退 +1 |

舊的 `stolenEggs20261116`、`stolenEggs20261109` 及其他歷史統計保留，不刪除或重寫正式玩家資料。新欄位不存在時視為零；舊分數不帶入本期。

打怪王計入目前全部九種怪物：

| ID | 怪物 |
|---|---|
| wolf | 大野狼 |
| tiger | 老虎 |
| gorilla | 金剛 |
| mole | 地鼠 |
| dragon | 烈火龍 |
| eagle | 巨飛鷹 |
| cobra | 眼鏡蛇王 |
| giant | 遠古巨人 |
| hornet | 虎頭蜂 |

每種都是 +1，不依怪物、傷害或戰利品數量加權。計數以後端成功結算時間判斷活動區間；戰鬥失敗、逾時、放棄及重送同一筆結算皆不額外加分。

## 保留的規則與效能

- 沿用偷蛋王的公開村落資格、群組＋帳號農場識別、有效成員／帳號篩選、Top 10、同分排序、錯誤提示及刷新冷卻。
- 打怪王計數寫入與戰利品／每日任務事件在同一筆 Firestore 交易內提交。重播既有交易收據或同一場戰鬥結果不再產生有效擊退事件，因此不加第二次分數。
- 使用 `readTarget` 已讀取的玩家群組資料判斷公開資格，不增加一筆群組讀取。
- 原有里程碑擊退統計不變；新增排行榜不改變巨人、眼鏡蛇或地鼠的觸發條件。
- 前後端透過 `scoreField` 核對榜期；版本未同步時顯示更新提示，避免將舊分數放在新日期下。
- 查詢仍走既有後端分頁查詢，只換目前榜單欄位，不新增即時監聽器或額外全村掃描。
- 獎勵說明沿用原有規則，只將打怪王的文字改為打怪。原系統未實作自動依名次發獎，本次也未新增另一套自動發獎流程。

## 介面

同一個排行榜入口新增「偷蛋王／打怪王」兩個可點選分頁，沿用原木框、獎牌、排行列、卷軸及綠色刷新按鈕。兩個分頁使用專案已有的每日任務空白木牌，疊上動態文字；沒有新增不同風格的圖示。

各分頁保留選取、刷新、空榜、狀態與對應單位（顆／隻），切換分頁不重建 Phaser Scene。

## 驗證

- 完整單元測試 **429/429 通過**。
- 專項測試涵蓋九種怪物的真實交易結算與重播、活動開始／截止邊界、私密村落不計分、失敗不計分、歷史分數不變，以及索引 PATCH 保留既有設定與 READY 檢查。
- 真實 Phaser + 隔離 Firebase SDK／既有後端服務：從遊戲原有排行榜入口開啟，驗證舊分數不帶入、兩榜切換、實際後端驗證野狼擊退後上榜、重送不重複、刷新保留分頁及公開資格。
- 手機／平板截圖 320×568、390×844、768×1024，另跑既有八種尺寸排行列捲動、長名稱、空榜、錯誤重試、快速開關及同一場景維持測試。
- `1,025` 等分數為隔離測試資料，不是正式玩家紀錄。
- 完整 Firebase Emulator 結果以隨附 `verification.json`／`verification.log` 為準；不得把隔離 MemoryDB 測試視為正式 Firebase 驗證。

## 上線順序

本次開發尚未更新正式環境。先推送 GitHub，在 Cloud Shell 拉取相同版本並完成完整驗證，接著：

```bash
cd "$HOME/kids-checkin"

# 僅新增本週兩個欄位的索引，不移除現有索引。
node scripts/ensure-farm-ranking-index.cjs --project homebasedb --apply

# 若尚未 READY，此步會以非零狀態結束。等待後重試。
node scripts/ensure-farm-ranking-index.cjs --project homebasedb --require-ready

# 待兩個索引 READY、相同程式版本的 Emulator 驗證通過後部署。
firebase deploy \
  --project homebasedb \
  --config game-admin/firebase.json \
  --only "functions:nexus-ops:gameOpsFarmTransaction,functions:nexus-ops:gameOpsAnnouncements"
```

前端由既有 GitHub Pages main/root 發布。請配合後端與索引就緒後驗收，避免新版前端先查詢尚未部署的新排行榜類型。這次不部署安全規則、不刪除舊分數、不遷移玩家資料。

## 修改檔案

- `css/farm-ranking.css`
- `docs/FARM_WEEKLY_RANKINGS_20261123.md`
- `firestore.indexes.json`
- `game-admin/functions/farm-ranking.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/tests/farm-backend-integration.test.cjs`
- `game-admin/tests/farm-ranking-query.test.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `js/farm/ranking-core.js`
- `js/farm/ranking-ui.js`
- `js/farm/rankings.js`
- `scripts/ensure-farm-ranking-index.cjs`
- `scripts/measure-farm-read-cost.cjs`
- `scripts/test-private-farm.cjs`
- `tests/farm-mail-browser.cjs`
- `tests/farm-private-backend-browser.cjs`
- `tests/farm-ranking-index.test.cjs`
- `tests/farm-ranking.test.mjs`
- `tests/helpers/farm-ranking-checks.cjs`

## 最後執行結果

完整驗證報告：unitPassed=true、browserPassed=true、emulatorPassed=false。登入、存檔、原遊戲交易、虎頭蜂、武士刀、寶箱（含圖像載入失敗備援）及營運中心回歸均通過。Emulator 在啟動階段下載 Firestore JAR 時回傳 `403: Domain forbidden`，尚未執行 Firebase Emulator 合約案例，需在 Cloud Shell 補跑；未以此報告啟用正式環境。
