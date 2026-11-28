# PWA 安全更新、分頁協調與交易恢復

日期：2026-11-28（台灣時間）。來源 Git HEAD `8dbae59e619cc5382853dfeb0e6397eccddd209a`，在既有未提交 Phase 2～8 工作上繼續開發。未提交、推送、部署、移轉或讀寫正式資料；正式六項功能開關保持 false。

## 已完成

1. 新版客戶端遇到後端要求更新、頁面協定不符或舊頁作廢時，以獨立 DOM 遮罩阻擋操作；Phaser 尚未完成初始化也能顯示。畫面使用米色／木色，純文字及可操作按鈕，不建立新首頁入口。
2. 同農場的新分頁先取得 Web Locks 原子操作權，不能自動 beginBattlePage 搶走舊頁戰鬥。使用者明確選「在此分頁繼續」才要求原頁交棒；原頁先停止新操作、等待現有請求結束，再關閉戰鬥頁並交出鎖。BroadcastChannel 只傳遞交棒通知，不作為授權。
3. 可恢復的經濟操作，在送出前把原 ID／原 action／原 payload 存入具農場 scope 的持久日誌。逾時、重載、新版進場或同瀏覽器另一分頁可查回已提交收據，沒有自動新 ID 或再次扣款。
4. 查無收據表示「結果未明」，不當成失敗或未送達。只查詢不執行原 action；玩家若選擇重試，仍使用原 ID 與原內容，畫面提醒可能扣款／消耗資源。純攻擊、開戰與結算不跨頁恢復，沿用離頁放棄且不發獎。
5. 更新先等待本頁已送出的請求結束，保留未確認日誌，再重新驗證 HTML 與同源 JS 相依圖，確認下載前後 release marker 一致才導航。離線、缺檔、超過256檔／單檔2MB、版本正在改變則停止導航並顯示錯誤。沒有清除登入、localStorage、sessionStorage、存檔或整個 CacheStorage。
6. 既有武器及精煉的專用 pending 指標與共用日誌同步清除；既有精煉 durable 指標也能匯入。避免共用層已確認完成，舊武器介面卻用沒有 ID 的殘留指令建立新交易。

## 實際模組與權威邊界

| 檔案 | 用途 |
| --- | --- |
| `js/farm/transaction-journal.js` | 經濟 action 白名單、原操作指標、scope、舊指標匯入與相符清理 |
| `js/farm/tab-coordinator.js` | Web Locks 原子鎖、明確交棒、in-flight 等待、舊頁暫停 |
| `js/farm/safety-ui.js` | 安全更新／另一分頁／交易恢復遮罩、純文字、focus trap、手機安全區 |
| `js/farm/safety-runtime.js` | 串接初始化、release marker、鎖、查詢／原 ID 重試、暫停與更新 |
| `js/farm/safe-update.js` | 同源 JS 圖重新驗證、循環去重與更新前後版本檢查 |
| `js/farm/client-release.js` | 獨立於美術 cache 的應用版本；後續相容版本發布須一起遞增 |
| `js/farm/backend-client.js` | 接入既有 farmCommand，寫入前保留 journal、暫停時不再預測攻擊 |
| `js/farm/battle-page-client.js` | 不相容頁面回傳可辨識的 update-required 錯誤 |
| `game-admin/functions/farm-recovery.cjs` | 新增可信任唯讀查詢；不修改玩家資產、會話或建立查詢收據 |
| `game-admin/functions/service.cjs` | 在既有 gameOpsFarmTransaction 分派查詢；保留現有身份及限流 |
| `tests/farm-safety.test.mjs` | 日誌、鎖、交棒、更新、恢復與 storage 失敗單元測試 |
| `game-admin/tests/farm-recovery.cases.cjs`、`.test.cjs`、`.emulator.cjs` | 同一組後端案例跑 MemoryDB 與真正 Firestore |
| `tests/weapon-refinement/pwa-safety-browser.cjs` | 兩分頁、更新與斷線的真實 Chromium 模組測試工具 |
| `tests/helpers/pwa-safety-game-browser.cjs`、`tests/farm-private-backend-browser.cjs` | 原遊戲／商店入口的回應遺失、查回與返回村落 |
| `tests/helpers/weapon-instances-browser.cjs` | 更新測試預期：啟動已查回收據，不再次點舊介面開新交易 |
| `scripts/run-refinement-firestore-tests.cjs`、`scripts/lib/firestore-emulator-proof.cjs` | 加入新測試及來源雜湊；共13個suite |
| `scripts/weapon-release-review.cjs` | 讀取本輪本機證據，正式審查仍NO_GO |

