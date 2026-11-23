# 北極極光農莊上架

新增場景 ID `arctic`，名稱「北極極光農莊」，售價 500,000 金幣，開放購買。富士山農莊仍然尚未開賣。

## 玩家流程

商店 → 場景 → 北極極光農莊 → 確認購買。購買後永久收藏於目前群組的玩家農場，不占倉庫容量，不會自動更換目前場景。玩家可在倉庫「場景」查看收藏，再從自家右上角設定 → 更換場景 → 使用此場景免費切換。重新進入保留選擇；拜訪他人時顯示對方設定，返回自家恢復自己的場景。

價格、餘額與所有權沿用 `buyScene` 後端交易，`setScene` 驗證已擁有。請求防連點、交易收據及戰鬥閘門沿用現有流程，不新增前端發幣或直接寫入。不能透過客戶端修改價格，重試同一收據不會再次扣款。

## 美術與載入

assets/farm/scenes 新增：

- arctic-aurora-v1-portrait.webp：720×1280，約 303 KiB。
- arctic-aurora-v1-landscape.webp：2172×724，約 518 KiB。
- arctic-aurora-v1-thumb.webp：240×427，約 31 KiB。

商店及倉庫只需縮圖；完整直橫底圖待切換時載入。設定先準備兩個方向，再儲存選擇。圖片失敗時保留原選擇與重試。公共素材版本清單已更新，既有未變更圖片繼續重用快取。

雪屋雞蛋與等級標示調整至直式實際入口，沿用既有菜園 42 個互動位置與母雞活動區；橫向使用對應全景，保持圖片比例。

## 修改位置

- js/farm/farm-scenes-core.js：新場景、售價與所有權共用模型；predeploy 會由 scripts/prepare-game-admin.cjs 複製給 Functions。
- js/farm/asset-manifest.js：圖片鍵及延後載入清單。
- js/farm/scenery.js：雪屋入口標示及雞蛋錨點。
- js/farm/farm-scene-ui.js：設定頁引導文字。
- assets/farm/cache-manifest.json、js/farm/art-cache-revision.js：公共美術快取版本。
- game-admin/tests/farm-transactions.test.cjs：後端購買、價格偽造、餘額、收據重播、所有權、免費切換。
- tests/farm-art-cache.test.cjs、farm-laying-visit.test.mjs：縮圖／延後載入及雪屋入口座標。
- tests/helpers/arctic-scene-browser.cjs、farm-private-backend-browser.cjs：實際遊戲入口隔離驗證。
- scripts/test-private-farm.cjs：新增 ARCTIC_SCENE_TESTS 驗證步驟。

## 驗證結果

- 全套單元測試 443/443 通過；另補上的雪屋入口座標檢查所在檔案 11/11 通過。
- ARCTIC_SCENE_TESTS：實際 HUD 商店 → 場景 → 購買 → 倉庫 → 設定 → 切換 → 重新整理 → 拜訪與返回，全部通過。
- 金幣不足無扣款；600,000 購買後剩 100,000；快速兩次確認只有一筆購買請求；已擁有不能再次購買。
- 模擬圖片 HTTP 503 時不送出選擇儲存，舊場景保留；重試成功。
- 商店／倉庫未請求完整北極底圖；菜園仍有 42 個位置。
- 320×568、390×844、430×932、768×1024、1024×768 無水平溢出。截圖為本機 Chromium、實際 Phaser、隔離後端服務與 SDK，不連正式玩家資料；未以實體手機驗證。
- 原富士山場景測試通過：維持禁止購買、既有持有人可使用、免費切換、重新進入與多尺寸相容。
- 本次未執行 Firebase Emulator；目前環境既有 Emulator JAR 下載有 HTTP 403 限制，未宣稱通過。

截圖及記錄：verification/arctic-scene/。

## 上線

需更新 GitHub Pages 前端與 `functions:nexus-ops:gameOpsFarmTransaction`。後端部署必須包含 predeploy 複製的新場景共用模型，否則舊後端尚未認識 `arctic` 會拒絕購買。無須部署 Rules 或遷移資料。未自動提交、推送或部署正式環境。
