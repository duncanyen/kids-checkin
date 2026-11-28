# 武器精煉Phase1～8整合測試報告

> 後續修正：進場前攻擊（SEC-02）已加入前後端共用限制，671單元、46真實Firestore／候選Rules及8組瀏覽器流程驗證通過。原報告保留為歷史證據；SEC-01及完整舊版更新流程仍未解除。見 [進場限制報告](approach-guard-report.md) 與 [合併攻擊／更新設計](batched-combat-and-update-design.md)。

> 最新相容性／戰鬥驗收：667單元、43真實Firestore／候選Rules與7組瀏覽器測試完成，但重現未受可信任命中驗證的批次可在怪物進場前獲勝，仍NO-GO。詳見 [相容性與安全報告](compatibility-security-report.md)，不得將測試程式綠燈視為安全驗收通過。

> 2026-11-28 後續更新：受審核移轉 adapter、分批／續跑／回復及同次資源帳本已完成隔離實作；最新 661 單元、37 真實 Firestore／候選 Rules 與3組瀏覽器結果見 [移轉對帳報告](migration-and-reconciliation-report.md)。原始階段紀錄保留；沒有正式移轉、部署或全服開放，整體仍 NO-GO。

日期：2026-11-28（台灣時間）。範圍：目前dirty工作目錄，來源HEAD `8dbae59e619cc5382853dfeb0e6397eccddd209a`。測試fixture與localhost，不登入正式帳號、不查正式玩家資料。**正式驗收未通過；此文件不是部署核准。**

## 1. 基準與環境

Phase1 [既有功能基準](04-regression-baseline.md)使用來源`0233ffd632d82ac0cede326d508718ea3cdbe734`，469項單元、29組瀏覽器通過，真實Emulator已被HTTP403阻擋；當時缺完整圖鑑、實機、正式Rules／索引與正式營運資料。Phase1文件提交為8dbae59，Phase2～8變更仍未提交。

本次使用Node22、Linux headless Chromium、真實Phaser3.60 fixture、localhost HTTP、真實service程式＋MemoryDB／隔離Auth SDK。browser guard拒絕非localhost外連。不是實體iPhone、真實Wi-Fi／行動網路或正式Firebase。

## 2. 測試結果摘要

最終數量與日誌雜湊見 [Phase8 evidence](evidence/phase-08-2026-11-28/phase-08-summary.json)。新增Phase8離線／政策／移轉工具17項，與原Phase7的612項合計**629項單元**，同一套件只計一次，不把歷次重跑加成測試數。

- Phase1原29組瀏覽器矩陣：初跑26通過、3失敗（combat_feedback、critical_feedback、navigation_load）。兩個血條0.3cm gap時序斷言及一個導航載入狀態斷言。完整初跑保留。
- 三組獨立重跑結果記在regression-rerun與regression-combat-rerun，不覆蓋原日誌。重跑通過不等於根治時序不穩，這仍是需處理／接受的驗收缺口。沒有修改遊戲或放寬原assertion。
- 額外5組：武器個體、材料來源、精煉／解除UI、精煉戰鬥、精煉營運中心，使用實際遊戲／獨立營運中心入口，全部通過隔離驗證。
- 額外5組首次因本次環境重啟後localhost8032無伺服器而全數ERR_CONNECTION_REFUSED；補上由runner管理的HTTP server後再跑，原失敗與通過皆保留，沒有把伺服器未啟動說成遊戲bug。
- 真實Firestore Emulator：再次下載JAR HTTP403 Domain forbidden，**6個新階段Emulator檔未執行assertions**。Rules、真正Firestore競態與索引READY不能標通過。

## 3. 全部需求覆蓋對照

