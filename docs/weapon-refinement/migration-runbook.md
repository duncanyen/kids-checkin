# 備份、移轉與資料對帳Runbook（準備版，未授權正式執行）

日期：2026-11-28（台灣時間）。目前NO-GO。**本次不執行正式備份、匯出、dry-run、移轉、Rules或部署**。下面分開「現在可重現的隔離指令」與「未授權的正式備份提案」；不存在的正式adapter不捏造參數。

## 1. 備份範圍與一致性

正式備份需包含整個Firestore資料庫：groups/*/users的最新farm、users公開profile與私有身分／session、武器owner／allocation／state、migration journal／quarantine、全部精煉intents／quotes／transactions／conflicts、精煉／解除／材料版本與pointer、草稿／release／audit、每日grant／任務事件、寶箱、禮包／claim／redemption、驗證事件與排行榜欄位、統計來源／防重／工作進度及相關設定。

同時備份Firebase Auth（含customClaims／停用狀態）、完整Firestore／Storage Rules release及ruleset、RTDB資料及Rules、Storage物件與metadata、完整索引／Functions區域與環境／IAM／Hosting target識別、原始碼artifact與雜湊。API密鑰、服務帳號私鑰不可塞入Git或報告；備份私有憑證／密碼雜湊的檔案限最小IAM、私人桶、加密與留存政策。

Firestore managed export完成不等於可對任意跨文件組合宣稱同一瞬間。確認PITR／可用snapshot-time機制及實際CLI支援，或對測試scope建立一致讀取快照／安排短暫資產操作閘門後比對。必須到隔離專案還原、驗證數量／owner／收據／能力及非武器欄位，再算備份可用。不要將匯出operation RUNNING或空JSON當作成功。

## 2. 正式備份指令提案（尚未授權，不要現在執行）

明確核准專案、私人備份桶、位置、scope、時間窗及執行人後才使用。Firestore已知區域asia-east1；備份桶應使用相容asia-east1或核准的asia多區域，不能再建asia-southeast1桶後才發現不相容。

```bash
# 此區段只能在收到「正式備份」明確授權後使用，本文本身不是授權。
set -euo pipefail
umask 077
NEXUS_BACKUP_DIR="$HOME/nexus-release-evidence/refinement-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$NEXUS_BACKUP_DIR"
: "${NEXUS_BACKUP_URI:?請填入已核准的私人備份桶 gs://...}"

gcloud firestore databases describe --project=homebasedb --database='(default)' \
  --format=json > "$NEXUS_BACKUP_DIR/database-before.json"
gcloud firestore export "$NEXUS_BACKUP_URI/firestore" \
  --project=homebasedb --database='(default)' \
  > "$NEXUS_BACKUP_DIR/firestore-export-operation.txt"
# 核對operation SUCCESSFUL、metadata及隔離還原，不只看命令結束。
firebase auth:export "$NEXUS_BACKUP_DIR/auth-users.json" --format=json --project=homebasedb

gcloud firestore indexes composite list --project=homebasedb --database='(default)' \
  --format=json > "$NEXUS_BACKUP_DIR/composite-indexes-before.json"
gcloud firestore indexes fields list --project=homebasedb --database='(default)' \
  --format=json > "$NEXUS_BACKUP_DIR/field-indexes-before.json"
gcloud functions list --project=homebasedb --format=json \
  > "$NEXUS_BACKUP_DIR/functions-before.json"
# 不使用 --delete，來源／目標不可相同，保留Storage originals。
gcloud storage rsync 'gs://homebasedb.firebasestorage.app' \
  "$NEXUS_BACKUP_URI/storage-objects" --recursive
```

環境變數只在核准作業中設定。`gcloud`依安裝版本支援狀態檢查`--help`；本次沒有對正式專案執行上列指令或驗證CLI雲端權限。

完整Rules備份採Google Firebase Rules REST API：先GET `https://firebaserules.googleapis.com/v1/projects/homebasedb/releases/cloud.firestore`，依回傳rulesetName GET `/v1/{rulesetName}`；Storage對應release為先前確認的`projects/homebasedb/releases/firebase.storage/homebasedb.firebasestorage.app`，仍需現場核對。使用ADC／gcloud取得token後只放HTTP Authorization，不印出token；保存release JSON與完整ruleset source，不用Repository片段代替。RTDB資料及`.settings/rules.json`由已核准instance URL用受權HTTP GET保存；Rules可能含註解，原文保存，不強迫json.loads。RTDB已知URL仍是asia-southeast1，不能在備份中自行改區域。

Git bundle只含已提交內容，**不足以備份目前dirty工作**。正式候選版本須先在獨立feature branch審查成immutable commit，再保存bundle、靜態前端、Functions封裝及source manifest；不要為補齊八階段hash偽造歷史提交。

## 3. 實際可用的隔離移轉CLI

現有`scripts/weapon-instance-migration.cjs`明確拒絕正式專案。以下只適用已啟動的本機Emulator＋已建立測試farm：

```bash
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8188
export GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm
node scripts/weapon-instance-migration.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player --dry-run \
  > /tmp/weapon-review.json
# 核對valid、數量、裝備與fingerprint後，固定generation。
# 將dry-run回傳的fingerprint填入已確認的NEXUS_SOURCE_FINGERPRINT，不自行重算舊值。
: "${NEXUS_SOURCE_FINGERPRINT:?請填入剛核對的fingerprint}"
node scripts/weapon-instance-migration.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player \
  --step stage --generation refinement-rehearsal-01 \
  --fingerprint "$NEXUS_SOURCE_FINGERPRINT" --apply
node scripts/weapon-instance-migration.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player \
  --step resume --batch-size 20 --apply
# status=staging時，使用原scope與原generation的journal再執行resume；不得改generation重建。
# status=active後進行verify；工具不會把未完成批次假裝完成。
node scripts/weapon-instance-migration.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player --step verify
```

此CLI沒有`--force-production`／`--allow-prod`。**不要把project改homebasedb、刪安全guard或把testEnvironment=true放入正式服務**。正式dry-run／批次執行／續跑命令目前沒有可核准的adapter，列C阻擋；需另實作與審查，不能把上述隔離命令當正式可用腳本。

無需Emulator即可重現的MemoryDB演練：

```bash
node tests/weapon-refinement/migration-rehearsal.cjs
```

此程式只建立合成farm，不連雲端：2001把大鐵槌→3份allocation，batch1中斷／續跑、重送不增量、移轉中武器操作拒絕、同期+777金幣及收蛋累計12保留、revision0安全回復保留較新非武器資料；新買賣後拒絕舊式rollback。

## 4. 正式adapter完成後的必要流程（不是已存在API）

- 服務驗證scope；不得只依帳號名稱推測跨群組owner。
- 匯出範圍清單、簽核、備份與隔離還原；正式dry-run須另獲授權。
- 每scope記來源fingerprint、固定generation及批次checkpoint；有異常隔離，不自補武器。
- stage內讀**最新farm**，比較fingerprint，保存武器投影及裝備來源；期間只擋該scope的武器數量／換裝，不擋收蛋、金幣及其他不衝突操作。
- 每resume transaction再讀最新farm，校驗世代與來源，僅合併必要schema欄位；不得從備份的整份farm覆蓋。
- 同一allocation ID確定性、已存在內容必須一致；重跑不新增。
- active前核對種類數量及裝備，並確保相容writer准入已就緒；失敗scope繼續安全相容，不強制V2。
- 專用scope→小批（建議5個scope，單transaction allocation batch20）→每批驗證→對照總清單，逐步取得授權。
- 原型verify會掃描該owner所有allocation，非無界全服；大owner須限制文件數／transaction時間並改有checkpoint一致驗證。跨scope正式batch controller目前尚無。

## 5. 資料對帳工具

離線工具只讀本機JSON，不載入Firebase SDK：

```bash
node scripts/weapon-data-audit.cjs --input /tmp/private-weapon-snapshot.json \
  --output /tmp/private-weapon-audit.json
# exit0：所提供snapshot內通過；不是全服或部署核准
# exit2：發現不一致；exit3：證據缺漏；exit1：輸入／執行錯誤
```

schema1包含`actors:[{uid,groupId,accountId}]`、`documents:[{path,data}]`、attestation及可選walletJournal。單檔≤32MiB，≤100000文件；工具不覆寫來源、不接受project／URL／apply。來源證明不能靠自行填attestation造假。

檢查：farm／owner／allocation有效數量、Instance namespace／ID、裝備、歸屬／generation、非負資源、0～9、+0零bonus、state與完整歷史、逐級成敗與原報價、設定hash、成功／失敗成本、退款無條件捨去、最終狀態、防重、pending／completed intent缺收據、同次提交資源差異。

**收據只有結算後coins／stones，不能單憑目前farm推導某筆歷史真正扣多少**。若缺同次已提交交易的walletJournal，工具必回INCOMPLETE，不能宣稱完全對帳。合成測試用MemoryDB已提交callback擷取前後；正式環境尚無同等歷史前後帳本／時間點證據，屬正式資產驗收阻擋，應補可追溯帳本或核准的實際寫入觀測方案。

localhost demo可用唯讀exporter（也拒絕正式專案）：

```bash
node scripts/export-weapon-audit.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player \
  --output /tmp/private-weapon-snapshot.json
```

此export使用單scope read-only transaction，取真實存在的farm／owner／allocations／states／migration／intents／quotes／receipts及需要的版本，不匯出密碼或Auth token；含私有抽樣／成本紀錄仍須私人保存。它**不虛構不存在的walletJournal**，有交易時離線audit可能exit3是正確結果。managed Firestore export不是此JSON格式，不能直接改副檔名使用。

## 6. 權限、讀寫量與費用

正式作業建議分離：備份人員的必要Datastore匯出／讀權、Cloud Storage對指定私人桶的最小讀寫、隔離還原專案權限；移轉服務的指定Firestore讀寫與稽核（Admin SDK繞Rules，必須IAM限制與工具guard）；Rules讀取的Firebase Rules viewer、Auth匯出所需Firebase Auth權限、監控唯讀。部署者／發布設定者／Auth grant權限分開。不要為方便一律授Owner。

MemoryDB文件介面測量（非真實帳單）：

| 2001把武器，K=3 allocation | 讀 | 寫 |
|---|---:|---:|
| review | 1 | 0 |
| stage | 3 | 3 |
| resume batch1 | 4 | 2 |
| resume batch2 | 4 | 2 |
| resume final batch3 | 4 | 4 |
| verify | 7 | 0 |
| 已完成resume重送 | 3 | 0 |

前6步合計23讀11寫；不含Auth、throttle、trigger、網路與自動重試。一般allocation `K=Σceil(數量/1000)`，resume每批N讀約3＋N，寫N＋journal，最後另owner／farm；verify約3＋全部allocation＋裝備個體讀，實際快取／其他狀態另計。

費用以「實測讀量/100000×核准讀單價＋寫量/100000×核准寫單價＋Functions/備份/儲存/網路/索引」估算。若僅套用使用者先前假設$0.06/$0.18，每1000個**恰為此範例**scope的23k讀11k寫約$0.0336（未算免費額度／其他服務），**不是目前asia-east1實際報價或所有玩家估算**。玩家數量、持有分布及現行區域單價未取得，不能據此承諾正式總費用。

## 7. 回復

先參閱 [rollback-runbook](rollback-runbook.md)。未發生任何新武器經濟操作且revision0時，原型rollback才可回復必要schema投影；保留移轉後較新金幣／雞蛋／任務及原始allocation供稽核。若發生新買賣、精煉或退款，一律拒絕舊式回復，保留新資料並對帳向前修復。沒有整庫回灌舊備份的正常回復流程。

## 2026-11-28 更新：受審核正式 adapter 已實作，僅在 Emulator 驗證

本節取代前文「尚無正式 adapter」的現況描述，前文保留為歷史記錄。正式執行仍未授權。新報告見 [migration-and-reconciliation-report.md](migration-and-reconciliation-report.md)。

### A. 現在可重現的完整隔離驗證

```bash
cd "$HOME/kids-checkin"
# 使用既有 Node 22、Java 21、官方 Firestore Emulator 套件。
# runner 僅啟動 localhost:8092 + demo-nexus-private-farm，資料由測試建立及清理。
node scripts/run-refinement-firestore-tests.cjs \
  --output /tmp/nexus-migration-verification
```

只重跑新增 adapter／CLI／帳本測試可加 `--suite migration-release.emulator.cjs`。這不是整套驗證的替代，正式前須保留完整套件證據。

### B. 同一計畫分批操作範例（僅 Emulator）

前提：已自行啟動本機 demo Emulator，並已建立合成測試 profile、group 成員及 V1 farm。`scopes.json` 是 1～50 個明確農場的 JSON array，欄位為 `uid`（profile ID）、`groupId`、`accountId`，不得拿正式玩家 scope 填入本節。

```bash
set -euo pipefail
umask 077
cd "$HOME/kids-checkin"
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8092
export GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm
NEXUS_MIGRATION_DIR="$(mktemp -d /tmp/nexus-migration.XXXXXX)"
: "${NEXUS_TEST_SCOPES:?請指向已建立測試資料的本機scopes.json}"
NEXUS_RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"

node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation plan \
  --scopes "$NEXUS_TEST_SCOPES" --run-id "$NEXUS_RUN_ID" \
  --output "$NEXUS_MIGRATION_DIR/plan.json"

NEXUS_PLAN_HASH="$(node -p 'require("./scripts/lib/weapon-migration-plan.cjs").hash(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")))' "$NEXUS_MIGRATION_DIR/plan.json")"

node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation review \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --output "$NEXUS_MIGRATION_DIR/review.json"
```

核對每個 scope 的 counts、total、fingerprint、schema 及 valid 後，僅在這個 demo 環境執行：

```bash
node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation migrate --apply \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --batch-size 20 --max-batches 1 \
  --checkpoint "$NEXUS_MIGRATION_DIR/checkpoint.json" \
  --output "$NEXUS_MIGRATION_DIR/batch-$(date +%s%N).json"
```

退出碼 2 表示未全部完成或有隔離項，**不能直接認定失敗並新建 generation**。檢查結果：只有 staging 且無異常時，使用同一計畫及同一命令、新 output 路徑續跑；有 quarantined／error 必須先查明原因。程序中斷後也使用原計畫，checkpoint 遺失不會導致多生成武器。

完成後：

```bash
node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation verify \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --output "$NEXUS_MIGRATION_DIR/verify-$(date +%s%N).json"
node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation export \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --output "$NEXUS_MIGRATION_DIR/assets.json"
node scripts/weapon-data-audit.cjs \
  --input "$NEXUS_MIGRATION_DIR/assets.json" \
  --output "$NEXUS_MIGRATION_DIR/audit.json"
```

離線 audit 的退出碼：0＝所選範圍證據完整通過；2＝資料錯誤；3＝缺證據（例如舊交易缺同次帳本）。都不是「全服已可發布」的宣告。工具不覆寫既有 output；export 按 scope 各自一致，不是全庫同時刻快照。

### C. 到期後續跑

`renew` 只讀寫本機計畫，不載入 SDK，不連資料庫：

```bash
node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation renew \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --output "$NEXUS_MIGRATION_DIR/renewed-plan.json"
```

新計畫保留原來源及 generation，新增 renewedFromHash。重新核對計畫、新 hash、review，使用新的 checkpoint 檔。正式作業還必須重新取得綁定新 hash 的授權，不能以 renew 延長舊授權或跳過來源驗證。

### D. 安全回復（僅示範 demo）

```bash
node scripts/weapon-migration-release.cjs \
  --project demo-nexus-private-farm --operation rollback --apply \
  --plan "$NEXUS_MIGRATION_DIR/plan.json" --plan-hash "$NEXUS_PLAN_HASH" \
  --output "$NEXUS_MIGRATION_DIR/rollback-$(date +%s%N).json"
```

只允許尚無新武器操作／精煉、無進行中戰鬥、原來源指紋相符的農場。已經遊玩產生新 V2 操作時會拒絕，必須保留 V2 並對帳／向前修復，不能整批還原備份或刪除私有個體。

### E. 未來正式連線的額外審查（本次不要執行）

正式 CLI 需額外 `--mode production --approval <本機經審核檔案>`，並清除 FIRESTORE_EMULATOR_HOST；本次不提供可直接執行的正式移轉命令或有效授權檔。

授權檔必要欄位：schemaVersion=1、project、database=`(default)`、planHash、operations array（限定本次 plan／review／migrate／verify／rollback／export 等實際授權操作）、operator、expiresAt（最長24小時）、backup.uri、backup.operation、backup.restoredVerified=true、explicitApproval=`APPROVE_REVIEWED_WEAPON_MIGRATION`。

初次唯讀 plan 的授權 hash 是 `hash({project,runId,actors})`；取得計畫後，後續操作改綁定完整計畫 hash。它們是兩個獨立審核步驟，不要把任一舊授權套用新計畫。正式執行身分還需最小 Firestore IAM：read/get/list/query，以及 migrate／rollback 所需的 create/update；本工具不需任意刪庫、索引修改、Functions部署或Auth管理權。

審查者必須實際核對備份成功、隔離還原、正確專案／操作者、程式 hash、scope、相容後端／PWA及候選／已部署Rules差異。授權檔是本機操作控制，不是能取代 IAM 或證明備份真的還原過的簽章。取得明確授權前，不執行正式 plan、review、export 等唯讀操作。
