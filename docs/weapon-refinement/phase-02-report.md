# Phase 2－武器個體化及舊資料相容改造

日期：2026-11-27（台灣時間）。工作基準 commit：`8dbae59e619cc5382853dfeb0e6397eccddd209a`；本階段變更在工作目錄，未推送、未部署、未連接正式資料。已閱讀 DEVELOPMENT_RULES 與 Phase 1 五份文件／測試證據。規範 v1.1 補記本次使用者授權，並非擅自解除階段限制。

## 1. 本次範圍與結論

已實作 +0 武器的個體識別、私有 Repository、後端交易同步、倉庫／商店個體操作、隔離移轉工具與測試。**沒有精煉／解除交易、精煉 UI、材料來源或新戰鬥數值。**

正式 `weaponInstanceEnabled` 保持 literal `false`，不提供環境變數或營運 UI 在正式環境開啟；隔離測試才對服務注入 true。CLI 只接受 `demo-*` 專案及本機 Firestore Emulator，不提供正式執行參數。

本次實作可在本機隔離環境驗證，但不是正式上線版本：真實 Firestore Emulator 因下載 HTTP 403 阻擋，不能宣稱真實交易競態、Rules 或正式環境驗收通過。沒有進入 Phase 3。

## 2. 實際修改檔案

| 檔案 | 內容 |
|---|---|
| `game-admin/functions/weapon-instance-config.cjs` | 正式預設 false；服務預設使用此值 |
| `game-admin/functions/weapon-repository.cjs` | scope、唯一 ID、舊／新讀取、個體查詢／歸屬、分頁、取得／移除／裝備的原子寫入計畫 |
| `game-admin/functions/migrations/weapon-instances.cjs` | review、stage、resume、verify、rollback；進度、來源快照、隔離報告 |
| `game-admin/functions/farm-transactions.cjs` | listWeapons/getWeapon；現有買賣／裝備／丟棄／寶箱／戰鬥接線，提交前呼叫 Repository |
| `game-admin/functions/service.cjs` | 注入預設開關；禮包發獎與武器建立同一 Transaction |
| `js/farm/weapon-instance-client.js` | 前端 Repository 與原交易恢復；不直接操作 Firestore |
| `js/farm/weapon-instance-ui.js` | 個體卡片、明確指定個體操作、分頁、逾時／重開恢復；沒有精煉按鈕 |
| `js/farm/WarehouseScene.js` | schema2 武器分類顯示獨立個體；schema1 保留原入口 |
| `js/farm/ShopScene.js` | schema2 出售時選定一把；購買使用原數量／價格確認流程 |
| `css/farm-chest.css` | 只作用於 weapons 彈窗的卡片樣式，沿用現有木框／遮罩／關閉生命週期 |
| `scripts/weapon-instance-migration.cjs` | 本機 Emulator 專用 CLI；預設 dry-run，不載入正式 ADC |
| `game-admin/tests/weapon-instances.test.cjs` | 18 項隔離測試與全武器／怪物 +0 序列比較 |
| `game-admin/tests/weapon-instances.emulator.cjs` | 真實 Firestore 競態／候選 Rules 測試程式，因環境阻擋尚未執行 assertion |
| `tests/farm-private-backend-browser.cjs` | 新增隔離 WEAPON_INSTANCE_TESTS 模式，原模式仍保留 |
| `tests/helpers/weapon-instances-browser.cjs` | 從實際遊戲倉庫／商店入口操作，含逾時後重新載入恢復 |
| `docs/weapon-refinement/DEVELOPMENT_RULES.md` | 原新建規範補記 Phase 2 明確授權，保留原階段歷史 |
| `docs/weapon-refinement/05-development-roadmap.md` | 保留前次已補的「規範已建立」說明 |
| 本報告與 `evidence/phase-02-2026-11-27/` | 結果、限制、指令與截圖證據 |

沒有修改 `combat-rules.js`、`combat-damage.js`、怪物時限、商品價格、正式開關設定檔以外的部署設定、Security Rules 或索引。原有未相關 `docs/NEXUS_PLATFORM_ADMIN_ASSESSMENT.md` 未修改。

