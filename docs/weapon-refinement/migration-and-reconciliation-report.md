# 正式移轉工具與資產對帳完成報告

日期：2026-11-28（台灣時間）。本次僅使用本機 demo Firestore Emulator／合成資料，沒有正式資料盤點、憑證載入、備份、移轉、部署、Rules 發布或 Git 提交／推送。

## 1. 實作範圍與結果

新增可供未來正式作業使用的有界線移轉 adapter 與 CLI，並補上精煉扣款／退款的可信任同次交易帳本。既有 Phase 2 demo CLI 繼續拒絕正式專案，沒有移除它的保護。

新工具：`scripts/weapon-migration-release.cjs`。支援 `plan`、`review`（dry-run）、`migrate`、`verify`、`rollback`、`export` 與離線 `renew`。預設 Emulator 模式，只有 `migrate`、`rollback` 需要且允許 `--apply`。不會自行探索或移轉全服玩家。

### 計畫與正式連線限制

- 明確指定 project、`(default)` database、最多 50 個精確 `{uid, groupId, accountId}` 農場 scope。
- 每 scope 保存來源武器指紋、各種類數量、allocation 數、固定 generation；同一農場不能對應兩個不同 profile。
- 整份計畫含 runId、工具 sourceHash、建立／到期時間。命令必須帶確認的 `--plan-hash`，工具原始碼變動或計畫過期都停止。
- 正式模式額外要求明確 `--mode production`、沒有 Emulator 環境變數、專案一致，以及本機審核授權檔。授權綁定計畫 hash、專案、database、操作種類、操作者、24 小時內期限、備份 operation／私人桶及隔離還原確認。
- 所有目的地與檔案驗證都在 SDK／ADC 載入前完成。Emulator 模式只接受 demo-* 及 localhost，不會以正式專案名稱假裝測試。
- 正式授權檔是操作人員經審核後的本機作業控制，不是遠端簽章、IAM 權限或備份驗證服務。實際存取仍依執行身分的 Firestore IAM。不得自行填 true 代替備份／授權程序。
- 每個交易 callback 重驗最新 profile/account/group 成員，以及計畫 generation／journal 指紋。正式 CLI 每次亦重讀授權檔，檔案過期／撤銷會阻止後續批次。

**本次未建立真實正式授權檔、未載入正式憑證。** 正式連線分支僅以純參數測試驗證允許／拒絕條件，實際 SDK 及資料操作皆在 demo Emulator。

## 2. 移轉一致性

仍沿用既有權威資料設計：V1 由 farm 堆疊數量作主；staging 暫不允許武器交易／進入戰鬥／可能發武器的開箱等衝突操作；完成後私有 owner／allocations 作主，farm 保留原子投影。原有免費木棒仍是農場綁定的隱含個體，不額外生成一把可出售木棒。

每個 allocation 最多 1,000 把，個體 ID 由 owner scope、generation、來源、武器種類及批次確定。stage 與每批 resume 是各自獨立的 Firestore Transaction，讀取最新 farm 再寫入；不是以 dry-run 或備份的整份 farm 覆蓋目前資料。其他金幣、收蛋、任務及獎勵的並行寫入會觸發重試，以最新值繼續。

每批最多 100 個 allocations；單 scope 計畫最多 10,000 個 allocations。這是安全上限，不代表建議單批移轉一千萬把武器。超限、無效數量、裝備錯誤、不同世代或不明 owner 都停止／隔離。

最後一批除了核對 validatedCounts，也讀取實際已寫入批次，逐一比對確定性 ID、完整內容與數量，拒絕遺失／多出的批次，避免只改進度就啟用不完整 V2。query 有 25,000 歷史文件上限，超限需另審，不截斷後宣稱成功。

### 中斷、並行與重複執行

