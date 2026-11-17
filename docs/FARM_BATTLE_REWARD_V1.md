# 咕咕村落：戰鬥勝利獎勵視窗 V1

已完成本地實作與隔離驗收，尚未推送 GitHub、部署正式 Functions 或實體 iPhone 驗證。

## 結算接線與資料來源

- BossEncounter.settle（`js/farm/dragon.js`）：巨飛鷹、烈火龍、大金剛、毒牙眼鏡蛇王、遠古巨人及菜園地鼠共用。原有 spec.settle 完成後才呼叫視窗；敗北與交易失敗不開成功視窗。
- VisitScene.defeatWolf / defeatTiger：保留既有扣血、戰鬥結算、入庫及系統通知流程，結算回傳後呈現結果，移除同筆成功浮字及原本額外延遲一秒的獎勵浮字。
- 可信任來源是 `gameOpsFarmTransaction` 的既有 `battleSettle` 成功回應 `result`；`farm-combat.cjs` 只補顯示欄位，不更改發獎 patch、容量規則、事件或任務：

```json
{
  "id": "原有 battle ID",
  "outcome": "win",
  "monster": "eagle",
  "inventoryUpdated": true,
  "rewards": [{"itemId": "eagleFeathers", "quantity": 1}]
}
```

quantity 由同筆結算的實際庫存 patch 減去結算前庫存計算；不是畫面估算，也不由前端要求。倉庫滿而原本不發道具的狼／虎勝利會回傳空 rewards 及 inventoryUpdated:false，視窗不顯示「已放入倉庫」。其他怪物原本允許超容量入庫的規則維持。

前端相容尚未部署的新後端：舊回應的 hasSpace 是實際入庫 patch 的確認值，沿用舊版每場固定一個道具的合約；legacy 前端交易僅於原交易成功後提供確認，不新增寫入。

視窗正常顯示時隱藏同筆舊獎勵提示；圖片／UI 載入失敗時恢復文字提示，絕不因此重送結算。保留既有失敗時點擊結算文字重試。按鈕與 Escape 都只執行既有 createFarmDialog.close；沿用遮罩、輸入鎖、焦點、shutdown/destroy 清理及明細捲動。

UI 以帳號／來源群組＋battle ID 去重，處理同時請求；已顯示 ID 保存於本頁及 sessionStorage（最近 128 筆）。發獎／任務防重仍由既有後端交易負責，與 UI 防重獨立。

## 素材與最新立繪要求

附件 README.md、manifest.json 已閱讀。8 張 PNG 原封不動複製至 `assets/farm/battle-reward/v1/`，SHA-256 與附件相符，均有 RGBA 透明通道。preview.png 不載入遊戲。

| PNG | 用途 |
| --- | --- |
| battle_reward_panel.png | 九宮格伸展空白內頁，保留木框四角 |
| battle_reward_plaque.png | 標題底牌，程式疊上戰鬥勝利 |
| battle_reward_close.png | 右上關閉按鈕 |
| battle_reward_row.png | 三列共用；空列無文字、圖示及互動 |
| battle_reward_feather.png | 僅用於 eagleFeathers |
| battle_reward_storage_banner.png | 僅確認入庫成功後顯示 |
| battle_reward_confirm.png | 確定按鈕 |
| battle_reward_eagle.png | 保留來源檔，依最新指示不載入、不預熱 |

依使用者後續指示，立繪使用**既有精靈圖頭部暈眩／星星影格**，以 Phaser 原 texture frame 擷取，比例與透明保持不變，不自行繪製怪物或星星。

| 怪物／texture | 暈眩影格 | 道具庫存 ID |
| --- | ---: | --- |
| eagle／巨飛鷹 | 6 | eagleFeathers |
| gorilla／大金剛 | 9 | gorillaFangs |
| dragon／烈火龍 | 16 | dragonScales |
| cobra／毒牙眼鏡蛇王 | 49 | cobraFangs |
| giant／遠古巨人 | 25 | ancientStones |
| mole／菜園地鼠 ×3 | 5 | sweetPotatoes |
| wolf／大野狼 | 10 | wolfFangs |
| tiger／猛虎 | 10 | tigerPelts |

沒有對應 texture/frame 時留白並保留正確名稱與數量，絕不顯示整張 sprite sheet 或其他怪物代替。其他戰利品優先取倉庫原有 texture；缺圖保留文字。

## 修改檔案

