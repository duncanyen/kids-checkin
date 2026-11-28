# 舊版 PWA 相容性與戰鬥安全驗收

> 後續修正：進場前攻擊（SEC-02）已加入前後端共用限制，671單元、46真實Firestore／候選Rules及8組瀏覽器流程驗證通過。原報告保留為歷史證據；SEC-01及完整舊版更新流程仍未解除。見 [進場限制報告](approach-guard-report.md) 與 [合併攻擊／更新設計](batched-combat-and-update-design.md)。

日期：2026-11-28（台灣時間）。**結論：NO-GO，不能宣稱已通過正式安全驗收。** 本次僅隔離測試與文件，未變更正式遊戲邏輯、Rules、索引、開關，未讀寫正式資料、未部署、未提交或推送 Git。

## 一、驗收重點與結論

已驗證的保護包括：V4 +0 傷害相容、V5 精煉能力不可降版、歸屬／順序／傷害／版本／速率拒絕、戰鬥能力快照固定、戰鬥中換裝／出售／精煉／解除拒絕、跨裝置競態、同筆及不同 ID 的重複結算、逾時／過期／舊頁面作廢，以及同次經濟交易收據恢復。

但有兩類未通過項目：

| 編號 | 結果 | 影響 |
| --- | --- | --- |
| SEC-01 | HIGH，實際重現，發布阻擋 | 合法身分可送出沒有任何碰撞／手勢來源證據的攻擊批次，只要在累計額度內，仍取得戰利品 |
| SEC-02 | HIGH，實際重現，發布阻擋 | 同一重現可在怪物 approachEndsAt 前打到 0 HP 並結算獲勝 |
| COMPAT-01 | 舊版安全拒絕通過，但完整可玩性未通過 | 舊堆疊出售／換裝與 V5 戰鬥需要更新；目前沒有完整的更新引導／舊客戶端預先准入機制，安全拒絕不代表舊 UI 正常可玩 |
| ENV-01 | 尚未驗證，發布阻擋 | 實際已部署舊 PWA artifact、iPhone Safari／加入主畫面的真實升級、BFCache／iOS 強制關閉及實際行動網路未測 |

因此本報告的自動化「測試程式通過」，包含對已知缺口的成功重現；**不會把 `combatSecurityAccepted` 或 `oldPwaCompatibilityAccepted` 改成 true。**

## 二、實際程式盤點

- `farm-daily-sw.js` 舊 daily-only worker 與 `js/farm/public-art-worker.js`：只攔截公開圖片／atlas JSON；不快取 JS、HTML、登入資料或 API。新 art worker 使用 skipWaiting／clients.claim，新 worker 接管不等於已開頁面的 JS module graph 更新。
- `js/farm/backend-client.js`：保留結果不明的經濟 request ID；原交易重送使用後端收據。攻擊採本機回饋與 500ms 批次，不需每擊往返。
- `js/farm/battle-page-client.js`：頁面 ID 不持久化；新頁 beginBattlePage 使舊會話失效；舊純戰鬥 pending 不跨頁重播，經濟 pending 保留。
- `game-admin/functions/farm-transactions.cjs`：先驗證玩家、歸屬與收據，重新驗證頁面、schema 及衝突；經濟結果及事件原子提交。
- `game-admin/functions/farm-combat.cjs`：V5 僅接受有序意圖，後端重新計算傷害／爆擊。V4 額外傷害欄位不影響計算。累計上限為近戰每秒20、遠程每秒10，加4的 burst；目前沒有校驗伺服器收到攻擊時是否已到 approachEndsAt。
- `weapon-abilities.cjs`：從私有個體建立快照，後續營運數值變動不更改既有戰鬥能力；相容限制保留。

## 三、PWA／舊分頁測試

測試程式：`tests/weapon-refinement/legacy-pwa-acceptance.cjs`。

舊版來源固定為 Git `8dbae59e619cc5382853dfeb0e6397eccddd209a`，由 `git show` 讀取真正的 backend-client、battle-page-client、combat-damage／rules 與 worker 依賴；每份載入來源記錄 SHA-256。新版取目前工作目錄。沒有從正式 GitHub Pages 或 Firebase 下載／查詢資料，亦未聲稱此 Git artifact 就是目前正式用戶快取的版本。

