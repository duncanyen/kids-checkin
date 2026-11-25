# 咕咕村落：爆擊、連續爆擊與戰鬥設定

## 確認後的規則

- 一般傷害沿用攻擊力 ±10，最低 1。
- 爆擊為「該次一般傷害 ×1.5」，每次四捨五入為整數。例如一般傷害 194，爆擊為 291。已依最後確認改為約 1.5 倍，不使用最初提及的 2～3 倍。
- 每把武器預設爆擊率 5%、連續爆擊率 5%，可各自調整至 0–100%。
- 先判定一般爆擊；如果同一武器的上一個有效命中是爆擊，另有一次獨立的連續爆擊判定。兩個判定任一成功即為爆擊，只放大一次傷害，不重複發動攻擊。
- 爆擊後下一擊的合計爆擊率為 `p + (1-p)q`。預設為 `5% + 95% ×5% = 9.75%`。
- 沒有爆擊即中斷連段。所有爆擊仍為 1.5 倍，不隨連段乘成 2.25 倍、3.375 倍。
- 只計算同一場戰鬥、同一武器的有效命中序列。近戰與遠程各自計算，避免批次排序影響結果；箭矢未命中及無效武器不會免費發動或消耗命中序號。地鼠沿用同一場戰鬥的共用 HP。
- 新戰鬥重新起算，不把上場連段帶到下一場。不增加額外連擊計時窗口，也不自動追加第二次攻擊。
- 基礎爆擊率為 0% 時，連續率即使為 100%，也不會自行啟動首個爆擊。基礎爆擊率 100% 時，每次有效命中都會爆擊。

預設的 9.75% 是「上一擊為爆擊」的條件機率，不是所有攻擊的機率。穩態整體爆擊率約為 `p / (1-(1-p)q) = 5.2493%`，平均傷害約增加 2.62%。

## 營運中心位置

左側新增獨立的 **戰鬥設定** 頁面，與既有「遊戲數值」分開：

1. 怪物 HP：九種怪物，整數 1–10,000,000。
2. 武器：八種武器，可設定攻擊力（整數 1–1,000,000）、爆擊率、連續爆擊率（皆 0–100%）。表格與編輯表單顯示爆擊後下一擊的合計機率。
3. 修改時必須填原因。保留既有管理權限、版本比對、操作防重及稽核，記錄修改者、時間、前後設定。
4. 設定存於 `ops_game_config/combat`，管理讀取使用 `gameOpsAdmin / combatBalance`，寫入使用 `saveCombatConfig`。玩家端不直接讀寫設定文件。
5. 儲存後套用於之後建立的新戰鬥；進行中的戰鬥保留開戰時的 HP、攻擊力、兩項機率及設定版本。

怪物 ID 沿用 `wolf / tiger / eagle / dragon / hornet / gorilla / mole / cobra / giant`；營運中心既有「金剛／眼鏡蛇王」名稱分別對應玩家畫面的「大金剛／毒牙眼鏡蛇王」，不新增重複怪物。

沒有既存設定時沿用原 HP／武器攻擊力並帶入兩項預設 5%；已有攻擊力或爆擊率設定的文件不會被覆寫，僅補上缺少的連續爆擊率預設。

## 命中回饋與後端驗證

- 命中立即顯示數字，爆擊使用較大數字、金色描邊與紅金色放射形外框。連續爆擊略加強外框顏色和縮放，但不增加額外文字或固定等待。
- 保留原本三分之一大小、約頭頂上方 0.3 CSS 公分的血條。傷害字和外框跟隨怪物可見頭頂，減少動態效果時保留靜態外框並縮短淡出。
- 每場以伺服器產生的亂數種子、武器模式、命中序號與開戰快照決定普通／爆擊傷害。連段序列可重現並快取，不受每批攻擊如何切分影響。
- 沿用 500 ms 合併攻擊。前端只送攻擊模式、次數、起始序號及協定版本，後端重新計算傷害，驗證裝備、期限、速率與序號。
- 不新增每一下 Firebase 請求、玩家文件監聽或每下攻擊收據。戰鬥設定只在真正產生新怪物時讀取一次，不在每批命中或重試時查詢。
- 後端確認最終 HP、戰利品、寶箱、每日任務及排行榜。重試使用原收據，不重複扣血或發獎。
- 特效最多重用八個文字和八個外框；場景離開會清除相關事件及圖形。

## 相容與發布

`combatVersion:2` 保留作為既有 HP 協定外形，新快照使用 `damageVersion:4`。瀏覽器使用 `combatProtocol:2, damageProtocol:4` 宣告能力；舊後端可忽略新增欄位並維持原本傷害。新後端在舊客戶端建立新戰鬥前要求重新載入。已有舊快照的戰鬥仍按原序列完成，不會途中改傷害或追加爆擊。

上線需要：

