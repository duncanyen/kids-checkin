# Phase 4 — 精煉石與既有獎勵整合

日期：2026-11-27（台灣時間）。來源 HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`。本工作目錄同時保留未提交的 Phase 2、3 改造，不能把相對 HEAD 的全部差異都歸為 Phase 4。本次未提交、推送、部署，未讀寫正式玩家資料、修改 Rules／索引，也未進入 Phase 5。

## 1. 驗收前提與目前邊界

已閱讀 [開發總規範](DEVELOPMENT_RULES.md)、Phase 1 五份分析、[Phase 2](phase-02-report.md)、[Phase 3](phase-03-report.md) 及其測試證據。**不能確認 Phase 3 已完整通過驗收**：真實 Firestore Emulator JAR 下載遭 HTTP403；前次兩項戰鬥血條位置斷言有時序不穩定。使用者明確授權 Phase 4 並要求繼續，本次僅完成工作目錄與隔離測試整合，保留上述缺口，沒有將其當成正式放行。

四個正式預設開關均為 false：`weaponInstanceEnabled`、`weaponRefinementEnabled`、`refinementCombatBonusEnabled`、`refinementStoneRewardEnabled`。材料發獎另要求既有私有登入、農場後端及 `ops_identity_state/global` 的 ready／farmReady 通過。開關是後端預設常數，不信任玩家請求中的旗標；測試透過建構服務注入，沒有公開測試隨機入口。

## 2. 材料與唯一權威欄位

| 欄位 | 實作 |
|---|---|
| 對外物品 ID | `refinement_stone` |
| 名稱／分類 | 精煉石／武器精煉材料 |
| 唯一庫存 | `groups/{groupId}/users/{accountId}.farm.refinementStones` |
| 預設 | 欄位不存在視為 0，不回填既有農場 |
| 數值 | 非負安全整數，增加與扣除檢查溢位 |
| 堆疊／期限 | 單一堆疊、無期限 |
| 限制 | 不可裝備、當武器、出售、一般丟棄、玩家交易／贈送或商店購買 |
| 倉庫位置 | 沿用「其他」分類，有庫存才顯示數量 |

沿用 Phase 3 已使用的 `farm.refinementStones`，**不另外建立同義庫存或材料 Collection**。測試確認簽到多給一顆後，可由既有精煉服務扣除同一欄位。

本次實作選擇材料為**不占一般倉庫容量的獨立堆疊**，不加入 `INVENTORY_KEYS`。目的是避免多送材料反而使滿倉玩家無法領取原本的簽到金幣；原有雞蛋、藥品、武器等容量規則不變。這是需求未指定占格方式時的相容選擇，正式開放前仍需確認此產品規則。

暫用圖 `assets/farm/refinement/test/refinement_stone.svg` 有 TEST 標記，透明背景，不覆蓋原圖。圖示不加入共同 `ALL_ASSETS` 預載清單；有材料才按需載入，載入失敗以「石」文字顯示，後續存檔更新可重試。**正式發布前必須換正式美術並重建資產 manifest**。

## 3. 獎勵來源與初始設定

| 來源 | 初始額外精煉石 | 領取邊界 |
|---|---|---|
| 簽到第 3 天 | 1 顆，100% | 原簽到週期的當天 grant |
| 簽到第 7 天 | 3 顆，100% | 原簽到週期的當天 grant |
| 其餘簽到日 | 關閉 | 不額外發放 |
| 每日任務全完成 | 1 顆，100% | 既有任務領獎，同群組／玩家／台北日期一次 |
| 怪物寶箱 | 下表 | 每箱第一次有效開啟 |
| 營運／禮包 | 管理員明確設定物品數量 | 原禮包期限、總名額、每帳號限額均保留 |
| 每週活動、圖鑑里程碑 | 尚未實作來源，禁止啟用 | 僅保留 extensions 能力標記 |

「每日任務額外一顆」在玩家按原本的領取獎勵時與金幣一併結算；不新增自動領獎請求或另一個任務計數器。原有收蛋／清潔／打怪事件、完成條件與金幣不變。

| 現有怪物 ID | 遊戲怪物對應 | 新箱內額外材料機率 | 數量 |
|---|---|---:|---:|
| `wolf` | 大野狼 | 10% | 1 |
| `tiger` | 老虎 | 10% | 1 |
| `gorilla` | 大金剛（金剛） | 10% | 1 |
| `mole` | 地鼠 | 20% | 1 |
| `dragon` | 烈火龍 | 20% | 1 |
| `eagle` | 巨飛鷹 | 20% | 1 |
| `cobra` | 毒牙眼鏡蛇王（眼鏡蛇王） | 50% | 1～2 |
| `giant` | 遠古巨人 | 50% | 1～2 |
| `hornet` | 虎頭蜂 | 關閉（0%） | 0 |

沒有建立別名怪物。上述機率是**已取得新寶箱後**的額外材料機率，不是怪物掉寶箱機率。原 `ops_game_config/chests`、怪物戰利品、營運發布的掉箱率、金幣及基本物品均不修改；新材料設定中甚至不包含 `dropRate`。

## 4. 設定結構與後端 API

新增私有設定文件：

- `ops_game_config/refinement-stones`：`schemaVersion, activeVersion, revision, updatedBy, updatedAt`。
- `ops_refinement_stone_versions/{version}`：不可覆寫的完整來源設定、`effectiveAt, contentHash, publishedBy, publishedAt`。
- `ops_refinement_stone_config_requests/{hash(adminUid:requestId)}`：管理發布的指紋、結果及時間，防重。
- 沿用 `ops_audit`，發布保存修改人、時間、舊指標及新版本／內容雜湊；不可變版本可還原前後設定。

每個來源規則為：

```json
{"enabled":true,"chanceBp":2000,"min":1,"max":1,"cycle":"box-open","claimLimit":1}
```

`chanceBp` 為整數 0～10000；單次數量 0～1000，min ≤ max，啟用且機率大於零時 min ≥ 1。簽到含完整 1～7 天及總開關；任務週期 `taipei-day`；寶箱 `box-open`；禮包 `existing-gift-claim`。週期／限制依既有規則驗證，不藉設定改變原活動或領獎限額。

所有來源同屬一個 `version`，沒有設定指標時不自動建立正式設定。未發布、內容雜湊不合或未到生效時間時，自動額外來源不發材料，原金幣／戰利品保留；真正資料庫讀取錯誤不吞掉，依既有交易失敗處理。明確含材料的禮包則整包保持未領，不部分交付。

沿用 `gameOpsAdmin` 的 `adminAPI`：

| action | payload | 結果 |
|---|---|---|
| `refinementStoneConfig` | 無 | 已發布 config／revision，或未發布的 defaults（不寫入） |
| `publishRefinementStoneConfig` | `{config, expectedRevision}`，外層 requestId | 原子發布版本、指標、防重收據與稽核 |

管理員必須同時有請求 admin claim 及當前 Auth admin claim，停權／撤權即拒絕。發布還需材料功能及可信任後端 ready，限定立即生效的版本，不開啟排程發布。相同版本不可覆寫；過期 revision 拒絕；相同 requestId 不可換內容。

`createStoneRewardService` 另提供 `dailyPreview/daily/captureChest/openChest/authorizeGift/giftAvailable` 供既有後端組合，沒有新增玩家自行填數量的發獎 callable。營運中心獨立材料設定 UI 留給 Phase 7；既有禮包商品目錄可辨識材料，功能關閉時標成不可用。

## 5. 簽到與任務原子流程

1. 沿用既有私有身分、群組、停權與伺服器台北日期驗證。
2. 依原本 `cycleId/day/dateKey` 與 `ops_daily_grants` 檢查是否已領。
3. 已領直接回原 grant，不查新材料規則、**不補發歷史**。
4. 沿用既有 canClaim／可信任任務事件判定；未完成不領。
5. 領取時讀取生效材料版本，獨立伺服器亂數決定額外量。
6. 同一 Firestore Transaction 更新原金幣、材料、day／state、grant 的結果與材料版本；任一失敗全部回滾。
7. 前端顯示伺服器預覽及實際結果，存檔仍由既有監聽器更新；不在前端自行加庫存。

原金幣獎勵快照不變。材料預覽可能隨管理員發布而更新，領取時以當時生效版本為準，結果會保存實際版本。沒有把材料預覽誤當成精煉的固定報價。

同帳號不同群組沿用既有 scope version 2 獨立計次；本次不改原禮包的帳號層級限額。

## 6. 寶箱版本鎖定與開箱

新箱在**原本成功掉落**後，外層額外保存：

```text
refinementStoneReward = {
  schemaVersion: 1, source: 'chest', monster,
  version, contentHash, lockedAt,
  rule: {enabled,chanceBp,min,max,cycle:'box-open',claimLimit:1},
  snapshotHash
}
```

原本 `snapshot` 的金幣與物品內容保持不變。沒有額外標記的舊箱永不補加材料；功能關閉時取得的箱也沒有該標記。未發布有效材料設定時取得的箱鎖為 disabled，不在日後變成有材料的箱。

開箱讀原箱的快照，核對怪物、掉落時間及快照雜湊；**不重新讀當前材料設定**。先做既有所有權、狀態、戰鬥中限制及原金幣／物品容量驗證，再將材料與原獎勵一次原子提交。結果記錄於原箱 `result`，包括材料量、版本與來源箱 ID。

同一筆開箱與重疊的批量開箱沿用既有收據及 opened 結果；重送只讀回原結果，不能再發材料。相同交易嘗試的亂數以 key＋抽樣範圍快取，不因 Firestore callback 自動重試重抽。原本掉箱／金幣用的 `farmRandom` 抽樣順序與索引未加入材料抽樣，避免改變既有機率或金幣。

材料使用獨立 `crypto.randomInt`，機率下界包含、上界不包含；數量採 min + randomInt(max-min+1)，包含上下限。0% 不抽／不給、100% 保證給。測試可控來源僅能於明確 testEnvironment 建構，未設隔離旗標即拒絕注入。

**關閉功能的維護語意**：

- 普通舊箱繼續照原規則開。
- 已鎖定正機率材料規則的新箱，暫停開啟並保留原箱，顯示「材料獎勵維護中」；避免關閉開關把已承諾材料悄悄刪除。
- 鎖定 disabled／0% 的箱仍能照原規則開。
- 重新開放後用原快照結算；已開啟箱仍可查回原結果。

開箱 UI 既有結果列可顯示材料圖示、名稱與數量，不增加發獎回呼；關閉與動畫事件只顯示。

## 7. 營運、禮包與未來來源

既有「營運獎勵」可經 `saveGift` 建立包含 `{kind:'item', itemKey:'refinement_stone', amount}` 的禮包，玩家仍用 `gameOpsRedeem`。

發獎前 `authorizeGift` 依後端材料開關、trusted ready、已發布 gift 規則及所有同材料列加總驗證。明確配置的禮包物品保證交付，gift chanceBp 固定 10000，不將管理員指定數量改成抽選。關閉／無效時保留整包及名額；恢復後同原 requestId 可重試。領取成功仍沿用原每帳號、每禮包、有效日期與名額限制，金幣、材料、quota 及收據同一交易。

不是另外開發任意 admin 給物 API。每週排行目前沒有完整通用獎勵派送器，圖鑑里程碑也尚無可接線的完整來源；extensions `{enabled:false,implemented:false}` 明確拒絕啟用。未來可在真正的可信任原子發獎流程中沿用同一 canonical ID／`D.award` 授權與原 receipt，不推測不存在的 API。

## 8. 修改與新增檔案（本階段）

| 檔案 | 本次用途 |
|---|---|
| `game-admin/functions/refinement-stone-rewards.cjs` | 新增來源設定、版本／稽核、來源授權、快照與抽樣 |
| `game-admin/functions/weapon-instance-config.cjs` | 增加正式 false 材料開關（其他三個維持 false） |
| `game-admin/functions/domain.cjs` | canonical item、後端授權發獎、獨立堆疊與上限檢查 |
| `game-admin/functions/service.cjs` | 沿用管理員／玩家驗證，組合來源服務、gift／catalog 接線 |
| `game-admin/functions/daily-challenges.cjs` | 預覽、原子 grant、結果版本及歷史不回填 |
| `game-admin/functions/chests.cjs` | 新箱鎖定、舊箱相容、原子額外發獎與批量支援 |
| `game-admin/functions/farm-transactions.cjs` | 注入來源服務與每請求抽樣器，不動原掉箱亂數 |
| `js/farm/refinement-material.js` | 共用材料定義與餘額驗證 |
| `js/farm/inventory-core.js` | 共用材料匯出，原容量鍵不變 |
| `js/farm/save-core.js` | 可選材料餘額完整性驗證，不初始化回填 |
| `js/farm/WarehouseScene.js` | 有庫存才顯示、懶載測試圖、只讀操作 |
| `js/farm/daily-ui.js`、`css/farm-daily.css` | 額外材料預覽與實際結果文字，材料另行且只在有材料時增高資訊欄 |
| `js/farm/chest-ui.js` | 既有獎勵列載入材料圖 |
| `js/farm/asset-manifest.js` | 懶載圖示登錄，排除共同預載 |
| `assets/farm/refinement/test/refinement_stone.svg` | 新增 TEST 暫用圖，不覆蓋原素材 |
| `assets/farm/cache-manifest.json`、`js/farm/art-cache-revision.js` | 依資產工具重建指紋 |
| `scripts/prepare-game-admin.cjs` | 將純材料模型複製到忽略提交的 functions/game 打包目錄 |
| `game-admin/tests/helpers/stone-reward-fixture.cjs` | 完全隔離資料及可信任事件 fixture |
| `game-admin/tests/refinement-stone-rewards.test.cjs` | 17 項整合／安全／相容測試 |
| `game-admin/tests/refinement-stone-rewards.emulator.cjs` | 真 Firestore 競態及 candidate Rules 測試，僅 localhost demo |
| `tests/farm-private-backend-browser.cjs`、`tests/helpers/stone-rewards-browser.cjs` | 真 Phaser 原入口＋隔離 SDK／後端模式 |
| `tests/weapon-refinement/stone-reward-cost-probe.cjs` | 隔離 IO 增量量測 |
| 本報告、`DEVELOPMENT_RULES.md`、Phase 4 evidence | 本次授權邊界、證據、限制 |

`ShopScene.js`、武器 Repository／移轉／精煉核心、`css/farm-chest.css` 等工作目錄差異另有 Phase 2／3 的既有未提交工作，不冒充本階段新增。沒有修改部署設定、Firebase Rules、索引、怪物戰鬥值、任務條件或原獎勵表。

## 9. 測試與證據

最終結果見 [Phase 4 證據](evidence/phase-04-2026-11-27/phase-04-summary.json)。保留初跑失敗與後續重跑，不手動將測試旗標改成通過。

新增 17 項單元／MemoryDB 整合測試涵蓋：

- 真怪物 ID／三組機率、0%／100%、機率臨界點、1～2 上下限、固定量、無效版本／限制／未實作來源。
- 簽到七天原金幣合計1600，加材料4；已領歷史不補發。
- 任務未完成拒絕、全完成一次多給1、跨台北日期／跨群組及多裝置同請求。
- 原子失敗回滾、原 request 重試、來源關閉零設定讀取、設定損毀不攔原金幣。
- 舊箱、新箱鎖版本、獨立 RNG 不改金幣、維護暫停不吞箱、虎頭蜂預設關閉。
- 重複／重疊批量開箱、容量不足／寫入失敗不部分發材料、外人及快照竄改拒絕。
- 材料滿倉照領、疊加／溢位／負值驗證；canonical ID 及庫存欄位都不能透過買賣／裝備／丟棄操作繞過。
- 真實 service 管理 claim／撤權、禮包原金幣＋材料一次發放、開關關閉不消耗領取名額。
- Transaction callback 重試抽樣固定；Phase 3 精煉從相同材料餘額扣除。

瀏覽器新模式從遊戲 HUD「每日任務」簽到，再從「倉庫」→「其他」查看6顆；使用真 Phaser3.60及真後端函式、MemoryDB／隔離 Firebase SDK。320×568及390×844皆驗證文字、按鈕、不可裝備／丟棄、無水平溢出。第1天材料為**僅測試設定**，正式初始表仍是第3／7天。

初跑 helper 使用錯誤的既有按鈕文字「今日已簽到」，實際為「今日已領取」，修正測試選擇後通過；沒有為測試修改正式按鈕文案。目視發現 SVG 沒有 width／height 在 WebGL 呈黑塊，補正96×96後重新截圖確認為紫色晶石。

真實 Firestore Emulator 本次再次於下載 JAR HTTP403 `Domain forbidden` 停止，未執行新 Rules／真競態 assertions，狀態 **BLOCKED**；MemoryDB 並行測試不等於真實 Firestore contention。完整瀏覽器矩陣初跑27／29組通過：倒數測試於 combat-feedback-browser.cjs:72 等待逾時；爆擊測試於 :67 血條距頭0.3cm斷言失敗。這兩組其後依原命令單獨重跑皆 exit0，沒有修改原測試容差或正式戰鬥程式。初跑失敗保留並列為時序不穩定，不以重跑抹除。另有材料入口與Phase2個體化入口兩組通過。最終全套單元543／543通過，包含本階段17項；版面調整後相關前端22項另跑通過（已包含於543，不重複加總）。

沒有 iPhone／Android 實機、正式網路、正式 Rules release 或營運玩家資料測試。新 Emulator 檔本身拒絕非 localhost／demo 專案。

## 10. Firestore／Functions 增量費用

測量資料見 [IO probe](evidence/phase-04-2026-11-27/cost-probe.json)，是 MemoryDB 交易介面計數，無 Auth RPC／節流／trigger／真實自動重試，**不是帳單或正式效能實測**。

| 操作 | 開關關閉讀／寫 | 測試開啟讀／寫 | 本階段增量 |
|---|---:|---:|---|
| 首次 daily status | 11／4 | 13／4 | +2 read、0 write |
| 已有 status 的簽到 claim | 4／4 | 6／4 | +2 read、0 write |
| 有效戰鬥掉箱 | 6／6 | 8／6 | +2 read、0 write |
| 開箱 | 4／3 | 4／3 | +0 read／write |

設定指標＋版本在同次 Transaction 讀快取共用，因此 status 同看簽到、任務不重讀兩份。功能關閉自動來源不新增設定讀取。領獎沿用原 farm/day/state/grant 寫入，新增 metadata 與counter不新增另一張領獎表。新箱快照也在原箱寫入，開箱不再查設定。含材料的禮包多讀指標／版本，普通禮包沒有此增量；管理 catalog 功能開啟時需查 readiness 與設定，屬管理操作。

不增加每下戰鬥請求或另一個獎勵 callable；主要增加既有請求處理中的少量讀取及文件大小，可能連帶增加既有 farm 鏡像／report capture 位元組，沒有實測正式觸發費用。首次發布設定為4寫（版本、指標、receipt、audit）及3讀（receipt、指標、版本），另加原 admin節流／驗證。

若月多出 R 次額外讀取，估算增量為 `R/100000 × 正式專案所在區域讀取單價`，還需扣免費額度／考慮重試、網路、Functions CPU、Storage／RTDB鏡像流量，不能沿用不明區域單價當正式帳單。沒有真實玩家產出、消耗量與活躍天數，不虛構月費。

新材料產出預期：每個完整7天簽到週期4顆；每日全部任務另1顆；寶箱期望值分別每箱0.1、0.2、0.75顆（最後一組50%×平均1.5），還要乘實際營運掉箱率及開箱數。原有箱不計入額外供給。

## 11. 舊版相容、安全與回復

- 不改部署／Rules。本機候選 Rules 只准不涉及 farm 的一般欄位更新，ops 根預設不放行；新 Emulator 已列入材料 counter、設定、版本、發布收據及grant拒絕寫入測試，但尚被環境阻擋。
- **未確認正式 Rules 是否等同候選**。若正式仍有寬鬆 allow，常數 false 無法代替安全規則；正式啟用前需比對實際 release 及所有 writer。
- 舊 PWA可忽略新增顯示欄位，不能因此有權直接發材料；舊後端若仍可到達且不認識箱外層快照，可能忽略材料。正式啟用前需保證所有可達區域／版本後端均支援新格式，不以清除瀏覽器快取當安全措施。
- 本階段沒有正式材料，不需資料移轉／回填。關閉材料新來源即停止新額外發放，原資產保留；既有正機率新箱按前述維護政策保留並提示。
- 已發材料不可直接刪除 counter或整庫回灌。以原daily grant／箱result／gift redemption對帳，保留歷史、向前修復。需修正設定時發布新版本，只影響後續來源／新箱。
- 不回退到忽略新箱欄位的舊後端。若要暫停材料相關操作，維持支援讀取／重播新箱格式的相容版本。

## 12. 尚未放行事項

1. Phase 2／3／4 真實 Emulator、Rules及併發驗收未完成，不能宣稱 Phase 3 全部通過。
2. 既有戰鬥 HUD／倒數瀏覽器時序不穩定保留於本次證據，不混入材料需求修改。
3. 材料使用 TEST 暫圖，正式美術尚缺；獨立堆疊不占格規則應在正式開放前確認。
4. 尚無正式資料／實機／真實成本驗證；營運中心設定 UI留給Phase7，週活動／圖鑑派送未擴建。
5. 所有正式開關維持 false。**在 Phase 4 停止，不部署、不進 Phase 5。**

## 13. 可重現的隔離驗證命令

下列命令只適用已安裝 Node22、既有專案相依、Playwright／Chromium 與 Phaser fixture 的本機測試工作目錄；不設定正式專案，不部署。

```bash
node scripts/prepare-game-admin.cjs
node --test game-admin/tests/refinement-stone-rewards.test.cjs
node tests/weapon-refinement/stone-reward-cost-probe.cjs
PHASE1_BASELINE_DIR=/tmp/nexus-phase4-new-baseline node tests/weapon-refinement/phase1-baseline.cjs
```

新材料 UI 模式需先用本機 HTTP server 服務專案根目錄，並沿用既有 `browser-guard.cjs` 隔離外部 SDK：

```bash
STONE_REWARD_TESTS=1 \
NODE_OPTIONS="--require=$PWD/tests/weapon-refinement/browser-guard.cjs" \
FARM_BASE_URL=http://127.0.0.1:8032 \
node tests/farm-private-backend-browser.cjs
```

真實 Emulator：建立僅 localhost Firestore 的測試設定，規則指定本專案 `rules/firestore.private-farm.candidate.rules`，以 `demo-nexus-private-farm` 執行 `game-admin/tests/refinement-stone-rewards.emulator.cjs`。本次已嘗試，但停於 JAR 下載；修復下載環境後需實際跑完，不能將 BLOCKED 改為 passed。