- 同計畫、同 generation 可反覆執行，不會把三把變六把。
- 進度權威在 `ops_refining_migrations/{scope}`；本機 checkpoint 只協助閱讀，不作為覆寫玩家資產的依據。
- 程序在提交後、寫 checkpoint 前被關閉，重新執行仍依 Firestore 實際進度續跑。
- 多 worker 同一計畫使用交易衝突重試，不跳過批次、不重複生成個體。
- 已完成 scope 會重新驗證後略過，不消耗後續 scope 的批次預算，避免第一位玩家永久擋住後面玩家。
- 某 scope 出錯會記錄隔離原因；其他 scope 可繼續，但整批不能標 complete。
- 計畫到期可離線 `renew`，保留來源、runId、generation 與父計畫 hash，產生新 sourceHash／期限。須重新 review、取得新 hash 授權及新 checkpoint；不改寫資料庫的移轉來源。

## 3. 資產驗證與安全回復

`verify` 會核對實際個體數、owner、generation、schema、farm revision、投影及裝備中的個體。離線 `weapon-data-audit.cjs` 可檢查單 scope 或多 scope 匯出 bundle，核對唯一個體 namespace、有效數量、歸屬、裝備、非負金幣／精煉石、+0～+9 能力、逐級歷史、成本、退款與交易防重。

每個 scope 的 `export` 在 read-only Firestore transaction 中取得一致快照。多個 scope 分別一致，不宣稱整個 bundle 是全資料庫同一時間點。匯出有 25,000 文件與 32MiB 的有界線保護；超過限制或交易逾時就停止，不輸出半份成功證據。

`rollback` 只允許尚無新武器操作（owner revision=0）、來源指紋未變、無進行中戰鬥的農場。它只移除武器 migration metadata／恢復原裝備欄位，保留當下最新非武器資產。回復後保留 allocations、journal 與歷史，不清庫；原 generation 不再使用。

已有買賣／換裝／精煉後拒絕回復到 V1。此時正常 V2 遊玩保留，使用 verify／離線對帳，暫停新的精煉，再擬定個別補償或修復計畫。**本次沒有提供任意補造個體、金幣或改寫歷史的自動修復按鈕。** 未完成 staging 的向前處理是用原計畫續跑；若既有批次已遭竄改，必須保留隔離，另行審核修復，不能藉重跑覆蓋異常。

## 4. 同次交易資源帳本

新增私有 `ops_refinement_wallet/{hash(profileId + transactionId)}`，由精煉／解除的原子交易建立，包含：

- schemaVersion、ownerId、transactionId、receiptPath、請求 fingerprint。
- action、before（coins／stones）、after、實際扣款或退款 amount、提交時使用的 createdAt。

它與 farm、武器狀態、owner revision、收據及 intent 完成狀態同時提交。同 ID 重送走既有收據，不新增帳本或再扣款／退款；既有帳本 key 衝突時整個經濟提交失敗，不能留下只有扣款沒有帳本的半套結果。intent 可維持 pending，修復衝突後仍用原 ID 查詢／續跑。

離線對帳交叉檢查帳本 key、owner、交易 ID、指紋、操作、金額、時間、收據餘額及前後差額。偽造欄位、重複交易、重複退款觀測、缺漏收據或 ledger 都會產生錯誤／缺口。

**不補造歷史帳本。** 舊交易若只有 after balance，仍標 `WALLET_DELTA_UNVERIFIED`。不會以目前金幣反推 before，也不會把人工填寫數字當真實原子證據。現有全遊戲金幣產消（收蛋、商店、怪物、活動等）的完整總帳不是這次新建的功能，不能宣稱已完成全服經濟閉環對帳。

候選 Rules 原有 `ops_.*` 保護已涵蓋新帳本；本次沒有修改 Rules。Emulator 另驗證有效玩家及僅自稱 admin 的客戶端均不能讀寫帳本、migration journal 或 allocations。這不代替正式 Rules release 查證。

## 5. 測試與限制

