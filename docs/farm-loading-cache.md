# 咕咕村落載入與公共素材快取優化

## 原因與修改範圍

同一次 Phaser Game 內，FarmAssetScene 原本已共用 textures，已存在的紋理不會重新下載。舊版的商店、倉庫仍以 ALL_ASSETS 準備素材，首次會連整套怪物動畫一起載入；村落入口則每次不分等待長短，都顯示全畫面載入。

離開遊戲文件或重新整理後，Phaser 必須重新建立解碼後的圖片、紋理及場景。瀏覽器 HTTP 快取僅保存下載內容，並不保存這些執行中物件；先前只有每日任務圖片另有明確的持久快取。最新存檔、村落存取資格及進場怪物也必須查詢，不能用上次畫面取代伺服器驗證。

本次只修改前端載入。Firebase、交易、排行榜、每日任務、資料結構及安全規則均未修改。

## 實作

- assets/farm/cache-manifest.json 與 art-cache-revision.js 記錄 205 個公共圖檔／圖集 JSON 的內容雜湊。只快取實際用到的檔案，不在啟動時預抓整包素材。
- 公共圖片 CacheStorage 與既有每日素材 worker 共用同一個註冊，scope 僅 farmgame.html。HTML、JavaScript、帳號、存檔及 API 不進入圖片快取。各圖獨立版本；更新一張只重抓一張，保留其他快取。
- worker 安裝與引擎、帳號模組並行。啟動只額外等最多 200ms；不支援、被禁止或空間不足時繼續使用一般網路載入。
- ShopScene、WarehouseScene 使用 CATALOG_ASSETS，保留所有商品、母雞、狗與戰利品圖示，移除九種完整怪物動畫及箭矢。VisitScene 仍在伺服器進場判定前準備完整素材，避免怪物計時開始後才等圖片。
- HUD 切頁時，缺圖先在原場景準備，鎖住操作防止重複切頁。約 200ms 尚未完成才使用既有母雞過場，成功後切場景；失敗保留原場景與重試。
- 村落按下雞舍仍立即變色回饋，每次重新驗證權限、存檔與怪物；快速完成不再閃出全畫面遮罩，較慢時顯示母雞及實際驗證進度。

## 檔案

- 前端：farm-daily-sw.js、js/farm/public-art-worker.js、public-art-cache.js、art-cache-revision.js、entry.js、daily-assets-cache.js、asset-manifest.js、assets.js、hud-ui.js、LobbyScene.js。
- 版本產生：scripts/build-farm-art-cache.cjs、assets/farm/cache-manifest.json。
- 驗證：tests/farm-art-cache.test.cjs、farm-public-art-cache-browser.cjs、helpers/farm-navigation-loading.cjs；既有 private-backend-browser 增加 NAVIGATION_LOAD_TESTS，路由模擬測試停用 service worker，真實 worker 另以 HTTP 測試。
- 隔離檢查入口：scripts/test-private-farm.cjs 已納入新測試與每日圖片相容性檢查。

## 實測條件及結果

本機 Chromium、390×844、實際 Phaser 3.60.0、隔離 SDK／交易資料。由自家 HUD、村落列表、公開村落卡片及雞舍點擊操作。對照舊版固定為 ae9a68a；完整原始數據見 verification/farm-loading-cache/{before,after}.json。

| 項目 | 舊版 | 修改後 |
| --- | --- | --- |
| 首次倉庫素材請求（圖＋圖集 JSON） | 58 | 40 |
| 首次倉庫已載入的完整怪物動畫 | 9 種 | 0 種 |
| 暖快取商店／倉庫各進出 3 次 | 0 次額外圖片請求 | 0 次額外圖片請求 |
| 反覆拜訪 5 次的全畫面載入遮罩 | 5 次 | 0 次 |
| 反覆拜訪 5 次的伺服器進場確認 | 5 次 | 5 次 |
| 首次素材刻意延遲時，80ms 原畫面仍在 | 否 | 是 |
| 首次素材刻意延遲時，80ms 全畫面遮罩 | 有 | 無 |
| 延遲超過 200ms 時母雞載入畫面 | 有 | 有 |

上述慢載入測試刻意阻擋素材回應，時間含測試操作、軟體繪圖與畫面建立；不能據此宣稱正式手機延遲降低多少。暖快取商店／倉庫仍須建立畫面，量測未證明其純渲染時間縮短。這次具體改善為縮小首次圖包、保留原畫面及消除快速拜訪的遮罩閃爍。

另以真正 HTTP server/service worker 測試，明確關閉瀏覽器 HTTP 快取：5 個代表性 JPEG／PNG／圖集 JSON 首次下載 5 次，重新整理 0 次、離開再返回 0 次；只替換測試伺服器的一張圖片後下載 1 次。兩次 API 回傳序號仍為 1、2，其他用途的快取保留。每日任務 37 張 PNG 也通過重新進入 0 次下載檢查。

手機比例實際遊戲入口截圖：verification/farm-loading-cache/visit-390x844.png。尚未在實體 iPhone 或行動網路量測；本機隔離結果不代表正式後端延遲。

## 維護與發布

修改 assets/farm 的公共素材後執行：

```bash
node scripts/build-farm-art-cache.cjs
```

將生成的兩個版本檔一起提交；單元測試會檢查版本與檔案內容一致。此次發布只需前端 GitHub Pages 更新，不需要部署 Functions 或 Rules。未自動提交或推送。

首次看新素材仍需下載；重新進遊戲仍需建立 Phaser 紋理及驗證最新資料。iOS 清理網站儲存、私密瀏覽或使用者清除快取後會走正常下載，不能保證永久免載入，也未增加整個遊戲離線功能。

## 驗證範圍補充

既有 tests/farm-loading-browser.cjs 是較早期的前端結算 fixture，直接跑目前正式啟用的後端模式會等不到進場完成；切成該 fixture 的舊模式後，也仍期待已移除的「收蛋時才抽怪物」流程。此舊測試未列為通過證據，檔案保持原樣。本次以目前真實遊戲入口的 NAVIGATION_LOAD_TESTS 及 private-backend-browser 驗證素材閘門、最新村落驗證、進場怪物與核心操作；真實持久快取另外使用不攔截 worker 的 HTTP 測試。

最終目前程式的隔離檢查：441/441 單元通過，test-private-farm.cjs 全部瀏覽器步驟通過，涵蓋登入、存檔失敗保護、遊戲交易、載入優化、租狗、群組每日任務、排行榜、虎頭蜂、武士刀、出怪設定、兩種寶箱動畫／備援、持久快取與營運中心。verification/farm-loading-cache/verification.json 的 codeSha256 已核對目前程式一致。

Emulator 未通過：補上本環境 CLI 路徑單獨啟動 demo 專案後，下載 cloud-firestore-emulator-v1.19.8.jar 被環境網路以 HTTP 403「Domain forbidden」拒絕，未跑到規則／callable Emulator 測試；未宣稱通過或修改報告旗標。紀錄見 verification/farm-loading-cache/emulator.log。
