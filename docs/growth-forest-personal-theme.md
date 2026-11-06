# 成長森林與個人主題同步

日期：2026-11-06（台灣）。

## 問題與修改

成長森林原先未載入共用 `theme-bootstrap.js`／`nexus-theme.css`，介面使用固定米色與綠色，因此沒有跟隨 Nexus 個人設定。

此次沿用既有十種個人色票及每帳號快取：

- 頁首同步載入共用主題啟動程式，首屏先套用目前帳號的本機設定，不另建森林專用主題。
- 背景、標題、文字、資源列、按鈕、底部導覽、表單、對話框、種子商店、成員卡片與操作提示改採 `--n-*` 語意色彩。
- 暗色主題使用對應文字、表面與按鈕前景，並補上警告／錯誤狀態的暗色配色；對話框遮罩與陰影改為中性色。
- Q&A 改用 SVG `currentColor`，隨按鈕主題色切換，不再固定綠色。
- 森林插畫、植物美術與資源的辨識色保留原色，主題設定調整的是介面配色。

## 設定來源與生命週期

與設定頁一致，讀取 `userSettings/{accountId}.appearance.theme`。直接 Firestore 與保留的雲端傳輸各提供 `watchAppearance`；頁面只訂閱自己帳號的設定，使用共用 `NexusTheme.hydrate` 更新畫面與快取，沒有寫入 Firebase。

共用啟動程式維持 `nexus.appearance.v1:{accountId}` 快取、跨分頁 storage 通知、重新整理及帳號隔離。設定無法讀取時保留既有快取／共用預設主題，不阻擋森林操作。離頁取消個人設定訂閱。

查看同群組成員的森林時，仍使用目前觀看者自己的個人主題，沒有讀取或套用對方的設定。沒有變更遊戲資料、帳號設定格式、正式 Security Rules 或 Functions 部署。

## 驗證

- 全專案單元測試：163 項通過、0 失敗。
- 真實頁面、CSS、Phaser 與隔離 Firebase fixture：十種色票的背景、文字、資源卡、導覽、表單、輸入框、主要按鈕、Q&A 及狀態列色彩皆符合共用設定。
- 驗證帳號儲存值覆蓋舊快取、即時設定更新、重新整理、帳號隔離、跨分頁快取刷新、查看成員仍維持自己的主題、切換色票不清除表單輸入，以及手機／桌面不溢出。
- 成員森林與九塊分區／批次澆水回歸使用隔離資料，不操作正式玩家資料。

```sh
node --test tests/*.test.mjs tests/*.test.cjs
# 先在專案根目錄啟動 python3 -m http.server 8030
GROWTH_THEME_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_NINE_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
```

本次尚未推送 GitHub，未部署正式環境。