- 發布遊戲前端（GitHub Pages）。
- 部署 `functions:nexus-ops:gameOpsFarmTransaction` 與 `functions:nexus-ops:gameOpsAdmin`。
- 部署營運中心 Hosting（`game-admin/firebase.json` 的 `nexus-game-admin` target）。

不需要改 Rules、建立索引、搬遷玩家資料或手動初始化設定文件。只有更新數值時無須再部署 Functions。

## 測試與建議

新增測試涵蓋管理權限、數值邊界、版本衝突、防重稽核、0%／100%、5% 分布、額外連續判定、1.5 倍、批次切分與重送、不同武器／新戰鬥隔離，以及設定更新不影響現有戰鬥。另從真正的公開村落入口操作九種怪物，測試預設機率、100% 爆擊及 0% 爆擊，檢查手機排版與原遊戲流程。

實作已補齊的設計原則：有效命中才判定、倍率不連乘、跨戰鬥不延續、設定鎖定快照、特效池化、減少動態效果、後台顯示條件合計機率。

後續調整建議：

- 先維持既有 HP 和 5%／5% 預設，觀察擊殺時間、失敗率、戰利品及金幣產出，再調整數值。
- 若希望連續特效更常見，可以先小幅試調「連續爆擊率」到 10–15%；不要把條件機率誤當作整體爆擊率。
- 連續率 100% 會讓首個爆擊之後的同武器命中持續爆擊到戰鬥結束，適合測試，正式使用前應評估平衡。
- 若未來增加爆擊裝備或限時加成，應先定義加法／乘法與上限，延續後端快照，不讓客戶端直接修改機率。

## 本次實測結果與交付

- 最終版單元測試：462 / 462 通過。
- 完整瀏覽器回歸通過：登入／存檔、實際公開村落入口的九種怪物（預設機率、100% 爆擊、0% 爆擊三組）、頭頂血條、爆擊外框與連段、合併請求、唯一結算、手機小尺寸與減少動態效果、原有商店／倉庫／租犬／場景／收蛋／偷蛋／打掃／每日任務／排行榜／寶箱，以及管理頁面保存數值與既有營運功能。使用 Chromium + Phaser 3.60.0 + 隔離 SDK + 真實交易服務／MemoryDB，不代表實機 iPhone 或正式 Firebase 驗收。
- Emulator 未完成：Firestore emulator JAR 下載遭 HTTP 403 `Domain forbidden`。報告的 `emulatorPassed` 為 false，不能作為正式啟用憑證，需在 Cloud Shell 用最新版本補跑。
- 傷害純運算壓測：Cloud Node.js 22，100 個樣本，每次以新快照重建 1,400 次命中序列並計算最後 20 下，中位數 0.555 ms、P95 5.461 ms。不包含網路、Firebase、繪圖與真實手機效能，不能當作完整遊戲延遲。
- 所有測試均未修改正式資料。本次尚未推送或部署。

畫面與報告：

- [實際遊戲爆擊手機尺寸畫面](/workspace/exports/gugu-chain-critical/battle-mobile.png)（以測試用 100% 爆擊率確保可見；正式預設仍為 5%／5%）
- [小尺寸手機畫面](/workspace/exports/gugu-chain-critical/battle-small.png)
- [獨立戰鬥設定頁](/workspace/exports/gugu-chain-critical/admin-page.png)
- [手機編輯視窗，預設 5%／5%](/workspace/exports/gugu-chain-critical/admin-mobile.png)
- [驗證報告](/workspace/exports/gugu-chain-critical/verification.json)／[完整驗證輸出](/workspace/exports/gugu-chain-critical/verification.log)／[純運算測量](/workspace/exports/gugu-chain-critical/damage-benchmark.json)

修改檔案：

- `docs/farm-critical-combat.md`
- `game-admin/functions/combat-balance.cjs`
- `game-admin/functions/farm-combat.cjs`
- `game-admin/functions/farm-transactions.cjs`
- `game-admin/functions/management.cjs`
- `game-admin/site/app.js`
- `game-admin/site/index.html`
- `game-admin/site/management.js`
- `game-admin/tests/battle-page.test.cjs`
- `game-admin/tests/combat-critical.test.cjs`
- `game-admin/tests/combat-v2.test.cjs`
- `game-admin/tests/farm-backend-integration.test.cjs`
- `game-admin/tests/hornet.test.cjs`
- `game-admin/tests/management.browser.cjs`
- `game-admin/tests/management.test.cjs`
- `game-admin/tests/private-callables.emulator.cjs`
- `js/farm/ShopScene.js`
- `js/farm/backend-client.js`
- `js/farm/battle-page-client.js`
- `js/farm/combat-damage.js`
- `js/farm/combat-feedback.js`
- `scripts/test-private-farm.cjs`
- `tests/farm-private-backend-browser.cjs`
- `tests/helpers/combat-feedback-browser.cjs`
