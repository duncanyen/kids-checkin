# 咕咕村落：怪物出現條件與機率設定

日期：2026/11/22（台灣時間）。本次僅實作與隔離驗證，尚未推送 GitHub 或部署正式環境。

## 使用位置

營運中心 → 遊戲數值 →「怪物出現 · 條件與機率」→ 各怪物「編輯出現條件」。

八種怪物皆可獨立啟用／停用新出現；設定自家、拜訪是否適用、最低雞舍等級、出現機率（0–100%）。地鼠可改成功抓蟲間隔；蛇王與巨人可改累計擊退間隔，並選擇計入的怪物（目前可靠紀錄的野狼、老虎、巨飛鷹）。儲存必須填理由。

野狼與老虎仍僅適用拜訪村落：現有自家場景沒有這兩種戰鬥實作，選單已停用自家欄位，後端也拒絕開啟；本次沒有新增不同的戰鬥玩法。條件類型及出場順序延續既有規則，不是任意腳本編輯器。

## 預設規則與 ID

未儲存設定時沿用原數值；首次儲存才建立設定文件，不重置其他怪物已存內容。

| ID | 名稱 | 自家條件 | 拜訪條件 | 累計門檻 |
| --- | --- | --- | --- | --- |
| wolf | 大野狼 | 停用 | 目標雞舍≥1級，10% | 無 |
| tiger | 老虎 | 停用 | 目標雞舍≥1級，1/30 | 無 |
| dragon | 烈火龍 | 自家雞舍≥2級，5% | 目標雞舍≥2級，1/30 | 無 |
| gorilla | 金剛（既有大金剛） | 自家雞舍≥3級，1/30 | 目標雞舍≥3級，1/30 | 無 |
| eagle | 巨飛鷹 | 自家雞舍≥3級，5% | 目標雞舍≥3級，5% | 無 |
| cobra | 眼鏡蛇王（既有毒牙眼鏡蛇王） | 玩家自己的雞舍≥2級，100% | 玩家自己的雞舍≥2級，100% | 每100次擊退野狼、老虎、巨飛鷹 |
| giant | 遠古巨人 | 玩家自己的雞舍≥3級，100% | 玩家自己的雞舍≥3級，100% | 每50次擊退野狼、老虎 |
| mole | 地鼠（既有菜園地鼠×3） | 玩家自己的雞舍≥2級，100% | 玩家自己的雞舍≥2級，100% | 每30次成功抓蟲 |

1/30 約3.333333%，儲存保留完整數值，不以顯示小數截斷原機率。未建立重複怪物。

### 機率如何解讀

先延續尚未結束的戰鬥；新進場先按蛇王→巨人→地鼠檢查已達成的里程碑，通過該機率才出現。未觸發時再判定一般怪物：金剛、烈火龍、巨飛鷹以互斥機率抽選；拜訪時若仍無怪物，再判定老虎，最後判定野狼。同一次只出現一種怪物。

因此各機率是「到達該判定階段」時的機率。尤其老虎1/30、野狼10%不是整體拜訪比例，前面的怪物會先占用一部分進場機會。後台也明確顯示說明，未擅自改成獨立同時抽出多隻。

同一場域、等級下，金剛＋烈火龍＋巨飛鷹不能超過100%；後端逐級驗證。單怪0%永不出現，100%在條件及順位允許時必定出現。啟用100%里程碑也必須先達成累計門檻。機率未通過不消耗里程碑，留待下次新的進場判定。

## 生效範圍與保護

- 新設定只影響之後的進場判定，不中斷或重新計算已開始戰鬥的血量、期限、戰利品與寶箱。
- 原始戰鬥會話、請求ID／收據、怪物攻擊與獎勵結算機制保留。
- 只在進場判定新怪物。收蛋、偷蛋的 verifyOnly／重用許可與戰鬥攻擊、結算不重新抽怪。
- 新里程碑也可在已有自家清場許可時，於下次進場被檢查，對應舊版前端的前置里程碑檢查；收蛋請求本身仍不觸發。
- 已消耗的里程碑不歸零；新間隔取「高於上次標記的下一個倍數」。改累計類型不重算歷史事件，使用原有可靠計數；應注意切換類型可能改變下一次達標時間。
- 強制關閉與既有戰鬥作廢規則不變。

## 後端資料與權限

設定文件：`ops_game_config/encounters`，包含 `monsters`、`revision`、`updatedBy`、`updatedAt`。

儲存操作：既有 gameOpsAdmin 的 `saveEncounterConfig`。沿用真正的管理員授權、expectedRevision 併發保護、管理請求防重及 ops_audit 前後值、原因、操作者、時間紀錄。一般玩家無法直接讀寫 ops_* 設定，也無法藉請求指定出現機率或降低門檻。

gameOpsFarmTransaction 在同一個可信任交易中取得設定與玩家／目標資料，驗證後選怪與建立會話。正式前端不再以寫死的 nextMilestone 決定是否發起挑戰，公開村落預載也直接請後端確認進場，不再先由前端選怪。

舊版純前端模式的函式保留作相容 fallback；目前正式啟用後端的路徑不使用其門檻或抽選。生命值、戰鬥秒數、掉落與懲罰仍為原規則，不在本次條件設定範圍。

