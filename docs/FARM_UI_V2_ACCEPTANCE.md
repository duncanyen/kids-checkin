# 咕咕村落 HUD V2 整合與驗收

> 以下保留 V2 初次整合結果。後續右框、通知圖片及底部 80% 縮放已調整，請見 [HUD 修正紀錄](FARM_UI_HUD_REPAIRS.md)。

日期：2026-11-10。範圍：僅 HUD 圖片、動態文字排版與透明點擊區，不變更遊戲規則、Firebase、場景原始碼或場景物件配置。

## 結果

13 個 HUD 元件均已對應。第一階段的左側三張圖與設定圖保持原檔、相同引用及顯示樣式；已比對四檔 SHA-256。V2 六張圖片直接複製，逐檔位元組比對與封包一致，沒有重新繪製、調色或自行修補。

已閱讀 V2 `README.txt` 與 `manifest.json`。依其指示，底部使用整張 `bottom_dock_no_badge.png`，不使用 V1 單顆切圖。V2 README 明載素材是修補的近似圖，**本次完成視覺整合，不宣稱逐像素還原**。

## 13 個元件對照

| # | 元件 | 圖片／資料來源 | 本次狀態 |
| --- | --- | --- | --- |
| 1 | 金幣 | V2 `coins_panel_dynamic_base.png`；原 registry `farm.coins` | 已替換，動態更新 |
| 2 | 待採收雞蛋 | V2 `eggs_panel_dynamic_base.png`；原 `poultryState(farm).ready` 各雞種合計 | 已替換，維持所有雞種計數 |
| 3 | 髒亂值 | V2 `cleanliness_panel_dynamic_base.png`；原 `farm.cleanliness`，顯示 `/100` | 已替換 |
| 4 | 設定 | 第一階段 `settings.png` | 保持不變，仍顯示原未開放提示 |
| 5 | 每日任務 | 第一階段 `tasks.png` | 保持不變 |
| 6 | 排行榜 | 第一階段 `trophy.png` 與既有 launcher | 保持不變 |
| 7 | 禮包外觀的活動入口 | 第一階段 `gift.png` | 保持原本「活動尚未開放」行為，沒有擅自變更功能 |
| 8 | 產蛋倒數 | V2 `egg_countdown_dynamic_base.png`；原場景 `timerText.text` | 動態拆成雞種說明與右側時間 |
| 9 | 村落 | V2 整組底圖；`village` 熱區 | 原場景切換事件 |
| 10 | 商店 | 同上；`shop` 熱區 | 原場景切換事件 |
| 11 | 倉庫 | 同上；`warehouse` 熱區 | 原場景切換事件 |
| 12 | 圖鑑 | 同上；`collection` 熱區 | 原未開放提示 |
| 13 | 信箱／通知 | 同上；`mail` 熱區，重用原 launcher、badge | 原通知事件及真實未讀狀態 |

## 資料與互動保留方式

- 三個資源欄保留原 registry 監聽與資料轉換。連線尚未確認時仍顯示 `—`，不使用圖片上的示範數值；較長數值依空白區寬度縮小字體。
- 倒數不另呼叫產蛋公式、不另建時鐘、不推算下一顆蛋，直接讀取既有場景已產生的字串。`123:00:09` 等長時數亦可拆分。
- 滿產、沒有雞、生病、存檔未確認及讀取提示保持原字串，非倒數提示可換行。
- HUD 圖片載入成功時，僅在顯示層收起原 Phaser 倒數文字／底框，避免重複顯示；不更動其 `active`、tick 或產蛋流程。圖片不可用或離開頁面時恢復原顯示屬性。
- 點擊新倒數欄會在原輸入啟用條件下轉交既有 `pointerdown`，保留存檔重試入口。
- 沿用同一個通知按鈕及 badge，沒有新建通知查詢。badge 的文字計數與 `hidden` 仍由 `mail-ui.js` 控制，只更換背景為 `mail_unread_badge.png`。
- 側邊與底部仍只在自家出現；怪物準備、戰鬥及尚未完成結算期間保持隱藏。
- 不新增 Firebase Listener；DOM 圖片不納入 Phaser preload，也沒有等待圖片才啟動遊戲的阻塞流程。新增排版使用既有 ResizeObserver，Game destroy 仍統一清理。

## 底座點擊區與比例

原圖 1495 × 356。熱區由 `js/farm/hud-layout.js` 保存，測試直接讀取交付的 V2 manifest 比對，避免座標兩邊漂移。

| 熱區 | x | y | 寬 | 高 |
| --- | ---: | ---: | ---: | ---: |
| village | 145 | 43 | 248 | 238 |
| shop | 392 | 43 | 247 | 238 |
| warehouse | 645 | 43 | 245 | 238 |
| collection | 898 | 43 | 240 | 238 |
| mail | 1148 | 43 | 236 | 238 |

每顆以 `left=x/1495`、`top=y/356`、`width=w/1495`、`height=h/356` 百分比定位。底圖固定原始比例，隨安全區及視窗一起縮放；不拉伸個別圖示。整圖兩端底座、固定件及綠葉均保留。桌面寬度上限 620px，矮橫向螢幕上限 360px，避免遮擋過多場景。

## 測試與截圖

使用本機 HTTP Server、系統 Chromium、真正 Phaser 與隔離 Firebase fixtures。沒有讀寫正式玩家資料。