| 功能 | 隔離證據 | 判讀／未覆蓋 |
|---|---|---|
| 登入／登出／重登入 | account-login、private-auth、profile設定、private-admin、存檔 | 本機表單／身分橋接／恢復通過；不是正式帳號驗證 |
| 村落首頁／導航 | farm-private、visit_hud、navigation_load、scene模式 | 有真實Phaser入口；導航狀態初跑失敗另列，不能宣稱完全無不穩 |
| 收蛋／偷蛋／清潔 | farm-private、daily_group、交易單元 | 原結算／倉庫／任務及跨群組隔離；未新增前端資產寫入 |
| 雞種買賣／商店／倉庫 | shop_stock、poultry單元、scene／原核心 | 原庫存、價格、容量、出售規則維持 |
| 守衛犬租用 | guard_rental、guard-dog單元 | 原租期／選擇／權益；不改護衛判定 |
| 武器買賣／個體／裝備 | weapon-instances額外模式＋原單元 | 同款獨立ID、明確出售1把、裝備、防舊種類請求、V1相容 |
| 全武器攻擊／全怪物 | 原combat／critical／chain單元、combat_feedback九怪、katana／hornet模式、Phase6矩陣 | 純模型覆蓋8武器×9怪物；真實UI主要大鐵槌／弓，未手動在實體手機逐個武器打全部怪物 |
| 爆擊／連爆／精煉戰鬥 | 原feedback、Phase6模型及額外V5模式 | +0保持V4，V5有序合併、快照、立即命中／500ms批次、混合切換、守限制、原ID重播 |
| 戰利品／寶箱 | chest_flow、chest_batch、art-failure、額外combat模式 | 原入庫、動畫降級、批次、防重、容量、原結果；不變更掉落 |
| 每日簽到／任務 | daily_group、daily單元、材料來源模式 | 同帳號不同群組、日期模型、一次領取與額外材料；非真等到台灣午夜 |
| 禮包／活動／排行榜 | 原service／management單元、ops-management、weekly_ranking | 後端名額、防重、公告／設定／兩榜驗證；玩家端完整私有禮包UI原有fixture缺口未補成已通過 |
| 圖鑑 | 原unavailable入口 | 完整收集／里程碑尚不存在，不能列成功案例 |
| 精煉石取得／扣除／顯示 | stone-rewards模式、stone單元及額外UI | 原獎勵不減、堆疊、不可賣、舊箱快照、按scope領取、防重 |
| +0～+9／失敗 | refinement核心／service／UI、Phase8實際service整合 | 逐級、成本、版本、失敗不降級、+9拒絕、重送／並行／中斷模型 |
| 解除／退款 | Phase5UI／player單元、Phase8整合與audit | +9成功成本35000／16，退款10500／8；失敗不退款；原ID重送一次 |
| 營運設定／統計 | 額外ops模式、ops／statistics單元 | 草稿／發布／回復、權限、防重、分頁、分片、對帳／快照；無正式全服分母不虛構 |
| 多裝置 | 並行service／MemoryDB測試、結果重播 | 不是實體雙手機，也不證明真實Firestore contention；Emulator BLOCKED |
| PWA／版本 | art-cache、daily-assets、legacy-price、protocol單元 | 公開美術worker更新／回退、+0協定；舊開頁操作已移轉V2／V5玩家仍需正式相容驗收 |
| 網路逾時／重連 | 登入／save、寶箱、精煉UI reload、V5lost-reply | 模擬已提交回應丟失、原ID查回與排隊後續命中；非真行動網路休眠／切換 |
| 手機尺寸／效能 | 320／390／402／440／768 viewport既有精煉UI＋390營運中心 | 模擬安全區、按鈕、捲動、減少動態；未測實體iPhone17／Android及正式P95 |

## 4. Phase8新增資產一致性驗證

`scripts/weapon-data-audit.cjs`只讀本機JSON；沒有Firebase SDK／網路／正式project參數。回傳valid=false是資產／資料不一致；valid=true但releaseReady=false為缺證據，不能當完全驗收。

新增17項測試包含：

