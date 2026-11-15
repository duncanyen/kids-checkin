# 偷蛋成功結果彈窗 V1.0 驗收

> 最新顯示調整：依使用者要求，明細改成單行「雞蛋名稱 × 數量」，例如「烏骨雞蛋 × 1」。不再顯示「來源未記錄」、雞名或下方品種小字。來源分組與交易數量驗證保持不變；以下來源文字及舊截圖描述屬原版驗收紀錄。此次更新通過 4 項來源資料測試及實際 Phaser 偷蛋彈窗回歸。

## 實作與資料來源

沿用原本雞隻／雞舍雞蛋的偷蛋入口、合併交易、守衛犬、冷卻、倉庫、道德值與排行榜。只新增結果回傳及顯示所需欄位，不增加偷蛋數量、不更改活動期間。

`takePoultryEgg()` 仍一次扣除一顆，只補回傳實際 `quantity`。伺服器 `farm-transactions.cjs` 的共用偷蛋成功結果新增：

| 欄位 | 來源／用途 |
| --- | --- |
| `transactionId` | 原有交易收據 `receiptRef.id`，供顯示防重使用 |
| `totalEggs` | 實際 `takePoultryEgg().quantity` |
| `eggBreed` | 實際抽中並扣除的 `takePoultryEgg().breed` |
| `eggSources` | 本筆扣除的數量與品種；目前 `henId:null`，明示個體來源未記錄 |

直接 `stealEgg` 與合併 `visitEncounter(...stealWhenClear:true)` 都經過同一結果實作。客戶端偽造的總數、來源與母雞名稱不會被採用。後端交易提交後，前端才開啟視窗；彈窗與兩個關閉按鈕沒有資料庫交易。

### 目前確定無法追溯的資料

現有正式模型是 `readyEggs.{breed}` 與總數 `eggsReady`；`hensState[].id` 雖能辨識雞隻，但沒有記錄每一顆待收蛋所屬的母雞。倉庫也按雞蛋品種存放。交易只抽選品種，沒有選中母雞個體。

因此本版實際交易會顯示「來源未記錄／實際品種 × 1」。即使雞舍內只剩一隻雞，或只有兩隻具名的同品種母雞，都不會猜來源，也不會反推歷史紀錄。這是缺少產蛋來源關聯資料，不是 UI 未接到雞群名單。

本版不建立另一套產蛋追蹤機制；若未來要真實顯示個體來源，需另行設計產蛋、收蛋、怪物損失與庫存扣除的來源紀錄及一致性。已有真實來源明細時，顯示層可依同一雞舍內的 `henId` 分組，並接受公開 `henName`／`henPublicNumber`；同名或同品種的不同 ID 不合併。

附件的「花花 × 2／米粒 × 1」僅用來驗收來源明細版型。現行遊戲每次偷一顆，本次沒有改成一次偷三顆。

## UI 與素材

已閱讀附件 README、manifest，並檢視 `preview.png`。使用九張獨立 RGBA PNG，驗證均具有 0–255 Alpha；預覽圖沒有載入為遊戲背景。

附件原圖存於 `assets/farm/steal-result/v1/`，含 README 與 manifest：

- `steal_result_title.png`：空白木牌，DOM 疊加「偷蛋成功」。
- `steal_result_hen.png`：中央母雞插畫。
- `steal_result_panel.png`、`steal_result_close.png`、`steal_result_total_banner.png`、`steal_result_section_title.png`、`steal_result_row.png`、`steal_result_storage_banner.png`、`steal_result_confirm.png`。

後七張與既有收蛋素材逐位元相同，執行時重用既有 `assets/farm/egg-result/v1/` URL，避免重新下載相同 PNG；附件原檔保留供對照。新增標題與母雞圖在拜訪開始後背景預熱，下載失敗不阻止遊戲啟動。

收蛋與偷蛋共用 `openFarmResult()` 的遮罩、容器、焦點、ESC、關閉、scene shutdown/destroy 清理及手機明細捲動。明細只有文字，左側名稱／品種、右側數量；長名稱省略並保留完整可存取名稱。總數欄的雞蛋圖示直接使用附件底圖。

同一交易的顯示 ID 存於分帳號／群組的分頁 sessionStorage，並搭配本頁記憶體防重；同時呼叫、關閉後重開與正常重新整理不會重開同一結果。儲存不可用時仍維持本頁防重，不因此阻止已完成交易。

