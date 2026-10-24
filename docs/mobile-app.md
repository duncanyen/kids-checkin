# iPhone 主畫面 App 模式

功能卡的 `navTo` 使用 `window.location.href` 同視窗導覽，沒有使用 `window.open`。程式中另開視窗的是外部 LINE 分享，保留原行為。

過去只有部分頁面宣告 mobile-web-app-capable，缺少 iPhone 的 apple-mobile-web-app-capable，也沒有統一 manifest。現在所有 15 個 HTML 頁面均提供：

- `apple-mobile-web-app-capable=yes`、Nexus 名稱及預設狀態列樣式。
- 統一的 Apple 主畫面圖示，沿用既有 Nexus 圖片。
- `manifest.webmanifest`，以相對路徑宣告 start_url、scope、id 與 standalone 顯示模式。根目錄與 `/kids-checkin/` 子路徑部署皆可涵蓋站內功能頁。

此模式須從 iPhone「加入主畫面」圖示啟動。普通 Safari 頁籤的網址列由瀏覽器控制，網頁無法強制隱藏。若先前圖示是瀏覽器書籤或保留舊設定，更新網站後請：

1. 從 Safari 開啟 Nexus 首頁。
2. 分享 → 加入主畫面；若系統顯示「以網頁 App 開啟」選項，保持開啟。
3. 從新的主畫面圖示啟動，確認進入聊天室、個人設定等功能及返回首頁仍維持 App 模式。

可在新圖示正常運作後刪除舊捷徑，不需要清除 Safari 網站資料或帳號資料。本次不新增 Service Worker 或離線快取，避免舊版功能頁與群組資料被快取。

驗證：

```sh
APP_BASE_URL=http://127.0.0.1:8012 node tests/mobile-app.cjs
```

測試檢查 15 頁的宣告一致性、manifest 相對路徑範圍，以及實際 navTo／返回操作維持單一視窗、session、群組與待送紀錄。檢查 HTML 時移除初始化腳本，導航測試僅載入實際 auth.js 並攔截 Firebase；不讀寫正式資料庫。Playwright 的手機模擬不能驗證 iOS 主畫面容器或實際 Safari 網址列，仍需 iPhone 實機驗證。
