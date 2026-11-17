# 公開村落返回時 entries 錯誤修正

## 已重現的原因

使用真正 Phaser 3.60.0、遊戲 HTML、場景與既有後端服務，Firebase SDK／資料皆隔離。透過 HUD 村落入口 → 公開村落 → 他人雞舍 → 溜走 → 返回自家，在自家選用已快取的富士山場景時重現：

```
TypeError: Cannot read properties of undefined (reading 'entries')
  Phaser.GameObjects.Group.getChildren
  reflowFarm (js/farm/scenery.js)
  resize → show → syncTheme → addFarmBackground
  MyFarmScene.create
```

Phaser 重啟場景會沿用 Scene 物件，舊 `rubbishGroup` 屬性仍存在，但 Group.destroy 已清除其 children。背景同步使用已快取的富士山素材時會立即重新排版，早於 create 重新建立垃圾群組，因此 `rubbishGroup?.getChildren()` 的 optional chaining 無法保護已銷毀群組的內部 children。

## 修正範圍

`js/farm/scenery.js` 的 reflowFarm：垃圾群組必須仍屬於目前場景且有有效 children 才讀取；同時跳過已銷毀的雞舍、母雞與怪物，避免重新排版操作上一輪物件。保留存活群組的尺寸／場景切換排版。

不更動偷蛋、收蛋、清潔、戰鬥判定、排行榜、後端與 Firebase Rules。

## 驗證

在 Chromium 手機尺寸、實際原入口操作，使用既有 MemoryDB 與 createService 隔離交易驗證，無正式 Firebase 讀寫。

```bash
python3 -m http.server 8032 --bind 127.0.0.1
# 另一終端機，工作目錄是 repository root：
VISIT_RETURN_TESTS=1 node tests/farm-private-backend-browser.cjs
VISIT_RETURN_TESTS=1 VISIT_RETURN_THEME=default node tests/farm-private-backend-browser.cjs
node --test tests/farm-scene-cleanup.test.mjs
```

- 修正前：原入口操作重現上述完整錯誤堆疊，Phaser 遊戲迴圈中止。
- 修正後：初始／富士山兩種自家場景各三輪（B → C → B）拜訪及返回成功；C 使用富士山素材。
- 每輪檢查遊戲 frame 持續增加、無 pageerror，切換 390×844 與 430×932 後目前垃圾群組與母雞仍存活，物件座標有效。
- 無額外收蛋、偷蛋、打掃交易；沿用原本進場驗證。
- 場景清理測試通過：20 輪 shutdown/restart 不累積清理掛鉤，destroy 清理只執行一次。
- 截圖：`/tmp/gugu-visit-return-fuji-390.png`、`/tmp/gugu-visit-return-default-390.png`。

未驗證實體 iPhone/Safari；正式環境更新前端後仍須確認。此修正不需要部署 Functions。
