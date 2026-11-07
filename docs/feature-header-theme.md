# 功能頁頁首與成長森林首屏主題

## 調整

- 記帳本右上角分類設定改為 44px 圓形按鈕，保留既有設定流程與主題色。
- 從底部導覽進入行事曆時，左側顯示行事曆 SVG 與名稱，切換視圖及視圖設定保留於右側。直接開啟仍保留返回主選單。
- 成長森林在 HTML 載入階段判斷底部導覽入口，左側顯示成長森林 SVG 與名稱，右側保留 Q&A。直接進入仍顯示個人森林名稱；查看成員森林保留成員名稱與返回自己的森林按鈕。

## 主題載入

共用主題啟動程式在樣式表載入前，同步設定根元素背景與文字顏色，避免頁面背景先顯示預設值。已儲存主題另保留每帳號的 sessionStorage 備份；持久儲存無法讀取時，同一分頁仍可沿用儲存值。預覽不寫入兩種快取，帳號之間仍隔離。

森林的 Firestore 個人設定訂閱加入 `includeMetadataChanges`。若已存在本機主題，忽略 Firebase 首次送出的磁碟快取設定，待伺服器確認後再同步，避免舊快取短暫覆蓋目前主題。直接 Firestore 與保留的 Functions 傳輸都使用相同處理。首次登入、沒有任何快取的帳號，仍先用共用預設值，收到設定後套用。

不修改正式 Firebase 資料、Security Rules、遊戲機制或部署設定。

## 驗證

- `node --test tests/*.test.mjs tests/*.test.cjs`：165 項通過。
- `node tests/feature-headers-browser.cjs`：延遲森林 CSS、同步背景、三個頁首、圓形設定、320／390／1440px、直接入口與成員返回鍵。
- `node tests/calendar-icons-browser.cjs`：行事曆視圖、設定、編輯與刪除操作。
- `GROWTH_THEME_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs`：26 種主題、即時同步、重新整理及帳號隔離。
- `GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs`：成員森林及直接返回。
- `GROWTH_NAV_ENTRY=1 GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs`：從底部導覽進入，查看成員後返回。

頁面測試使用本機靜態伺服器與隔離資料；不連線寫入正式 Firebase。
