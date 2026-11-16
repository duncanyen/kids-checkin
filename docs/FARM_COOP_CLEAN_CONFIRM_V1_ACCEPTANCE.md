# 協助打掃雞舍確認視窗 V1 驗收

## 實作範圍

只替換拜訪他人雞舍時的確認視窗及前端事件。從原本「村落 → 公開村落 → 村落卡片 → 玩家雞舍 → 點雞舍屋頂」開啟，不增加入口。自家清潔視窗、清潔數值、後端資料結構、Rules、每日任務計數及遊戲規則維持原流程。

先閱讀附件 `README.md`、`manifest.json` 並檢視 `preview.png`。五張獨立 PNG 原樣放入 `assets/farm/coop-clean/v1/`，均為 RGBA，Alpha 範圍 0–255；沒有重新生成、裁切或 CSS 模擬木框。預覽圖只用於比對，沒有載入成遊戲背景。

| 素材 | 原尺寸 | 用途 |
| --- | --- | --- |
| `coop_clean_panel.png` | 602×684 | 完整木框與底部花草 |
| `coop_clean_title.png` | 1066×233 | 木牌與母雞，疊加「打掃雞舍」 |
| `coop_clean_illustration.png` | 836×610 | 雞舍／母雞／掃帚插畫 |
| `coop_clean_button_no.png` | 616×141 | 左側「否」 |
| `coop_clean_button_yes.png` | 616×140 | 右側「是」 |

## 共用容器與版面

把原收蛋／偷蛋彈窗的遮罩、Phaser 輸入鎖、焦點恢復、shutdown／destroy 冪等清理抽成 `createFarmDialog()`。收蛋及偷蛋仍使用原本的介面與圖片、捲動、關閉流程；新打掃視窗使用同一容器，替換面板及內容。

面板保持 602:684。預覽中的 704×800 面板是排版基準：標題左 8.24%、上 -6.375%、寬 83.52%；插畫左 24.43%、上 14.125%、寬 51.14%；按鈕左側 13.21%／52.7%、寬 34.09%。圖片以原比例 contain 顯示。

兩個真正的 DOM button 等寬、等高，觸控高度至少 44 CSS px。兩張按鈕原圖高度相差 1 px，原圖比例保留，透明觸控區尺寸一致。短名稱保持兩行訊息，極長名稱在名稱區換行及捲動，確認問題維持可見。安全區、短螢幕、橫向畫面不遮住按鈕。狀態訊息僅在處理／失敗／結果未明時出現。

## 名稱、目標與交易

- 名稱使用 Lobby 既有公開成員資料傳入的 `VisitScene.targetName`，以 `textContent` 顯示，不查新 collection，也不把示例姓名寫死。名稱空白時顯示「這座雞舍有點髒亂，是否要幫忙打掃雞舍？」。
- 開窗捕捉並固定 `targetGroupId`、`targetAccountId`、`visitToken` 與公開姓名。切場景時由共用清理關閉；若同場景目標識別改變，每個 update 也會關閉舊視窗。按「是」前再次驗證目標；不使用等待期間可能變動的 `this.targetGroupId` 組成原交易。
- 「否」不執行任何清潔請求，留在原雞舍；Escape 同樣取消。按「是」後兩個按鈕暫停操作，綠鈕顯示「處理中…」。DOM busy 與 scene 的共用 Promise 同時防重，直接連呼既有方法也只執行同一工作。
- 清潔仍走既有 `helpClean`：每次有效操作最多減少 30 髒亂值、原道德值規則及一次後端驗證的每日任務事件。沒有新增前端計數器或第二套餘額／庫存。
- 成功關閉並沿用原成功浮字；對方已被打掃時關閉並提示已乾淨，不計任務。明確失敗保持視窗，恢復按鈕並顯示錯誤。
- 逾時不自動重送。沿用 `farmCommand` 的 sessionStorage 原 requestId，手動按「確認結果」查回同一交易。也保留 helpClean 的 deadline-exceeded／未知連線結果 ID，不把結果未明當作可另開新交易。
- 已送出後切換村落，原交易仍可能成功，但只更新原目標；不在新村落顯示舊成功訊息，也不清掉新場景的請求狀態。關閉視窗不能撤銷已提交的伺服器交易。

