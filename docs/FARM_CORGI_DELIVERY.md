# 柯基犬護衛功能交付

> 本文件保留首次上架紀錄。解除護衛已改為 [回倉庫保留時間](FARM_GUARD_DOG_PAUSE.md)。後續減速、坐下與回家睡滿一分鐘已調整，請見 [最新活動規則](FARM_CORGI_ROUTINE.md)。

日期：2026-11-10。

## 設定與既有規則

| 項目 | 設定 |
| --- | --- |
| 商店品種 ID | `corgi`，開放租用 |
| 防偷蛋 | 40%，取樣值 `< 0.4` 時攔截 |
| 日租／週租 | 100／500 金幣 |
| 活動節奏 | 每 30 秒，15 秒繞雞群、15 秒回雞舍與休息 |
| 攔截成功後 | 沿用米格魯：對該雞舍禁偷 2 小時 |
| 圖片 | 16 格透明 atlas；休息、走路、奔跑、警戒；84px 顯示 |

圖片由 image_gen 依使用者參考圖生成並整理進既有 atlas 格式。每格保留完整身體、共同腳底線與透明採樣邊界；不是從原參考圖無損切出的逐像素素材。

沿用現有 `farm.guardDogs`：租後先進倉庫、啟用才開始租期、同品種最多一隻、同時一隻護衛、不可重設租期、到期離場、提前解除不退款。未變動其他犬種價格、開放狀態或防守能力。

租用仍由可信任後端核價、核對玩家／群組並以原子交易扣款與建立租約；保留冪等收據與價格變更拒絕機制。偷蛋攔截沿用既有遊戲交易，沒有擴大重構既有防守架構。柯基使用友善護衛犬避讓，不取消母雞走到雞舍下蛋。

## 主要檔案

- `js/farm/guard-dog-core.js`：柯基設定、共用巡邏階段；保留 `colliePatrolPhase` 相容入口。
- `js/farm/guard-dog-art.js`：依犬種套用巡邏節奏與體型；沿用載入、動畫與清理機制。
- `js/farm/guard-dog-ui.js`：50% 活動說明；後端缺少新商品時明確提示，不允許前端自行租用。
- `js/farm/asset-manifest.js`：柯基 atlas 隨功能需求載入。
- `assets/farm/guard-corgi-sheet.png`、`guard-corgi-sheet.json`：16 格圖集。
- `tests/farm-guard-dog.test.mjs`：價格、倉庫／啟用、40% 邊界、50% 巡邏與到期。
- `tests/farm-predator-atlas.test.cjs`：圖集透明採樣邊界。
- `game-admin/tests/guard-dog-service.test.cjs`：後端核價、重送、唯一性、餘額不足與啟用。
- `tests/farm-guard-dog-browser.cjs`：實際商店／倉庫／農場／拜訪流程，另可設 `CORGI_ONLY=1` 快速驗證新犬種。
- `docs/farm-guard-dogs.md`：補充新犬種規格。

`game-admin/functions/game/` 是部署前產生的共用模型副本，不手動維護、不提交建置產物。營運後台既有犬種列表會從後端 catalogue 自動帶出柯基，無需增加新集合或遷移玩家資料。未修改正式 Rules 或既有玩家存檔。

## 驗證

- 模型、圖集與護衛 API：24/24 通過。
- `npm --prefix game-admin/functions test`：38/38 通過（與前項 API 測試有重疊，不相加為獨立案例數）。
- 下蛋流程回歸：9/9 通過。
- 柯基專項瀏覽器：租用 100／500、啟用、巡邏、自然走回雞舍休息、雞隻避讓、40%／2h 邊界與到期通過。
- 舊犬種完整瀏覽器回歸通過，包含大白熊、米格魯、邊牧、動態營運調價及新增柯基流程；柯基專項另確認自然返程後進入閉眼睡眠格。
- `git diff --check` 通過。

瀏覽器使用真正 Phaser、隔離 Firebase 與可信任 API 服務測試替身，不讀寫正式玩家資料。租期時鐘固定以驗證精確到期時間；柯基移動測試另給 tween manager 單調時鐘，避免測試的固定 Date.now 凍結動畫。遊戲本身不需要修改時鐘。

## 正式上線必要步驟

本次沒有推送、沒有部署。必須先推送程式，再在有 Firebase 權限的環境執行：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

部署前命令會自動執行共用模型打包。只更新 GitHub 前端而不部署 Functions，舊後端不會接受柯基租用；前端會提示「護衛犬商品尚未同步至伺服器」。部署後再確認正式商店日／週租價格、租約進倉庫、啟用及防守通知。

正式 Firebase 實測、iPhone／iPad 真機驗收仍待執行，隔離瀏覽器測試不能代替這些驗收。


## 實際畫面

- [商店柯基商品](images/farm-corgi/shop.webp)
- [手機租用視窗](images/farm-corgi/rental-mobile.webp)
- [桌面租用視窗](images/farm-corgi/rental-desktop.webp)
- [雞群旁巡邏](images/farm-corgi/patrol.webp)
- [返回雞舍旁睡覺](images/farm-corgi/sleep.webp)

以上均為隔離測試畫面，使用測試帳號、餘額與租約；不是正式玩家資料。
