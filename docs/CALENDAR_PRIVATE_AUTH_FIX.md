# 行事曆登入恢復與權限錯誤修正

## 原因及變更

`js/calendar.js` 原先自行 initializeApp/getFirestore，沒有沿用 `js/firebase-config.js` 在私有登入模式下等待預設 Auth 恢復的流程。它會立即註冊 events 監聽，並透過 window.onload 寫入 logs，可能在登入身分尚未就緒時被正式 Rules 拒絕。

改用既有共用 db；模組依賴完成 Auth 恢復後，才初始化行事曆、監聽行程及寫入一次瀏覽紀錄。沒有更改 Firebase 規則、Token、群組資料結構或伺服器權限判斷。

補上監聽 error callback。若權限真的已失效，清除舊行程與開啟中的明細，顯示重新登入說明、重新讀取及返回首頁，不把拒絕權限視為成功。重試維持單一訂閱；pagehide 清理，bfcache pageshow 核對原帳號與群組後恢復。恢復不重複寫瀏覽 Log。

## 檔案

- `js/calendar.js`
- `css/calendar.css`：可恢復錯誤提示排版。
- `tests/calendar-auth-browser.cjs`：新的延遲 Auth／拒絕授權／重試／返回頁面驗證。
- `tests/calendar-flow-browser.cjs`、`tests/fixtures/navigation-performance-sdk.js`：補齊實際 Auth SDK 既有方法的隔離 mock。

## 驗證

使用真實 calendar.html、共用 firebase-config.js 與 calendar.js，搭配 Chromium 390×844、Asia/Taipei 及隔離 SDK；未存取正式 Firebase。

- 延遲 Auth 恢復150ms，提前送出 window load：events/logs 都沒有提早讀寫，沒有 permission-denied。
- 恢復後共用 App 只初始化一次；行程正常顯示，瀏覽 Log 一筆。
- 模擬 listener permission-denied：error callback 正常處理，舊行程清除，無未捕捉例外。
- 拒絕期間重試及恢復權限後重試：訂閱數正確，不累積。
- 連續三次 pagehide/pageshow：每次只恢復一個監聽，沒有額外瀏覽紀錄。
- `calendar-flow-browser.cjs`：新增／跨月編輯、失敗重試、日期切換及手機欄位回歸通過。
- `calendar-icons-browser.cjs`：圖示、編輯／刪除、週視圖及設定回歸通過。
- `calendar-avatar-browser.cjs`：首頁行事曆穩定帳號及改名頭像回歸通過。
- 目前工作區 Node 測試386項通過（含先前尚未推送的農場讀取優化測試）。

```bash
node tests/calendar-auth-browser.cjs
node tests/calendar-flow-browser.cjs
node tests/calendar-icons-browser.cjs
node tests/calendar-avatar-browser.cjs
```

截圖及紀錄：`/workspace/exports/calendar-auth-fix/`。尚未推送或部署。本項僅需發布前端，不需部署 Functions 或 Rules；先前農場讀取優化仍保留於工作區，屬另一項需要後端部署的變更。
