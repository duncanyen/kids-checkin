# 哈修塔特湖農莊 V2 上架

場景 ID `hallstatt`，售價 500,000 金幣，開放購買。使用原遊戲風格融合版 V2，並保留富士山尚未開賣、北極極光可購買的設定。

流程：商店 → 場景 → 下一頁 → 哈修塔特湖農莊 → 確認購買。購買後永久收藏於目前群組的玩家農場，不占倉庫空間，不自動切換。玩家在右上角設定 → 更換場景中選擇使用，亦能切回初始或其他已擁有場景。

## 修改

- assets/farm/scenes/hallstatt-v2-portrait.webp：720×1280。
- assets/farm/scenes/hallstatt-v2-landscape.webp：2172×724。
- assets/farm/scenes/hallstatt-v2-thumb.webp：240×427。
- js/farm/farm-scenes-core.js：前後端共用場景、價格、所有權模型。
- js/farm/asset-manifest.js：縮圖與兩種方向完整圖片鍵；完整圖片延至切換才載入。
- js/farm/scenery.js：專屬直橫向座標映射、80% 雞舍互動寬度、雞舍中心與入口錨點、菜園及活動區對齊。既有菜園 42 個邏輯位置保留，方向及場景切換可逆轉換。
- js/farm/ShopScene.js：場景每頁兩款，避免新增第三款時卡片重疊；其他商品分類仍每頁六項。
- assets/farm/cache-manifest.json、js/farm/art-cache-revision.js：公共圖片內容版本更新。
- scripts/test-private-farm.cjs：加入 HALLSTATT_SCENE_TESTS。

不變更戰鬥、產蛋、偷蛋、排行、獎勵、Rules 或玩家資料結構。購買與設定繼續走既有 buyScene／setScene 後端交易與防重收據。Functions predeploy 透過 scripts/prepare-game-admin.cjs 複製新的共用模型。

## 驗證

本機 Chromium、Phaser 3.60.0、隔離 SDK 及真實後端服務邏輯；未使用正式玩家資料。

- 全套單元測試 447/447 通過；最後微調全景映射後，產蛋／座標測試檔 12/12 通過。
- 商店場景頁正確顯示 1/2、2/2；第二頁只有哈修塔特卡片，售價 500,000。
- 餘額不足拒絕；600,000 購買後剩 100,000；快速兩次確認只有一次請求；已擁有禁止再次購買。後端忽略偽造價格，收據重試不重複扣款。
- 倉庫收藏正確，瀏覽商店／倉庫只請求縮圖。圖片 HTTP 503 不儲存新選擇，重試後成功。
- 實際點雞舍屋頂開啟清潔確認後取消，沒有清潔交易；實際點首格、末格菜園各觸發一次既有搜尋。
- 320×568、390×844、430×932、768×1024、1024×768 切換與排版正常；湖景與主要湖畔房屋在資源列下方可見，無水平溢出。
- 切換免費、重新整理保留，拜訪他人顯示對方場景，離開回自家恢復自己的選擇。
- 北極極光既有購買／收藏／切換流程回歸通過。

直式及全景以可逆映射保留菜園身分；各尺寸亦驗證雪屋以外的新雞舍入口位於互動區內、活動區有正高度與足夠空間。實體 iPhone 與正式網路尚未驗證；本次沒有執行 Emulator，未聲稱規則或 callable Emulator 通過。

## 上線

需推送前端並部署 `functions:nexus-ops:gameOpsFarmTransaction`，後端才能接受 `hallstatt` 購買。無須部署 Rules 或遷移資料。未自動提交、推送或部署。