## 3. 資料結構與唯一權威

### 3.1 舊農場 schema1

權威仍為 `groups/{groupId}/users/{accountId}.farm` 的種類數量與 `equippedWeapon/equippedBow`。未移轉、開關 false 時，不讀／寫新武器集合，不改既有買賣或裝備判斷。

### 3.2 新農場 schema2

```text
ops_weapon_owners/{hash([profileId, groupId, accountId])}
  schemaVersion: 2
  ownerId, profileId, groupId, accountId
  generation, status: staging | active | rolled-back
  counts: { weaponId: quantity }              # 後端維護摘要
  equippedMeleeInstanceId, equippedBowInstanceId
  equippedWeapon, equippedBow                # 種類投影
  revision, createdAt, updatedAt

ops_weapon_owners/{ownerId}/allocations/{allocationId}
  id, ownerId, generation, weaponId
  quantity: 1..1000
  removed: [已移除個體的 ordinal]
  schemaVersion: 2, source, createdAt, updatedAt

ops_refining_migrations/{ownerId}
  generation, fingerprint, sourceSnapshot
  counts, total, allocationCount
  completed, validatedCounts, status, createdAt, updatedAt

ops_weapon_quarantine/{ownerId}
  ownerId, issues, createdAt
```

商品／原始傷害仍只取既有共用目錄與戰鬥設定，不在各武器複製價格、圖像及全份能力設定。**本版用壓縮配置保存 +0 個體，不是每把先建立一份相同 Firestore 文件。**

每一個 allocation 是固定批次，最多 1,000 把：

```text
allocationId = SHA256([generation, sourceTransaction, weaponId, chunk])
instanceId   = allocationId + "_" + ordinal
```

例如一個 quantity=3 的大鐵槌批次，確實有 `_0`、`_1`、`_2` 三個不同個體 ID。同名同種可各自裝備、出售或丟棄；removed 只標記指定 ordinal，不會減掉其他個體。批次 ID、數量與建立來源不因售出重新編號；removed 與時間由後端原子更新。

Repository 對每個有效 ID 回傳完整 DTO：`instanceId/weaponId/ownerId/refineLevel/refineBonus/refineStatsVersion/refineFailCount/successfulRefineCost/equipped/createdAt/updatedAt/schemaVersion/ownerRevision/bound`。本階段所有精煉欄位由後端固定為 0，沒有可寫入非零精煉能力的入口。批次時間是本次建立／批次異動時間；裝備狀態由 owner 關聯即時計算。

未來若需要各自非零能力／完整個體時間，須在 Phase 3 審核中新增稀疏個體狀態或物化方案，不能將同批次所有武器一起加成。本階段不預先實作精煉儲存交易。

schema2 的有效個體集合／removed 狀態及 owner 裝備關聯為權威，owner counts 是同交易維護摘要；farm 種類數量只作容量、HUD、戰鬥與舊版讀取的相容投影。每次武器變更先核對摘要與 farm 投影，發現不一致即拒絕，不能讓任一方各自「修正」另一方。完整 `verify` 會從配置批次重算數量。

farm 新增的非私密標記只有 `weaponSchemaVersion/weaponGeneration/weaponInstanceRevision/weaponMigrationState`；不嵌入完整個體清單、成本或歷史，避免原 RTDB mirror 與公開村落讀取放大。

### 3.3 雙寫結束條件

schema2 的 farm 數量是可信任後端在同一 Transaction 維護的單向投影，不是第二個可寫權威。暫留它是為了容量與既有戰鬥消費者；Phase 2 不刪除。

未來必須先盤點所有消費者、淘汰舊 payload／舊區域 writer、確認舊 PWA 被協定 gate 阻擋並補完測試，才另案停止對應投影。不能在本階段把 farm 數量清零或切回 legacy。

## 4. 交易與功能整合