- `farmgame.html`：增加視窗 CSS。
- `css/farm-battle-reward.css`：素材布局、空列、手機安全區與長名稱。
- `js/farm/battle-reward.js`：怪物／道具／暈眩影格對照、結算 view adapter，預留可信任多道具陣列。
- `js/farm/battle-reward-ui.js`：三列共用 renderer、素材預熱、防重與既有 dialog 接線。
- `js/farm/battle-reward-feedback.js`：非阻塞模組預熱、場景有效性與 UI 失敗回退。
- `js/farm/dragon.js`、`js/farm/VisitScene.js`：接回原結算、避免重複浮字。
- `game-admin/functions/farm-combat.cjs`：補回傳實際道具 delta、怪物種類與入庫狀態。
- `tests/farm-battle-reward.test.mjs`、`game-admin/tests/farm-backend-integration.test.cjs`：合約、防重、八種怪物、滿庫、缺圖與多道具測試。
- `tests/farm-private-backend-browser.cjs`：擴充實際遊戲入口的勝利視窗驗收模式。
- `assets/farm/battle-reward/v1/`：8 PNG 及原始 manifest／README。

## 驗收結果

使用 Chromium、真正遊戲 HTML／Phaser 3.60.0／原場景／原後端服務，Firebase SDK 與資料庫使用隔離 fixture／MemoryDB，不接觸正式資料。

- 全部 392 項單元測試通過；八種怪物結算均回傳正確 itemId、quantity 與 inventoryUpdated，重送不再增加庫存及擊退任務。
- 巨飛鷹：登入遊戲原有自家進場事件，實際滑鼠選弓及拉弓射擊；顯示巨飛鷹頭上星星影格、巨鷹羽毛 × 1、兩列淡色空底板、入庫提示，無售價。
- 大金剛：原有自家進場事件，實際點擊攻擊；顯示頭上星星影格及猩猩尖牙 × 1。
- 狼／虎：從 HUD 村落 → 公開村落 → B 村落 → 雞舍進場，等待怪物走入畫面後以真實 pointer 攻擊；正確彈窗、連點關閉及重複結算不增發道具，關閉後留在 B 村落。
- 模擬入庫交易暫時失敗：巨飛鷹／大金剛均不顯示成功視窗、道具與任務為 0；點擊原結算重試後各入庫 1、任務 1。
- 重複成功 UI 事件、重送原 battleSettle、連點確定及右上關閉均不重複發獎；共用 dialog 解除場景輸入鎖。
- 390×844 及 320×568：立繪不蓋怪物名稱、無橫向溢出、確定可見；長道具名與 12,345 數量右對齊；三列填滿僅用 UI fixture，沒有改正式掉落規則。
- 缺圖 fixture 保留名稱及數量；滿庫 fixture 不顯示入庫圖片。
- 原有收蛋視窗完整回歸通過（單一／多種／120 顆、4 種捲動、7 種尺寸、關閉、空結果、失敗、UI 失敗、重整、生命週期與任務次數）。
- 既有完整私人農場瀏覽器回歸通過（收蛋、商店、拜訪清潔、偷蛋、戰鬥與每日任務；無前端直接 Firestore 寫入）。

重跑方式：先以靜態伺服器啟動 repository root（127.0.0.1:8032），並備妥真正 Phaser fixture `/tmp/kids-phaser.js`，再執行：

```bash
BATTLE_REWARD_TESTS=1 node tests/farm-private-backend-browser.cjs
BATTLE_REWARD_TESTS=1 BATTLE_REWARD_KIND=gorilla node tests/farm-private-backend-browser.cjs
PREDATOR_REWARD_TESTS=1 node tests/farm-private-backend-browser.cjs
PREDATOR_REWARD_TESTS=1 PREDATOR_REWARD_KIND=tiger node tests/farm-private-backend-browser.cjs
EGG_RESULT_TESTS=1 node tests/farm-private-backend-browser.cjs
node tests/farm-private-backend-browser.cjs
```

## 實際畫面與差異

匯出資料夾：`/workspace/exports/gugu-battle-reward/`，包含手機截圖與通過的測試日誌。

- gugu-battle-eagle-390.png／gugu-battle-eagle-320.png：從原打怪入口實際射擊後的勝利視窗。
- gugu-battle-gorilla-390.png／gugu-battle-gorilla-320.png：從原打怪入口實際點擊後的勝利視窗。
- gugu-battle-three-rows-320.png：明確標為 UI fixture 的三列／缺圖／長名稱排版。

相較 preview：依最新要求，以原精靈暈眩影格取代巨飛鷹手繪立繪，因此插畫輪廓、留白與寬高不同；共同主框以九宮格調整內頁高度而非扭曲木框；小手機按鈕保留 44px 觸控範圍，視覺位置可能微幅不同。背景使用實際原場景加共用暗色遮罩，不使用設計稿背景。

未完成範圍：尚未部署正式 Functions／GitHub Pages、未做正式 Firebase Emulator 端到端測試或實體 iPhone/Safari 測試；另外四種怪物已驗證後端／view 合約及影格對照，尚未逐種實際操作攻擊驗收。

上線需更新前端及 `functions:nexus-ops:gameOpsFarmTransaction`，不用部署 Rules、不需資料遷移。此次 Functions 僅增加顯示所需的結算回傳欄位。
