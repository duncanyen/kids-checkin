# Nexus 已實作效能機制

> 2026-11-09 以目前程式為準。舊效能報告保留當時測量值，不代表之後所有版本／真機都達到同樣數字。本文件不調整既有機制。

## 1. 監聽器與舊結果失效

| 模組／來源 | 實作 | 維護時不可破壞 |
| --- | --- | --- |
| 首頁 `dashboard.js`／`main.js` | stopDashboardListeners 集中停止資料訂閱、分鐘計時與群組載入；dashboardGeneration 使舊結果失效，pagehide 呼叫清理，pageshow 重新初始化 | 不能只清除 DOM；待完成 Promise 仍可能回來。頭像補載重用已接收的 widget 快照 |
| 待辦 `todo.js` | pagehide 停聚合文件／成員監聽與 recurringTimer；pageshow 的 bfcache 恢復重新載入 | 不能把分鐘補算改成每次 render 新增一個 timer |
| 相簿 `gallery.js` | pauseGallery 停止範圍／頭像訂閱、Observer，增加 generation；resume 確認帳號及群組 | 快取缺資料不能直接移除貼文；停止後的查詢不得再註冊新監聽 |
| 餐食 `food-decision.js` | 切日期／餐別解除舊訂閱；loadVersion 過期時對晚到的 stop 立即清理 | store.watch 回傳 Promise<Function>，不是同步 stop |
| 農場 `scene-cleanup.js` | shutdown／destroy 共用一次性入口並互相解除掛鉤 | 不能讓每次重啟累積 destroy callback；跨場景資源與場景內資源需分開 |
| 森林 `main.js`／`scene.js` | 離頁停資料與外觀監聽、timer、Object URL，destroy Canvas；背景時 sleep 遊戲循環 | 不為每次水滴餘額更新重建 Phaser；離頁後不重開資料訂閱 |
| live-read-core | closed 旗標涵蓋驗證尚未完成及 fallback 訂閱；timeout 亦清除 | 不因認證晚回來而在已卸載頁面訂閱 |

這是逐模組的現況，不是全站統一框架。行事曆 `listenToEvents` 等舊頁未保留取消函式，已列待處理，不在本次修改。

## 2. 初始化與非同步並行

- 首頁 userSettings 決定功能內容；群組成員頭像稍後補載，並以目前世代保護。不要回退成先掃全部 users 才呈現首頁。
- `expense.initApp` 同時啟動分類與當月資料，圖表等待必要分類；頭像只查當前記錄引用的帳號，不阻塞金額。
- `scoped-profiles.mapBatches` 每批 10 個、最多 4 個工作者並行；pendingByDb 以 DB 實例及參數隔離，共用未完成請求後即刪除。它不是永久個人資料快取。
- `game-members.loadGameGroupMembers` 先查 groups.members，再逐批 users in；這個函式的批次目前是順序執行，不要把其他工具的四批並行誤套到它。
- 農場 `entry.js` 引擎載入與 membershipReady 平行；Boot 的私人存檔存取仍等待資格。不能為追求首屏速度移除安全閘門。
- 成長森林 snapshot 的獨立資料讀取及單區九地塊讀取使用 Promise.all。direct 模式為避免缺索引而本機篩選，有明確 2000 候選上限，不等同高規模最佳化。

## 3. 相簿分頁與增量渲染

來源：`gallery.js`、`gallery-profiles.js`、`gallery-viewer.js`。

1. 首頁輪播有自己的有界查詢，不下載整個相簿。
2. 相簿每頁 `PAGE_SIZE=15`，groupId＋timestamp desc，以 DocumentSnapshot startAfter 前進；同時間順序保留 Firestore 文件鍵。
3. 每個已載入區間有 after／end 與文件 ids；即時查詢使用 startAfter／endAt 範圍。上方 head 區間仍接收較新貼文，歷史區間不重複全量讀取。
4. posts 與 cards 以 Map 保存，signature 決定是否重畫，圖片來源沒變就保留媒體節點與輪播位置；只變留言／按讚不重新下載整張圖。
5. loading 防止同頁重入，exhausted 只在伺服器確認頁面不足時成立。快取可能不完整，仍保留重試。
6. IntersectionObserver 接近頁尾才載入，仍有手動按鈕。離頁 disconnect；已載入頁數增加時，監聽區間數也增加，並非固定一個 Listener。
7. 成員最新名稱／頭像使用限定群組的 users in 監聽，不批次重寫歷史貼文；停止函式同時涵蓋名單尚未讀完的情況。

## 4. 圖片、SDK 與素材

