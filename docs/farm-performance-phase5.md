# Nexus 第五階段：咕咕村落效能報告

本階段保留 Phaser 3.60.0、原生 MPA、角色與數值、資料結構、Security Rules、群組隔離及 RTDB 關閉狀態。未提交、推送或部署。基準為 699cd54。

## 架構與生命週期

farmgame.html 使用固定版本 Phaser CDN，js/farm/main.js 原生模組只執行一次 new Phaser.Game。沒有發現同文件重複建立 Game 的路徑。BootScene 預載共用紋理、建立全域動畫、啟動自家存檔 session，再切換 MyFarmScene。Boot 的 isListeningFarm registry 防止重複訂閱，Game destroy 解除 session 與 online 回呼。

一般 MyFarm／Lobby／Visit／Shop／Warehouse 透過 scene.start 切換：舊場景 shutdown，保留場景實例、全域 Texture/Animation Manager，下一次 create 重建場景物件。沒有為效能改成 sleep/wake，避免將既有交易與戰鬥狀態留在背景；沒有主動卸載共享紋理以免再次下載與動畫閃爍。

原本多個資源只監聽 shutdown；Game.destroy 的 Scene destroy 路徑可能跳過 shutdown，造成外部事件未清理。新 onSceneExit 同時監聽 shutdown 與 destroy，第一個觸發就移除兩個 hook，且只清理一次。

未配置 Arcade Physics。母雞使用 Tweens 與路徑安全計算，避敵原本每 200ms 檢查一次；弓箭用 swept segment 命中判定。未降低碰撞頻率、移動速度、動畫 FPS 或戰鬥時限。

## 根因、修改與風險

|優先|問題／位置|修改|風險及驗證|
|---|---|---|---|
|P1|ShopScene.create、WarehouseScene.create 每次 events.on shutdown 永久累積|改為一次性且涵蓋 destroy 的 onSceneExit|20 輪場景切換及 helper 單元測試|
|P1|WarehouseScene.initFirebase 重複 watchFarm 已由 Boot 持續訂閱的自家資料|使用同一 Game registry 的 myFarmData，處理首次 setdata、changedata 並清理|保留原交易驗證；倉庫功能、存檔與群組回歸|
|P1|MyFarmScene.initFirebase 任意存檔更新都 syncHens、重啟原生 interval|依雞狀態、雞舍及病程日齡比較視覺 key；無關更新保留 Sprite 與行走狀態；同場景只建立一次 egg interval|雞狀態改變仍重建；48 小時病雞清理仍可重試；直接 syncHens 不走快取，維持既有強制更新功能|
|P1|多場景與 atmosphere 等只在 shutdown 清理|onSceneExit 在 Game destroy 也移除 DOM／registry／resize hooks、Observer、角色及 Timer|實際 Game.destroy 後 loop 停止、Canvas 移除、氣候層 inactive|
|P2|每隻雞 henRouteIsSafe 重算相同敵人 bounds|同一個避敵 pass 共用 zones；跨 pass 不快取|不改判定幾何或時間；8 雞、兩怪物避讓回歸|
|P2|日間零強度 glow 仍繪製多圈透明 Graphics|strength 恰為零時跳過；非零不改|僅排除完全透明輸出；四種天氣／日夜回歸|
|P3|registerPoultryAnimations 不具重入保護|已存在 key 則跳過|不改動畫內容；保留全域 Animation Manager|

原生 egg interval 在 document.hidden 時不執行畫面及生產交易；返回後仍使用原本 Date.now 計算經過時間，不更改產蛋規則。Phaser 自有 visibility 行為保留，沒有新增背景戰鬥暫停政策。完整換頁由瀏覽器結束原文件；未新增第二個 Game 或持久跨頁引擎。手機背景／恢復全流程尚未真機驗證。

## 量測方法

實際 Phaser、實際本地圖集，無頭 Chromium 390×950。Firebase SDK 完全替身，禁止正式寫入，mail UI 隔離；兩隻雞（一健康、一病雞）。20 輪 MyFarm→Shop→Warehouse→MyFarm，之後採樣 5 秒 poststep 間距。BASELINE=1 透過 git show 699cd54 提供舊場景模組；基準與修改後依序執行。這不是手機 GPU／Safari，也不是 15 分鐘 soak。

首進時間是測試端 goto 到母雞建立完成的壁鐘時間，包含本機 HTTP，單次樣本；不是生產網路可操作時間。poststep 是引擎更新迴圈節奏，不是螢幕合成器實際呈現 FPS。Timer 數量是 Phaser Clock _active，不包含原生 interval 或尚未併入的 pending Timer。

## 修改前後

|項目|前|後|
|---|---:|---:|
|首次進入 ms|1447|1447|
|20 輪後 Shop shutdown hooks|21|1|
|20 輪後 Warehouse shutdown hooks|21|1|
|累計 Firestore subscribe 呼叫|21|1|
|回到自家活躍 Firestore Listener|1|1|
|自家 Display List 物件|67|67|
|自家活躍 Phaser Clock Timer|1|1|
|共享 Texture keys|39|39|
|20 次金幣更新保留原 Sprite|False|True|
|20 次金幣更新保留原 interval|False|True|
|Game.destroy 後 atmosphere active|true|false|
|poststep averageFps（間距單位 ms）|18.33|20.84|
|poststep median（間距單位 ms）|54.90|45.50|
|poststep p95（間距單位 ms）|66.50|61.80|
|poststep p99（間距單位 ms）|76.60|68.60|