使用真實 Chromium、真實舊／新 worker、實際 Cache Storage 及兩個頁面；只有 auth／RPC 運輸橋接到合成身分與實際 createService + MemoryDB。舊／新模組透過隔離 HTML 按鈕／模組操作，不是歷史完整 Phaser UI；完整現行遊戲入口另由既有瀏覽器回歸測試驗證。

| 情境 | 實測結論 |
| --- | --- |
| 舊 V4 client 在 V2 +0 農場購買 | 後端建立獨立個體，數量與金幣正確 |
| 舊堆疊出售／種類換裝 | 拒絕，不任選一把新個體，不丟武器／金幣 |
| worker 更新時舊頁面保持開啟 | worker 已接管，但舊頁仍執行 legacy module graph；新頁可載入 current graph |
| 新頁取得頁面所有權後，舊頁新交易 | 拒絕舊頁的新請求，無額外扣款 |
| 舊購買已提交、回應遺失，更新後重試 | 保留 sessionStorage 原 ID，讀回同一收據；沒有第二次扣款／新增 |
| JS、HTML、API 快取排除 | Cache Storage 無 JS／HTML／API／snapshot module；API 連續兩次真正抵達測試端點 |
| 離線與重連 | 離線 API 不回傳快取成功；重連下一次抵達端點 |

測試初跑的兩個假設錯誤保留：其一把「原 pending 購買的合法收據重播」誤當新舊頁面競態；其二假設舊 farmCommand 接受第三個 explicitRequestId，但固定舊版其實忽略此參數。修正後採後端實際收到的原 ID 驗證，沒有修改正式客戶端或清除 pending 來湊通過。

現有模式是「一個農場一個有效戰鬥頁面」，不是兩裝置可無限制同時操控同一戰鬥。另一頁開啟時舊頁會被拒絕；這是安全行為，但操作體驗仍需明確引導。

### 相容性仍需補強

不能在舊頁面還可發出舊種類出售／換裝，或無法處理 V5 時就宣稱全玩家可無痛開放。建議後續另行實作伺服器回傳的版本能力／農場准入與明確更新畫面；先保存並確認所有原經濟 pending，再切換新版。不要強制清掉 local/sessionStorage 或自動重開一筆交易，也不能只靠前端旗標／強制刷新當安全邊界。

## 四、戰鬥安全實測

共用案例：`game-admin/tests/compatibility-security.cases.cjs`；分別由 MemoryDB 單元與 `compatibility-security.emulator.cjs` 在真實 Firestore 執行。新案例使用正式准入服務分支 `testEnvironment=false`；白名單、登入身分及資料都是合成 fixture。

| 測試 | 實際行為 |
| --- | --- |
| +0 V4 舊協定 | 同樣 seed／批次得到原傷害；偽造 damage、criticalRate 不覆寫結果 |
| +1 舊協定降版 | 拒絕，更新到 V5 後才取得 206 的可信任快照 |
| 偽造 HP、傷害、機率、獎勵、勝敗、武器 | V5 拒絕，HP／資產不變 |
| 錯 firstAction、錯 damageVersion、超額攻擊、武器無效 | 拒絕，不扣減 HP |
| 營運中心在戰鬥中更改原始數值 | 已建立的戰鬥快照不被重算 |
| 精煉／解除／出售／換裝與戰鬥衝突 | 拒絕衝突操作，沒有扣資源或換掉能力 |
| 同 ID 兩次攻擊、另一 ID 同順序競態 | 不重複扣 HP，0 HP 後不能再獲額外攻擊收益 |
| 重複結算（同／不同 ID） | 原戰利品一次、最多一箱、有效 DEFEAT_MONSTER 事件一次 |
| 新頁作廢舊戰鬥／舊收據重播 | 拒絕舊攻擊與舊結算，無獎勵 |
| 戰鬥時間已到才送攻擊 | 攻擊拒絕，原結算為 loss，不發勝利獎勵 |

既有完整 Emulator 套件另驗證候選 Rules，禁止前端修改 farm 權威資產、私有能力、戰鬥快照、帳本及管理配置。本次未修改或發布 Rules；不能用候選規則的通過替代正式 Rules release 核對。

### SEC-01／SEC-02 真實重現

隔離農場裝備大鐵槌 +1，後端設定金剛正常 HP 4,000。透過既有入口取得真實挑戰，advance 測試時鐘到開戰後 2,000ms（測試時鐘是後端 fixture，正式 API 沒有此控制入口）。直接呼叫正式服務的 batch 意圖，**沒有觸發任何 Phaser 點擊、手勢或碰撞**：

