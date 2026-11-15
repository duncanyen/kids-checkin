# 偷蛋流程優化與驗收

本次只修改前端操作、結果呈現與原交易的逾時確認。沒有修改 Cloud Functions、Rules、冷卻時間、守衛犬機率、扣蛋、金幣、任務或排行榜規則；沒有執行正式部署或操作正式玩家資料。

## 流程與耗時盤點

- `VisitScene.attemptSteal()` 原先已無固定 3 秒等待，也沒有每次偷蛋前的確認對話框。「確認雞舍中…」是畫面文字。原 `createConfirmDialog()` 是協助清潔確認，保留。
- `VisitScene` 的 `Between(1000,3000)` 是雞隻移動間隔；怪物退場的動畫、空蛋提示的 500 ms 著色都不是偷蛋交易的強制等待。本次沒有改動這些遊戲行為。
- 請求仍走既有合併 `visitEncounter({reusePermit:true,stealWhenClear:true})`，正常情況一個 callable 完成驗證與偷蛋。初次村落驗證進行中時等待同一工作，舊後端仍支援既有分開的 `stealEgg`。
- 原彈窗會在成功回傳後 `await prepareFarmResultAssets()`，下載較慢可能等至素材 8 秒逾時。現在偷蛋結果不等待圖片載入，文字、數量與關閉控制立即建立；圖片繼續使用預熱／瀏覽器快取。冷快取仍可能稍後才顯示圖片，沒有假稱下載已完成。收蛋彈窗仍沿用原本的等待策略。
- 偷蛋彈窗停用原 150／180 ms 的遮罩與面板淡入；不是減少交易時間，而是確保結果第一個畫面就清楚可見。按鈕沒有等待動畫完成的門檻。

## 玩家操作

沿用「村落 → 公開村落一覽 → 選擇村落 → 對方雞舍」。拜訪場景加入使用現有木牌元件的明確「偷蛋」按鈕。雞隻或雞蛋圖示點擊只提示這個操作，避免觸碰場景就發生經濟交易。

點下按鈕在同一次事件中縮至 0.95、變色並停用該按鈕，立即啟動請求，不停用整個場景輸入。500 ms 內不顯示等待文字；超過才顯示「正在偷蛋…」。伺服器結果回傳即清除提示，成功且有蛋才開既有結果彈窗。

守衛犬攔截、冷卻、沒有蛋、倉庫滿及失敗保留原提示；怪物仍須先完成戰鬥。結果視窗才按照既有共用遮罩阻擋場景操作。確定與關閉共用 UI 清理，留在原本拜訪的村落，不再執行交易。

## 逾時確認

`farmCommand()` 已以帳號、來源群組、action 和完整 payload 對應 sessionStorage 的原 requestId；後端 `ops_farm_transactions` 收據先於經濟驗證讀取，重播相同 ID／payload 就回傳原結果。

新流程對不明確的逾時／連線錯誤顯示「結果確認中」，最多自動確認一次，使用相同 action、payload 與 requestId。這是既有 callable 的冪等重播，沒有新增一筆交易 ID；若第一次尚未提交，原交易仍可能由這次確認完成，並非獨立唯讀查詢。

兩次都無法確認時停止自動確認，按鈕改成「確認結果」。再次操作或正常重新整理再拜訪此村落，先找回尚未確認的請求，跳過可能已因原交易更新的前端冷卻／空蛋檢查，但仍接受後端全部驗證。明確拒絕才釋放原 ID；不可自行清除 pending storage 再當新交易重試。偷蛋的 `functions/deadline-exceeded`、未知連線結果也保留原 ID；離開場景或切換帳號／群組就停止自動確認，不在新的身分下重送。

限制：sessionStorage 屬於單一瀏覽器分頁；關閉分頁、清除瀏覽器資料或換裝置，無法用目前介面查詢另一分頁遺留的未知收據。若要跨裝置主動查回最後一筆交易，需要另外增加伺服器查詢入口。本次沒有假造該能力，也沒有用新的交易自動補發。

## 個體來源與顯示

現有 `readyEggs.{breed}` 只有按品種彙總，沒有每顆蛋與 `hensState[].id` 的關聯，不能由雞群名單推測偷自哪一隻。現行實際回傳仍為 `eggSources[{henId:null,breed,quantity}]`，畫面保留「烏骨雞蛋 × 1」等可信資訊，不顯示來源未記錄或額外小字。

若成功回傳具有真實 `henId` 與公開 `henName`，顯示同一行「雞名／雞蛋名稱 × 數量」，按照個體 ID 分組；同名或同品種不同 ID 不合併。測試的具名多母雞資料僅用於 UI 及分組驗收，沒有宣稱現有交易能記錄不存在的個體來源。

## 量測方式

前端輸出 `farm-theft-flow`，包含點擊至下一個畫面的回饋、啟動 farmCommand、回傳及結果下一個畫面的時間。既有 `farm-theft-latency` 則提供往返和後端 identity／rate-limit／transaction／handler 時間。啟動 farmCommand 並不等於封包已離開裝置，認證或待結算工作也可能在其中。

隔離瀏覽器測試另在實際 callable SDK 邊界與 DOM 出現後的下一個 requestAnimationFrame 量測，輸出原始 JSON。這是畫面呈現的近似時間，不是實體螢幕光學量測。

前後條件：同一 Linux 容器、Chromium、390×844 viewport、真實 Phaser 3.60.0、隔離 Firebase SDK、真實後端服務搭配 MemoryDB；依序測量，素材已預熱。基準程式為 Git `3517dab`。注入 60／350／900 ms 的 callable 服務延遲，各 20 筆成功操作，前後各 60 筆；每筆測試會在隔離資料重設冷卻及補回待偷蛋，不改正式設定。基準點雞隻即偷蛋，新版點明確按鈕才偷蛋；操作計時均從真正發起交易的點擊開始，不計入村落導覽或提示步驟。

