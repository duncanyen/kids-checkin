# 虎頭蜂與蜂蜜 V1

## 規則與設定

- 怪物 ID：`hornet`；戰利品 ID／農場庫存欄位：`honey`。
- 雞舍 Lv.2 起，在自家／拜訪進場的既有後端抽選池加入虎頭蜂，預設 100/30%（1/30）。收蛋及偷蛋執行中不重新抽怪。
- 保留既有里程碑怪物優先順序及其他怪物的機率；若舊營運設定已用滿互斥機率，暫不啟用該進場類別的虎頭蜂，營運中心顯示原因，避免改掉既有設定或阻斷進場。
- 營運中心 → 遊戲數值 → 怪物出現條件，可調整虎頭蜂自家／拜訪開關、最低雞舍等級及機率。寶箱頁也新增虎頭蜂，預設不額外掉寶箱。
- HP 600；短弓傷害 20（30 次）、獵弓 30（20 次）、聖騎士弓 60（10 次）；所有近戰武器無效。
- 戰鬥總長 50 秒，進場飛行階段 10 秒：前 2 秒由右下快速飛近，其餘時間在雞舍上方盤旋。10 秒後每 5 秒作勢向母雞俯衝，僅為視覺動作。
- 勝利沿用後端戰鬥結算／防重收據，發放蜂蜜 1 個、原每日任務有效擊退事件及戰鬥紀錄。蜂蜜在倉庫「其他」，商店「出售 → 其他」售出 300 金幣。
- 逾時只扣戰鬥玩家最多 100 金幣，餘額不足則歸零。不改雞舍主人的金幣、不扣雞蛋。
- 戰鬥沿用原本互動鎖定、強制離開與工作階段生命週期。確定／關閉結果視窗只處理 UI。

## 素材

| 檔案 | 用途 |
|---|---|
| `assets/farm/hornet-sheet.png` | 依提供的聊天合成精靈圖整理重建的透明圖集，7 個動作、每組 8 格 |
| `assets/farm/hornet-sheet.json` | 56 格 Phaser atlas；每格共同虛擬畫布 200×200 |
| `assets/farm/honey.png` | 新設計的蜂蜜罐／蜂巢透明圖示 |
| `scripts/build-hornet-atlas.cjs` | 依透明圖集計算完整影像邊界，重建 atlas metadata |

精靈顯示尺寸採 104×104 虛擬畫布，實際可見身體約 50–65 遊戲單位；使用最近鄰取樣。勝利視窗採頭暈格 43。

提供的是含標題、格線及棋盤底的聊天合成參考圖，本環境未取得原始 32×32 獨立透明格。因此本版使用參考圖整理重建的圖集，並非原始像素逐點擷取；細節與原參考可能有差異。沒有把合成參考圖當成遊戲背景。

## 程式接線

`hornet-core.js` 提供純規則與路徑，`hornet.js` 沿用 `BossEncounter`、既有射箭碰撞及後端結算。`MyFarmScene`／`VisitScene`／`pending-battle` 建立及清理戰鬥；既有共用遮罩與勝利視窗顯示虎頭蜂及蜂蜜。

後端 `encounters.cjs`、`farm-combat.cjs`、`farm-transactions.cjs` 處理出現、傷害、入庫、售價及防重；`chests.cjs`／`domain.cjs`／`reporting.cjs` 納入新怪物與物品。RTDB 農場鏡像原本同步整個 farm，無須新增寫入通道。

## 驗證方式與限制

- 單元測試：425/425。包含三弓命中次數、所有近戰無效、1/30 抽樣與臨界值、Lv.1 不出現、50 秒期限、重送不重複發蜂蜜、可信售價、逾時餘額 1000／50／0、被拜訪農場不變、透明圖集不切邊。
- 遊戲入口測試：Chromium、真實 Phaser 3.60.0、390×844 及 320×568 手機視窗；Firebase 傳輸以隔離 SDK 連接現有服務與 MemoryDB。由正常自家／公開村落入口進入，實際弓箭拖曳與碰撞，從倉庫及商店操作蜂蜜。
- 為可重現測試，測試設定將虎頭蜂機率設為 100%；射箭測試在進場截圖後固定目標位置，飛行與俯衝路徑另有純函式測試。正式預設仍為 1/30。
- 已增加實際 Auth／Functions／Firestore Emulator 合約案例，包含並行結算與蜂蜜出售防重。本環境 Emulator 是否執行成功以隨附 verification.json 為準，不以 MemoryDB 測試冒充正式交易。
- 此次不修改安全規則、不遷移帳號資料。上線需部署更新後的 nexus-ops 後端及發布前端；本次開發沒有部署正式環境。

## 修改與新增檔案

- `assets/farm/honey.png`
- `assets/farm/hornet-sheet.json`
- `assets/farm/hornet-sheet.png`
- `docs/FARM_HORNET_V1.md`
- `game-admin/functions/chests.cjs`
- `game-admin/functions/domain.cjs`
- `game-admin/functions/encounters.cjs`
- `game-admin/functions/farm-combat.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/functions/management.cjs`
- `game-admin/functions/reporting.cjs`
- `game-admin/site/app.js`
- `game-admin/site/index.html`
- `game-admin/site/management.js`
- `game-admin/tests/chests.test.cjs`
- `game-admin/tests/encounters.test.cjs`
- `game-admin/tests/farm-backend-integration.test.cjs`
- `game-admin/tests/hornet.test.cjs`
- `game-admin/tests/katana.test.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `game-admin/tests/reporting.test.cjs`
- `js/farm/MyFarmScene.js`
- `js/farm/ShopScene.js`
- `js/farm/VisitScene.js`
- `js/farm/WarehouseScene.js`
- `js/farm/asset-manifest.js`
- `js/farm/assets.js`
- `js/farm/battle-reward.js`
- `js/farm/chest-ui.js`
- `js/farm/combat-rules.js`
- `js/farm/entry-encounter.js`
- `js/farm/giant-trigger.js`
- `js/farm/hen-navigation.js`
- `js/farm/hornet-core.js`
- `js/farm/hornet.js`
- `js/farm/hud-ui.js`
- `js/farm/inventory-core.js`
- `js/farm/laying-visit.js`
- `js/farm/mail-ui.js`
- `js/farm/mole.js`
- `js/farm/operations-rewards.js`
- `js/farm/pending-battle.js`
- `js/farm/save-core.js`
- `scripts/build-hornet-atlas.cjs`
- `scripts/prepare-game-admin.cjs`
- `scripts/test-private-farm.cjs`
- `tests/farm-hornet-art.test.cjs`
- `tests/farm-hornet.test.mjs`
- `tests/farm-private-backend-browser.cjs`

## 本次執行結果

- 6 項虎頭蜂專項測試及 425 項完整單元測試通過。
- 真實 Phaser 遊戲入口的虎頭蜂流程測試通過；手機尺寸 390×844 與 320×568。
- Emulator 啟動被下載限制阻擋：Firestore JAR 回傳 `403: Domain forbidden`；尚未執行新增的真實 Firebase 合約案例，需在 Cloud Shell 補跑。
- 較完整的原遊戲回歸結果見 `verification.log`／`verification.json`。

- 完整瀏覽器回歸已通過：登入、群組管理、農場存檔、收蛋、偷蛋、清潔、原怪物戰鬥、未開賣武士刀、寶箱及圖片失敗備援、營運中心桌機與手機版。報告為 unitPassed=true、browserPassed=true、emulatorPassed=false。
