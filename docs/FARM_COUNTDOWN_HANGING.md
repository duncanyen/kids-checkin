# 產蛋資訊木牌 50% 與吊繩定位

日期：2026-11-10。

- 木牌、雞頭圖示、兩條吊繩及動態文字一起縮至修改前的 50%，不重新繪製圖片。
- 水平位置依雞蛋與清潔資訊欄的中心定位，使左繩對應雞蛋資訊框、右繩對應清潔資訊框。
- 垂直位置取兩個圖片實際框線的下緣，排除透明留白；繩頭輕微重疊框線不到 2px，讓接點連續。
- 原木牌圖片為 897 × 235：繩心 x=218/722，繩頂 y=15。雞蛋與清潔修補圖的框線下緣約在圖片高度 95.4%／95.0%；未來替換這些圖時需重新校準。
- 沿用既有 ResizeObserver，直向、橫向及桌面會重新定位；產蛋字串、倒數、存檔重試與遊戲規則不變。

## 檔案

- `js/farm/hud-ui.js`：依框線與繩頭座標定位。
- `css/farm-hud.css`：木牌統一 50% transform。
- `tests/helpers/farm-hud-checks.cjs`：四種版型檢查縮放與兩條繩的接點位置。

## 驗證

- `node --test tests/farm-hud-layout.test.mjs tests/farm-hud-encounter.test.mjs`：5/5 通過。
- `FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs`：HUD 與通知完整回歸通過。
- 320 × 740、390 × 844、844 × 390、1440 × 900：木牌寬度為原先 50%，繩頭位於各自資源框內且與可見下緣誤差小於 2px；文字未溢出、木牌主體不遮擋資訊欄或左側圖示。
- 已實際檢視手機截圖：吊繩從上方資訊框下緣接出；其他 HUD 圖示尺寸與功能不變。
- `git diff --check` 通過。未修改 Firebase、Phaser 場景原始碼或遊戲規則；未部署、未推送。

[390px 手機](images/farm-ui-countdown/game-390.webp) · [320px 手機](images/farm-ui-countdown/game-320.webp) · [修正前後](images/farm-ui-countdown/before-after.webp)

截圖與測試使用真正 Phaser 及隔離 Firebase fixtures，不代表 iPhone／iPad 真機驗收。動態倒數、雞隻與餘額可能與先前截圖不同。