- 真實service合成流程：獨立武器+0→+9、一次失敗、解除及同ID重送；11筆經濟提交、11筆同次提交前後餘額證據。
- 原allocation數量／namespace、owner／generation、裝備個體、非負資源、0～9、+0零加成。
- 原intent／quote／發布版本hash、實際成本／成功率／保底／能力、連續revision、逐級結果、成功／失敗成本與最終state。
- 解除只對歷史成功投入退款、floor取整、退款後歸零，不用新費用算歷史。
- 假造錯扣、重複資源變動、錯誤退款、重複交易／路徑、缺武器／錯owner、改歷史設定／報價，都能阻擋。
- completed intent缺收據、pending、缺原始歷史／完整scope／一致快照／實際資源差異，不能假判完全通過。
- 唯讀demo exporter用既有集合，沒有編造不存在的欄位／collection；缺walletJournal時正確INCOMPLETE。
- 原型移轉2001把→3份allocation，batch1中斷／續跑、同ID不增量，同期新金幣與收蛋紀錄保留，後續武器交易發生後拒絕schema rollback。
- 審查工具全未知證據NO-GO；純規劃穩定分組跨裝置一致、比例巢狀，精煉／combat相依，緊急停止不能刪能力。它不是正式runtime gate。

故意破壞的資料全部是合成fixture，**沒有發現或操作任何正式玩家資產**。不得把合成audit的releaseReady=true當成正式發布就緒。既有正式收據沒有pre-balance帳本，完整歷史資源對帳仍缺可信任來源。

## 5. 效能與成本證據

最新精煉UI本機倉庫單樣本：4張卡片首屏4563ms；Phase5原樣本2485ms。兩者均只有1樣本，執行負載／快取不同，不能計算中位數／P95或判定正式退步百分比。這個觀測也不支持宣稱「手機秒開」。兩次都為listWeapons 1次、capabilities 1次、per-card detail 0次，沒有每張卡片額外查詢。

戰鬥仍原500ms批次與即時本機預測，不新增每擊FireStore讀取；Phase6成本探針見原報告。Phase7統計為異步分片、非全服listener。Phase8工具離線audit不消耗Firestore；demo exporter及原型移轉成本見[migration-runbook](migration-runbook.md)。沒有正式帳單或實體網路時間，不能給假美元總額或P95。

## 6. 舊版本與故障恢復評估

美術worker只緩存允許的公開資產，不緩存Auth、私有個體、API結果或精煉ID。新前端beginBattlePage宣告V5；舊前端在有精煉能力的場次被拒絕，不降成不驗證的傷害。這提供安全拒絕，**不代表舊頁所有原有操作仍可正常完成**。

移轉後V2＋instance gate關閉會阻止舊武器變動；須有正式相容writer／准入分離。精煉test-only gate尚不能正式白名單開放；材料全域關閉也會暫停已鎖材料的寶箱。以上列正式阻擋，沒有為讓測試全綠而取消保護。

真正斷網／多裝置競態／Rules重疊allow／索引READY／全部區域／正式權限／實機流暢度，仍未驗證。穩定性門檻先提出待核准，不把受控本機資料當正式基準。

## 7. 重現與證據

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
PHASE1_BASELINE_DIR=/tmp/weapon-phase8-baseline PHASER_FIXTURE=/tmp/kids-phaser.js \
  node tests/weapon-refinement/phase1-baseline.cjs
node tests/weapon-refinement/migration-rehearsal.cjs
node scripts/weapon-release-review.cjs --output /tmp/weapon-step-a-review.json
```

額外模式分別WEAPON_INSTANCE_TESTS、STONE_REWARD_TESTS、REFINEMENT_UI_TESTS、REFINEMENT_COMBAT_TESTS，使用farm-private-backend-browser及browser-guard，先啟動localhost HTTP並設定FARM_BASE_URL；營運中心使用refinement-operations.browser及OPS_UI_BASE。請保存每次失敗，不能只留下最後通過。

真實Emulator重現命令及localhost demo設定隨evidence保存；目前在JAR下載前阻擋，不能聲稱已驗證真實交易。應在允許官方artifact下載的測試環境修復，不能改用正式資料來代替Emulator。