### 讀取成本

每次真正的新進場檢查增加最多1次設定文件讀取；設定與農場讀取在既有進場請求中完成，沒有新增玩家輪詢或另一支設定查詢 API。收據重播、進行中的戰鬥、收蛋驗證及拜訪許可重用不讀此設定。相關讀取次數已有單元測試。這不是宣稱總讀取量一定下降：新進場仍多一份規則讀取，以取得最新後台設定。

## 驗證

- 全套單元測試：412項全部通過，0失敗。完整瀏覽器驗證全部通過；驗證報告的程式雜湊與目前後端及正式前端程式一致。
- 新增7項規則／權限／交易測試，包含60,000組舊版抽選樣本比對、0%／100%／機率邊界、等級門檻、互斥合計限制、個別設定保留、版本／稽核／防重、非管理員拒絕、門檻小於原值、舊版claim請求仍驗證、收據及進行中戰鬥不重抽、設定讀取次數。
- 營運中心真正DOM操作，驗證地鼠自家75%／拜訪25%及門檻7、獨立停用巨鷹、蛇王改只累計野狼且間隔11，390px手機表單無水平溢出。
- 真實Phaser3.60與正常遊戲入口：自家進場以成功抓蟲2次觸發地鼠（低於舊版30）；怪物阻擋倉庫操作；0%不觸發；HUD村落→公開村落→選村落→選雞舍，100%狼出現；沒有由前端送claimEncounter選怪。
- 原收蛋、商店、偷蛋、打掃、戰鬥與每日任務回歸，以及寶箱動畫／開箱與失敗回退由完整驗證腳本覆蓋。
- 畫面與資料使用隔離測試SDK／記憶體交易服務，不操作正式玩家，也不是靜態HTML預覽。實體iPhone／Android未測。
- 已新增Firebase Emulator用戶端禁止改設定、真callable依門檻2觸發與停用後不觸發測試。本環境嘗試下載cloud-firestore-emulator-v1.19.8.jar被403 Domain forbidden阻擋，未宣稱Emulator通過；需在Cloud Shell補驗。

## 上線需更新

尚未推送或部署。需更新遊戲前端與營運中心前端，並部署 nexus-ops 的 gameOpsFarmTransaction、gameOpsAdmin。一般怪物／里程碑判定與營運儲存兩者都要更新，只部署一支不足。

建議先部署兩支後端再發布前端，避免新版前端取消本地門檻後仍連到舊後端。舊前端到新版後端的claim也會受新版設定驗證。既有Firebase兩區並存設定不變。

不需要新增Functions名稱、安全規則、索引或遷移玩家資料；設定使用現有受保護ops_*命名空間。第一次儲存後即保留後台值，以後調整不需修改／重部署程式。

Cloud Shell已備妥Node22、Chromium、sharp與Phaser測試檔時，使用既有完整驗證：

```bash
cd "$HOME/kids-checkin"
export NEXUS_TEST_TOOLS="$HOME/.nexus-test-tools"
export PATH="$NEXUS_TEST_TOOLS/node_modules/node/bin:$NEXUS_TEST_TOOLS/node_modules/.bin:$PATH"
export NODE_PATH="$NEXUS_TEST_TOOLS/node_modules${NODE_PATH:+:$NODE_PATH}"
export PHASER_FIXTURE="/tmp/kids-phaser.js"
PRIVATE_FARM_REPORT="$HOME/nexus-encounter-verification.json" node scripts/test-private-farm.cjs --emulator
```

## 修改檔案

- `game-admin/functions/farm-combat.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/functions/management.cjs`
- `game-admin/site/app.js`
- `game-admin/site/index.html`
- `game-admin/site/management.js`
- `game-admin/tests/management.browser.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `game-admin/tests/private-farm-rules.emulator.cjs`
- `js/farm/MyFarmScene.js`
- `js/farm/VisitScene.js`
- `js/farm/visit-entry.js`
- `scripts/test-private-farm.cjs`
- `tests/farm-private-backend-browser.cjs`
- `tests/farm-visit-entry.test.mjs`
- `game-admin/functions/encounters.cjs`
- `game-admin/tests/encounters.test.cjs`
- `docs/FARM_ENCOUNTER_SETTINGS.md`

## 截圖與驗收資料

隨附下載包中的截圖皆來自隔離環境的實際營運中心及真實Phaser遊戲入口：

- `admin-settings.png`：八隻怪物的條件與機率列表；地鼠7次、75%／25%與停用巨鷹是測試修改值，不是正式預設。
- `admin-editor-mobile.png`：390px手機表單；蛇王只累計野狼與11次門檻的測試設定。
- `mole-entry.png`：自家進場按後端2次抓蟲設定觸發地鼠。
- `wolf-visit.png`：從公開村落正常入口依100%設定遇到狼。
- `verification.json`、`verification.log`：412項單元及所有瀏覽器測試結果；emulatorPassed如實為false。
- `emulator-download-error.log`：本環境下載Emulator被403阻擋的原始錯誤。

本次沒有新增美術素材、沒有更改既有遊戲數值以外的帳號或群組資料。