最終結果：**661／661 單元測試、9 檔共 37／37 真實 Firestore／候選 Rules 測試、3／3 瀏覽器回歸通過**。新增移轉 Emulator 套件包含 7 項實測；瀏覽器是合成服務的核心遊戲、玩家倉庫精煉與獨立營運中心，沒有實體手機／行動網路量測。原始初跑／失敗修正紀錄放在 `evidence/migration-release-2026-11-28/`；參見 `validation-summary.json` 與 `real-firestore-summary.json`。

覆蓋包括：唯讀計畫產生、來源過期、並行移轉、批次中斷續跑、同款三把不重複、裝備保留、跨 scope 隔離、成員撤銷、計畫篡改、到期更新、正常買賣、回復限制、非武器資產保留、CLI checkpoint／輸出防覆寫、多 scope 匯出、實際扣款／退款／防重及 ledger 衝突的原子中止。

初跑發現兩項測試 fixture 問題：list 未傳入實際 farm，以及清單分頁時假定第一頁必有目標武器。已修正測試按既有分頁協定讀取；沒有放寬正式交易驗證或更改遊戲數值。

正式備份、隔離還原、正式 IAM／Rules／索引／雙區後端相容、舊 PWA 實機、正式玩家完整歷史資料等，仍未驗收。Emulator 結果不代表已獲正式發布授權，整體保持 NO-GO。

## 6. 修改檔案

新增：

- `scripts/weapon-migration-release.cjs`：受審核計畫控制的 CLI。
- `scripts/lib/weapon-migration-plan.cjs`：純計畫、hash、期限與連線政策，離線 renew。
- `scripts/lib/weapon-migration-job.cjs`：逐 scope 授權、分批、續跑、verify／rollback／export。
- `game-admin/functions/refinement-wallet.cjs`：原子資源帳本。
- `tests/weapon-migration-release.test.cjs`、`game-admin/tests/migration-release.emulator.cjs`。
- 本報告及對應驗證證據。

調整：

- `game-admin/functions/migrations/weapon-instances.cjs`：可信任作業 callback、逐批進度／實體驗證、revision 與戰鬥回復保護；預設仍關閉。
- `refinement-service.cjs`、`refinement-player-service.cjs`：在原交易內新增一份帳本，不改消耗／機率／能力／獎勵。
- `scripts/export-weapon-audit.cjs`、`scripts/lib/weapon-data-audit.cjs`：同次帳本匯出、單／多 scope 對帳與歷史缺口。
- `tests/weapon-data-audit.test.cjs`：舊缺口測試保留無帳本情境，新增真實帳本與篡改檢查。
- Emulator runner／proof、發布審查工具、開發規範及 runbook。

未修改玩家頁面、戰鬥數值、正式預設開關、Rules、索引或部署配置。工作目錄仍包含前階段未提交內容，不能把所有 dirty 檔案都算作本次新增。

## 7. 成本與效能

精煉成功或失敗且確實扣款，以及解除成功，各增加 **1 次文件寫入**；拒絕的資格／資源不足交易不增加此帳本。收據重送不增加額外帳本。沒有新增每擊 Firestore 查詢／武器特效等待。

移轉每批仍主要是該批 allocations 寫入加 journal；stage 寫 owner／journal／farm；最後批 owner／journal／farm 切換。新增每次交易的身分／世代授權讀取，最終一次完整實體核對與 verify／export 是管理作業讀取，不在玩家首頁全量監聽。

量級估算：A 個 allocation 的移轉約 O(A) 寫入及 O(A) 終檢／對帳讀取，重試及獨立 export 會額外讀取。每把武器不是一份重複大商品文件；1,000 把同款可以由一個 allocation 表示。未取得正式玩家資產分布，不估造實際美元帳單、移轉工期或正式延遲。

## 8. 下一個正式步驟

先審查此工具、移轉 scope 清單、計畫與回復條件，再取得不可變程式版本及正式備份／還原證據。只有明確授權之後才進行正式 read-only 計畫與 dry-run、指定測試帳號移轉、逐批驗證及白名單開放。不能以本次工具完成直接執行正式操作。

Git 基準 HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`。本次沒有新 commit hash，尚未提交或推送。
