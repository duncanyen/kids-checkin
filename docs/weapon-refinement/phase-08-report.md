# Phase 8－整合驗證及Step A正式發布前審查

> 2026-11-29 新增：新精煉／解除與營運 API 的真實 Auth HTTP 驗收 **27/27** 通過（新增21情境），單元725項、Firestore57項通過且來源proof符合。詳見 [HTTP驗收](refinement-http-acceptance.md) 與 [更新後發布前審查](predeploy-review-refinement-http.md)。正式發布仍NO_GO，沒有部署或操作正式資料。


> 2026-11-29 最新：使用者已在修正版 `e7e4fd5`、Node 22.23.4 的 Cloud Shell 環境完成完整 Emulator 合約 **9/9 通過**，證據為回傳的終端摘要。先前下載／Registry 阻擋為歷史狀態；其餘正式驗收與授權不因此解除。詳見 [Cloud Shell 完整驗收](cloudshell-full-acceptance.md)。


> 後續修正：進場前攻擊（SEC-02）已加入前後端共用限制，671單元、46真實Firestore／候選Rules及8組瀏覽器流程驗證通過。原報告保留為歷史證據；SEC-01及完整舊版更新流程仍未解除。見 [進場限制報告](approach-guard-report.md) 與 [合併攻擊／更新設計](batched-combat-and-update-design.md)。

> 最新相容性／戰鬥驗收：667單元、43真實Firestore／候選Rules與7組瀏覽器測試完成，但重現未受可信任命中驗證的批次可在怪物進場前獲勝，仍NO-GO。詳見 [相容性與安全報告](compatibility-security-report.md)，不得將測試程式綠燈視為安全驗收通過。

> 2026-11-28 後續更新：受審核移轉 adapter、分批／續跑／回復及同次資源帳本已完成隔離實作；最新 661 單元、37 真實 Firestore／候選 Rules 與3組瀏覽器結果見 [移轉對帳報告](migration-and-reconciliation-report.md)。原始階段紀錄保留；沒有正式移轉、部署或全服開放，整體仍 NO-GO。

日期：2026-11-28（台灣時間）。審查結論：**NO-GO，停止於Step A。未執行B～F。**

> 後續更新（2026-11-28）：本機Firestore Emulator下載問題已用官方同版套件修復，7檔25項真實交易／候選Rules驗證通過；見 [最新Emulator驗證](emulator-verification-report.md)。下文保留原Step A審查時點及歷史403記錄，整體NO-GO與其他正式阻擋不變。

## 1. 本次已完成

依 [開發總規範](DEVELOPMENT_RULES.md) 完成工作目錄的整合回歸、離線資產對帳、隔離移轉演練、發布相依檢查，以及六份交付文件：

1. 本報告。
2. [final-test-report.md](final-test-report.md)：所有需求覆蓋、初跑／重跑、差異與未測範圍。
3. [release-plan.md](release-plan.md)：A～F依序授權、相容部署命令提案、穩定分群、監控量化提案。
4. [migration-runbook.md](migration-runbook.md)：備份範圍、未授權正式備份指令、可用隔離dry-run／分批／續跑／verify、對帳及成本。
5. [rollback-runbook.md](rollback-runbook.md)：停新交易、保留已取得能力、原ID結果恢復及向前修復。
6. [operations-guide.md](operations-guide.md)：獨立營運中心角色、參數／版本、交易查詢、統計與事故操作。

新增工具不被正式遊戲載入，沒有修改正式遊戲邏輯、原HP／攻擊／攻速／倍率／掉落、Rules、部署索引、正式權限或五項正式旗標；未備份／讀寫正式資料、未部署、未合併main、未提交／推送。

## 2. 必須保留的前置缺口

不能確認Phase1～7全部正式驗收通過：本機實作及受控測試已存在，但真實Emulator持續下載HTTP403；Rules、Firestore真正競態與正式索引未驗證；Phase6伺服器不證明Phaser物理碰撞／手勢來源；Phase7統計欠完整全服庫存分母與歷史資源帳本。本次明確Phase8授權允許準備及評估，不把上述缺口改成通過。

## 3. Step A審查矩陣

