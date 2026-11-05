# 成長森林：精簡首頁與成員森林

日期：2026-11-06（台灣）。沿用目前前端 Firestore 暫行模式。

## 首頁調整

- 移除森林下方整排花名／種植位置按鈕，直接點花朵或土地操作；「我的植物」仍可透過位置選擇提供鍵盤操作途徑。
- 隱藏一般連線、已同步等文字，不預留其高度；錯誤與重試入口仍顯示。考試提交、購買等操作結果改用四秒浮動提示，不推擠森林。
- 將最新使用者名稱的「成長森林」放入頂列，左側只保留返回箭頭，移除 NEXUS 字樣與原本重複的大標題區。
- 「資源怎麼獲得？」移至頂列右側的 SVG Q&A 按鈕，仍開啟目前群組的實際資源規則。
- Q&A 圖示為 `assets/growth-forest/help.svg`，附按鈕名稱、滑鼠提示與鍵盤焦點樣式。

## 05 成員森林

底部導覽新增固定編號「05 成員森林」。成員列表以目前群組的 `groups.members` 帳號 ID，查詢 `users.accountId` 最新名稱與頭像，使用既有 `avatar`、`photoURL`、`avatarUrl` 優先順序；不以舊名稱猜測身分。

沒有頭像、網址不合法或圖片載入失敗時，使用名字首字。頭像使用安全 URL 判斷，名稱與標籤透過 DOM 文字賦值，不插入未處理 HTML。停用、缺失及重複 accountId 的不明確帳號不提供森林入口。

點成員後進入獨立唯讀森林畫面：

- 上方為返回箭頭與對方最新名稱。
- 只顯示森林圖；有多區土地時保留必要的上一區／下一區按鈕。
- 隱藏自己的資源、Q&A、一般導覽、種植與商店控制。
- 花朵不可點擊澆水或種植。返回箭頭直接回到自己的森林，未更改登入帳號或所選群組。
- 尚未建立森林的成員顯示空森林；瀏覽不建立花園、錢包、遷移報告，也不發放任何資源。
- 返回時使尚未完成的訪客請求失效，避免遲到回應覆蓋自己的畫面。切換成員或讀取失敗時隱藏前一位的森林。
- 訪客場景離開／背景時暫停，離頁銷毀；成員不會共用自己的可操作場景。

自己在成員列表會標示「自己」，點選會直接回自己的森林。

## API 與資料界線

新增唯讀動作：

| 動作 | 驗證與回傳 |
| --- | --- |
| `members` | 重新確認目前玩家與群組關係；只回傳目前群組中有效且可唯一辨識帳號的 accountId、名稱與頭像 |
| `memberForest` | 檢查目標為目前群組有效成員；只回傳名稱、土地數／分頁與植物外觀（ID、種類、階段、位置） |

`memberForest` 不回傳水滴、金幣、積分、種子背包、規則、獎品、考試、閱讀及遷移明細。原本的完整 `snapshot`、紀錄列表及其他寫入操作仍沿用原權限，不因可看森林就開放一般成員操作或讀取他人私有資料。

共用 `forestPage` 保留九塊分頁與原植物相容；新增動作不執行 `ensureProfile`。沒有新增 Firestore 集合，也沒有變更、放寬或部署正式 Security Rules。暫行模式直接使用 Web SDK，因此其實際存取仍受目前專案既有規則限制，不能把瀏覽器端的欄位篩選當作可信任後端授權；後續切回後端需一併驗證。詳見[前端暫行模式](growth-forest-direct-mode.md)。

## 驗證

- 全專案單元測試：163 通過、0 失敗。
- 共用服務與瀏覽器生成服務的業務案例各 21 項通過，包含最新帳號資料、公開欄位白名單、禁止跨群組／他人私有 API、禁止替他人澆水、空森林零寫入、停用／重複帳號與退出群組。
- 成員森林瀏覽器流程已通過，使用真實 HTML／CSS／Phaser 與隔離 Firebase fixture：精簡頁首、狀態隱藏、SVG Q&A、正確頭像、唯讀、分頁、返回自己的森林、空森林零寫入、手機與桌面版面。
- 原有完整瀏覽器流程、九塊分區及批次澆水回歸皆已通過；既有花卉、考試／閱讀、家長審核、商店與兌換可繼續使用。
- 不操作正式玩家資料，也不代表已完成正式 Firebase 權限或 Emulator 驗證。

```sh
node scripts/prepare-growth-forest.cjs
node --test tests/*.test.mjs tests/*.test.cjs
GROWTH_TEST_DIRECT=1 node --test tests/growth-forest-service.test.cjs
# 專案根目錄啟動 python3 -m http.server 8030 後
GROWTH_MEMBERS_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_NINE_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
```

本次尚未推送 GitHub，未部署正式 Functions 或 Security Rules。
