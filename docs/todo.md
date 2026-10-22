# Nexus 待辦

## 資料與相容性

- 沿用 todos/{groupId}；不寫入 events。
- 文件保存 groupId、文件建立者 accountId、updatedByAccountId，
  以及 categories、todos、recurringTemplates。
- 每筆新待辦與循環設定都保存建立者 accountId、顯示用 operator、
  所屬 groupId。編輯不會把原建立者換成編輯者。
- 個人指派以 assigneeAccountIds 為識別，assigneeScope 為 members；
  所有人員使用 all，會隨目前群組成員顯示頭像。
  保留顯示名稱快照 assignees，相容既有首頁小工具。
- 頭像直接使用個人設定上傳後保存的 users.avatar，支援 JPEG data URL 與圖片網址；
  不使用固定人物照片。只有未上傳或載入失敗時才以姓名字樣佔位。
  開啟表單與返回頁面時會重新讀取本群組的頭像，並更新主列表。
- 人員從 groups/{groupId}.members 的 accountId 分批查詢 users。
  不以姓名連接不同群組，不再建立小明、小華等示範資料。
- 舊的姓名指派僅在本群組唯一對應時解析；同名或離開群組時要求重新選擇。
- 寫入使用交易，讀取最新待辦與群組成員後再修改，保留其他成員剛新增的資料；
  儲存失敗時保留表單，不顯示為已成功。

## 完成紀錄

預設收合，分為「今日完成」與「過往完成」，每頁 10 筆。
新紀錄保存 ISO completedAt、台北日期 completedDate 和 completedByAccountId。
沒有年份的舊完成時間保留在過往紀錄，不猜測年份。
跨越台北午夜、返回頁面時會更新分組。

## 循環待辦

每日支援每隔 1–30 天；每週使用開始日期的星期；每月與每年保留原始日期，
遇到不存在的日期使用月底，因此 1/31 → 2/28 → 3/31，不會永久偏移到 28 日。
閏日同理。時間使用 Asia/Taipei，結束日期含當日。

建立時先顯示第一筆（可為未來日期），之後在載入、返回待辦頁或頁面開啟期間
每分鐘，補齊已到期項目。此專案沒有伺服器排程，頁面關閉期間不會在背景寫入；
下次開啟時補齊。無需額外的伺服器或憑證。

循環以固定的「設定 ID + 日期」產生項目 ID，並在同一交易中更新 nextIndex，
避免重複；每次最多補 200 筆，再接續補齊。編輯或刪除單筆不影響後續循環，
停止循環保留已產生與已完成的紀錄。原有文件大小限制仍適用於大量歷史資料。

## 驗證

Node 24 與系統 Chromium / Playwright：

1. 執行 node --test tests/todo-core.test.mjs
2. 在專案根目錄啟動靜態伺服器。
3. 執行 TODO_BASE_URL=http://127.0.0.1:8004 node tests/todo-browser.cjs

瀏覽器測試攔截 Firebase 模組，使用記憶體資料，不連線正式 Firebase。
涵蓋 12 位群組成員、同名與改名、穩定帳號 ID、完成分頁、循環補齊與停止、
分類沿用、錯誤驗證、儲存失敗重試、保留最新資料、群組隔離。
