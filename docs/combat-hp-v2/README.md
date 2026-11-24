# 咕咕村落 HP 戰鬥 V2

本次只調整戰鬥血量、傷害與命中呈現。出現條件、出現機率、戰鬥時限、飛近時間、武器售價及開賣狀態、掉落、寶箱、每日任務與排行榜規則沿用既有流程。

## 數值

| 怪物 ID | 怪物 | HP | 原有總時限 |
| --- | --- | ---: | ---: |
| wolf | 大野狼 | 300 | 60 秒 |
| tiger | 老虎 | 400 | 50 秒 |
| eagle | 巨飛鷹 | 800 | 60 秒 |
| dragon | 烈火龍 | 1,600 | 60 秒 |
| hornet | 虎頭蜂 | 2,400 | 50 秒 |
| gorilla | 大金剛 | 4,000 | 40 秒 |
| mole | 地鼠 | 4,000 | 60 秒 |
| cobra | 毒牙眼鏡蛇王 | 6,400 | 50 秒 |
| giant | 遠古巨人 | 12,000 | 70 秒 |

地鼠保留原本多隻共用血量的行為。既有近戰／遠程攻擊對象限制不變。

| 武器 ID | 武器 | 基準 | 每次有效命中範圍 |
| --- | --- | ---: | ---: |
| club | 木棒 | 20 | 10–30 |
| mace | 狼牙棒 | 60 | 50–70 |
| battleaxe | 雙手斧 | 120 | 110–130 |
| ironhammer | 大鐵槌 | 200 | 190–210 |
| katana | 武士刀 | 400 | 390–410 |
| shortbow | 短弓 | 80 | 70–90 |
| huntingbow | 獵弓 | 160 | 150–170 |
| paladinbow | 聖騎士弓 | 320 | 310–330 |

## 即時回饋與可信任結算

- 後端開戰時產生隨機種子，保存版本、最大 HP、近戰／遠程武器與有效攻擊力快照。
- 前後端共用逐次傷害算法，依該戰鬥種子、攻擊模式與命中序號產生 ±10 的整數傷害。前端可立即呈現同一個結果，不自行決定伺服器傷害。
- 延用既有 500 ms 攻擊合併，批次只送模式、次數、版本與起始序號，不新增逐次 Firebase 請求。後端驗證原有攻速上限、裝備、期限及連續序號，並重新計算傷害。
- 既有固定收據及結算流程負責防重、倉庫、任務和排行榜；血條與傷害動畫不發獎。
- 依最新要求，只顯示原尺寸三分之一的頭頂血條；怪物名稱、HP 數字、倒數、武器／階段文字及背景資訊框均移除。傷害字 30／32／36 px，使用描邊、錯位、上浮及約半秒淡出，最多重用八個文字物件。
- 血條底緣距離怪物可見圖像上緣約 0.3 CSS 公分（約 11.34 CSS px），依手機畫布與鏡頭縮放換算，並逐幀跟隨。透明留白以快取的精靈格 alpha 邊界排除，不會每幀重掃圖片。傷害字也錨定可見頭頂，跟隨怪物移動並短距離上浮。血條即時扣減，金色殘血條約 300 ms 追上。減少動態效果時不播放追趕動畫，傷害字縮短為 220 ms。
- 後端回覆時校正 HP，保留等待中的攻擊預測。畫面結束及場景離開時清除計時器、事件監聽、文字和動畫。

## 相容與發布

既有未結算且沒有 V2 快照的戰鬥沿用舊 HP／傷害完成；新戰鬥套用 V2。新前端也可處理舊後端的戰鬥結果。舊前端連上新後端，會在新怪物建立前收到重新載入提示，避免混用兩套數值。

上線需要發布前端並部署 `functions:nexus-ops:gameOpsFarmTransaction`，建議先部署後端後立即發布前端。無須部署 Rules、修改正式玩家文件或調整管理員的怪物出現設定。部署前以當前版本完成隔離驗證；本次開發沒有執行正式部署。

## 驗證

測試環境為 Chromium + Phaser 3.60.0 + 隔離 SDK + 真實交易服務／MemoryDB，並非正式 Firebase。

- `game-admin/tests/combat-v2.test.cjs`：九種 HP 與時限、八種傷害範圍與上下限、批次一致性、偽造傷害拒絕、序號／攻速／裝備驗證、收據重播與結算一次。
- `tests/helpers/combat-feedback-browser.cjs`：從遊戲的村落／公開村落／玩家雞舍入口進入九種怪物場景，驗證三分之一頭頂血條、約 0.3 公分間距、移除文字、傷害靠近頭頂、隨移動／動畫跟隨、前後端 HP 一致、追趕血條、合併請求、結算、離開、小螢幕與減少動態效果。
- `tests/farm-private-backend-browser.cjs` 舊流程：收蛋、商店、拜訪、打掃、偷蛋、弓箭碰撞、戰鬥獎勵與每日任務回歸。