## 驗收結果

真實 Phaser 3.60.0、Linux Chromium、390×844 及其他 viewport，Firebase SDK／後端資料庫使用隔離 fixture，沒有寫入正式玩家資料。

| 項目 | 結果 |
| --- | --- |
| 原公開村落入口及雞舍點擊 | 通過，使用實際滑鼠座標點擊 |
| 不同村落主人 | 通過，B 村落「村長 Bob」及 C 村落「Carol 村長」 |
| 名稱尚未取得 | 通過，顯示一般雞舍提示 |
| 長名稱、文字注入 | 通過，換行／捲動，HTML 字串只顯示文字，不建立 img 或執行程式 |
| 小螢幕與適配 | 通過 320×568、375×667、390×844、430×932、768×1024、844×390；無水平溢出，兩鈕至少 44 px 且等大 |
| 否／取消 | 通過，沒有 helpClean，髒亂值及任務進度不變、場景輸入恢復 |
| 是／連點 | 通過，一筆有效交易，70→40，任務只加一次；等待期間取消及確認皆停用 |
| 明確失敗 | 通過，沒有資源或任務變動，錯誤可見，兩鈕恢復 |
| 已被他人清潔 | 通過，UI 快照仍髒而後端已為 0 時，後端拒絕並提示已乾淨，不計任務 |
| 交易已提交但回覆逾時 | 通過，測試用 client deadline 100 ms、回覆延遲 350 ms；不自動第二次請求，手動確認 ID 相同，70→40 而非 10，任務只加一次 |
| 開窗後切換村落 | 通過，舊視窗關閉，不送清潔 |
| 請求中切換村落 | 通過，已接受的原請求只打掃原雞舍，不更動新村落或重開舊視窗 |
| 監聽器清理 | 通過，取消前後 shutdown／destroy／update 的 listener 數量一致 |

350 項既有 Node 測試通過。收蛋結果、偷蛋結果及逾時確認、怪物進場阻擋、商店／餵食／清潔／實際戰鬥與每日任務的 Phaser 整合回歸通過。`git diff --check` 通過。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
COOP_CLEAN_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
EGG_RESULT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
STEAL_FLOW_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
ENTRY_ENCOUNTER_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

需先在 8032 啟動靜態伺服器並準備 Phaser fixture。上述不是 iPhone Safari 真機、正式 Firebase 或 Emulator 全套驗證；本次沒有 Rules 或 Functions 修改。

## 實際截圖與差異

- [原拜訪入口 390×844](verification/coop-clean/gameplay-390.png)
- [小螢幕／長名稱 320×568](verification/coop-clean/long-name-320.png)
- [接近預覽原比例的遊戲畫面 390×693](verification/coop-clean/gameplay-reference-ratio.png)
- [預覽與實際遊戲並排](verification/coop-clean/preview-vs-gameplay.png)

與預覽的差異：背景是原本動態遊戲加既有遮罩，沒有換成預覽中的純色背景；姓名使用實際測試主人，非示例姓名。原彈窗安全內距為上 24／下 12 px，因此相同比例下的整體中心較預覽約下移 6 px。字型使用既有 system-ui，附件沒有提供字型；字寬與行距可能有小差異。極長名稱需要局部捲動。圖示與木框均為原 PNG，沒有修補或重新繪製。

## 修改檔案