- `prepareChange` 先準備所有讀取與寫入閉包，經濟核心完成所有讀取後才一起寫。沒有 read-after-write，也不另開非原子的「補發個體」交易。
- 購買：原價扣款、原容量檢查、數量投影、配置批次、owner revision 與原收據一起提交。同一收據重播不建立新 ID。
- 出售／丟棄：schema2 必須帶實際 ID 與 `expectedWeaponRevision`；出售另帶 `instanceIds`，數量與種類必須完全相符，且不允許重複 ID。已裝備個體不可移除。
- 裝備：以指定 ID 查歸屬；owner 儲存唯一裝備關聯，種類投影同步更新。同款另一把可換裝。兩裝置競爭同一 revision 時只有一筆成功，另一筆需重新讀取，不自動變成新操作。
- 舊版只有種類的出售／裝備 payload 在 schema2 明確失敗，不任意挑一把。舊版購買意圖仍無歧義，由同後端建立個體，不允許回到前端直寫。
- 禮包：`service.redeem → domain.award` 後、同一交易提交前計算武器增量；名額、入庫、配置批次及 receipt 一起提交。維持原 accountId 名額語意。
- 寶箱：`open/openMany` 仍按原內容快照、原容量與防重流程結算；總武器增量交同 Repository。最多 20 箱 × 7 種武器 × 每種 1,000 把，使用 140 個配置文件，不需 140,000 次個體文件寫入。
- 戰鬥：schema2 進場前驗證 owner、已裝備 ID 與種類吻合。原純戰鬥模型繼續讀可信任種類投影；沒有修改傷害／攻速／限制／時限，不新增每下攻擊請求。+0 精煉欄位不參與本版計算。
- 原免費木棒使用農場綁定、穩定 ID，不占倉庫格，不可賣／丟棄；不改初始武器規則。武士刀原持有者能讀取／使用，但原尚未開賣狀態保留。
- 怪物目前發的是既有戰利品及寶箱，沒有新增武器掉落率。日獎目前只發金幣；營運禮包透過同一 redeem 發獎。完整週獎／圖鑑派獎器原本不存在，本次沒有虛構接線或啟用新發獎。
- 管理調幣、每日金幣及護衛犬等原非武器交易保留目前 farm 標記，不改寫武器權威。原 legacy 前端仍須由正式 Rules 阻擋；本次不變更 Rules。

## 5. 移轉工具與併發

### 流程

1. `review`／`--dry-run`：只讀指定測試農場；檢查安全非負整數、合法裝備、總量，回傳 fingerprint。不寫正式或測試玩家資料。
2. `stage`：核對人工帶入 fingerprint、沒有未完成戰鬥、沒有另一個移轉；保存原武器數量／裝備／schema 快照及 generation，將該農場標記 staging。
3. `resume`：每筆交易最多建立指定數量配置文件、記進度及已核對各種數量；固定 ID，失敗中斷重跑不多發。同一 generation 不重建。
4. 完成最後批次時，交易重讀當下 farm、source fingerprint、owner、journal，核對數量，再切 schema2／active。保留原非武器最新值與 member 文件其他欄位；不拿開始時的整份 farm 蓋回。
5. `verify`：分頁重算有效個體數、驗證重複／非法 ordinal、裝備歸屬及投影，回傳 counts。這是診斷掃描，資料很多時較耗費讀取，不能拿它做每次登入的流程。

移轉 staging 期間武器買賣／裝備、寶箱及進場戰鬥會明確暫停，帶武器的禮包也會整筆拒絕、保留原名額。先前已提交的操作照原收據回傳；gate 之前的新交易使來源 fingerprint 改變，stage 拒絕要求重新盤點。非武器金幣操作若仍可在目前入口執行會保留，完成後可用原 requestId 重試被擋操作。這是每農場短暫鎖定，不宣稱移轉中所有操作完全無等待。

異常資料 `review` 只回問題；明確執行 stage 才寫私人 quarantine 診斷，**不修改該農場**、不補造資產。需人工查明後重新 review。

### 僅限本機 Emulator 的指令

前置：Node 22、既有依賴，以及可成功下載／啟動 Firestore Emulator 的隔離環境。本次環境下載遭 403，以下寫入命令本次未執行於真正 Emulator。

第一個終端啟動：

