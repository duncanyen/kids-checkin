# Phase 6 — 武器精煉戰鬥整合

日期：2026-11-27（台灣時間）；來源HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`。工作目錄仍含Phase2～5及精煉石美術的未提交工作，本次未提交、推送、部署、修改正式資料、Rules或索引，未進Phase7。

## 1. 前置核對與目前狀態

已閱讀 [開發總規範](DEVELOPMENT_RULES.md)、Phase1分析與Phase2～5報告／證據。Phase5本機實作與568項單元、新UI／恢復／退款測試完成，**不能確認正式驗收已通過**：真實Firestore Emulator下載HTTP403，初跑瀏覽器有既有幀時序失敗。依使用者明確Phase6指示完成隔離整合，不把前置缺口改成通過。

正式預設 `weaponInstanceEnabled`、`weaponRefinementEnabled`、`refinementResetEnabled`、`refinementCombatBonusEnabled`、`refinementStoneRewardEnabled` 均為false。新精煉／解除仍限制隔離建構器、指定帳號／群組白名單、私有身分與後端ready；本次沒有開放正式玩家。

## 2. 現有差異與處理決策

| 項目 | 盤點結果 | 本次處理 |
|---|---|---|
| 原爆擊／連爆 | V4已採兩次獨立OR與1.5倍 | 不改倍率或既有V4序列 |
| 連爆狀態 | V4近戰／遠程各自保留，切回可能接舊序列 | 精煉採V5全域cursor；+0維持V4，明確版本化 |
| 合併順序 | 原flush固定近戰後遠程，會丟失交錯順序 | V5同一500ms批次提交有序runs，V4不變 |
| +0失敗快照 | Phase3失敗也存baseStatsSnapshot，但原+0戰鬥讀live設定 | +0預覽與統一服務改讀live base；已成功精煉仍用取得時base |
| 其他增益 | 未找到已接入戰鬥的卡牌／玩家等級增益或連發多段能力 | 不虛構計算，描述欄otherEffects=[]；裝備及限制沿用現有規則 |
| 實際輸入驗證 | 原後端驗證計數、時間、裝備及傷害，不跑Phaser碰撞 | 保留並加V5順序驗證；實際手勢／碰撞反作弊未解決，正式阻擋 |

以上不改原怪物HP、原始武器數值、命中範圍、點擊／拉弓手勢、動畫移動路徑、武器攻速或任何獎勵設定。

## 3. 統一能力服務與計算順序

`game-admin/functions/weapon-abilities.cjs` 的 `equippedAbilities` 在開戰Transaction內讀取可信任的owner、裝備Instance ID、allocation及private state，驗證scope、generation、投影、狀態與原始能力版本。`applyAbilities`只把已取得精煉能力套到該場可攻擊的槽位，未相容的傷害仍為0。

每個slot提供：武器／個體、等級、原始base與目前liveBase、累計basis-point加成、最終stats、能力設定版本、stateRevision、epoch、1.5倍率、±10浮動、原server速度上限／burst、弓250ms發射間隔描述、原可攻擊怪物及otherEffects=[]。不把成功成本、失敗紀錄或其他人的私有武器資料放進公開farm／RTDB鏡像。

順序固定：

1. 由伺服器驗證真正裝備個體，不信任玩家傳的attack、weaponId或bonus。
2. +0用目前營運原始設定；+N用既有取得時base快照，維持既有能力不被直接調低。
3. `原始攻擊 × (10000 + 累計attack bonusBp) / 10000`，沿用Core的整數四捨五入；不逐級相乘，也不把預覽final再加一次。
4. 兩種機率各加累計百分點；0～10000bp驗證。若設定會超過100%，沿用既有明確衝突拒絕，不能悄悄截斷已取得能力。+0來源設定也由原combat-balance驗證合法範圍。
5. +0槽位保留原本百分比設定的完整精度，即使與精煉槽位混用也不額外量化；精煉能力採已確認的整數bp。先檢查原武器／怪物相容性，不相容維持傷害0。
6. 最終基礎攻擊力周圍±10取整數，再按是否爆擊乘一次1.5，沿用Math.round。沒有新增其他倍率。

`refinement-core.cjs`的effectiveBase供預覽與新戰鬥解析共用。+0失敗快照修正只讓預覽跟既有+0戰鬥一致，不變更實際+0攻擊值；新增測試驗證營運調整base後的混合槽位也不會把+0誤鎖成舊值。

## 4. 戰鬥快照與相容協定

既有combatVersion仍為2。普通+0、未個體化及目前目標無法使用精煉武器的場次保留damageVersion4；既有V2／V3／V4舊會話的算法不變。

只要可用槽位有+N，伺服器建立damageVersion5：

```text
abilitySnapshotVersion: 1
weaponAbilities: {schemaVersion,generation,ownerRevision,slots}
baseDamage / criticalRate / chainCriticalRate: 已驗證最終值
chainState: {mode:null,critical:false,streak:0}
actionCount: 0
```

新前端beginBattlePage另外宣告 `refinementDamageProtocol:5`，原combatProtocol2／damageProtocol4保留。舊前端沒宣告此能力時不能進入有精煉加成的V5戰鬥，會要求更新，不降級傷害或由不支援的客戶端結算；普通+0照舊。

同一場戰鬥固定base、bonus、instance／state版本與damageSeed。精煉、解除、換裝、出售的原交易都拒絕正在進行的戰鬥；Firestore衝突重試保證開戰與能力交易其中一方先完成，另一方重讀最新狀態，不混用半套能力。

即使其他可信任程序在場中變動private state，既有會話仍用原快照，不在每批重算能力；測試明確覆蓋此情形。已存會話的client傳值不作權威，真正HP、連擊與結果都由後端計算。

## 5. 連續爆擊與有序批次

V5每次有效命中：上一擊同槽位且為爆擊時，額外判連爆；基礎與額外任一成功算一次爆擊。公式 `1-(1-p)(1-q)`；+9的20%／20%在上一擊爆擊後為36%，兩次都成功也只乘1.5一次。長期爆擊占比與每擊期望另見 [平衡報告](combat-balance-report.md)。

- 切換近戰／弓箭控制時，就加入不抽傷害、不增加攻擊次數的switch事件；即使沒有射擊又切回也會清連擊。相鄰純switch可合併成最後一個，語意相同。
- 換攻擊槽位的第一擊也不沿用另一武器的連擊。
- 擊退、結算、離開／新頁面、新目標與新戰鬥重置cursor；戰鬥未結束時不能實際換裝。
- 無傷害、不相容、怪物已死或無效請求不推進有效攻擊序列。
- 一支箭沿用原ArcheryControls：碰撞後destroy／splice，再呼叫一次arrowHit；發射最短250ms不改。近戰仍是原pointer命中事件。沒有新增一次手勢的多段／連發次數。

V5仍是500ms合併，payload：

```json
{
  "action":"battleAttack","battleId":"server-battle-id",
  "combatVersion":2,"damageVersion":5,"firstAction":0,
  "attackRuns":[
    {"mode":"melee","count":2},
    {"type":"switch","mode":"ranged"},
    {"mode":"ranged","count":1}
  ]
}
```

同一批最多64 runs、1000個命中；原每秒20近戰／10遠程、burst4及截止時間不變。server驗證firstAction、武器／目標、每槽計數、版本與原收據；HP／damage／crit／獎勵等額外欄位拒絕。批次分割不改傷害或連擊，死亡後不再抽後續有效命中。

前端即刻用相同快照預測數字及HP，後端回傳attacks、chainState、actionCount及HP再校正。等待中的新命中保留有序queue；確認前批後再以500ms窗口送剩餘，不因慢回應漏送。V5結果不明保留原requestId及整個batch，重試原批次，不重抽或重扣獎勵；未知／取消等錯誤也不丟掉原ID。V4原flush路徑保留。

switch-only批次必要時也有一次狀態RPC；不是每個按鈕點擊即查Firestore，連續切換仍合併。混合命中在一批送出，不新增每幀／每發／每下能力查詢。

## 6. 功能開關與緊急暫停

`refinementCombatBonusEnabled`現在也是新精煉及解除的准入：關閉時後端拒絕新經濟操作，UI不提供可執行的精煉能力承諾。原測試fixture改為明確啟用此旗標，不修改正式預設。

**已取得能力不依准入旗標刪除或歸零**。能力解析驗證private state後保留已取得加成，新開戰仍能用該武器的能力；已開戰快照不變。關閉weaponRefinementEnabled／refinementResetEnabled只停止新操作，已完成結果仍可查詢。若需緊急停止，應先停這兩項准入，不能整庫回灌或移除bonus。

這不是把正式開關開啟：正式環境本階段未產生個體／精煉資料、未部署；普通+0在所有旗標false時完全走原V4。舊測試階段取得的個體只在隔離資料驗證，沒有正式回填／移轉。

## 7. 資安驗證與正式阻擋

本次完成：可信任個體／能力／版本讀取、開戰原子快照、場中衝突限制、有效順序／計數／頻率／時限驗證、後端重算HP、原收據冪等、原loot／chest／任務結算防重。不接受前端damage、crit或win，不能靠改前端顯示取得額外物品。

仍有實質限制，不能宣稱完整防外掛：

1. 原架構以「有效命中意圖」結算，不在伺服器跑怪物位置、拉弓軌跡或碰撞；可依合法頻率送命中命令的腳本仍可能被接受。若正式要求每次獲獎都能對應真實手勢／碰撞，現況**尚不能安全證明，列正式上線阻擋**，需另設可驗證命中／反腳本方案；本次不假設前端可信任，也不在未授權下重寫物理系統。
2. 戰鬥seed沿用現有可重現公開快照，玩家可預測下一擊；序號與順序不可跳過，但不是隱藏未來爆擊的安全亂數協定。精煉成功本身仍用Phase3私有crypto亂數，不混用戰鬥seed。
3. 正式Rules release未查證；候選Rules對ops根與farm權威欄位有拒絕，但不等於已部署或已通過真實Rules驗收。真實Emulator本次再次下載JAR HTTP403，沒有執行新安全／競態assertions。
4. 所有可達區域／舊PWA都須支援V2個體與V5協定，不能只更新前端或單一區域後假定安全。沒有部署或正式切換驗證。

因此是隔離環境的功能整合完成，**不是正式安全驗收通過**。

## 8. 測試與平衡

新增 `game-admin/tests/refinement-combat.test.cjs`：17項，涵蓋8武器×9怪物×4級的矩陣、+0原V4逐擊比較、限制、原始快照、防止重複加成、+0失敗cache、36%機率統計、混合場次+0原始百分比精度、一次1.5倍率、±10端點、混合批次分割、switch-only、不相容與偽造請求、頻率／順序、攻擊／結算重送、loot與chest一次、開關保留能力、場中衝突、舊客戶端拒絕、逐批零能力讀取。

新瀏覽器模式從實際HUD「村落 → 公開村落 → 他人農莊」進入，測試+9金剛、虎頭蜂、遠古巨人：第一次近戰使用畫面實際指標點擊，其餘burst沿用相同場景命中事件；飛行使用既有箭矢碰撞回呼。驗證即時數字、500ms合併、近遠切換、serverHP一致、原戰利品各一次與每日任務共3次。**沒有把回呼測試當成真實拉弓手勢驗證**。

最終全套單元測試 **585／585通過**（含新增17項）。原有瀏覽器回歸初跑29組中27組通過，倒數銷毀等待與+0血條頭部位置兩組失敗；保留初跑日誌，兩組獨立重跑均通過，未修改原判定或放寬容差。精煉UI及新V5整合模式也獨立通過。這不代表既有時序不穩已根治。

新V5最終交付跑使用固定活動內日期，最初因測試等到LobbyScene啟動卻未等村落卡片建立而失敗；僅補上測試helper對實際目標物件就緒的等待，再跑通過。原失敗 `browser-delivery-final.log` 與通過 `browser-delivery-rerun.log` 都保留。

截圖採390×844手機viewport：[金剛戰鬥](evidence/phase-06-2026-11-27/battle-gorilla-plus9.png)、[虎頭蜂獎勵](evidence/phase-06-2026-11-27/reward-hornet.png)、[遠古巨人獎勵](evidence/phase-06-2026-11-27/reward-giant.png)。戰鬥截圖是移動中瞬間，部分怪物立繪／血條可能在viewport邊界或外側，不能將這些截圖當作所有位置與實際手勢的完整視覺驗收；獎勵截圖另行保留。未實測實體iPhone／行動網路。

另注入一次伺服器已接受但回應逾時，確認重送原batch／requestId，之後排隊的命中只提交一次，不重複傷害／獎勵。完整結果、初跑及重跑見 [Phase6 evidence](evidence/phase-06-2026-11-27/phase-06-summary.json)。

平衡模擬共288列、180組相容各1000場；所有武器的+0/+3/+6/+9每擊、DPS、擊數、擊殺時間、時限勝率及假設收益，見 [平衡分析](combat-balance-report.md)、[CSV](evidence/phase-06-2026-11-27/simulation/results.csv)。+9長期DPS約+63.6%，但移動／遇怪／里程碑限制使每日產出不等比；未改任何HP或獎勵。

## 9. 效能與Firebase費用

[能力探針](evidence/phase-06-2026-11-27/cost-probe.json)為MemoryDB文件介面計數，不含原有Auth／節流／會話／farm、Firestore自動重試及鏡像報表trigger：

| 情況 | 每次開戰額外能力文件讀取 | 每擊／每幀能力讀取 |
|---|---:|---:|
| 原V1農場 | 0 | 0 |
| V2兩槽+0、未有精煉state | 3（owner＋2 allocations） | 0 |
| V2兩槽有精煉state | 5（另2 state） | 0 |

初始木棒不需allocation，空弓槽不讀；同一Transaction使用既有讀取快取共用state，不重複付同文件讀取。兩批有效攻擊的測試明確檢查沒有讀owner／state／combat設定。交易重試必須重讀權限與版本，不以快取跨請求跳過安全。

snapshot／cursor寫回原active session與原攻擊收據，不新增每擊文件；增加的是少量會話／回應位元組。混合武器一批RPC保序，switch-only與逾時重試可能有額外RPC，不能宣稱總讀取零增加。

增加讀費約為 `V2開戰次數 × 實際額外文件數 ÷100000 × 專案區域單價`，另含網路／Functions／儲存及重試；未取得正式帳單或玩家量，不虛構美元費用。模擬DPS不等於網路延遲或實機效能。

## 10. 修改檔案

- 新增 `game-admin/functions/weapon-abilities.cjs`：統一權威裝備能力。
- `refinement-core.cjs`、`refinement-service.cjs`、`refinement-player-service.cjs`：有效base一致、戰鬥准入及既有能力顯示。
- `service.cjs`：傳入既有正式false的combat旗標；不是新增公開開關。
- `farm-combat.cjs`、`farm-transactions.cjs`：開戰能力解析、V5版本／有序批次與原結算接線。
- `js/farm/combat-damage.js`：保留V4，新增V5單擊與有序計算。
- `js/farm/backend-client.js`：V5本機預測、有序500ms佇列、結果不明原ID與慢回應排隊處理。
- `js/farm/battle-page-client.js`：V5能力宣告；原V4協定欄位不變。
- `js/farm/archery.js`：既有切換按鈕僅增加清連擊通知，射箭手勢／速度／碰撞不改。
- `js/farm/weapon-refinement-ui.js`：明示已取得能力保留，不再說所有精煉未套戰鬥。
- 新增 `game-admin/tests/refinement-combat.test.cjs`、`refinement-combat.emulator.cjs`、`tests/helpers/refinement-combat-browser.cjs`；現有fixture／harness明確提供測試combat准入。
- 新增 `tests/weapon-refinement/combat-balance-simulation.cjs`、`combat-ability-cost-probe.cjs`、兩份報告與evidence；總規範更新本階段授權。

檔名前未附路徑者在 `game-admin/functions/`。沒有修改combat-rules原HP／attack、combat-balance原始預設、farm-combat.CONFIG、敵人動作程式、chests／stone掉率／物品設定、首頁HUD、Rules或索引。`farm-combat.cjs`只整合能力／協定及原結算，不改CONFIG值。此前Phase2～5的其他工作目錄差異保留原樣。

## 11. 回復與重現

停止新精煉／解除准入，保留private state、版本、收據及既有能力；既有V4場次照原快照結束，V5必須由支援它的後端／前端完成，不回退到忽略精煉能力的舊writer。不要刪bonus或用舊farm整庫覆蓋新資產。若資料損毀，保留帳本對帳、向前修復；本次沒有正式資料回填或遷移。

本機已備妥Node22、既有依賴與Chromium／Phaser3.60 fixture時：

```bash
node scripts/prepare-game-admin.cjs
node --test game-admin/tests/refinement-combat.test.cjs
node tests/weapon-refinement/combat-balance-simulation.cjs
node tests/weapon-refinement/combat-ability-cost-probe.cjs
```

本機HTTP根目錄服務後，以 `REFINEMENT_COMBAT_TESTS=1` 執行既有farm-private-backend-browser，使用browser-guard隔離SDK。Emulator套件只接受localhost與 `demo-nexus-private-farm`，修復HTTP403環境後須實際跑完，不能修改驗證旗標。

所有正式預設仍false，沒有部署、正式資料操作或進入Phase7。安全／Emulator／實機及已知時序缺口仍需驗收。
