# 咕咕村落：分層載入與母雞進度條

2026-10-29。保留原生 MPA、Phaser 3.60.0、Firestore 與既有玩法。RTDB 開關、Rules、資料結構與圖片檔案均未變更。

## 行為

- farmgame.html 先顯示田園紙色載入面板，再由 entry.js 非同步取得原版本 Phaser。引擎載入與群組資格查詢可重疊，不再用 head 的 parser-blocking script 擋住初始畫面。
- constants.js 對外提供一份 membershipReady Promise。Boot 立即載公開首屏素材，只有資格成功後才啟動既有 startFarmSaveSession，因此存檔讀取可與素材下載重疊。
- Boot 核心包為母雞 atlas PNG/JSON、直向底圖、橫向底圖、紙張與看板，共 6 檔。保留兩張背景以支援立即旋轉／平板 resize，不降低清晰度。
- 自家存檔需要烏骨雞／布雷斯雞時，只補缺少的品種；等待時不以不完整資料更新畫面或授權收蛋。
- 村莊目錄只載所需背景／按鈕／雞舍；商店、倉庫與拜訪依場景 preload 取得完整所需素材。已載過的 Texture／Animation 留在同一 Game 內重用。
- 自家收蛋抽到 boss 才載該 boss 與必要弓箭 UI；素材完成且存檔仍就緒後才建立敵人、開始原本倒數。失敗保留原抽選結果，重試不重抽機率，不領獎、不扣蛋。離開場景後晚回應不建立舊敵人。
- FarmAssetScene 是同一 Game 的不可見共用 loader，序列化／重查快取處理重疊請求，不是第二個 Phaser.Game；沒有畫面物件或活躍 Timer。次要場景採 Loader File barrier，直接 scene.start 也必須經過素材 gate。

## 進度條

紙色面板、草綠進度條與母雞。Phaser 尚未準備好時用本地 SVG 母雞圖形，hen texture 載入後改用遊戲現有 atlas 的 8–15 行走格，不重複下載母雞圖片。

進度由已完成的工作階段加權：引擎、核心素材、群組資格、存檔、必要雞種、農莊首次渲染。素材階段採真實 Loader 事件；這是階段完成度，**不是精確下載位元組百分比**。沒有按經過時間自動灌滿的 interval，存檔與必要素材未就緒不能到 100%。

母雞與填滿效果採 transform 動畫；行走使用受控 rAF 約 8fps，面板隱藏／分頁背景／Game destroy 時停止。prefers-reduced-motion 關閉行走／位移過渡。100% 在第一個有效農莊 frame 後呈現並短暫停留；後續戰鬥補載則立即移除遮罩再開始敵人，避免扣掉可操作戰鬥時間。

錯誤顯示重試與返回遊戲區；核心／引擎失敗採安全重新載入，功能與 boss 素材只補載失敗項目。重試不建立預設存檔。沿用既有 server transaction、creation receipt、cache／pending write 判斷及一次性獎勵保護。

## 可驗證結果

隔離 Chromium、真實 Phaser／圖片、假 Firestore，未存取正式資料：

|情境|結果|
|---|---|
|只有母雞的首次核心素材|30 檔／14,750,327 bytes → 6 檔／3,359,024 bytes，原始檔總量約減少 77.2%|
|混養更新|只補 silkie／bresse atlas，不預載怪物／武器|
|membership 人為卡住|公開核心圖片已開始請求，沒有私人存檔監聽或可操作農莊|
|核心圖片卡住、membership 放行|存檔監聽已開始；證明兩者等待重疊|
|存檔卡住|金額不填預設值、進度小於100，收蛋與功能入口維持阻擋|
|boss 圖片失敗|不建立 encounter；重試保留原抽選，飛龍仍為60秒|
|引擎／核心／商店素材失敗|顯示可重試錯誤；Shop.create 不使用缺圖，重試只補缺件|
|同場景素材重用|Shop→Warehouse 不重新下載已載包|
|Game 在等待 membership 時被銷毀|晚回資格不再啟動私人監聽|
|20 輪場景切換|清理 hook 不累積、自家監聽維持1；共用 loader 無顯示物件／Timer|

混養首次進入仍需增加相應品種的素材量，3.36MB 不是所有存檔的總傳輸量，也不含 Phaser／Firebase／其他程式與 HTTP overhead。實際手機秒數、正式網路、Safari／iOS PWA／Android 的改善幅度尚未量測，不把77.2%檔案量減少說成77.2%時間改善。

## 測試

- tests/farm-loading-browser.cjs：受控遲延、分層請求、真進度、缺圖重試、boss機率保留、Scene gate、reduce-motion、destroy 晚回應；結果在 farm-progressive-loading-results.json。
- farm-save-browser：慢 cache miss／離線不重置、部分存檔拒絕、creation receipt。
- game-group-isolation、farm-public-villages：群組、公開／封閉村落、跨群組交易與退出。
- farm-hen-lifecycle、farm-actors、farm-poultry、farm-gorilla、farm-archery-browser：雞種、路線、受擊、裝備、弓箭拖曳與命中、時限及獎勵。
- farm-map、farm-atmosphere、farm-mail-browser：42個菜園區域、resize、日夜天氣、通知領獎與輸入遮罩。
- farm-performance：20輪場景清理、單一存檔訂閱、Sprite／interval 保留與 Game destroy。
- farm 單元／atlas 測試共32項。
- 新增 loading canvas 後，既有測試的遊戲座標定位改為 `#game-container canvas`。分類測試同步既有短弓／獵弓，沒有改商店商品或價格。

測試環境需 Playwright、Chromium、本地靜態伺服器與同版本 Phaser fixture。沒有引入新套件。

## 修改範圍與限制

新增：asset-manifest.js、assets.js、entry.js、loading-ui.js、farm-loading.css、farm-loading-browser.cjs。
調整：farmgame.html、farm/main.js、BootScene、constants、MyFarmScene 與四個次要 Scene 的素材 gate；各角色動畫註冊先確認 texture 存在。調整相關既有測試的 canvas selector 與過期商品期望。

未做全站架構改造、圖片壓縮／裁切、角色刪減、伺服器規則或安全架構修改；先前資安稽核所列問題不會因載入優化而自動解決。商店／倉庫首次進入仍可能等待較大的功能包，本次將它移出自家首屏；後續可再評估分類級別資源包。