舊 Functions 若缺少新總數／收據欄位，保留原有成功浮字；素材或 DOM 開啟失敗也使用該備援，不重送交易。正常開啟彈窗時不重複顯示同筆成功浮字。攔截、零顆與失敗不開成功彈窗。

## 測試結果

338 項 Node 測試通過，包含新增來源分組、一致性、缺少來源、來源超量與非法資料驗證；後端測試確認偽造來源無效、實際扣除／入庫／排行各更新一次，攔截回傳零顆。

真正 Phaser 3.60.0 與隔離後端／資料庫驗證通過：

- 從原本雞隻點擊入口進入另一公開群組，成功後顯示一顆實際入庫的烏骨雞蛋。
- 目標有兩隻具名烏骨雞仍顯示來源未記錄，不歸給花花或米粒。
- 來源介面案例：單一個體、花花兩顆與米粒一顆、同名不同 ID、部分未知、長名字與八筆來源；這些版型案例不呼叫交易、不增庫存或排行。
- 確定／關閉共用清理，快速重複點擊只關閉一次，保留 VisitScene 與原目標村落。
- 同一交易再次傳入及重新整理後都不重開；彈窗期間再次呼叫偷蛋不送出交易。
- 實際守衛犬攔截、沒有蛋、注入交易失敗不開成功視窗。
- 注入彈窗 DOM 建立失敗：保留成功浮字、恢復操作，不重送交易。
- 320×568、375×667、390×844、430×932、768×1024、844×390 排版，無水平溢出，關閉及確定保持可用；CDP 觸控手勢可捲動明細。
- 原有收蛋完成彈窗的單／多雞種、長列表、倉庫不足、失敗、重新整理與場景清理回歸通過。
- 原有商店、清潔、偷蛋許可、怪物戰鬥與每日任務整合回歸通過。
- `git diff --check` 通過。

```bash
node scripts/prepare-game-admin.cjs
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
STEAL_RESULT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
EGG_RESULT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
VISIT_PERMISSION_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
STEAL_SPEED_TESTS=1 OLD_STEAL_RESULT_FIELDS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

## 實際截圖與差異

- [390×844 原偷蛋入口的實際結果](verification/steal-result/gameplay-390.png)
- [320×568 原偷蛋入口的實際結果](verification/steal-result/gameplay-320.png)
- [附件預覽與實際遊戲並排](verification/steal-result/preview-vs-gameplay.png)
- [花花／米粒的來源版型案例](verification/steal-result/source-layout-example.png)：純 UI 驗收資料，沒有真的偷三顆。

木框沿用收蛋視窗的九宮格延伸；總數底板、明細列、插畫及標題圖維持素材比例。容器高度、留白與字型受共用手機版排版影響，沒有宣稱逐像素相同。附件沒有提供字型檔，固定標題使用系統粗體與文字陰影。正常單顆結果的空白較多，多筆明細則使用相同空間捲動。

截圖來自實際 Phaser 場景的隔離交易，不是 HTML 靜態預覽；不是正式玩家資料或手機真機測試。尚未執行 iPhone Safari／Android 真機驗收，沒有部署 Firebase 或變更正式資料。

## 修改檔案

- `farmgame.html`、`css/farm-egg-result.css`
- `js/farm/egg-result-ui.js`：共用結果容器。
- `js/farm/steal-result.js`、`js/farm/steal-result-ui.js`：來源顯示與防重。
- `js/farm/VisitScene.js`：既有成功入口接線與背景預熱。
- `js/farm/poultry.js`：選蛋結果補回傳實際數量，扣蛋規則不變。
- `game-admin/functions/farm-transactions.cjs`：必要的成功結果顯示欄位。
- `game-admin/tests/farm-backend-integration.test.cjs`
- `tests/farm-steal-result.test.mjs`、`tests/farm-private-backend-browser.cjs`
- `assets/farm/steal-result/v1/`：九張 PNG、原 README／manifest。
- 本文件及 `docs/verification/steal-result/` 截圖。

完整啟用需要發布前端並部署 `functions:nexus-ops`，由現有 predeploy 打包新版純模型；不需要部署 Rules、遷移或重設玩家資料。
