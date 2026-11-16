# 咕咕村落載入錯誤頁面診斷

在 `farmgame.html` 的 ES module 啟動前載入獨立 classic script。沒有取代全站 console.error，也不攔截其他頁面的錯誤。

- 初次載入期間的未捕捉 JavaScript error、unhandledrejection、程式 script 資源失敗，以及原本已 catch 的引擎／main module／初始化元件／群組／存檔／核心素材失敗，顯示原生 alert。
- 顯示可取得的階段、類型、代碼、訊息、檔案、行列及堆疊。Safari 未提供檔案或堆疊時不捏造資訊；跨來源 Script error 的細節仍受瀏覽器限制。
- 關閉 alert 後，載入卡片的詳細文字保留，可截圖或選取；只用 textContent 呈現。
- 同一錯誤物件或相同診斷內容去重，每次頁面最多三筆自動 alert，避免每幀錯誤導致無法操作。
- 遊戲完成載入後移除全域捕捉與舊詳細資訊，不把遊戲中的每筆交易錯誤都轉為阻塞 alert。原有 Console、重試、資料流及交易不變。
- 僅抽取錯誤欄位，不序列化請求、玩家資料或憑證物件；網址移除 query/hash，並遮蔽常見 credential 標籤、Bearer 與 JWT。此措施不取代錯誤來源本身的敏感資料最小化。

## 驗證

- 360 項 Node 測試通過；新增遮蔽、去重、全域捕捉、資源篩選、三筆上限及完成後解除測試。
- 實際 farmgame.html → entry.js → 動態 main import 注入 TypeError，確認 5% 位置出現一筆 alert，包含 module、代碼與 stack，原有 farm-startup-failure Console 與重試保留。
- 390×844 Chromium 手機尺寸截圖：[錯誤詳細資訊](verification/startup-diagnostics/error-390.png)。模擬失敗用於驗證捕捉能力，不代表已定位使用者手機的原始問題。
- 真實 Phaser 私有模式整合回歸通過：收蛋、商店、協助清潔、偷蛋、Boss 攻擊結算及每日任務。
- 未在 iPhone 真機驗收；瀏覽器若阻擋原生 alert，頁面詳細資訊仍保留。

前端修改，不需要 Firebase Functions／Rules 部署。正式問題發生後請擷取 alert 或詳細區，才能判定實際原因。

## dragon.js:73 初始化前讀取修正

使用者提供的 iPhone 診斷指向 module scope 的 `DRAGON_SPEC.config: DRAGON_CONFIG`。舊版在 import dragon 時立刻讀取 constants 的 export；該模組又依賴含 Auth 非同步初始化的 Firebase 設定。原生 TDZ 迴歸 fixture 可重現 `Cannot access 'DRAGON_CONFIG' before initialization`，但不將這個合成 fixture 當成實機 Safari 重現。

改為建立 DragonEncounter 時才取 config／salePrice；entry 將 constants module 完成初始化作為 main import 的前置條件。引擎及 constants 下載仍平行，並不提前等待 membershipReady 查詢結果，也不移除 Boot 的成員驗證。怪物數值、機率、傷害、掉落、售價、交易及後端區域不變。

驗證：361 項 Node 測試、實際 entry 延遲 constants 回應測試、原有 startup alert 測試、真實 Phaser 私有後端完整遊戲整合均通過。另以 `DRAGON_STARTUP_TESTS=1` 啟動台灣 region SDK 配置的隔離遊戲，確認原入口成功進入烈火龍戰鬥，health=600、salePrice=200、size=176 與後端 challenge 正確。

WebKit 測試引擎下載失敗，因此未執行 Safari／iPhone 真機測試；使用者需在前端發布後重新開啟遊戲確認。本次不需要部署 Firebase Functions 或 Rules。