```json
{"action":"battleAttack","combatVersion":2,"damageVersion":5,"firstAction":0,"attackRuns":[{"mode":"melee","count":25}]}
```

省略的 battleId、battlePageId、requestId 都取自隔離的真正挑戰／唯一請求。伺服器近戰此時累計額度為 `floor(2 × 20) + 4 = 44`，25 次未超額，於是驗算並接受。結果 HP=0；當下仍早於 approachEndsAt；battleSettle 發放 `gorillaFangs +1`。

這不是竄改傷害成功，而是**被接受的攻擊命令缺少可信任的命中依據**。同一重現同時證明「進場前不應接受攻擊」尚未受後端限制。重現報告保留在 `real-final/combat-finding.json`；它有 releaseBlocker=true，不能因測試 assert 成功就抹除風險。

另外，damageSeed 會隨公開挑戰交給客戶端，玩家可以重算本機傷害／爆擊，這是即時回饋架構所需資訊，也表示不能把種子視為反作弊秘密。原後端遠程額度10/s和前端約250ms一發並不相同；本次未更改數值，也不將其誤報為已符合逐發手勢驗證。

### 後續建議（未實作）

1. 先明確定義每種怪物／武器何時可命中，以及雙方一致的攻擊節奏／burst；後端先拒絕 approachEndsAt 前的無效命中，避免 UI 不可打但 API 可打。
2. 提出批次提交的時間線／軌跡與伺服器可驗證碰撞模型。保持本機即時特效與合併請求，不改成每擊讀 Firestore。僅由前端回報 hit=true 或加入可偽造的滑動座標，不能當成安全解法。
3. 若完整伺服器碰撞模型成本過高，須明確接受「速率驗證型休閒遊戲」的殘餘作弊風險，並評估獎勵速率限制／異常偵測；這涉及遊戲規則與風險政策，不能由本次驗收擅自調整。
4. 不以 App Check、混淆或隱藏 seed 宣稱解決可信任命中。App Check／Auth 是額外門檻，不能證明一次合法身分的物理命中。

## 五、結果、證據與重跑

本輪 **667／667 單元測試、10 檔共43／43真實Firestore／候選Rules測試、6／6現行遊戲瀏覽器回歸，以及1組固定舊版模組／真實worker升級測試完成**。其中安全案例通過代表成功辨識／重現預期缺口，不代表安全驗收通過。結果見 `evidence/compatibility-security-2026-11-28/validation-summary.json`、`real-firestore-summary.json`、browser 模組來源 hash 與各完整日誌。原始失敗／重跑均保留。

```bash
node --test game-admin/tests/compatibility-security.test.cjs
COMPAT_SECURITY_OUTPUT=/tmp/nexus-compat-security/repro \
  node scripts/run-refinement-firestore-tests.cjs --output /tmp/nexus-compat-security-full
COMPAT_SECURITY_OUTPUT=/tmp/nexus-pwa-browser \
  node tests/weapon-refinement/legacy-pwa-acceptance.cjs
```

只跑新增真實案例可加 `--suite compatibility-security.emulator.cjs`。整套 runner 只使用本機 demo，拒絕正式專案。Browser 需要既有 Playwright／Chromium；完整 Phaser 回歸另使用本機 PHASER_FIXTURE，不載入正式資料。

測試證據有效範圍：真實 Firestore Transaction 與候選 Rules；不等於 Cloud Functions HTTP／App Check／Auth／Storage emulator 全套，也不等於正式部署流量。實機 Safari／Android／行動網路未測，延遲不捏造。

## 六、本次修改與停止點

新增 helper、共用安全案例、單元／Emulator 套件、固定舊版模組／worker browser harness；調整 Emulator runner／proof 加入第10組、發布審查優先讀取最新證據、更新規範與交付文件。

未修改 `js/farm`、Service Worker、後端交易／戰鬥 runtime、價格／傷害／速度／怪物規則或正式功能開關。測試 fake 時鐘與合成授權只存在測試檔，未暴露到正式服務。

Git 基準仍為 `8dbae59e619cc5382853dfeb0e6397eccddd209a`，工作目錄包含前階段未提交變更。沒有新的 commit、沒有推送。本次驗收完成並停止；SEC-01／02及相容性／實機缺口未解前，不進入正式發布。