```bash
firebase emulators:start \
  --config firebase.private-farm-review.json \
  --project demo-nexus-private-farm --only firestore
```

第二個終端，使用**已在隔離環境建立的測試 profile／group／account ID**替換範例；沒有 fixture 時 review 會報缺失，不自動建立玩家：

```bash
export GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8092

node scripts/weapon-instance-migration.cjs \
  --project demo-nexus-private-farm \
  --profile TEST_PROFILE --group TEST_GROUP --account TEST_ACCOUNT --dry-run
```

審閱輸出的 fingerprint 後才執行：

```bash
node scripts/weapon-instance-migration.cjs \
  --project demo-nexus-private-farm \
  --profile TEST_PROFILE --group TEST_GROUP --account TEST_ACCOUNT \
  --step stage --generation TEST_GENERATION_001 \
  --fingerprint REVIEWED_FINGERPRINT --apply

node scripts/weapon-instance-migration.cjs \
  --project demo-nexus-private-farm \
  --profile TEST_PROFILE --group TEST_GROUP --account TEST_ACCOUNT \
  --step resume --batch-size 20 --apply
```

反覆執行 resume 到 status=active；中斷不改 generation。再驗證：

```bash
node scripts/weapon-instance-migration.cjs \
  --project demo-nexus-private-farm \
  --profile TEST_PROFILE --group TEST_GROUP --account TEST_ACCOUNT --step verify
```

不提供把專案換成 homebasedb 的正式執行途徑；CLI 會在載入 SDK 前拒絕非 demo 或非本機 emulator。服務測試注入開關只存在測試程式，不將測試開關寫入營運設定。

## 6. 回復與向前修復

- staged／active 且 revision=0、來源武器 fingerprint 一致時，`--step rollback --apply` 可解除 marker、回原 schema／裝備，保留當下金幣及其他資產；配置及 journal 保留稽核，狀態 rolled-back。
- 重複 rollback 不再次發物品；重新移轉需新的 generation，避免重用舊配置。
- 任何新武器購買／出售／換裝後 revision>0，rollback 明確拒絕。停用新變更，保留讀取，使用 verify 與原收據、不可變來源、removed／owner 關聯對帳，審查後向前修復。**本版不提供可任意補造資產的自動 repair 命令。**
- 新個體操作開關關閉時，schema1 繼續原遊戲；已移轉 scope 的武器變更安全暫停，仍可讀資產，不回退成兩套可寫數量。正式沒有執行移轉，因此正式玩家不會進入此狀態。
- 不做整庫回灌、不刪舊資產、不因 UI 失敗重發武器；正式備份／Rules release 與兩區 writer 清單仍是將來正式切換的先決條件。

## 7. 測試結果與限制

測試摘要與日誌 SHA 見 [phase-02-summary.json](evidence/phase-02-2026-11-27/phase-02-summary.json)。

| 驗證 | 結果 |
|---|---|
| 新增個體化隔離單元 | 18 項通過；含 MemoryDB 交易，不當成真正 Firestore contention |
| 全部既有＋新增單元 | 487 項通過、0 失敗；後續最終核對以 evidence 為準 |
| Phase 1 主要瀏覽器矩陣 | 本次重新執行29組全部通過，另2組封裝準備通過；不挪用前次報告 |
| 實際倉庫／商店入口的新模式 | 真實 Phaser＋隔離 SDK／後端服務通過；獨立 ID、換裝、防連點、買二賣一、逾時成功後 reload 同收據恢復、320／390px |
| 真實 Emulator／Rules／競態 | BLOCKED：Firestore JAR 下載 HTTP403 `Domain forbidden`，未執行 assertion |
| 正式資料、真實兩手機／行動網路、正式 Rules／部署 | 未查／未執行，不宣稱通過 |

十二項需求的對照：1～3 為三把／重跑／裝備測試；4～6 為買二賣一及跨 owner；7 為並行購買／出售／裝備；8 為 gate＋重試／保存非武器資產；9 為提交失敗重試與真實頁面逾時／重載；10 為 schema1／schema2 舊 payload；11 為所有八種武器、九種怪物的快照／每模式60次命中序列比較；12 為重跑 Phase 1 核心矩陣。第7項真實 Firestore／實體裝置層級仍未通過驗證，不能混算成已完成。

