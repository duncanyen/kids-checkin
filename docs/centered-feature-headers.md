# 功能頁置中標題

從 Nexus 側邊功能導覽直接進入時，以下頁面使用共用 `css/feature-header.css`，顯示 24px SVG 與 20px 粗體功能名稱：

- 行事曆
- 成長森林
- 待辦事項
- 遊戲大廳
- 管理者後台

頁首採左右等寬欄位，讓功能名稱位於頁面中央，返回按鈕放左側、既有操作放右側。380px 以下改成標題置中於第一列、返回與操作位於第二列；遊戲頁因右側包含玩家資訊，600px 以下即使用兩列，避免重疊。

從底部導覽進入時，行事曆、待辦事項與森林維持左側功能名稱。查看成員森林時，保留返回自己的森林與成員名稱。

移除待辦卡片原本的「待辦」標題與右側「循環待辦」新增入口。既有待辦紀錄、排程資料及處理邏輯保留；循環處理的回歸測試改從既有 API 開啟表單，避免依賴已移除的入口。

遊戲大廳的標題移至頁首，保留既有 `gameZoneTitle`；遊戲切換只更新內部 `gameZoneLabel`，避免初始化或回到大廳時清除 SVG。

## 驗證

- 全專案單元測試：165 項通過。
- `tests/feature-headers-browser.cjs`：五個直接入口的置中標題、SVG、返回按鈕、320／390／768／1440px 版面，以及底部入口與成員返回。
- `tests/todo-browser.cjs`：待辦新增、指派、完成、循環處理、錯誤重試與群組隔離。
- `tests/calendar-icons-browser.cjs`：行事曆工具列、設定、視圖及編輯刪除。
- `tests/game-2048-touch.cjs`：真實觸控、遊戲操作及返回大廳。
- `GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs`：森林查看成員、分頁與返回。

瀏覽器測試均使用本機頁面與隔離 Firebase fixture，不寫入正式資料。