- `farmgame.html`：載入清潔視窗 CSS、更新共用 CSS 版本。
- `css/farm-coop-clean.css`：素材排版、手機觸控與長文字。
- `js/farm/coop-clean-ui.js`：確認畫面、動態文字、按鈕與結果狀態。
- `js/farm/farm-dialog.js`：沿用的共用遮罩與生命週期。
- `js/farm/egg-result-ui.js`：接到共用容器，原收蛋／偷蛋呈現保持原流程。
- `js/farm/VisitScene.js`：原入口接線、固定目標、一次清潔與既有提示。
- `js/farm/backend-client.js`：helpClean 的不明結果保留原 ID。
- `tests/farm-private-backend-browser.cjs`：原入口、交易、適配與失敗案例。
- `tests/farm-map.cjs`：拜訪清潔視窗改用新 DOM 確認狀態。
- `assets/farm/coop-clean/v1/`：五張 PNG 與附件原 README／manifest。
- 本文件及 `docs/verification/coop-clean/` 四張截圖。

尚未執行 GitHub 推送或正式部署。本次前端發布即可，不需重新部署 Functions、Rules 或索引。

## 跨群組同帳號打掃修正

後端 helpClean 原先僅比較 targetAccountId 與目前 accountId，誤將不同群組的獨立雞舍當成自家目前雞舍。改為同時比較群組與帳號；跨群組同帳號沿用既有拜訪權限與髒亂值判定，目標減少 30 髒亂，來源農場沿用 +3 道德值（上限 100），同一收據重送不重複更新。

每日任務仍要求其他帳號：同帳號跨群組清潔不產生 HELP_CLEAN_OTHER 任務事件，不放寬每日任務的原有驗證。清潔他人仍正常累計。公開村落、成員資格、怪物結算及已乾淨拒絕等條件不變。

驗證：363 項 Node 測試通過；新增原子交易／重送／群組隔離／封閉村落／缺少成員／空髒亂／自家目前雞舍／怪物阻擋及任務資格測試。`CROSS_GROUP_SELF_CLEAN_TESTS=1` 真實 Phaser 隔離瀏覽器模式從原 HUD、公開村落、同帳號雞舍及確認入口操作，取消不送出、三次快速確認只一筆有效交易，70→40 且來源髒亂仍 30，任務進度維持 0。原 COOP_CLEAN_TESTS 六尺寸、錯誤、逾時收據確認與切換村落回歸通過。測試不存取正式玩家資料。

本次變更在 gameOpsFarmTransaction 交易核心，需從 game-admin 部署 `--only functions:nexus-ops:gameOpsFarmTransaction`；既有雙區設定會同時更新台灣與新加坡。每日任務 Functions、Rules 及前端不需因本修正另行部署。尚未執行正式部署。

## 自家雞舍共用確認視窗

依使用者確認，只統一提醒視窗與操作，不調整各自數值：自家 cleanOwn 一次清到 0、不增加道德值；幫別人 helpClean 每次減少 30、幫忙者道德值 +3（上限不變）。原有每日任務資格保持，自家清潔不計入協助他人。

MyFarmScene 點雞舍後共用 coop-clean-ui 的木框、插畫與是／否按鈕，內文為「你的雞舍有點髒亂，是否要打掃雞舍？」。按否不交易、按是同步鎖定並防連點；成功後關閉，不顯示成功浮字或下方正常處理狀態文字。錯誤可重試，逾時保留 cleanOwn 原 requestId，由玩家確認原交易，不自動新增交易。

圖片背景預熱，不阻塞主要遊戲；同場景只一個清潔視窗，離開場景清理遮罩並恢復輸入。有生病母雞時，原雞舍管理／治療入口保留，從「清理雞舍」進入相同木質確認畫面。原治療用 Phaser 視窗不因本次清潔改版而移除。

371 項 Node 測試通過；OWN_COOP_CLEAN_TESTS=1 真實 Phaser、原自家雞舍點擊驗收取消、失敗恢復、快速連點一筆、已乾淨、逾時同收據、切場景清理、生病母雞管理流程及任務不誤計。原他人雞舍確認與完整遊戲回歸通過。測試為 Linux Chromium／隔離 Firebase，不是 iPhone 真機或正式資料驗收。

截圖：[390×844 自家雞舍確認](verification/coop-clean/own-farm-390.png)。本次只改前端與測試，不需部署 Functions 或 Rules。
