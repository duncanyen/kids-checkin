# 成長森林導覽調整

成長森林使用自己的底部導覽列，不再同時顯示 Nexus 功能導覽或頂部森林頁籤。順序為「首頁、我的森林、成長紀錄、夢想獎勵、家長管理、成員森林」，移除數字編號，採共用 SVG 圖示。家長管理沿用原有權限檢查，一般成員不顯示。

首頁使用連結回到 `index.html?nav=1`；其餘頁籤在森林內切換並更新目前標記。所有角色（含家長與管理員）首次進入或重新整理都先顯示自己的森林；管理功能須點選家長管理。

從側邊功能導覽直接進入時，頁首改為「返回主選單」按鈕，不顯示個人名稱與箭頭。從底部導覽進入時，保留左側森林 SVG 與功能名稱。查看成員森林時保留成員名稱與返回自己森林的按鈕。

共用圖示函式讓 `wishlist` 與 `forest` 使用同一份 SVG，因此主頁側邊功能及森林頁首圖示一致。新增 `data-app-navigation="local"` 讓自行管理導覽的頁面跳過共用導覽掛載，其他功能頁行為不變。

## 驗證

使用隔離 Firebase fixture 與本機靜態伺服器：

```sh
GROWTH_NAV_ONLY=1 GROWTH_NAV_ENTRY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/navigation-browser.cjs
node tests/feature-headers-browser.cjs
node --test tests/*.test.mjs tests/*.test.cjs
```

導覽測試涵蓋一般成員、家長及管理員的初始森林、權限、頁籤切換、成員返回、重新整理、首頁連結、圖示一致，以及 320／390／768／1440px 版面。