測試環境執行方式：

```bash
node --test game-admin/tests/weapon-instances.test.cjs
node tests/weapon-refinement/phase1-baseline.cjs
# 先依既有瀏覽器 fixture 啟動 localhost HTTP server、指定 Phaser 3.60.0 檔案
WEAPON_INSTANCE_TESTS=1 node tests/farm-private-backend-browser.cjs

GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm \
firebase emulators:exec --non-interactive \
  --config firebase.private-farm-review.json \
  --project demo-nexus-private-farm --only firestore \
  'node --test --test-concurrency=1 game-admin/tests/weapon-instances.emulator.cjs game-admin/tests/private-farm-rules.emulator.cjs'
```

本次完整瀏覽器測試加用 `tests/weapon-refinement/browser-guard.cjs` 阻擋非 localhost、未被既有 fixtures 接管的出站。沒有使用正式玩家憑證。單獨執行上述瀏覽器命令亦建議加 `NODE_OPTIONS=--require=絕對路徑/browser-guard.cjs`。

[320px 截圖](evidence/phase-02-2026-11-27/weapon-instances-320.png)／[390px 截圖](evidence/phase-02-2026-11-27/weapon-instances-390.png)：從實際倉庫入口開啟；沿用現有木框，+0 卡片不是精煉畫面。Chromium 尺寸模擬不等於實體 iPhone 驗收。

## 8. 費用影響

以下是新增 Repository 層的文件讀寫估算，不含原 Auth／身分／成員／農場／收據、限流與 Functions 計費，也不是正式量測：

| 操作 | 新增讀取 | 新增寫入 |
|---|---:|---:|
| 開關 false、未移轉的既有遊戲 | 0 | 0 |
| schema2 買入 1～1,000 把同款 | owner 1 | owner 1＋配置 1 |
| schema2 出售一把 | owner 1＋配置 1 | owner 1＋配置 1 |
| schema2 裝備一把 | owner 1＋配置最多1；木棒0 | owner 1 |
| 個體 get | owner 1＋配置1；木棒0 | 0 |
| 個體 list 每頁 | owner1＋最多4個新配置、游標所在配置至多1 | Repository0；外層既有限流仍可能寫入 |
| 戰鬥新進場 | owner1＋已裝備配置最多2 | 0 |
| 每下命中 | 0 | 0 |
| 移轉 | 各步 farm／owner／journal；每批最多100配置 | 每配置1；每步 journal1，首末另有 owner／farm |

同筆交易的配置文件讀取沿用既有快取，不因同批次選多把重複讀取同文件。大量箱子交付仍在原經濟交易內，預留最多200份配置異動的防護上限；目前正常來源最高140份可容納，不截斷獎勵。

相容 farm 寫入仍會觸發原報表／mirror；新私有 ops 集合不新增每文件觸發器。Migration verify 是全量診斷掃描，與平常分頁費用分開。部署前需在真正 Emulator／測試專案量測重試、讀取、回應大小與索引開銷；本次不宣稱 Functions 延遲或正式帳單改善。

## 9. 尚未完成、限制及下一步

1. 真實 Firestore／候選 Rules 測試需於能下載 Emulator 的隔離環境補跑，並另核對正式 Rules。不得以 mock 結果開啟正式功能。
2. 壓縮 +0 個體已具獨立 ID／操作，但非零精煉狀態的個體儲存與版本策略屬 Phase 3；本版明確不實作。
3. 正式兩區 writer、正式資料備份／還原、全站資料盤點、實機弱網測試仍未執行；目前 CLI 故意只能逐測試農場操作，不能掃描／遷移正式全站。
4. 舊公告／禮包 browser fixture 的模組供應缺口仍是 Phase 1 已知問題，不因後端禮包單元通過而宣稱修復；本階段未混入無關修正。
5. 不自動進入 Phase 3、不部署、不推送、不移轉正式資料。完成文件與測試後停在此階段。
