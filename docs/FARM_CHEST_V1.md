# 咕咕村落寶箱 V1 開發與驗收報告

日期：2026/11/18（台灣時間）。程式已實作，尚未推送 GitHub 或部署正式服務。

## 功能與整合

成功擊退結算沿用既有戰鬥交易：原戰利品不變，伺服器再判定額外一個未開啟寶箱。原戰鬥 ID、請求收據及原子交易共同防重。戰鬥勝利第 1 列原戰利品、第 2 列寶箱（未掉落則留白）、第 3 列空底板。

倉庫新增「寶箱」分類，分未開啟與開箱紀錄。開啟立即送出請求與鎖定按鈕，成功後才演出。金幣使用原 farm.coins；道具用原庫存欄位，雞隻沿用商店的容量、個體及生產交付邏輯。雞隻直接進雞舍，不會假稱在道具倉庫。純金幣、純物品、混合多物品皆支援。

寶箱保存掉落時設定快照及版本，後台修改不會改變既有箱內容。唯一寶箱 ID、歸屬驗證、消耗、金幣／物品／雞隻、結果紀錄與請求收據在同一交易提交。已開啟箱能讀回原結果；重播收據仍附目前農場餘額，避免舊餘額覆蓋畫面。逾時保留原請求 ID，重試原交易，不自動另開一箱。

未開啟寶箱獨立保存，不占一般物品倉庫格數，避免滿倉丟失額外掉落。開箱內容遵守現有倉庫與雞舍容量；容量不足或交付失敗，整箱維持未開啟，沒有部分入庫或扣箱。戰鬥未結束時禁止開未開啟箱；既有完成結果仍可查詢。

## 怪物 ID 與預設值

| 現有 ID | 本次名稱 | 現有名稱／別名 | 掉落率 | 金幣（含上下限） |
| --- | --- | --- | --- | --- |
| wolf | 大野狼 | 大野狼 | 20% | 1–100 |
| tiger | 老虎 | 老虎 | 20% | 1–100 |
| gorilla | 金剛 | 大金剛 | 20% | 1–100 |
| mole | 地鼠 | 菜園地鼠×3 | 50% | 100–200 |
| dragon | 烈火龍 | 烈火龍 | 50% | 100–200 |
| eagle | 巨飛鷹 | 巨飛鷹 | 50% | 100–200 |
| cobra | 眼鏡蛇王 | 毒牙眼鏡蛇王 | 80% | 500–1,000 |
| giant | 遠古巨人 | 遠古巨人 | 80% | 500–1,000 |

沒有建立重複怪物。預設只有金幣、物品清單空白。0% 永不掉落、100% 每次有效勝利掉落一箱；金幣均勻抽包含兩端的整數，最小等於最大為固定額。

## 營運中心

位置：營運中心 → 遊戲數值 →「怪物寶箱 · 個別掉落與內容」→ 各怪物「編輯寶箱」。

每隻獨立設定機率、金幣啟停／範圍、商品及正整數數量；物品清單為每箱全部發放，沒有額外權重。後端沿用管理權限驗證、修改理由、稽核前後值、操作者及時間，並用設定版本避免同時覆寫。儲存某隻不會重置其他怪物。

設定位於 ops_game_config/chests；首次有效戰鬥交易若文件不存在才原子建立預設，或由管理員首次儲存建立。既有設定保留，不需要手動初始化。箱資料位於 ops_farm_chests/{玩家與群組歸屬雜湊}/boxes/{唯一箱ID}，沿用既有 ops_* 禁止用戶端存取規則，只透過驗證後的 callable。清單只查本人分區，以狀態及每頁20筆讀取，不掃描所有玩家。

金幣設定安全上限每箱 1,000,000,000，非負整數；單項一般物品1–1,000、單箱雞隻合計最多20。機率大於零時至少須有可實際發放的內容。啟用金幣且最小0、最大大於0時，允許抽到0，符合設定含下限規則。

### 商品交付

