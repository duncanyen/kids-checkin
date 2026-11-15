# 咕咕村落收蛋完成彈窗 V1.0 驗收紀錄

本次只整合前端收蛋結果呈現，沒有修改 Cloud Functions、Firebase Rules、資料結構、雞種產蛋規則、獎勵或每日任務計數方式。

## 程式與資料流程

- `js/farm/MyFarmScene.js`：在原有 `homeEncounter({collectWhenClear:true})` 或舊版相容 `collectEggs` 交易成功後，開啟結果彈窗。原本的防連點鎖及處理中提示保留；結果尚未關閉時也不能重送收蛋。
- `js/farm/egg-result.js`：將既有 `total`、`collected`、`remaining` 整理為唯讀顯示資料。雞種 ID、名稱沿用 `BREEDS`；零收穫品種不顯示，總數不一致時拒絕建立成功明細。
- `js/farm/egg-result-ui.js`：圖片預熱、DOM 面板、焦點管理、明細捲動、關閉及 shutdown/destroy 清理。沒有資料庫寫入、任務更新、重新初始化場景或重新收蛋。
- `css/farm-egg-result.css`：圖片排版、safe area、九宮格木框、短暫進場動畫、按壓縮小、減少動態效果設定。
- `js/farm/mail-ui.js`：收蛋處理中或結果視窗開啟時，延後原有自動公告，避免兩個視窗重疊。
- `farmgame.html`：加入結果視窗樣式。
- `tests/farm-egg-result.test.mjs`：顯示資料格式與一致性測試。
- `tests/farm-private-backend-browser.cjs`：延伸真實 Phaser 與隔離後端整合驗收。

交易仍由原後端原子更新雞舍待收蛋、倉庫及有效收蛋事件；一次收多顆仍是一筆收蛋事件。結果視窗不建立第二套計數器、餘額、收據或收蛋資料。沒有額外 Firebase 查詢或 Listener。

若成功交易後圖片或 DOM 失敗，恢復輸入並退回原有文字收穫提示；不重送交易，也不將已成功收蛋提示為交易失敗。若只收取部分雞蛋，面板顯示實際入庫總數，並另提示尚留雞舍的數量。

## 素材對照

素材原樣取自 `GuguVillage_EggResult_Assets_V1.zip`，置於 `assets/farm/egg-result/v1/`；保留原 README 與 manifest。12 張 PNG 均驗證為 RGBA，具有 0–255 Alpha。沒有另畫圖示或以 Emoji 代替。

| PNG | 用途 |
| --- | --- |
| `egg_result_panel.png` | 主面板，以九宮格延伸空白內頁、保留邊框厚度與四角 |
| `egg_result_title.png` | 收蛋完成標題與母雞裝飾 |
| `egg_result_close.png` | 圓形關閉按鈕 |
| `egg_result_illustration.png` | 母雞與蛋籃插畫 |
| `egg_result_total_banner.png` | 總數資訊欄，文字及金色數字由 DOM 疊加 |
| `egg_result_section_title.png` | 本次收穫標題 |
| `egg_result_row.png` | 無圖示、無固定文字的明細列 |
| `egg_result_storage_banner.png` | 成功提交後的已入庫提示 |
| `egg_result_confirm.png` | 確定按鈕 |
| `egg_result_decoration.png` | 保留原素材，本版不額外疊加，主面板已有草叢 |
| `egg_result_decoration_right.png` | 同上 |
| `egg_result_eggs_icon.png` | 保留原素材，本版不額外疊加；總數底板已有雞蛋插圖 |

## 測試結果

322 項現有及新增 Node 測試通過：

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
```

在本機 HTTP server 上，使用專案真正的 Phaser 3.60.0、真正的前端場景及後端服務，搭配隔離 MemoryDB／SDK 執行；沒有連接正式 Firebase，也沒有使用靜態 HTML 取代遊戲驗收：

```bash
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
LEGACY_HARVEST_BACKEND=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
EGG_RESULT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

上述三種模式通過：

- 單獨烏骨雞蛋、單獨布雷斯雞蛋、混合三種雞蛋、單顆、120 顆及四種雞蛋。
- 四種明細只讓列表捲動，並以 Chromium touch event 實際驗證手勢捲動。
- 交易等待中連點、彈窗開啟時重複呼叫、連點確定、右上角關閉；沒有重複收蛋或加庫存。
- 無蛋不開成功視窗；注入後端交易失敗時資料不變、不開成功視窗。
- 注入「交易成功後 DOM 建立失敗」，只出文字備援、恢復輸入，交易沒有重送。
- 倉庫只剩一格、雞舍有兩顆時，只顯示一顆已收取，另一顆保留並提示。
- 重新整理後由隔離存檔恢復正確庫存，沒有自動重開上次結果。
- 場景離開時移除彈窗並清理事件；關閉沒有重建 Phaser 場景。
- 原有後端每日任務事件仍正確累計且遵守上限；原有商店、拜訪、偷蛋、清潔及戰鬥整合測試保留通過。
- 320×568、375×667、390×844、430×932、360×800、768×1024、844×390 檢查面板與確定按鈕未出界，沒有水平捲軸。
- `git diff --check` 通過。

## 執行畫面與視覺限制

- [390×844 實際遊戲截圖](verification/egg-result/mobile-390.png)
- [320×568 實際遊戲截圖](verification/egg-result/mobile-320.png)
- [提供的素材與實際遊戲並排](verification/egg-result/assets-vs-gameplay.png)

截圖來自真實 Phaser 場景中的隔離測試交易，畫面中的名稱、庫存及金幣是測試帳號資料，不是正式玩家資料。

依訊息中的完成畫面參考檢查：標題、圓形關閉、母雞插畫、總數欄、純文字明細、倉庫卷軸及綠色確定按鈕均已對應；沒有加入時間區塊、額外明細圖示或裝飾。原主場景保持不變，只加暗色遮罩。

不是逐像素還原：素材包主面板的原比例與直式完成畫面不同，使用九宮格延伸；內容內距、文字字型與行高以可用手機空間配置。素材保留原始柔光及細小邊緣筆觸，沒有自行重畫修補。並排圖比較的是 ZIP 內素材總覽與執行結果；完成畫面原圖只存在訊息內，沒有宣稱進行該圖的逐像素差異分析。

本次是 Chromium 的尺寸及觸控模擬驗收，不能等同 iPhone Safari、Android 或 iPad 真機驗收。正式 Firebase 與真機確認仍待前端發布後執行。本次不需要部署 Functions 或 Rules，也沒有執行正式部署。