| 項目 | 結果 | 審查證據／下一步 |
|---|---|---|
| Git分支／commit | BLOCKED | main、HEAD8dbae59；Phase2～8 dirty，尚無可發布immutable commit |
| 既有功能／新整合單元 | 隔離通過 | 最終629項；原29組瀏覽器初跑3項不穩，獨立重跑另列，不假稱首跑全綠 |
| 新階段5組UI | 隔離通過 | 真實遊戲／獨立後台入口，SDK／資料是MemoryDB；不是正式服務 |
| 資產一致性 | 合成通過／正式BLOCKED | 完整合成歷史11筆對帳；正式缺實際pre/post帳本／一致快照 |
| 真實Emulator | BLOCKED | 官方JAR下載HTTP403，未執行6份新階段測試assertions |
| Firebase專案／環境 | 未查證 | 預期homebasedb、Firestore asia-east1，來源為先前使用者盤點／公開設定 |
| Rules相容 | BLOCKED | 有完整候選，不知現行正式release／重疊allow；本次未發布或比對正式 |
| Functions相容 | BLOCKED | callable兩區；原report trigger仍新加坡；未部署核對所有可達舊區／新版服務 |
| 索引 | BLOCKED | Phase7候選未併入部署、未READY驗證，不能只跑FarmTransaction |
| 舊PWA／舊分頁 | 部分模型通過，正式BLOCKED | +0與美術cache已測；舊client對V2/V5的安全拒絕不等於正常可玩 |
| 功能預設關閉 | PASS（本機檔案） | 五項literal false，不代表有正式remote gate |
| 備份／隔離還原 | 計畫完成／未執行 | 執行正式備份前需專項授權 |
| 正式移轉工具 | BLOCKED | 現有CLI只接受localhost demo，不能刪guard或冒用testEnvironment |
| 正式白名單／漸進gate | BLOCKED | 純規劃函式有測試，未接runtime；現在只有隔離testAccess |
| 手機／網路／成本 | BLOCKED | viewport與文件計數有證據，無實體手機、真雙裝置、行動網路與正式帳單基準 |

## 4. 本階段新增檔案／工具

| 檔案 | 行為／安全邊界 |
|---|---|
| scripts/lib/weapon-data-audit.cjs | 純離線檢查farm／owner／allocation／state、交易／報價／歷史成本／退款及實際資源差異 |
| scripts/weapon-data-audit.cjs | 只讀本機JSON、拒URL／project／覆寫來源，≤32MiB；exit2資料異常，exit3缺證據 |
| scripts/export-weapon-audit.cjs | localhost demo單scope read-only transaction匯出；拒正式project，不虛構walletJournal |
| scripts/lib/weapon-release-policy.cjs | 審查用穩定分群、門檻相依及NO-GO；未接正式遊戲 |
| scripts/weapon-release-review.cjs | 唯讀Git／本機設定產生Step A檢查，未知正式項保持false，不執行任何發布 |
| tests/weapon-refinement/phase8-fixture.cjs | 實際service合成+9／失敗／解除流程，僅已提交callback才保存資源前後證據 |
| tests/weapon-refinement/migration-rehearsal.cjs | 純MemoryDB2001把／3allocation中斷續跑、較新資產保留、後續交易後禁止舊回復 |
| tests/weapon-data-audit.test.cjs | 正常整合、故意損壞、重複、缺帳本、版本／報價一致性、唯讀輸出安全 |
| tests/weapon-release-review.test.cjs | 穩定scope分群、付費與combat相依、關閉不刪能力、審查永不自授發布 |
| tests/weapon-migration-rehearsal.test.cjs | 中斷／重播／競爭資產保留及正式相容阻擋的回歸 |

其他新增為六份文件、規範Phase8授權補充及evidence。未觸碰與精煉無關的NEXUS_PLATFORM_ADMIN_ASSESSMENT文件。

## 5. 統合結果與重要差異