FPS 樣本約 18.3→20.8，但早期重跑曾出現下降（20.3→17.6），不具統計證據證明 FPS 改善，**沒有達到或驗證 60 FPS**。首次時間同為 1447ms，沒有證實首次進入加速。沒有聲稱記憶體降低或 GPU 負載改善。subscribe 呼叫由 21→1 是隔離替身計數，不是帳單文件讀取量；未增加動畫每影格 Firebase 寫入。所有金幣、收蛋、偷蛋與戰鬥結果交易路徑仍保留。

## 回歸測試

- farm-performance.cjs：20 輪切換，shutdown hook 不累積、自家 1 個 Listener；20 次金幣更新保留 Sprite／interval；Game.destroy 後 destroy event 發出、Canvas 移除、loop.running=false、氣候層 inactive。沒有 pageerror。
- farm-scene-cleanup.test.mjs：20 輪 shutdown 後兩種 hook 都歸零，destroy 與 shutdown 連續觸發只清理一次。
- farm-hen-lifecycle：自家／拜訪舊 Tween 清理、病雞不走動、產蛋動作後重建正常。
- farm-hen-avoidance：8 雞、移動中的敵人、兩個可見怪物、雞舍升級、重建後避讓正常。
- farm-actors：三級雞舍 900 條路段、看板、野狼／老虎走路／受擊／死亡／逃跑、去重結算、鄰居雞舍入口正常。
- farm-archery-browser：滑鼠／觸控拖曳、虛線、射失及命中、短弓／獵弓、巨鷹／飛龍時限與結算、商店買賣回歸。
- farm-save-browser：慢快照／斷線不建立預設存檔、保留物品、缺損存檔拒絕、一次性建立及刪除保護。
- game-group-isolation：切群組、群組權限、拜訪與商店路徑、跨分頁返回隔離正常。
- farm-atmosphere：日夜與四種天氣、互動、重啟清理、恢復時鐘正常。
- farm 相關單元／atlas 測試 31 項通過，新增 cleanup 1 項通過。JS syntax 與 diff whitespace 檢查通過。

既有兩個測試原本以固定毫秒等待行走 Tween／受擊動畫，在低速無頭渲染時發生競態；改為等待實際狀態並保留 timeout 與原判斷，沒有放寬遊戲判定。

## 資源與尚未完成的量測

三種雞 atlas 約 1.86MB、1.85MB、1.57MB（1254×1254）；dragon-sheet 1.23MB（2048×1024）、gorilla-sheet 1.18MB、gorilla-fang 1.15MB、panorama 約 0.995MB。Boot 預載所有角色，首次圖像解碼及 GPU 紋理成本仍在。不同寬度需要不同底圖，商店／倉庫即時使用所有道具；未冒險刪圖、降解析度、重裁圖集或拆成非同步，以免缺圖或攻擊時閃爍。沒有更改圖片清晰度。

未測量：真機 Safari／iOS PWA／Android、實際觸控延遲、CPU 降頻／低電量、GPU、Long Tasks、完整 JavaScript CPU 時間、heap 保留及長期記憶體趨勢、正式 Firestore 文件讀寫、限速網路首次載入。慢網存檔安全測試不能代替弱網遊戲載入效能量測。

**15 分鐘測試尚未執行**；目前執行的是 5 秒採樣。已提供 `SOAK_MS=900000 OUTPUT=/tmp/farm-soak.json node tests/farm-performance.cjs` 的長測入口，但不得將它描述成通過 15 分鐘。該測試仍是隔離兩隻雞情境，不能替代多怪物真機長測。

沒有改變武器、敵人血量／時限／機率、病程門檻、偷蛋、產蛋與金幣數值。沒有將客戶端動畫狀態改存 Firebase，沒有降低既有交易保護；現有交易與伺服器 Rules 的防作弊強度本次沒有重新設計或正式驗證。

## 修改檔案

js/farm/scene-cleanup.js；MyFarmScene.js、VisitScene.js、ShopScene.js、WarehouseScene.js、LobbyScene.js；atmosphere.js、garden-feedback.js、scenery.js、viewport.js、hen-navigation.js、poultry-art.js。

tests/farm-performance.cjs、farm-scene-cleanup.test.mjs；修正既有 farm-hen-lifecycle.cjs 與 farm-actors.cjs 的等待競態。本報告及 farm-performance-phase5-results.json。沒有修改 Nexus 其他功能模組。

## 後續建議

優先補真機錄製及 15 分鐘測試，再根據實際 trace 判斷 Graphics 重繪、紋理記憶體及初始解碼成本。角色／道具隨需載入需要設計取消、失敗重試、場景等待與原子動畫註冊，風險高於本次小修，應另案實作；不能先假設有 FPS 收益。若要降低透明區，需同步驗證 atlas frame、pivot、bounds 與命中區，不可單改 PNG。停止於第五階段。
