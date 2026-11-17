# 遊戲主模組下載失敗的啟動恢復

## 問題與界線

`Failed to fetch dynamically imported module: .../js/farm/main.js` 表示主模組或其相依模組未能下載／通過模組載入檢查。僅憑此訊息無法判定是 main.js、Firebase CDN、網路中斷、HTTP 錯誤或 MIME/CORS 設定。此環境存取正式 GitHub Pages 被網路代理拒絕（CONNECT 403），未確認正式網站當時的 HTTP 回應。

原有 entry 在第一次匯入失敗後直接顯示錯誤。瀏覽器會在目前文件的模組快取記住失敗；只在同一文件重複 import 同一網址無法可靠恢復。本次修正的是暫時性模組下載失敗時的恢復流程，不宣稱已消除所有正式網路故障。

## 變更

- `js/farm/entry.js`：僅 game-module 階段、符合瀏覽器動態匯入下載錯誤訊息時，重新載入文件一次；sessionStorage 與 URL 時戳防止短時間迴圈。
- 恢復時替 main.js 加臨時版本參數，重新建立文件模組快取。正常啟動不新增模組重試請求。
- 成功後移除臨時頁面參數，保留其他查詢參數與 hash。
- 兩分鐘內持續失敗保留既有 alert、Console、詳細資訊與手動重試，不循環跳頁。
- ReferenceError、程式初始化 TypeError 等原有錯誤仍直接回報。
- `farmgame.html`：入口 script 版本更新。

無交易、倉庫、任務、排行榜、Functions 或安全規則變更；恢復採整頁導覽，不在原文件建立第二個 Phaser 實例。

## 驗證

使用實際 farmgame.html、entry 與 loading UI，Chromium 390×844，隔離替換 constants/main 模組並注入下載故障，不存取正式 Firebase。

```bash
python3 -m http.server 8032 --bind 127.0.0.1
# 另一個終端機
node tests/farm-module-recovery-browser.cjs
node tests/farm-startup-order-browser.cjs
node tests/farm-startup-diagnostics-browser.cjs
node --test tests/farm-startup-diagnostics.test.cjs tests/farm-dragon-startup.test.cjs
```

通過：主模組單次下載失敗、相依模組單次下載失敗、持續失敗僅一次自動導覽、初始化錯誤不重試、禁止 sessionStorage 時 URL 防迴圈、成功後保留原查詢參數、成功後短時間再次失敗不形成重試迴圈，以及既有常數初始化順序與錯誤提示。成功測試的替代主模組僅初始化一次；並非正式 Phaser/Firebase 的端對端交易測試。

另有 4 項啟動診斷／dragon 初始化單元測試通過。未實測實體 iPhone、Safari 或正式 Wi-Fi／行動網路。若正式檔案持續缺失或外部 CDN 持續不可用，重試後仍會顯示錯誤，需要進一步取得失敗請求的 HTTP 狀態。
