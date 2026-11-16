# 拜訪確認移至列表載入階段

## 調整後流程

點選玩家雞舍 → 顯示既有母雞走路過場動畫與「正在載入村落…」 → 既有素材、群組權限、目標存檔與伺服器怪物判定完成 → 才切入拜訪場景。

`LobbyScene` 將原本的資料讀取與 VisitScene 全素材預載平行處理，素材完成後才呼叫既有進場／里程碑 API，避免把怪物倒數耗在下載素材上。未新增 Firebase API 或寫入類型，也沒有在載入階段收蛋、偷蛋或增加任務進度。

`VisitScene` 使用本次選擇的資料與伺服器結果初始化，不再於畫面出現後重跑一次進場確認，也不顯示「確認村落中」。即時資料與村落隱私監聽仍在背景執行；偷蛋／打掃等交易仍由後端驗證權限及怪物狀態。

一般怪物及地鼠／蛇王／巨人的既有優先順序保留。已逾時的舊事件由後端結算，再確認目標；若其他雞舍有未結算事件，留在列表提示返回自家處理，不默默改成另一個目標。

預先結果綁定來源帳號、來源群組、目標群組與主人，且僅交接一次。同一場景重新啟動時不重用舊結果；不是把它當成長期快取或授權憑證。非列表直接切入場景（例如原戰鬥恢復）仍保留原安全確認路徑。

載入中連點只執行同一工作，包含伺服器回覆到 Phaser 完成切場景的短暫期間。切換群組、頁碼或離開列表後會丟棄舊回覆，不讓它切進已取消的雞舍。已送出的伺服器事件不能因取消畫面而抹除；仍由既有原目標結算規則處理。

## 驗收

- 353 項 Node 測試通過，包括清場結果為 null、里程碑優先順序、舊事件補確認、取消與錯誤目標。
- 真實 Phaser＋隔離後端，從原 HUD／公開村落卡片／玩家雞舍座標點擊驗證。
- 慢回覆時仍在列表載入，沒有提早切入拜訪畫面。
- 連點僅一筆進場命令；入場後沒有第二次進場命令或確認文字。
- 猩猩在載入階段確認，入場直接呈現怪物。
- 載入失敗留在列表，可再次點擊重試。
- 請求中改選自己的村落，舊回覆不切場景。
- 同一 prepared 結果只使用一次，重啟場景會重新確認。
- 既有怪物進場／戰鬥阻擋、打掃確認視窗、偷蛋與逾時防重回歸通過。

截圖：

- [列表載入階段](verification/visit-preparation/loading-list-390.png)
- [進場後直接可操作](verification/visit-preparation/ready-farm-390.png)

測試為 Linux Chromium 390×844、真實 Phaser 3.60.0、隔離 Firebase SDK／MemoryDB；不是 iPhone 真機或正式環境驗證。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
VISIT_PRELOAD_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
ENTRY_ENCOUNTER_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
COOP_CLEAN_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
STEAL_FLOW_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```

需先啟動 8032 靜態伺服器並提供 Phaser fixture。沒有修改或部署 Functions、Rules、索引或正式資料。本次只需發布前端；前次進場優化與打掃視窗已於 `8520535` 推送；本次母雞過場調整尚未推送。

## 修改檔案

- `js/farm/LobbyScene.js`：載入階段準備、防連點、取消與錯誤處理。
- `js/farm/visit-entry.js`：既有伺服器進場命令及里程碑選擇。
- `js/farm/VisitScene.js`：一次性交接資料與結果，保留背景監聽與直接進場備援。
- `tests/farm-visit-entry.test.mjs`、`tests/farm-private-backend-browser.cjs`。
- 本報告及 `docs/verification/visit-preparation/`。

## 母雞載入過場追加驗證

沿用 `loading-ui.js` 與已載入的母雞 Atlas，沒有新增動畫素材或固定等待時間。資料與素材完成後顯示 70%，進場驗證完成後顯示 95%，場景就緒即關閉；這些是完成階段比例，不是網路下載百分比。離開、切換選擇與載入失敗會清除本次過場，成功時由既有進場完成流程收起。

本次重新執行 3 項進場單元測試與 `VISIT_PRELOAD_TESTS=1` 真實 Phaser 瀏覽器流程，均通過；額外檢查母雞 canvas 可見、慢請求期間遮罩持續顯示、到達及取消後遮罩消失。未重跑上次完整 353 項測試。