可使用 `COMBAT_FEEDBACK_TESTS=1 FARM_BASE_URL=http://127.0.0.1:8039 node tests/farm-private-backend-browser.cjs` 執行專項測試；需先啟動該 HTTP Server，並備妥 `/tmp/kids-phaser.js`、Playwright 和 Chromium。

實際遊戲入口截圖（隔離測試帳號）：

- [一般手機傷害與血條](/workspace/exports/gugu-combat-hp-v2/gugu-combat-damage-mobile.png)
- [320 × 568 小螢幕](/workspace/exports/gugu-combat-hp-v2/gugu-combat-hp-small.png)
- [九種怪物實際結算命中數樣本](/workspace/exports/gugu-combat-hp-v2/gugu-combat-v2-browser-results.json)

樣本的命中數隨每場種子改變，不是固定擊殺次數。遠程的專項壓力測試在真實場景中呼叫原箭矢命中回呼；另由既有虎頭蜂／寶箱測試操作實際拉弓、投射物碰撞。測試用時鐘會推進以符合既有後端攻速額度，並非放寬正式攻速上限。

### 實際結果

- 最終版單元測試：458 / 458 通過。
- 完整瀏覽器回歸通過：登入、存檔、原有農場操作、九種 HP 戰鬥、場景購買／切換、拜訪 HUD、載入快取、租犬、分群組每日任務、每週排行榜、虎頭蜂真實拉弓與逾時、武士刀、營運怪物設定、寶箱與管理後台。
- 最後調整武器圖鑑文字間距後，另補跑全套單元測試，以及武士刀商店／倉庫／戰鬥流程，並驗證圖鑑文字不遮住關閉按鈕。
- Emulator：未完成。Firestore emulator JAR 下載回應 HTTP 403 `Domain forbidden`，無法在此環境啟動。這不是 Emulator 測試通過，正式部署前仍需在 Cloud Shell 以最終版本補跑。
- 本機完整流程報告在最終圖鑑間距微調前產生，不能當作最終版正式切換憑證。

### 修改檔案

- `docs/combat-hp-v2/README.md`
- `game-admin/functions/farm-combat.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/tests/battle-page.test.cjs`
- `game-admin/tests/combat-v2.test.cjs`
- `game-admin/tests/farm-backend-integration.test.cjs`
- `game-admin/tests/hornet.test.cjs`
- `game-admin/tests/katana.test.cjs`
- `js/farm/ShopScene.js`
- `js/farm/VisitScene.js`
- `js/farm/backend-client.js`
- `js/farm/battle-page-client.js`
- `js/farm/combat-damage.js`
- `js/farm/combat-feedback.js`
- `js/farm/combat-rules.js`
- `js/farm/dragon.js`
- `js/farm/hornet-core.js`
- `js/farm/mole.js`
- `scripts/prepare-game-admin.cjs`
- `scripts/test-private-farm.cjs`
- `tests/farm-cobra.test.mjs`
- `tests/farm-giant.test.mjs`
- `tests/farm-gorilla.test.mjs`
- `tests/farm-hornet.test.mjs`
- `tests/farm-katana.test.mjs`
- `tests/farm-mole.test.mjs`
- `tests/farm-private-backend-browser.cjs`
- `tests/helpers/combat-feedback-browser.cjs`

### 頭頂血條版面修訂

- 新增 `js/farm/monster-head.js`：快取各格可見圖像上緣及頭頂位置，處理裁切、翻轉、原點與世界座標；以 CSS 單位換算間距。
- `combat-feedback.js` 移除固定資訊面板與倒數計時器，血條及傷害字逐幀跟隨怪物。地鼠沿用共用 HP，血條跟隨最近被擊中的個體，傷害字各自跟隨實際被擊中的地鼠。
- 一般戰鬥狀態文字不再顯示。真正的結算失敗仍保留重試入口，避免玩家無法完成交易。
- 最終版 458 項單元測試通過，九種怪物入口專項測試通過；本次版面修訂沒有修改後端結算或戰鬥數值。
- [最新一般手機畫面](/workspace/exports/gugu-combat-head/mobile.png)／[最新小手機畫面](/workspace/exports/gugu-combat-head/small-mobile.png)

CSS 公分依裝置換算，並非保證在所有手機上皆為物理尺量的 0.3 公分。
