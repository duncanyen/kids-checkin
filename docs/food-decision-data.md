# 吃什麼：選單與每日資料

管理者後台從 `system_menus` 載入功能開放清單；既有清單缺少 `food` 時，只補上此項，不覆寫其他設定。新建清單也包含此項。個人設定使用同一份功能名稱清單，且仍受個人 `menus` 權限限制；若原本未開放，管理者須先勾選成員的「吃什麼？」。

個人卡片顯示／排序存於 `userSettings/{accountId}`，首頁兩個 renderer 與個人設定共用讀取方式。舊姓名文件僅在有相符 accountId，或全站只有唯一同名且帳號相符時採用。更名不搬動或刪除姓名文件，避免同名成員互相影響；更名前會先保存可確認歸屬的設定至帳號文件。

## 儲存與查詢

- 群組取目前選擇的 `lastGroupId`，其次為登入資料的 groupId；不再使用寫死的預設群組或訪客帳號。
- 進入頁面先驗證 `groups/{groupId}.members` 與帳號資料，載入該群組餐廳及成員大頭照。
- 餐廳維持 `food_restaurants`，以 groupId 查詢；新增時寫入 groupId 與建立者 accountId。
- 投票固定文件為 `food_votes/{groupId}_{YYYY-MM-DD}_{餐別}`；日期依畫面月曆選取的本地日期，餐別為早餐、午餐、晚餐、宵夜。
- `votes` 以 accountId 作 key；同一人改投會覆寫自己的票。transaction 讀取最新文件及群組成員資格，保留其他人的票，避免同時投票覆蓋。
- 每票保存 accountId、name、avatar、choice、restaurantId、source、time；姓名與頭像顯示優先使用目前成員資料，統計僅顯示目前成員的票。
- 「那就出發吧」保存 `decision: { choice, accountId, time }`；改投後清除舊決定。
- 日期／餐別切換會解除舊訂閱、清空前次顯示，再訂閱對應文件；過期請求不更新畫面。輪盤切換日期／餐別後取消，避免動畫完成時誤存到新日期。
- 寫入失敗不更新假資料，會顯示錯誤；成功資料由 Firestore 訂閱更新。分享按鈕使用瀏覽器分享或複製，供使用者自行貼至群組。

舊版本使用 addDoc 產生隨機 ID。載入日期／餐別時查詢同 groupId/date/meal 舊文件，把各帳號最後時間的票合併至固定文件，保留固定文件已存在的票。`legacyImported` 標記避免重複匯入；原始文件保留，跨群組資料不合併。

## 驗證

啟動本地 HTTP server 後執行：

```sh
FOOD_BASE_URL=http://127.0.0.1:8012 node tests/food-browser.cjs
```

測試攔截 Firebase 模組並使用記憶體資料，沒有正式資料庫讀寫。涵蓋選單補齊、個人設定保存／首頁顯示、群組與日期餐別隔離、重新整理、改投、儲存決定、舊資料相容、並行投票、寫入失敗、餐廳新增及取消輪盤。