未修改 Rules、索引、怪物／武器數值、戰利品、價格或正式准入開關。Web Locks 是客戶端體驗與防意外重入措施；惡意客戶端可以繞過，因此真正資產安全仍由伺服器身份、原子交易、頁面歸屬及收據保護。

## 交易日誌

key：`nexus.farm.journal.v1:` + JSON([profile docId或null, accountId, groupId]) + `:` + 原 request ID。

value：`version:1, scope, id, action, payload, createdAt`。不存密碼、Token、Auth session、客戶端自認餘額或發獎結果。payload只限既有可恢復操作；超過32KB或累積100筆會阻擋新操作。資料損毀／空間不足須保留資料並顯示安全錯誤，不清空後重送。

送出前持久化失敗就不送出。正常執行中可同時進行原本合法的不同操作，並非一律全局排隊；某筆結果未明後停止新的操作，先查明原結果。同 action／payload沿用既有 in-flight／ID，不能改成不同ID。帳號或群組改變後停止恢復及清理原 scope。

本機日誌不是授權或資產權威，篡改ID、payload、其他群組或帳號仍要過後端檢查。更新／移除瀏覽器資料會失去指標，因此畫面不提供「清快取解決問題」。

## 後端 API

仍呼叫既有 `gameOpsFarmTransaction`，新增 action：

```json
{
  "action": "getFarmTransactionResult",
  "requestId": "本次查詢ID",
  "groupId": "目前群組",
  "transactionId": "原交易ID",
  "originalAction": "buyWeapon",
  "originalPayload": {"item":"mace","quantity":1}
}
```

身份取自既有已驗證 Auth／私有 credentials，不相信前端 ownerId。沿用 transactionSession、player及限流；可在舊頁失效或精煉暫停後讀回既有交易。

- 一般經濟操作查既有 `ops_farm_transactions/{hash(uid:原ID)}`；驗 uid／account／group／原指紋。
- 精煉及解除查既有 `ops_refinement_transactions`，必要時查 `ops_refinement_intents`；驗 owner scope及該類別原有 fingerprint。
- 回傳 `completed`（原結果）、`rejected`（已拒絕intent）、`pending`（intent尚未完成）或 `unknown`（尚無收據）。
- 不建立新 collection、不掃描玩家／歷史、不寫新查詢收據、不重放戰鬥、不解除戰鬥頁／功能開關限制。
- 後端尚未更新而不認識此action時，保留日誌並停止恢復，不降成自動執行原經濟操作。未來相容版本仍須後端先具備此查詢，再發布前端。

## 更新流程

`FARM_CLIENT_RELEASE` 與網路 no-store marker不同，或伺服器明確要求新協定 → 安全遮罩 → 玩家檢查原交易／更新 → 暫停新的遊戲操作 → 等待目前請求結束 → 只查原收據 → reload cache模式重新驗證同源程式圖 → 比較前後 marker → 檢查現有farm scoped worker更新 → 帶更新參數重新載入 → 新頁取得鎖並恢復原指標 → 由現有頁面流程載入權威存檔。

現有 worker仍只快取公開美術，不存 HTML、JS或API成功回應。沒有為了更新增加完整離線遊戲功能，也沒有 unregister全部worker或清空其他App快取。HTTP重新驗證使用`cache:reload`；已載入的模組不就地替換，保留到明確導航。

更新圖解析支援本專案現有字面值相對 import／export／dynamic import；不是任意JS parser，不處理執行時計算出的未知模組URL或第三方SDK的版本原子發布。未來新增非字面值程式載入，需加入發布manifest或驗收清單，不能假設已覆蓋。

## 分頁流程

鎖名包含profile／account／group。同一scope第二頁沒有操作權時，不註冊新戰鬥頁、不買賣；不同scope鎖獨立。交棒前先暫停來源頁預測與計時排程的新請求，等已送出請求得到結果或既有20秒timeout，再交出鎖；目的頁最多等約24秒，超時保留原狀態並要求稍候或關閉原頁。沒有localStorage非原子lease或背景自動搶鎖。

不支援Web Locks的瀏覽器會顯示更新瀏覽器提示並停止新操作；BroadcastChannel缺少時不能請原頁即時交棒，需先關閉原頁再重試。其他裝置不共用本機鎖，仍由原後端page guard控制，舊頁收到失效時顯示阻擋畫面。bfcache恢復沿原reload處理。