可選25項：母雞、烏骨雞、布雷斯雞、日本長尾雞；狼牙棒、雙手斧、大鐵槌、短弓、獵弓、聖騎士弓；遠古巨石、四種雞蛋、菜蟲、蚯蚓、狼牙、虎皮、龍麟、猩猩尖牙、咕咕活力散、巨鷹羽毛、地瓜、眼鏡蛇王毒牙。沿用既有商品 ID；活力散商品 ID medicine 對應庫存 medicines。

以下商品已在後台標明原因且後端拒絕儲存：

| 商品／ID | 限制原因 |
| --- | --- |
| 木棒 club | 初始武器，沒有可交付的商店庫存商品 |
| 大白熊犬 guard:pyrenees、米格魯 guard:beagle、邊境牧羊犬 guard:collie、柯基犬 guard:corgi | 限時租用涉及租期、剩餘時間、暫停與啟用，缺少寶箱租約兌換交付 |
| 初始場景 scene:default | 已內建 |
| 富士山農莊 scene:fuji | 目前尚未開賣，維持既有限制 |
| 中級 coop2、高級 coop3、特級 coop4、頂級 coop5 雞舍，以及倉庫擴充 expand | 即時升級服務，缺少可入庫的升級兌換憑證；特級、頂級仍為即將推出 |

## 指定素材與動畫

11張 PNG（3張主圖、8張逐格圖）與原包逐位元相同，皆具 RGBA 透明通道；檢查結果見 asset-verification.json。精靈圖2048×1024、每格512×512，保留供 Phaser 使用。本次沿用既有 DOM 彈窗，使用原8張透明逐格 PNG，未使用 preview.gif 作遊戲背景，亦未生成替代寶箱美術。

依原 manifest：格起點0、90、170、270、370、480、600、740毫秒，第4索引於370毫秒揭露實際結算獎勵；播放一次900毫秒，停第7索引，原點(0.5,0.78125)。減少動態、跳過、背景頁面與動畫載入失敗使用原開蓋靜態圖，獎勵仍可讀。確定、關閉、動畫回呼均不發獎、不重建場景、不增加任務次數。

與素材參考差異：沿用現有木框／標題／按鈕容器；結果另顯示實際金幣與物品文字清單。長清單於明細區捲動，按鈕保持可見。營運中心維持既有管理介面風格。未實測實體 iPhone／Android。

## 驗證結果

- Node22.23.4：405項單元測試全部通過，0失敗。
- 原有登入、私人身分、管理權限、農場存檔、收蛋、偷蛋、打掃、戰鬥、每日任務瀏覽器回歸通過。
- 真實 Phaser3.60 遊戲入口：進自己村落 → 原巨飛鷹戰鬥操作 → 勝利箱掉落 → HUD倉庫 → 寶箱分類 → 開啟／查閱紀錄，測試通過。不是獨立靜態預覽。
- 預設8怪物、0%／100%／機率臨界點、金幣上下限／固定金額、原戰利品無掉箱、同戰鬥收據重播、其他玩家拒絕、設定權限／稽核／版本、舊箱設定鎖定通過。
- 純金幣、純物品、金幣加多筆物品及雞隻、滿倉／雞舍滿失敗後重試、寫入失敗原子回復通過。
- 快速連點、兩個裝置識別重試同箱、後端已提交但前端逾時後沿原請求重試、刷新後歷史、已開箱讀回、同箱只發一次通過。
- 完整8格／370ms揭露／900ms停留、跳過、減少動態、8張動畫圖載入失敗回退通過。
- 實際320px與390px Chromium畫面及營運中心桌面／手機測試通過。測試服務使用隔離記憶體交易資料庫與可控制的隨機值，不操作正式玩家資料。

### 尚未完成的正式驗證

Firebase Emulator 執行所需下載遭此環境網路代理 CONNECT403 阻擋。本次報告如實為 unitPassed=true、browserPassed=true、emulatorPassed=false，不能當成正式切換已核准。已加入真正 Emulator 的雙請求開箱與用戶端禁止修改箱／設定測試，但本環境未執行成功。記憶體交易測試不能取代 Firestore 的實際併發驗證。