- 相簿主圖／留言圖使用 `loading="lazy"`、`decoding="async"`；頭像有固定尺寸，避免不必要的版面跳動。lazy 不保證瀏覽器一定等到可見才發請求。
- Storage 上傳模組與 photo viewer 採 dynamic import；一次圖片發文最多五張、留言最多三張，各自依原流程壓縮及上傳。
- Chart.js 只在需要圖表時載入；共用 pending Promise，15 秒 timeout，失敗清除以利重試，金額與導覽不依賴成功載入。
- 森林共用引擎 Promise，失敗可清除重試；目前 scene preload 仍載入所有森林植物階段，不要描述為每朵花才下載。
- 農場 Boot 僅核心素材；FarmAssetScene 將後續 bundle 排隊並重查紋理快取，重疊需求不重複下載。怪物／商店按需求取素材，季節素材有明確活動期限。
- Phaser preload gate 保持 preload→create 順序，失敗讓玩家重試，不能直接讓尚未備妥素材的場景開始互動。
- Object URL 使用後 revoke；下載／分享留意 iOS 使用者手勢時機，非同步結束後不得假設仍有原始手勢資格。

## 5. 查詢、快取與防重複

| 機制 | 範圍／效果 | 不是什麼 |
| --- | --- | --- |
| 記帳游標 | 每次文件 query limit(10)，當月金額／筆數由 sum／count 聚合；listPages 快取已讀頁 | 日曆與回顧不一定同樣分頁；不是全部帳務都只讀十筆 |
| 聊天 ChatHistory | 每頁 30、Map 按 id 去重，loading 鎖；切房間換 history 物件拒絕舊結果 | 無程式內的一天保存期限；讀取頁數不等於資料保留天數 |
| 首頁未讀照片 | getCountFromServer，focus／visibilitychange 更新，pending 防同時重查 | 不是全相簿即時文件監聽 |
| 個人主題 | theme-bootstrap 在 SDK 前同步讀帳號快取，之後 hydrate 雲端偏好 | 快取不是權限或最新資料的保證；預覽中不能被遲到資料強行覆蓋 |
| 農場存檔 | 單一 session 共用 verify pending；保存最後確認快照，revision 避免延遲驗證倒退 | 空快取不是新玩家；錯誤不能以 initialFarm 填補 |
| 護衛犬商品 | 同場景共用載入中 catalogue，30 秒快取；開租用表單強制讀取最新設定，後端檢查 expectedPrice | 卡片快取不授權扣款；價格變動不能直接按新價扣款 |
| 營運兌換 | 按模式共用連線 Promise、同內容共用操作 Promise；sessionStorage 保留 requestId，後端交易收據避免二次發獎 | timeout 不等同伺服器沒完成；不能換碼重新發一次 |
| 森林刷新 | 220 ms 合併刷新；busy 時延後，避免交易中的表單被刷新干擾 | 群組修訂鎖仍使同群組寫入互相競爭，不是無限制高吞吐 |
| RTDB 適配 | 開啟後才嘗試鏡像；未 ready／一般網路失敗可 fallback Firestore，permission-denied 不回退 | 目前開關 false，不能宣稱已節省正式 Firestore 訂閱讀取 |

## 6. 遊戲渲染與清理

既有場景對農場快照做差異更新，不因只變金幣就重建全部雞隻。移除精靈時亦清除其 Tween／事件；參考 `poultry-art.js`、`hen-navigation.js` 及 [第五階段紀錄](farm-performance-phase5.md)。

放風顯示與完整養殖分離，室內雞不必建立外部 Sprite，仍參與產蛋與生病。森林 `scene.render` 在 plant id／texture 未變時保留精靈，只替換成長階段有變動的部分。

未新增每影格 Firebase 讀寫；動畫座標不是每幀同步的多人遊戲狀態。Boss／商店素材按需載入已是後續實作，舊報告中「全部預載」的觀察需按版本辨識。

## 7. 驗證、限制及維護基線

對應既有測試：navigation-performance、gallery-performance、farm-performance、farm-save-browser、farm-loading-browser、game-group-isolation、growth-forest-browser 與各純核心測試。每支測試的 fixture、採樣長度與 SDK 替身範圍需閱讀檔頭。

不得把 Playwright 行動 viewport 當 iPhone 真機、不把 mock 訂閱／查詢數當帳單成本、不把數秒採樣當十五分鐘長測。正式索引、網路慢速、外部 CDN 首次解碼、GPU／heap 長測、實際電池消耗與 RTDB 啟用後成本仍需另行量測。

本次只補註解及文件；沒有改查詢、快取、監聽器、CSS、圖像或遊戲迴圈。實際跑過的檢查以 [DOCUMENTATION_AUDIT.md](DOCUMENTATION_AUDIT.md) 為準，不複用舊報告的通過數。
