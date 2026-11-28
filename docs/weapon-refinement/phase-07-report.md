# Phase 7－營運中心武器精煉管理及統計

交付日期：2026-11-28（台灣時間）。來源 HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`。Phase 2～6與精煉石美術的工作目錄差異仍未提交，本報告不把全部 HEAD diff 當成 Phase 7。

## 1. 範圍、前置驗收及結論

依 [開發總規範](DEVELOPMENT_RULES.md) 與本次明確授權，在**既有獨立 `game-admin/site`** 新增「武器精煉管理」。玩家 App 不載入管理模組，不新增玩家營運入口。完成本機實作及隔離測試，不表示正式驗收已通過。

Phase 6 已完成585項單元與隔離UI／數值模擬；真實 Emulator 下載HTTP403、伺服器未重跑手勢／碰撞，仍是原有正式阻擋。Phase 7再次嘗試真實 Emulator，同樣在下載階段被HTTP403阻擋，未執行其 Rules／真實競態 assertions。

**五項正式玩家開關全部false**：weaponInstanceEnabled、weaponRefinementEnabled、refinementResetEnabled、refinementCombatBonusEnabled、refinementStoneRewardEnabled。沒有部署、正式資料讀寫、正式遷移、Rules／索引部署、Git提交或推送，沒有進Phase8。

## 2. 管理介面與操作流程

入口：獨立營運中心 → 武器精煉管理。沿用原登入、側欄、表格、按鈕、純文字DOM及手機橫向表格捲動。

### 參數與草稿

- +1～+9表格：累計攻擊%、爆擊／連爆增加百分點、成功率%、金幣、材料、等級開放、保底、必成次數。
- 初始值直接來自Phase3 `Core.defaults()`，沒有另外建立第二套數值。
- 前端HTML數值範圍、整數／bp轉換及跨欄位檢查；後端重新驗證全部欄位。
- 第一版最高attack bonus5000bp＝50%；兩率各1500bp＝15pp；金幣／材料非負安全整數，成功率0～10000bp。
- 依本階段「不得低於前一級」改成**非遞減**；歷史Phase3嚴格遞增規則的差異已明確調整並增加測試。+1可等於前級，第一版仍使用原預設遞增表。
- `levels[].enabled`可選，舊版本缺欄位按原規則開放，不改舊版本canonical hash；新UI明確儲存boolean。關閉等級由Core.preview拒絕，不能只靠前端隱藏。

材料設定包含簽到總開關、7天各自數量／機率、任務、9種怪物寶箱額外材料、既有禮包數量範圍／開關。寶箱原dropRate與原獎勵完全不在此發布payload內。虎頭蜂原材料預設關閉；圖鑑與每週活動仍未實作，不能在本頁假裝啟用；禮包實際內容沿用原禮包管理。

解除設定使用原enabled、coinsRefundBp與stonesRefundBp，預設3000／5000bp。失敗消耗永不退款；原交易仍按本輪歷史成功投入，沒有按新費用重算舊投入。

### 發布與回復

1. 編輯表格，填至少4字修改原因，儲存草稿。
2. 驗證草稿，產生綁定草稿revision、當前3個設定pointer revision、歷史能力檢查及影響的validationHash。
3. 顯示修改前後值、歷史衝突、能力保留與保底政策。
4. 具有publish權限，且必要時具有risk權限者，明確確認後立即發布。
5. 同一Firestore Transaction建立3份不可覆寫版本、3個pointer、release、audit、冪等收據並標記草稿已發布。
6. 新報價讀到新pointer；已有報價因config revision／hash改變而拒絕，不能用舊費用扣款。
7. 歷史頁「建立回復草稿」複製舊設定內容，重新驗證、發布成全新版本；不回寫或刪除舊release。

第一版**只支援確認後立即生效**，effectiveAt為伺服器發布時間；沒有排程器或未來生效UI。原配置服務也只支援立即發布，本次沒有假裝完成未來排程。草稿沒有玩家效果。

發布前讀取最多101筆歷史精煉設定：最多100版可驗證，超過時停止發布，不忽略較舊武器。比對每個歷史級別的已取得bonus與新下一級，任一變低就禁止發布。+9既有能力不被改寫。此方式偏保守：即使某舊配置未實際被玩家取得也保護。未來版本超過100前需新增可驗證的歷史能力上限摘要／分批bootstrap；不可直接提高無界掃描。

保底變更必須明確確認 `preserve-target-failures`。不寫任何武器state、不清零已有失敗次數；新門檻套用下次新報價，若既有失敗已達新門檻，原Core可判定下次必成。降低門檻、啟用／停用都列高風險。

## 3. 權限與現有後台安全性

所有呼叫先通過既有 `D.adminIdentity` 的登入token role=admin，再即時 `auth.getUser` 驗證目前role及未停用。新權限只讀**目前伺服器Auth customClaims**，不信任前端傳入角色或登入表單。

| Claim | 功能 |
|---|---|
| refinementPermissions包含read | 讀設定、草稿、歷史、查交易、看統計、驗證影響 |
| edit | 建立／修改／回復草稿，啟動有界補算、查核、快照工作；同時需read |
| publish | 經驗證Hash發布；同時需read，不強制要求edit，可分工 |
| risk | 首次設定、等級／解除開關、材料來源或保底變更，仍須publish |
| opsLegacyAccess=true | 同時授與其他原有營運模組的存取；不是精煉權限預設附帶 |

含refinementPermissions但沒有opsLegacyAccess的帳號，只能用本精煉模組、原精煉唯讀配置及供首頁使用的dashboard，**不能繞到舊調金幣／物品、設定、禮包、戰鬥數值等API修改資產**。原有未使用新claim的營運管理員保持原本權限，無精煉權限時也不能使用新精煉模組。

舊 `publishRefinementConfig`／`publishRefinementResetConfig`／`publishRefinementStoneConfig` 公開管理路徑直接拒絕，避免繞過草稿、細分權限及發布預覽；未被玩家使用的內部配置建構器仍供隔離fixtures。舊相關測試改為驗證入口退役、新claim及撤權，不是忽略安全失敗。

沒有hard code管理員帳密；測試email／admin身分僅存在隔離測試。MFA仍沿用原後台選用機制，沒有擅改所有管理員登入；發布者／高風險角色建議正式上線前落實MFA與IAM授權流程。**沒有呼叫正式Auth設定任何人的claim**。權限配置必須由既有可信任Auth管理流程完成，玩家與網頁不能自授權。

管理查詢不提供直接修改精煉武器／退款的任意API。補償沿用既有獨立、具稽核的營運補償流程，且需要額外舊模組權限；不將統計或查核當成補償交易。

新集合皆以ops_開頭，現有完整候選Rules的root matcher排除ops_，前端不可直接讀寫（包含admin token）。Rules未修改、正式release未核對；真實Rules測試仍BLOCKED，不能用候選檔當正式驗證。

## 4. 實際新增API

全走原 `gameOpsAdmin` callable，沒有新增玩家公開API。

| action | 必要payload／行為 |
|---|---|
| refinementOverview | bundle、3個revision、目前權限、關閉的正式flags |
| refinementSaveDraft | bundle、reason；修改另需draftId、expectedRevision |
| refinementValidateDraft | draftId、expectedRevision，回傳validationHash／衝突／風險 |
| refinementPublishDraft | 同上＋validationHash、confirm:true、pityPolicy |
| refinementDrafts／refinementHistory | 25筆＋游標 |
| refinementRestoreDraft | releaseId、reason；只建立新草稿 |
| refinementTransactions | 日期及查詢條件、綁定查詢的游標 |
| refinementStatistics | startDate／endDate，最多31日 |
| refinementReconcile | source、來源游標，每批50筆，冪等補算 |
| refinementBuildSnapshot | 已結束的台灣date、固定jobId，每批50筆，續跑至complete |
| refinementAuditStatistics | date、固定jobId，每批100筆，對帳至complete |

所有草稿／發布操作具伺服器請求指紋與CAS；同requestId不同內容拒絕，相同內容重送讀回原結果。補算與長工作有來源防重／jobId checkpoint，並非任意執行玩家經濟交易。

## 5. Firestore資料結構

沿用：`ops_game_config/{refining,refinement-reset,refinement-stones}`、`ops_refinement_versions`、`ops_refinement_reset_versions`、`ops_refinement_stone_versions`及`ops_audit`。

| 新集合 | 用途 |
|---|---|
| ops_refinement_drafts/{id} | bundle、reason、revision、expectedRevisions、修改人／時間、狀態、回復來源 |
| ops_refinement_releases/{id} | version、before／after、修改／發布人與時間、生效時間、理由、發布狀態、policy |
| ops_refinement_admin_requests/{hash} | action／payload fingerprint、response、createdAt |
| ops_refinement_records/{sourceHash} | 唯一來源的正規化交易／材料／戰鬥／經濟紀錄，filterTokens、來源hash |
| ops_refinement_daily/{TaipeiDate}_{0..31} | 每日32個分片values、updatedAt |
| ops_refinement_day_players/{hash} | 日期＋農場owner scope的唯一精煉參與標記 |
| ops_refinement_state_views/{hash} | 最新個體level／failCount觀測，soldAt後排除、revision防亂序 |
| ops_refinement_farm_snapshots/{hash} | 日期＋群組帳號最後觀測金幣及武器數量 |
| ops_refinement_snapshot_jobs/{jobId} | 快照分批進度、累計、完成結果 |
| ops_refinement_snapshots/{date} | 有覆蓋範圍說明的觀測分位數與分布 |
| ops_refinement_audit_jobs/{jobId} | 有界對帳checkpoint、紀錄加總、彙總差異；不修改玩家 |

精煉／解除收據僅補analytics內的原始uid、groupId、weaponId、精煉前bonus、有效成功率，沒有額外同步統計文件。原`ops_verified_farm_events`的DEFEAT_MONSTER事件補伺服器開戰至結算時間及實際戰利品數量。**不改原金幣／材料／獎勵數字或發獎流程**。

## 6. 非同步來源、統計公式與資料完整性

新增8個單區asia-east1的觀測trigger定義（只寫本機原始碼，沒有部署）：

- 精煉收據 → 正規化交易＋每日精煉統計。
- 簽到／任務grant、禮包redemption、已開啟chest → 額外材料產出；寶箱另記實際開出金幣。
- 既有farm report事件 → 金幣餘額淨增／減觀測趨勢。
- 既有verified farm event → 擊退與原戰利品數量；非打怪事件直接略過。
- 個體state → 最新觀測view。
- farm提交 → 金幣／武器數量有變才更新當日快照；純攻擊不讀寫快照。

交易／材料／戰鬥來源在同一統計Transaction內檢查正規化sourceId，原子更新分片、每日玩家標記及來源紀錄。重送不重算；同來源內容雜湊不同時報錯待查，不覆寫舊結果。分片取owner hash mod32，同owner的每日唯一標記與分片一致，不將所有玩家更新集中一份global doc。

來源交易先提交，trigger失敗只重試觀測，不回滾／阻擋玩家已成功精煉。沒有每次命中／每幀統計查詢；戰鬥trigger掛既有verified events而非每批battleAttack收據。

| 需求指標 | 公式／目前可用性 |
|---|---|
| 每日精煉玩家數 | 台灣日期＋owner scope唯一數；同帳號不同群組分開 |
| 次數／成功／失敗 | 每筆已完成精煉收據一次；解除另列 |
| 各級實際成功率 | 成功數÷樣本數；無樣本null，<100標「樣本不足」，不自動判異常 |
| 各級設定成功率 | 該級交易實際有效successRateBp平均，含保底必成100%；不是拿目前設定解讀歷史 |
| 金幣消耗 | 所有成功／失敗收據actualCost.coins總和 |
| 解除返還 | 解除收據refund.coins總和 |
| 金幣淨回收 | 消耗－解除返還；可為負數，不截成0 |
| 材料產出／消耗／返還 | grant／gift／chest實際quantity；精煉actualCost.stones；解除refund.stones分開 |
| 全服等級分布／參與率 | **完整分母不足**，顯示缺口；目前只提供觀測state級別與refinedByWeapon，不冒充全服 |
| 連敗次數分布 | 觀測state的refineFailCount分布，sold個體排除；尚非全服歷史日末快照 |
| 活躍金幣中位數／P90／P95 | 分批快照對該日金幣或武器數量有變的群組農場最後餘額取nearest-rank；名稱明示「觀測樣本」，不是所有登入玩家 |
| 金幣產出／消耗趨勢 | 既有報表的每筆餘額淨變化正負部分；**不是逐項毛收入／消費** |
| 平均打怪時間 | 有新analytics的擊退事件，伺服器開戰至結算duration總和÷已知樣本；舊缺資料排除，不補造0 |
| 怪物獎勵產出變化 | 日期間擊退數、實際loot_item數量、已開箱金幣趨勢；不虛構戰利品出售價值或缺漏的歷史對照 |

沒有查正式營運資料。畫面數字均為隔離fixtures；未知來源不說成全服0。首次部署後也不會自動假設已有完整歷史。

快照工作每批50，精確金幣分位數最多10000個觀測樣本；超限停止，需另行分散式分析。state部分是工作執行時觀測，不回推成所選歷史日末；沒有完整庫存及未觀測+0的分母，故刻意不計算錯誤全服參與率。正式完整全服指標仍需有權限的分批backfill、全服覆蓋清單及明確活躍定義；本次未對正式玩家做此工作。

## 7. 補算及對帳

補算來源：receipts、daily、gifts、chests、economy、battles。每批50來源；將回傳nextCursor用於下一批。來源不變時再次執行不新增統計。失敗時保留來源資產／收據，查清原因後用原來源補算。

查核工作每批100正規化紀錄，使用同一contribution reducer重算，再比對當日最多32個分片。每日唯一owner最多5000；超限停止，不截斷。回傳matched／mismatch及差異欄位，不修改玩家或偷偷覆寫統計；查核中分片有新變化則回報concurrent-changes-retry。這是有界、可續跑的觀測對帳，不宣稱跨批為全資料庫時間點快照。

正式來源若被修改，sourceHash衝突會停止，必須先人工稽核；不得刪防重紀錄來重跑，否則可能重算。暫未設TTL／資料清理，因防重紀錄有完整性用途；後續需定義留存及封存政策。

## 8. 查詢、索引與費用

交易日期範圍最多31日，按createdAt降冪，25筆一頁。支持player UID、groupId、Instance ID、weaponId、目標等級、成功／失敗／解除、交易ID、版本、種類。先以一個filterToken索引選候選，再在最多200筆內套用全部條件。若多條件稀疏，可出現空頁但仍回傳繼續游標，不將截斷資料當全量。游標綁定條件hash，換查詢不能沿用。

候選索引見 [phase-07-indexes.proposed.json](phase-07-indexes.proposed.json)。沒有合併到部署索引、沒有建立正式索引；MemoryDB不驗證索引READY。真實測試環境仍須驗證createdAt/filterTokens、farm snapshot date/occurredAt及collection-group boxes.openedAt，不能直接拿候選檔覆蓋整份既有索引。

[成本探針](evidence/phase-07-2026-11-28/cost-probe.json)為MemoryDB文件介面計數，含原admin throttle，但不是真實帳單：

| 操作（初次設定範例） | 文件讀 | 空查詢最低讀另計 | 寫入 | Auth查核 |
|---|---:|---:|---:|---:|
| overview（尚無配置） | 4 | 0 | 1 | 1 |
| 儲存草稿 | 6 | 0 | 4 | 1 |
| 驗證（無歷史） | 6 | 1 | 3 | 1 |
| 原子發布3配置 | 9 | 1 | 11 | 1 |
| 首筆精煉非同步投影 | 3 | 0 | 3 | 0 |
| 1日1分片儀表板 | 3 | 0 | 1 | 1 |
| 1筆交易頁 | 2 | 0 | 1 | 1 |

- admin throttle本來就有1讀／1寫；新的管理操作並非純零寫查詢。
- 一般精煉投影：3讀（防重、分片、每日owner），2寫；首次當日owner再加1寫。重送通常只讀、不寫，但會重新讀相關文件。
- 非精煉來源通常2讀／2寫。state與實際資產變動快照通常1讀／1寫；相同資產的farm事件直接略過，但trigger呼叫本身仍有成本。
- 每日儀表板最多31×32=992個分片＋1份快照，無全服listener、無玩家／歷史掃描；隨需求可再加最終日彙總壓縮。
- 查詢最多200候選＋必要cursor／throttle，補算50來源，查核100紀錄／批，快照50文件／批；均非無成本。
- Functions觀測呼叫、索引儲存、事件重試、Transaction重試、讀取索引項、SDK／網路及儲存費另計。沒有正式帳單、精煉交易量及區域單價查證，不虛構美元預測。
- 增量費公式可用：`新增讀量/100000×專案讀單價＋新增寫量/100000×寫單價＋Functions/儲存/網路`。本次沒有搬RTDB或宣稱其完全免費。

## 9. 測試、截圖及未驗證項目

單元／隔離瀏覽器／真實Emulator分開記錄，詳見 [evidence summary](evidence/phase-07-2026-11-28/phase-07-summary.json)。最終數量由該摘要及原始日誌提供，初跑失敗不刪除。

最終全套單元 **612／612通過**（相較Phase6增加27項）。Phase1基準runner的2項prepare、當時607項單元及**29／29組既有瀏覽器回歸全部通過**；新增功能完成後再跑最終612項單元及獨立營運中心瀏覽器測試，均通過。既有瀏覽器包含登入、首頁／存檔、收蛋／偷蛋／清潔、商店／裝備、爆擊／連爆、打怪、寶箱、任務、排行榜與場景／導航。

初跑585項時有6項失敗：舊測試的嚴格遞增、缺新管理權限／已退役直發API，以及trigger數量／區域斷言需要按本階段新規格更新。新增測試初跑另找出預覽權限及首次發布高風險判定問題，已修正實作與明確角色行為，沒有放寬正式玩家開關或修改報告通過旗標。初跑失敗日誌與最終通過日誌一起保留。

新增測試覆蓋：目前Auth撤權、未授權讀寫、只讀帳號不能繞舊API、非法數值、nondecreasing及上限、等級關閉、草稿無玩家效果、3pointer原子發布、舊報價作廢而不扣款、CAS／並行發布、相同requestId防重、歷史不可覆寫、回復新版本、歷史能力衝突、保底保留政策、材料不能改原寶箱掉落、32分片及日唯一owner、重複來源、來源變更衝突、實際成本退款對帳、分頁／游標隔離／200候選限制、補算、快照分位數、state亂序／售出排除、攻擊不寫資產快照、真實事件分析、對帳發現被改的彙總、儀表板不掃玩家。

瀏覽器使用實際獨立後台導航及原API服務，僅攔截runtime SDK並接MemoryDB：儲存草稿→預覽→確認發布、歷史回復草稿、25／10筆分頁、樣本不足標示、只讀禁寫及390×844無頁面橫向溢出。不是正式Firebase或實體iPhone測試。

畫面：[桌機發布預覽](evidence/phase-07-2026-11-28/admin-preview-desktop.png)、[手機](evidence/phase-07-2026-11-28/admin-mobile.png)、[歷史](evidence/phase-07-2026-11-28/admin-history.png)、[交易](evidence/phase-07-2026-11-28/admin-transactions.png)、[統計](evidence/phase-07-2026-11-28/admin-statistics.png)。數字為測試fixture。

真實Emulator新增3項測試：真實並發來源防重、真實管理草稿／發布／撤權、候選Rules拒絕客戶端管理資料讀寫。**本次未跑到assertions：JAR下載HTTP403**。不可用MemoryDB通過當作Firestore Transaction／索引／Rules已驗收。

## 10. 修改檔案與回復

新增正式模組（只在工作目錄）：

- `game-admin/functions/refinement-operations.cjs`：權限、草稿、預覽、發布、回復及管理API。
- `game-admin/functions/refinement-statistics.cjs`：正規化、分片、防重、查詢、補算、對帳。
- `game-admin/functions/refinement-snapshots.cjs`：有界觀測快照與分位數工作。
- `game-admin/site/refinement.js`：獨立營運中心UI。

調整：`service.cjs`（接API／細分權限／關閉舊發布繞路）、`index.cjs`（8個觀測器）、`refinement-core.cjs`（等級開關與非遞減驗證）、`refinement-service.cjs`／`refinement-player-service.cjs`（收據analytics）、`farm-transactions.cjs`（既有擊退事件analytics）；以及`game-admin/site/{app.js,management.js,index.html,styles.css}`接導覽及樣式。

新增測試：`game-admin/tests/refinement-operations.test.cjs`、`refinement-statistics.test.cjs`、`refinement-operations.browser.cjs`、`refinement-operations.emulator.cjs`，`tests/weapon-refinement/operations-cost-probe.cjs`。調整既有refinement-core／service／player／stone測試，以新權限及退役發布API為準；`tests/functions-region.test.cjs`檢查新增8個trigger仍單區。文件為本報告、候選索引、規範授權補充及evidence。

原始怪物HP／武器攻擊／爆擊倍率／攻速／手勢／掉落／玩家前端管理入口未修改。五個正式flags檔案仍false；Rules與正式部署配置／正式索引未修改。

本機重現需既有Node22、Chromium及Phaser3.60 fixture；例：

```bash
node --test game-admin/tests/refinement-operations.test.cjs game-admin/tests/refinement-statistics.test.cjs
node tests/weapon-refinement/operations-cost-probe.cjs
# 本機HTTP根目錄服務後，隔離SDK，不連正式Firebase
OPS_UI_BASE=http://127.0.0.1:8032/game-admin/site \
NODE_OPTIONS=--require=./tests/weapon-refinement/browser-guard.cjs \
node game-admin/tests/refinement-operations.browser.cjs
```

不提供或執行本階段正式部署命令。未來若需回復配置，用舊release建立新草稿再發布；不刪歷史、來源防重、個體能力或帳本。統計observer可暫停後以原來源補算；不能以回復統計來退款或整庫回灌玩家資料。

## 11. 仍需正式驗收／決策

1. 修復Emulator下載環境，完成真實Rules、索引及並行交易驗證；Phase6命中反作弊缺口仍未解決。
2. 在正式上線前配置最小Auth claims／MFA／IAM，核對所有可達區域與舊後台快取；本次不修改任何正式權限。
3. 完整全服庫存分母、活躍定義及分批快照覆蓋尚未建立，因此部分「全服」指標明確顯示缺資料。現有state是稀疏資料，不能推算全服+0。
4. 金幣趨勢是淨變化觀測；若要逐項毛產出／消耗，需補可信任金幣流水，不能把本報表當財務帳。
5. 歷史版本100、快照10000樣本、對帳5000唯一owner等安全上限，達到前需規劃分散式彙總／歷史能力摘要。資料保留與封存另行確認。
6. 發布只立即生效；排程若需要應另做新規格，不能只把effectiveAt設未來而不實作pointer切換。

本次停止在Phase7工作目錄實作與隔離證據，未部署、未進Phase8。
