# 底部導覽按鈕互動修正

日期：2026-11-10。

## 行為

- 初始進入自家畫面，村落按鈕不再因 `aria-current="page"` 自動出現選取框。保留該屬性的導覽語意，外觀只由實際操作狀態控制。
- 按下按鈕，實際圖片縮至 0.95；放開依既有彈性曲線恢復原尺寸，成功點選時顯示亮框。
- 點選其他按鈕時切換選取；離開／返回自家及遇到怪物時清除選取。通知視窗關閉時清除通知按鈕亮框。
- 鍵盤 `focus-visible` 仍保留可辨識的焦點框；減少動態效果偏好會停用回彈動畫。
- 固定原透明熱區，僅縮放圖像，避免邊緣點擊在縮放途中失效。

## 圖片顯示方式

原本整排五個按鈕烙印在共用底圖，對透明按鈕套 transform 並不會縮小圖案。本次沿用相同 PNG 與 manifest：

1. SVG 僅作底座圖片遮罩，移除重複的五塊按鈕像素；不是新的 SVG 圖示。
2. 四個原按鈕以同張 PNG 的 background viewport 顯示對應區域；通知繼續用先前完整修補圖。
3. 縮放露出的承座使用同張 PNG 的下方木板區域，不使用 CSS 漸層重畫木牌。

沒有修改任何圖片檔案、按鈕入口、資料綁定、怪物隱藏規則、Firebase 或 Phaser 場景。

## 檔案

- `js/farm/hud-layout.js`：共用素材裁切比例、底座遮罩。
- `js/farm/hud-ui.js`：圖片分層、實際點選與清除狀態。
- `css/farm-hud.css`：按下縮放、回彈及選取亮框，取消依 aria-current 常亮。
- `tests/helpers/farm-hud-checks.cjs`：初始無選取、圖片實際縮放、固定熱區、放開回彈、返回後清除選取及既有操作回歸。

## 驗證

- `node --test tests/farm-hud-layout.test.mjs tests/farm-hud-encounter.test.mjs`：5/5 通過。
- `FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs`：HUD、通知與排行榜回歸通過。
- 四種版型、原 80% 導覽尺寸、50% 倒數及吊繩接點維持正常。
- 實際圖片 bounding box：按下寬度／原寬度約 0.95，放開回復約 1；按鈕熱區寬度不變。
- `git diff --check` 通過。使用隔離資料與實際 Phaser；尚未進行 iPhone／iPad 真機驗收，沒有部署或推送。

[初始無選取](images/farm-ui-button-states/initial.webp) · [按壓](images/farm-ui-button-states/pressed.webp) · [放開後選取](images/farm-ui-button-states/selected.webp) · [狀態比對](images/farm-ui-button-states/comparison.webp)