請在既有 Cloud Shell Node22／Chromium 測試環境補跑：

```bash
cd "$HOME/kids-checkin"
export NEXUS_TEST_TOOLS="$HOME/.nexus-test-tools"
export PATH="$NEXUS_TEST_TOOLS/node_modules/node/bin:$NEXUS_TEST_TOOLS/node_modules/.bin:$PATH"
PRIVATE_FARM_REPORT="$HOME/nexus-chest-verification.json" node scripts/test-private-farm.cjs --emulator
```

須待三種驗證皆通過再正式部署。需要更新遊戲前端、營運中心前端，以及 nexus-ops 的 gameOpsFarmTransaction、gameOpsAdmin；只部署交易函式不足。此功能不需要改安全規則、建立新索引或遷移既有玩家。尚未推送／部署，不代表正式玩家已可使用。

## 實際截圖與證據

截圖來自上述真實 Phaser 遊戲入口，後端為隔離測試資料與測試設定（為驗證強制100%掉箱，非正式預設機率）。

- battle-drop.png：原羽毛＋額外箱，第三列空白。
- warehouse.png、chest-list.png：遊戲倉庫分類與未開箱清單。
- opening.png：成功交易後實際動畫揭露階段。
- result-coins-320.png、result-items-320.png、result-mixed-320.png：金幣、物品及混合含雞隻結果。
- admin-settings.png、admin-editor.png、admin-mobile.png：設定位置及手機表單。
- verification.json：驗證狀態與程式雜湊。
- verification.log：完整405項與瀏覽器測試輸出。
- asset-verification.json：指定素材完整性與透明度。

## 修改檔案清單

- `farmgame.html`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/functions/management.cjs`
- `game-admin/site/app.js`
- `game-admin/site/index.html`
- `game-admin/site/management.js`
- `game-admin/site/styles.css`
- `game-admin/tests/management.browser.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `game-admin/tests/private-farm-rules.emulator.cjs`
- `js/farm/WarehouseScene.js`
- `js/farm/asset-manifest.js`
- `js/farm/backend-client.js`
- `js/farm/battle-reward-ui.js`
- `js/farm/battle-reward.js`
- `js/farm/farm-dialog.js`
- `js/farm/item-categories.js`
- `scripts/test-private-farm.cjs`
- `tests/farm-private-backend-browser.cjs`
- `assets/farm/chest/v1/README.md`
- `assets/farm/chest/v1/chest_inventory_icon.png`
- `assets/farm/chest/v1/chest_open_spritesheet.png`
- `assets/farm/chest/v1/chest_open_static.png`
- `assets/farm/chest/v1/frames/chest_00_closed.png`
- `assets/farm/chest/v1/frames/chest_01_latch.png`
- `assets/farm/chest/v1/frames/chest_02_ajar.png`
- `assets/farm/chest/v1/frames/chest_03_lifting.png`
- `assets/farm/chest/v1/frames/chest_04_reveal.png`
- `assets/farm/chest/v1/frames/chest_05_shine.png`
- `assets/farm/chest/v1/frames/chest_06_settle.png`
- `assets/farm/chest/v1/frames/chest_07_opened.png`
- `assets/farm/chest/v1/manifest.json`
- `css/farm-chest.css`
- `game-admin/functions/chests.cjs`
- `game-admin/tests/chests.test.cjs`
- `js/farm/chest-animation.js`
- `js/farm/chest-ui.js`
- `tests/farm-chest-animation.test.mjs`
- `docs/FARM_CHEST_V1.md`（本報告）。

## Cloud Shell 動畫操作驗證修正

獎勵列與入庫提示在動畫前保留版面空間，僅隱藏內容；避免第4格揭露時移動到「跳過動畫」原點擊位置。測試以 Playwright 時鐘固定動畫期間，再使用真正滑鼠點擊「跳過動畫」，斷言停第7格、結果完成，並恢復時鐘。沒有強制點擊、忽略逾時或略過跳過功能測試。正式動畫仍為原900毫秒。