| 檢查 | 結果 |
| --- | --- |
| V2 manifest 與程式座標一致 | PASS |
| 各雞種／長時數／例外提示解析 | PASS |
| 全部 13 個 DOM 元件對應、圖片成功載入、沒有 HUD SVG | PASS |
| 五個熱區位置、尺寸、互不重疊、至少 44px 觸控範圍 | PASS |
| 村落／商店／倉庫進入及原返回鍵 | PASS |
| 任務／活動／圖鑑／設定未開放提示 | PASS |
| 排行榜開啟、通知讀取／獎勵／重試／刪除／群組隔離 | PASS |
| badge 有未讀顯示、歸零隱藏，再有新通知恢復 | PASS |
| 原產蛋文字鏡射、存檔重試事件 | PASS |
| 四雞種待採收數量合計、金幣／髒亂值動態更新 | PASS |
| 987,654,321 金幣在各版型完整顯示 | PASS |
| 怪物、結算重試、拜訪他人時隱藏導覽 | PASS |
| 原四張圖片 SHA-256 不變、V2 六張圖片逐檔一致 | PASS |
| 20 輪場景進出：registry 監聽數 3、Firebase Listener 1，原精靈及 timer 重用；destroy 清理 | PASS |
| 慢速載入／離線／重連／部分存檔保護 | PASS |

版型：320 × 740、390 × 844、844 × 390、1440 × 900。自動檢查資源欄互不重疊、倒數在資源欄下方且避開左側圖示、文字未溢出、底座在畫布內，以及頁面沒有橫向溢出。已檢視手機截圖及並排圖，沒有發現 HUD 互相覆蓋或錯位。

指令：先在專案根目錄啟動 `python -m http.server 8030 --bind 127.0.0.1`，再執行：

```bash
node --test tests/farm-hud-layout.test.mjs tests/farm-hud-encounter.test.mjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-save-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-performance.cjs
git diff --check
```

上述瀏覽器測試需要 Playwright、`/usr/bin/chromium` 與現有測試使用的 `/tmp/kids-phaser.js`。未宣稱 iPhone／iPad 真機效能或正式 Firebase 已驗收；生命週期測試亦不代表裝置流暢度驗收。

### 畫面

- [390px 手機](images/farm-ui-v2/game-390.webp)
- [320px 手機](images/farm-ui-v2/game-320.webp)
- [844px 橫向](images/farm-ui-v2/game-844.webp)
- [1440px 桌面](images/farm-ui-v2/game-1440.webp)
- [原參考元件表與新畫面並排](images/farm-ui-v2/comparison.webp)

並排圖左側為先前封包提供的 `full_sprite_sheet.png`，右側為實際 Phaser 手機截圖。封包沒有完整手機場景參考圖，因此不能據此宣稱整個場景位置逐像素吻合。餘額與時間是隔離 fixture 的實際動態畫面，刻意不照抄參考示範值。

## 仍存在的素材差異

1. 資源底牌仍可見塗抹木紋；雞蛋與髒亂值切圖帶有鄰接邊緣或邊框裁切痕跡。本次依指示使用 V2 原檔，未自行補畫。
2. 倒數底牌文字區有模糊修補與下緣淡色殘痕；吊繩附近可見透明邊緣雜點。
3. 信箱右上角移除固定紅點後留下淺色補丁與輪廓缺口；真實未讀為零時補丁會直接露出，並不是仍有固定通知紅點。見[原素材補色區](images/farm-ui-v2/mailbox-source-repair.webp)。
4. 獨立紅點含有少量原按鈕邊框片段，未讀時會跟著顯示。圖片尺寸與位置依底座比例縮放，但無法消除素材本身的殘片。
5. 整張底座圖的透明邊緣仍有少量紅／深色雜點。
6. 動態文字沿用現有合法系統字體；不同裝置字形可能與參考插畫字型不同。為保持可讀及不溢出，長金額、較長雞種會依空間縮字，並非固定像素字樣。

這些屬於 V2 提供素材的限制。要消除瑕疵需要更乾淨的原稿；本次未用 CSS 漸層、通用 Icon、Emoji 或重新生成圖片掩飾差異。

## 本次檔案

程式：

- `js/farm/hud-ui.js`：接入底板、動態字串、原事件與既有 badge；HUD 顯示生命週期。
- `js/farm/hud-layout.js`：manifest 座標、百分比定位及原字串拆分。
- `css/farm-hud.css`：V2 底板／整組底座／紅點／倒數的排版與透明熱區。

測試：

- `tests/helpers/farm-hud-checks.cjs`：13 元件、圖片、事件、動態資料、幾何與響應式驗證。
- `tests/farm-hud-layout.test.mjs`：manifest 及倒數字串相容性。
- `tests/farm-save-browser.cjs`：資源圖由 SVG 改為 PNG 的斷言調整，原存檔案例不變。

素材／文件：

- `assets/farm/reference-ui/v2/`：六張圖片及原 `manifest.json`、`README.txt`。
- `assets/farm/reference-ui/README.md`：補上第二階段文件連結。
- `docs/FARM_UI_REFERENCE_RESTORATION.md`：保留第一階段紀錄，補上本次連結。
- `docs/FARM_UI_V2_ACCEPTANCE.md`：本文件。
- `docs/images/farm-ui-v2/`：四種尺寸、並排圖與原素材瑕疵截圖。

第一階段四張 PNG 未變更。`MyFarmScene.js` 及其他 Phaser 場景、Firebase、Rules、遊戲資料模型沒有修改。工作區原有平台盤點文件未修改。本次沒有部署或推送 GitHub。
