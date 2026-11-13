# 排行榜 V2 素材

原始圖由專案擁有者提供，保留於 source/asset-sheet.jpg 與 source/reference.jpg。前者是 1280×960 白底 JPEG，後者是 720×1280 版面設計稿。執行時只使用獨立 PNG，沒有把整張參考畫面當背景。

以 `python3 scripts/extract-leaderboard-assets.py` 重製切圖，使用 Pillow；執行 `python3 scripts/verify-leaderboard-assets.py` 驗證來源及未重繪像素。去除的是與外部相連的白底，並對外緣做 white-matte 修正；未改寫不透明內部像素。manifest.json 保留原檔 SHA-256、裁切矩形與重用資訊。座標為左／上包含、右／下不包含。

| 素材 | PNG | 來源座標／重用來源 |
| --- | --- | --- |
| title | `leaderboard_title.png` | [22, 0, 540, 160] |
| close | `leaderboard_close.png` | [543, 44, 646, 153] |
| category | `leaderboard_category.png` | [22, 162, 575, 253] |
| panel | `leaderboard_panel.png` | [646, 28, 1104, 778] |
| period_banner | `leaderboard_period_banner.png` | [18, 264, 537, 351] |
| divider | `leaderboard_divider.png` | [42, 353, 592, 397] |
| row_gold | `leaderboard_row_gold.png` | [18, 402, 627, 489] |
| row_silver | `leaderboard_row_silver.png` | [18, 489, 627, 574] |
| row_bronze | `leaderboard_row_bronze.png` | [18, 574, 627, 658] |
| row_normal | `leaderboard_row_normal.png` | [18, 658, 627, 737] |
| medal_gold | `leaderboard_medal_gold.png` | [1117, 32, 1272, 173] |
| medal_silver | `leaderboard_medal_silver.png` | [1117, 177, 1272, 285] |
| medal_bronze | `leaderboard_medal_bronze.png` | [1117, 289, 1272, 398] |
| gift | `leaderboard_gift.png` | [1137, 499, 1252, 614] |
| sparkle | `leaderboard_sparkle.png` | [1120, 625, 1253, 723] |
| reward_banner | `leaderboard_reward_banner.png` | [18, 743, 626, 848] |
| refresh | `leaderboard_refresh.png` | [137, 848, 515, 950] |
| grass_left | `leaderboard_grass_left.png` | [647, 788, 894, 891] |
| grass_right | `leaderboard_grass_right.png` | [959, 790, 1209, 891] |
| calendar | `leaderboard_calendar.png` | [546, 259, 634, 347] |
| rank_normal | `leaderboard_rank_normal.png` | assets/farm/daily-missions/v2/status-empty.png |

## 使用界線

- title、close、category、refresh 為真正固定的標題／功能文字，可保留原圖文字。玩家、村落、數值、期間、狀態與說明均由 DOM 動態呈現。
- 原素材一般名次徽章印有 4，沒有抹字冒充無文字版本；rank_normal 沿用每日任務現有 status-empty.png，再以 DOM 顯示 4～10。
- 金色列本身已帶星光，sparkle 獨立檔目前不額外重疊或播放動畫。
- JPEG 無法提供原始透明 alpha／陰影；邊緣壓縮痕跡及去背造成的微小差異仍可能存在。若要原生透明品質，需要補提供透明 PNG／設計原檔。
- 圓章沿用舊素材、九宮格伸縮及小螢幕文字換行均已於交付報告標示，不宣稱逐像素完整還原。