## 測試與初跑問題

最終結果：**705／705 單元測試（本次新增17項）、57／57真正Firestore測試／13檔suite（本次新增4項收據查詢案例）、11組瀏覽器workflow通過**。11組包含7組原有回歸、雙分頁安全模組工具、真實遊戲商店恢復、新輸入協定9怪物、固定舊版模組／真實worker。實際遊戲入口測試使用真實Phaser＋service＋MemoryDB；真正Firestore交易與candidate Rules另跑。

結果、來源雜湊、截圖及指令見 `evidence/pwa-safety-2026-11-28/`，不把MemoryDB混稱真實Emulator E2E。

測試包含：已提交但遺失回應、未知原請求不自動執行、明確重試保留ID、舊session指標、精煉／解除暫停後查詢、跨scope及竄改拒絕、同scope第二頁阻擋、明確交棒、原分頁暫停、storage失敗、離線更新、版本中途改變、更新不清登入／美術／日誌、原商店入口與返回村落、320與390px畫面。

初跑發現的真實整合問題均已保留日誌：

- 全局只允許一筆日誌會阻擋原本合法的兩個不同in-flight餵食；改成追蹤active IDs，只有未明交易才阻擋新的不同操作。
- 共用層確認收據後，舊武器pending仍保留且缺ID；改為只清除指紋相符的專用指標，並更新原回歸測試預期。
- 舊合併戰鬥測試曾因500ms批次切分時序而失敗，保留初跑，不以重跑通過抹除不穩定性。
- 瀏覽器工具曾有fixture函式語法、測試直接寫入漏battlePageId、等待已存在URL而誤判導航等問題；均修正測試工具，沒有因此放寬後端驗證。

## 費用與效能

正常遊玩仍沿既有交易，不新增每擊／每幀Firebase查詢。每頁多一次同源release文字檔檢查，分頁協調是本機API；只有有待確認交易或玩家按確認時才查收據。每筆查詢增加原身份／限流讀取及1筆收據讀取，精煉無收據時最多再讀1筆intent；查詢不寫玩家資產或查詢收據，但既有限流仍有原有成本。沒有全服listener或歷史全掃描。

明確更新會重新下載／驗證程式圖，增加HTTP流量，公開美術快取保留。未量測正式玩家月費、Functions P50/P95、實機耗電或Wi-Fi／行動網路數據，不能提供虛構數值。

## 尚未完成的正式驗收與限制

- 尚未測物理iPhone／Safari、行動網路、系統強殺PWA或完整所有瀏覽器；Chromium手機尺寸不能代替實機驗收。
- 已經載入歷史程式的分頁**不能被追溯注入新UI或Web Locks**；它仍靠伺服器拒絕舊協定／失效頁面，重新載入相容版本後才有本介面。固定Git舊模組與真實worker工具通過不等於已取得正式歷史artifact。
- 更新marker一致可檢查切換時序，但不是完整內容雜湊發布manifest，也不是跨CDN全檔原子發布證明。正式發布需核對artifact及實際HTTP快取行為。
- 新日誌保護新版送出的操作，能匯入仍存在的舊session指標及舊精煉durable指標。**過去已關閉分頁、原ID也已遺失的武器／一般交易不能憑品項猜回**，只能以安全營運查帳處理，不能補造ID或自動重買。
- 禮包、護衛犬租用及每日任務的獨立endpoint仍沿原有pending／後端防重機制；本次共用收據API限farm與精煉，沒有假稱已能自動查回所有其他endpoint。更新保留其既有storage，不清除。
- 原買賣若未包含報價版本／expectedPrice，未知請求明確重試仍沿既有後端當前規則，沒有新增「保證舊價」；精煉／解除沿既有版本報價，過期須重新確認。這類未版本化價格若日後改動，需另外設計原請求取消／新報價的原子流程。
- 正式環境尚未部署新查詢或UI。實機、歷史artifact、發布相容性與資產對帳仍需審查，**Step A維持NO_GO**，不進Step B～F。

## 回復

隔離測試可停用新前端模組測試環境，保留journal與原server收據；不要清空journal、武器資料或精煉能力。正式若未來啟用，先停止新操作、保留原查詢能力及最低戰鬥協定。回退版本若不讀新journal，可能遺失恢復入口，因此需保留此相容層或向前修復，不能直接以舊版加清快取作回復。