手機 Wi-Fi、實體行動網路、iPhone Safari／Android 真機、正式 Cloud Functions 冷啟動與正式 Firestore 競爭均未實測。模擬延遲不是行動網路測試，不能據此保證正式環境中位數小於 500 ms。

所有時間單位為 ms，表格為「中位數／P95」（P95 採 nearest-rank）。

| 注入服務延遲 | 版本 | 樣本數 | 點擊→回饋 | 點擊→請求 | 請求→回傳 | 點擊→結果 | 回傳→結果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 60 | 修改前 | 20 | 35.5 / 64 | 1 / 1 | 92.5 / 104 | 118.5 / 144 | 31.5 / 68 |
| 60 | 修改後 | 20 | 39 / 74 | 0 / 1 | 67.5 / 107 | 108.5 / 137 | 39.5 / 67 |
| 350 | 修改前 | 20 | 34 / 61 | 1 / 1 | 360.5 / 383 | 402.5 / 434 | 34.5 / 70 |
| 350 | 修改後 | 20 | 43 / 74 | 0 / 1 | 371 / 403 | 410.5 / 438 | 36.5 / 58 |
| 900 | 修改前 | 20 | 34.5 / 65 | 1 / 1 | 918.5 / 942 | 954.5 / 983 | 33 / 46 |
| 900 | 修改後 | 20 | 46.5 / 77 | 0 / 1 | 923 / 939 | 963.5 / 980 | 38 / 50 |

原始樣本：[修改前](verification/steal-flow/before.json)、[修改後](verification/steal-flow/after.json)。

暖快取的前後差異很小，350／900 ms 組並未顯示總時間改善；差距屬此次環境的數 ms 排程波動，不能宣稱已消除正式站三秒延遲。新版 60 筆回饋的最大值為 88 ms。

900 ms 組的主要耗時是請求到回傳（包含注入服務延遲），前端不能在真實結果前顯示成功。這組超過 500 ms 是預期限制；若正式站同樣出現約三秒，應收集既有 `farm-theft-latency` 中的 handler／transaction 與 roundTrip：handler 長就追查後端與 Firestore 交易；roundTrip 遠高於 handler 時優先追查認證、網路與區域距離。隔離 MemoryDB 不代表正式 Firestore 的效能。

## 功能驗收

全套 341 項 Node 測試通過（包含離場停止確認案例）。原收蛋彈窗、拜訪許可，以及商店、清潔、真實戰鬥結算與每日任務的 Phaser 整合回歸通過。

- 原 HUD 村落按鈕、公開列表、群組卡片與雞舍圖示，以真正滑鼠座標點擊進入，沒有直接呼叫 scene.start 代替導覽。
- 正常成功、同名／同品種不同個體的來源版型、來源缺少、守衛犬攔截、空蛋、交易拒絕、彈窗建立失敗、重複開關、長明細捲動與重新整理均通過。
- 850 ms 慢請求：前 180 ms 無等待文字，超過 500 ms 顯示提示，其他場景輸入仍可用；快速連點只發一筆偷蛋請求。
- 真正客戶端 deadline 縮短至 100 ms（僅測試）：第一筆已提交後延遲 350 ms 回覆，確認請求使用同一 ID 讀到同一收據，入庫與排行只增加一次；舊回覆稍後到達也不重開彈窗。
- 連續兩次 deadline：保留 ID／確認結果按鈕；重新整理並由原導覽拜訪同一村落，查回原收據，沒有多扣蛋或多發蛋。
- 阻擋偷蛋彈窗 PNG 載入時，實際偷蛋仍能顯示總數與明細，確定／關閉可操作；釋放下載後圖片正常顯示，不等待 8 秒素材逾時。
- [拜訪場景的明確偷蛋按鈕](verification/steal-flow/action-390.png)。
- [原遊戲入口的手機尺寸截圖](verification/steal-flow/mobile-390.png)。截圖為隔離環境，非手機真機或正式玩家資料。

## 修改檔案

- `js/farm/VisitScene.js`：明確操作、按鈕回饋、延遲提示、同筆交易確認與分段計時。
- `js/farm/steal-request.js`：不明結果分類及一次冪等確認。
- `js/farm/backend-client.js`：保留 deadline 請求 ID，找回本村落未知結果。
- `js/farm/egg-result-ui.js`、`js/farm/steal-result-ui.js`：偷蛋使用立即建立的共用彈窗，圖片非阻塞載入。
- `js/farm/steal-result.js`：只在有真實個體 ID／公開名稱時顯示名稱。
- `css/farm-egg-result.css`、`farmgame.html`：偷蛋彈窗立即可見、更新 CSS 版本。
- `tests/farm-steal-request.test.mjs`、`tests/farm-steal-result.test.mjs`、`tests/farm-private-backend-browser.cjs`：資料、逾時、防重、正常入口及前後量測。
- 本文件與 `docs/verification/steal-flow/`：證據及原始數據。

## 可重跑的測試

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
STEAL_FLOW_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
STEAL_FLOW_TESTS=1 STEAL_FLOW_ASSET_HOLD=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
EGG_RESULT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
VISIT_PERMISSION_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

需先啟動 Repository 的靜態測試伺服器（預設 8032）並準備真實 Phaser 3.60.0 檔案；不是連接正式 Firebase。前後量測分別加上 `STEAL_FLOW_BENCH=1`，基準再加 `STEAL_FLOW_BEFORE=1`，應依序執行，避免相互競爭。基準透過 `git show 3517dab` 載入原程式與 CSS，不切換工作目錄的版本。