- 完整合成+0→+9含一次失敗，9成功成本35000金幣／16石，失敗成本另記；解除返還10500／8，同ID重送不重退，總11筆已提交經濟交易完全對帳。
- 缺同次提交前後餘額時，audit即使結構正確仍INCOMPLETE。原正式收據只保存post-balance，不能用目前餘額推造歷史變動，這是正式資產驗收阻擋。
- 原型移轉每次交易重讀最新farm並合併必要欄位；同期+777金幣、收蛋累計12在續跑及revision0安全回復後保留。買賣後revision變更，回復拒絕，向前修復。
- 新增正式釋出矛盾：V2＋instance flag=false會拒絕原武器交易；不能按C先搬玩家、D才補相容writer。
- 精煉／解除服務仍強制testEnvironment與隔離scope，並無正式可操作白名單；不能為上線把testEnvironment=true放正式。
- stone flag=false會保留但暫停已鎖材料的舊箱，不是只停新來源。正式緊急控制需拆准入與歷史兌付，尚未完成。
- D步驟的精煉與combat必須同一准入版本協調，不得有付資源但承諾能力未生效的中間窗口。
- 無asset損壞是指**本次完整合成資料**；沒有查正式資料，不對正式資產健康狀態作保證。

## 6. 風險與正式發布阻擋

R1：缺真正Firestore／Rules／並行及索引測試。修復官方artifact下載環境，在隔離專案實際執行，不能改用正式測試玩家來替代。

R2：戰鬥只驗證命中意圖／頻率／順序／裝備及重算傷害，不驗實際物理碰撞。需明確完成最低可信任驗證／反腳本設計與驗收，不假設前端可信。

R3：缺immutable候選commit、完整正式環境識別／權限／索引／Rules相容查證與備份隔離還原。

R4：正式移轉adapter／批次controller、V2相容writer的准入、正式穩定白名單尚未建立。原demo-only工具不能偽裝成正式命令。

R5：正式歷史資源差異證據與全scope覆蓋不足，不能確認無錯扣／退款或資產遺失。需可信任帳本／一致快照與對帳，不手填balance／pass旗標。

R6：舊PWA／舊開頁對V2／V5及回退相容、實體iPhone／Android、多裝置及實際網路未驗。原瀏覽器3組時序不穩仍需排查／明確接受，不只重跑看綠。

R7：Phase7觀測統計缺全服完整分母、毛金幣流水與足夠樣本；目前資料不能支撐全面經濟平衡／費用驗收。

R8：緊急關閉要能只停新交易／新材料，保留V2操作、舊箱兌付、pending結果及已取得能力；現有literal/test-only flags不能達成全部正式控制要求。

以上未解，**不建議授權B部署，更不執行C～F**。目前可以審查工具／測試與後續補強方案；不是要求批准一個仍有阻擋的正式部署。

## 7. Commit hash與來源追蹤

| 階段 | 實際commit hash | 說明 |
|---|---|---|
| Phase1基準程式 | 0233ffd632d82ac0cede326d508718ea3cdbe734 | 原測試基準來源，不含後續精煉 |
| Phase1盤點／基準交付 | 8dbae59e619cc5382853dfeb0e6397eccddd209a | 已存在提交，也是目前HEAD |
| Phase2 | 無獨立commit，未提交 | 工作目錄實作及對應evidence |
| Phase3 | 無獨立commit，未提交 | 同上，不把HEAD當已含Phase3 |
| Phase4 | 無獨立commit，未提交 | 同上 |
| Phase5 | 無獨立commit，未提交 | 同上 |
| Phase6 | 無獨立commit，未提交 | 同上 |
| Phase7 | 無獨立commit，未提交 | 同上 |
| Phase8 | 無獨立commit，未提交 | 本次測試／工具／準備文件；未合併main |

來源manifest以SHA256凍結本次審查範圍，供檢查檔案是否漂移，**不是Git commit的替代品或正式版本核准**。不能為滿足八個hash欄位捏造hash、追溯重寫歷史或自動commit／push main。

## 8. 交付與停止點

完整日誌、初跑失敗、獨立重跑、五組新UI、Emulator阻擋、資產audit、成本、來源manifest及環境審查見 [Phase8 evidence](evidence/phase-08-2026-11-28/phase-08-summary.json)。六份文件可依本地路徑審查。

下一步應先針對上述阻擋決定補強及驗收，再產生新的不可變候選commit與Step A報告。任何正式備份／dry-run／部署／Rules／移轉／開關／逐級擴大都必須有指定範圍與步驟的明確授權。本次停止於Step A，未執行B～F。
