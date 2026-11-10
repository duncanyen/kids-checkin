# 咕咕村落 HUD 邊框、通知與縮放修正

日期：2026-11-10。

## 修正內容

1. 雞蛋資訊欄：原 V2 PNG 右側被裁掉，改用完整透明木牌，補齊右外框、內框及鉚釘。數量綁定不變。
2. 清潔資訊欄：同樣換成完整圖片，保留掃把及吊繩，清潔數值綁定不變。
3. 通知按鈕：使用 image_gen 重新生成獨立完整木牌與信封，不再讓 V2 補色缺口直接露出。覆蓋原通知按鈕範圍，保留原通知 DOM、事件及獨立未讀 badge；未讀歸零時能看到完整右上框線。
4. 底部五個按鈕：整個容器以 `translateX(-50%) scale(.8)`、底部中央為基準等比縮小，包含共用底座、五個透明熱區及通知紅點。原 manifest 座標保持不變，其他 UI 不縮小。

圖片為生成式修補，木紋、信封角度與細部筆觸有差異，不是逐像素回復。為保留其他四顆底部按鈕與裝飾，沒有使用重新生成的整條底座取代原底座。

## 檔案

- `assets/farm/reference-ui/repairs/{eggs-panel,cleanliness-panel,mail-button}.png`：三張修補圖。
- `assets/farm/reference-ui/repairs/README.md`：圖片來源與裁切紀錄。
- `js/farm/hud-ui.js`：兩個資訊欄改用修補圖，通知原熱區增加完整圖。
- `css/farm-hud.css`：整組 80% 縮放及通知新圖定位。
- `tests/helpers/farm-hud-checks.cjs`：驗證新增圖片、80% 縮放及縮放後熱區。
- `tests/farm-mail-browser.cjs`：透過實際已讀流程驗證紅點消失，擷取無紅點狀態。
- `docs/images/farm-ui-repairs/`：本次實際畫面與前後比對。

## 驗證

- `node --test tests/farm-hud-layout.test.mjs tests/farm-hud-encounter.test.mjs`：5/5 通過。
- `FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-mail-browser.cjs`：完整通過，涵蓋 HUD 版面與操作、通知、獎勵、重試、排行榜及群組隔離。
- `git diff --check`：通過。
- 320 × 740、390 × 844、844 × 390、1440 × 900：驗證縮放係數為 0.8；透明熱區仍對應 manifest、彼此不重疊，數值與倒數不溢出，怪物／拜訪情境仍隱藏導覽。
- 已實際檢視 390px 畫面及未讀歸零畫面：兩個資訊欄右邊框完整，通知沒有舊補色缺口。
- 底部熱區跟隨視覺一起縮小：320px 畫面最窄按鈕約 38.4px，與先前原尺寸驗收的 44px 下限不同。測試依本次指定 80% 調整，沒有用擴大熱區造成相鄰按鈕重疊。側邊按鈕原觸控範圍不變。

測試使用真正 Phaser 與隔離 Firebase fixtures，不代表 iPhone／iPad 真機驗收。沒有修改 Firebase、遊戲規則或 Phaser 場景原始碼；沒有部署或推送。

## 截圖

- [390px 手機](images/farm-ui-repairs/game-390.webp)
- [320px 手機](images/farm-ui-repairs/game-320.webp)
- [通知已讀、紅點隱藏](images/farm-ui-repairs/mail-no-badge.webp)
- [修正前後並排](images/farm-ui-repairs/before-after.webp)

前後截圖的雞隻、餘額與倒數可能不同，均為實際隔離測試畫面；僅比較本次 HUD 區域。
