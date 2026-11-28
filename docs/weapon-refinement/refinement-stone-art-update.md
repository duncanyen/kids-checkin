# 精煉石圖示替換（2026-11-27）

依使用者提供的深藍晶體、青色發光紋路圖片去背後，替換 Phase 4 的 TEST 暫圖。本次僅調整美術資產與圖示引用，不啟用材料來源、不改獎勵／交易邏輯、不進 Phase 5，未提交、推送或部署。

## 資產與顯示

- 新增 `assets/farm/refinement/v1/refinement_stone.png`：256×256 RGBA、透明背景，縮小保留完整晶體，四周16px安全留白。PNG約85KiB。
- 遊戲沿用原有倉庫45px圖示槽，實際晶體約40px高，與其他物品一致；開箱獎勵沿用既有圖示槽與等比例顯示。
- 移除未使用的 `assets/farm/refinement/test/refinement_stone.svg`，新圖無 TEST 字樣。
- 更新共用材料模型為 texture=`refinement_stone`、image=`refinement/v1/refinement_stone.png`、temporaryArt=false。
- 倉庫沿用共用模型按需載入，不將新圖加入首頁共同預載；有庫存才顯示。
- 開箱結果以物品 ID `refinement_stone` 優先選共用圖片，即使舊結果的 icon 欄位仍是 `refinement_stone_test`，也會顯示新圖。
- 後端新開箱結果的圖示鍵改為 `refinement_stone`，僅顯示中繼資料，不改獎勵量、版本、收據或扣箱交易。
- 使用既有工具重建資產 manifest／revision，後端打包純模型同步新圖片設定。

## 檔案

`js/farm/refinement-material.js`、`js/farm/asset-manifest.js`、`js/farm/chest-ui.js`、`game-admin/functions/chests.cjs`、`tests/helpers/stone-rewards-browser.cjs`、PNG資產、`assets/farm/cache-manifest.json`、`js/farm/art-cache-revision.js`。

此前 Phase 4 報告及證據是替換前的歷史紀錄，其 TEST 圖與來源雜湊保留原樣；本次素材與截圖以本文件及下列新證據為準。換圖不代表前階段的 Emulator／正式 Rules 驗收已補完。

## 驗證

- `node scripts/build-farm-art-cache.cjs`、`node scripts/prepare-game-admin.cjs` 通過。
- `node --test game-admin/tests/refinement-stone-rewards.test.cjs game-admin/tests/chests.test.cjs tests/farm-art-cache.test.cjs`：39／39通過。
- `STONE_REWARD_TESTS=1` 既有瀏覽器測試：真 Phaser、遊戲原本每日任務及倉庫入口，320×568與390×844通過，無水平溢出，材料不可裝備／丟棄。
- PNG檢查為256×256 RGBA，四條外邊界全透明；目視檢查手機實際截圖，無白底、黑塊、白框或 TEST 標記。
- 四個正式開關仍為 false；未操作正式 Firebase 資料。

[390px截圖](evidence/refinement-stone-art-2026-11-27/warehouse-390.png) · [320px截圖](evidence/refinement-stone-art-2026-11-27/warehouse-320.png) · [測試日誌](evidence/refinement-stone-art-2026-11-27/tests.log) · [瀏覽器日誌](evidence/refinement-stone-art-2026-11-27/browser.log)
