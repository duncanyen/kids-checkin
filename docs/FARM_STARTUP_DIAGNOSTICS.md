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
