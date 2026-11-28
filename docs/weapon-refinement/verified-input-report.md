# 共用運動模型與合併輸入命中驗算

日期：2026-11-28（台灣時間）。工作目錄來源 Git HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`；含既有未提交 Phase 2～8 工作，沒有新增 commit、推送或部署。本次授權僅限隔離驗證，正式資料未讀寫。

## 1. 實作範圍與界線

已在工作目錄實作 `inputProtocol: 1`：瀏覽器與後端共用確定性運動、觸點與箭矢碰撞模型。客戶端傳送操作，不再宣告命中次數；伺服器驗算合法輸入造成的命中，再沿用既有能力、傷害浮動、爆擊／連爆、勝負、戰利品、寶箱、任務及排行交易。

這是**隔離測試版本，不是正式 GO**。正式服務沒有新增啟用環境參數或管理 API。`createService` 的 `verifiedCombatTestEnvironment` 預設 false、`verifiedCombatTestAccounts` 預設空，僅測試 fixture 以伺服器建構參數准入確切帳號／群組。不得把這兩個測試參數接到正式環境。既有六項正式功能開關皆維持 false。

未准入帳號仍使用原 V4／V5 合併命中路徑，原先缺乏物理證據的問題仍存在；不能宣稱已全服防作弊。新協定只能驗證「可能合法的操作」，無法證明操作來自真人；可計算合法瞄準的自動化工具仍屬殘餘風險。

## 2. 共用模型與顯示

`js/farm/verified-combat.js` 不依賴 DOM、Phaser、SDK、真實時鐘或 Math.random。將 390×844 直式畫面作為版本化標準場地；`verified-combat-view.js::arenaProjection` 以現有 gardenBounds 做仿射映射，畫面與觸點使用反向一致的座標轉換。

| 怪物 ID | 新協定共用運動來源／方式 |
| --- | --- |
| wolf、tiger | 進場及90單位／秒巡邏、按時間的攻擊停頓與有效命中停頓 |
| dragon、eagle | 沿用 aerialPatrolPoint、原進場與飛行尺寸 |
| hornet | 沿用 hornetPosition，盤旋／俯衝；母雞目標固定在快照位置 |
| gorilla | 原 cubic-out 接近與攻擊位置 |
| cobra | 原1.05頻率橫向巡邏與5秒下探 |
| giant | 原0.8頻率與8秒動作階段 |
| mole | 原九宮格及1.4秒換洞，以快照 seed 決定三個不同洞位 |

近戰沿用各精靈圖的正規化可點擊矩形。弓箭沿用既有重力360、拉距×9且速度上限1050、最短拉距12、250ms射擊間隔、2.5秒壽命與0.36尺寸橢圓掃掠判定。物理以10ms固定格點積分，分批切割不改變結果；地鼠換洞不把瞬移路徑當成可撞擊的移動軌跡。

**與舊版路徑的具體差異：**新協定為了可驗算，虎頭蜂不追逐當下前端自由移動的母雞；地鼠不使用 Phaser 隨機數；狼虎的停頓由時間／已確認輸入決定，不依動畫完成回呼。場地依菜園比例映射，非所有底圖與寬度的逐像素原路線重現。僅新協定使用這些規則，舊版運動不切換。正式發布前需核准這些確定化差異並補齊實機觸控／全部場景驗收。

未修改怪物 HP、武器原始傷害、±10浮動、爆擊倍率、掉落／獎勵與怪物存在秒數。damageVersion 與 inputProtocol 各自版本化，不把物理輸入偷偷塞進舊傷害版號。

## 3. 實際協定

入口仍為 `gameOpsFarmTransaction`，不增加 callable。

1. 新頁面沿原 `beginBattlePage` 傳送 `inputProtocol: 1`。
2. 僅伺服器測試准入成功且武器已個體化的農場，會話鎖定 inputProtocol 1，並在既有私有 owner 標記 `combatInputProtocol: 1`。
3. 開戰快照鎖定能力、damageVersion、進場／截止時間、inputRules、inputState；後續批次不重新讀取每把武器。
4. `battleAttack` 沿用既有 requestId／頁面 session：

```json
{
  "action": "battleAttack",
  "groupId": "A",
  "requestId": "固定於這批的唯一ID",
  "battleId": "伺服器既有會話ID",
  "combatVersion": 2,
  "damageVersion": 5,
  "inputProtocol": 1,
  "firstInputSeq": 0,
  "events": [{"type":"tap","seq":0,"at":1790000000000,"x":195,"y":450}],
  "endAt": 1790000000000
}
```

上述時間與位置只是格式範例，不能直接用於實際戰鬥。傷害版本取自實際快照，不固定5。

- `tap`：seq、at、x、y；後端驗算當下怪物 hitbox。
- `shoot`：seq、at、origin{x,y}、pull{x,y}；後端重新計算速度／彈道／碰撞，客戶端不能給 velocity 或 hit。
- `switch`：seq、at、mode；僅重置連爆狀態，不能造成傷害。
- `endAt` 可讓既有箭矢繼續飛行；沒有箭時跳過不必要的物理迭代。

回應新增 `inputState`、權威 health／attacks／chainState 及本批 hits（hitIndex、damage、critical、healthAfter 等）。沿既有收據保存，相同 requestId 與內容取得原結果；同 ID 改內容被拒絕。沒有獨立新建「命中API」或額外獎勵資料庫。

## 4. 限制、時間及重試

每批最多64筆，單場最多4096筆；seq 連續，事件時間不可倒退或早於上一批確認時間。未抵達、截止後、超前伺服器100ms以上、遲到3秒以上均不接受。每筆事件皆檢查時窗，不能只用新 endAt 包裝過期輸入。

近戰採原20次／秒上限與最多4次 burst token，未命中也消耗額度；進場／閒置不會儲存無上限連擊額度。弓箭驗發射250ms間隔及最多12支在途，不以「命中間隔」粗略替代發射節奏。這是新協定節奏契約，舊版累計速率公式未變。

3秒遲到、100ms未來容忍及4次burst是本機驗證參數，**尚未經手機行動網路實測核准**。高延遲／背景暫停可能導致批次被拒絕；新輸入會停止並回報錯誤，不默默轉成新的攻擊交易。正式發布前需補上清楚的恢復／更新體驗與網路測試。

前端每約500ms合併；碰撞時立即以相同模型預測數字／血量，回傳後校正。hitIndex 防止確認同一命中時重播傷害字。逾時保留 batch 內容及 ID，重試原請求。結算先排空原批次，後端只補算已提交箭矢；未提交的新輸入不靠結算補造。離頁沿原放棄流程，不補發獎勵。

## 5. 舊版相容與防降版

私有 owner 的最低協定只由可信任交易升級。撤除測試准入後，此標記仍保留，不能改用未驗證舊戰鬥；回復工具也拒絕把該 owner 降成舊資產。未開始新戰鬥前會查驗既有 owner，防止省略 begin 握手繞過限制。

舊 PWA 仍可握手並使用原有經濟交易及收據恢復，避免先前逾時購買因舊客戶端清除 pending ID 而無法確認；但已升級帳號的舊握手不得開始戰鬥，會要求更新。這不是完整舊版更新介面：尚未實作阻擋操作的更新面板、跨分頁協調與實機 Service Worker 更新驗收。

## 6. 安全與交易

- 既有身份／群組、session、武器歸屬、裝備、能力快照與收據檢查保留。
- 伺服器不接受客戶端自訂命中、傷害、血量、速度或能力。
- 純模型只在 clone 上運算，任何非法輸入使整批拒絕，不部分扣血。
- session 血量／收據在原 Firestore Transaction 原子更新；原戰鬥結算負責原子獎勵／排行／任務。
- 前端無權寫 ops_* 會話／收據；本次未修改 Rules 或部署設定。
- 同批跨裝置重送、同 seq 不同 requestId、不同payload重放、未抵達、假弓箭原點及假命中均有測試。
- 僅法規格驗證不是對所有攻擊面的完整資安稽核；合法自動化、輸入時窗內的時間選擇與seed可預測仍需風險評估。

## 7. 修改檔案

本次主實作：

- `js/farm/verified-combat.js`：共用模型與驗算。
- `js/farm/verified-input-client.js`：預測、序列、固定ID批次、重試。
- `js/farm/verified-combat-view.js`：場地投影、怪物／箭矢顯示與傷害事件。
- `js/farm/backend-client.js`、`battle-page-client.js`、`combat-feedback.js`、`archery.js`：接入既有通訊、HUD與弓箭。
- `js/farm/dragon.js`、`mole.js`、`hornet.js`、`giant.js`、`cobra.js`、`aerial-patrol.js`、`scenes/VisitScene.js`：新協定才使用共用位置／觸點，舊路徑保留。
- `game-admin/functions/service.cjs`、`farm-transactions.cjs`、`farm-combat.cjs`：隔離准入、頁面／最低協定、後端驗算及原交易。
- `game-admin/functions/migrations/weapon-instances.cjs`：已升級協定不得回復至不相容資產。
- `scripts/prepare-game-admin.cjs`：打包共用模型及相依純函式至既有 functions/game 產物。
- `tests/verified-combat.test.mjs`、`verified-input-client.test.mjs`、`helpers/verified-input-browser.cjs`、`farm-private-backend-browser.cjs`：純模型、通訊與實際遊戲入口。
- `game-admin/tests/verified-input.cases.cjs`、`verified-input.test.cjs`、`verified-input.emulator.cjs`、`helpers/verified-input-fixture.cjs`：同組案例跑 MemoryDB／真實 Firestore。
- `game-admin/tests/helpers/release-fixture.cjs`、`memory-db.cjs`：測試准入及修正 fixture dotted update 語意，不改遊戲邏輯。
- `scripts/run-refinement-firestore-tests.cjs`、`scripts/lib/firestore-emulator-proof.cjs`、`scripts/weapon-release-review.cjs`：新案例、來源hash及本機審查證據。

既有未提交的其他 Phase 檔案不全部算成本次新增；準備腳本生成的 functions/game 副本不另算權威來源。

## 8. 測試與證據

本次最終單元688／688；九個瀏覽器workflow通過（七個既有回歸、新協定入口、舊worker模組各組合），其中既有離開戰鬥首輪失敗：固定20擊不足以保證200±10傷害擊敗4000HP，測試改為勝利即停、最多25擊後通過，沒有改遊戲數值。新協定入口涵蓋9種怪物及320／390／768px，遠程用真實mouse拖曳，近戰使用原sprite pointer handler；大金剛完成原勝利／入庫／任務／排行一次，其他測試場次經原離頁放棄，不補造勝利。

真實Firestore結果以最終53／53、12檔及來源不變的proof為接受條件；其餘中途來源變動結果標為無效。

最新結果與重現指令見同資料夾 `evidence/verified-input-2026-11-28/`，以來源雜湊相符的最後一輪結果為準。初跑與診斷失敗一併保留，不能用最後成功抹除時序問題。瀏覽器測試使用真實 Phaser 3.60.0／原拜訪入口、實際 service 與 MemoryDB；真實 Firestore 交易／candidate Rules 另跑，不能混稱為完整 Functions／Auth Emulator E2E。

## 9. 效能、成本與發布阻擋

沿用500ms批次，最多約2批／秒而非每下攻擊；沒有每幀／每箭 SDK 查詢。每個實際批次沿用既有 session 與收據寫入，實際讀取仍含原身份、rate limit及交易檢查，不能宣稱「零新增費用」。新協定頁面 V2 owner 增加一次讀取，首次最低協定升級增加一次寫入；後續不每擊讀owner或武器。箭矢尚在飛行時，命中／結算會需要原有批次更新。原部署前對精確單價、真實SDK讀寫與行動網路負載尚未量測，本次不虛構月費。

後端增加固定步進物理 CPU；每場輸入、每批事件與在途箭數有界。記錄／會話 payload 也較原aggregate大，正式發布前需測9種怪物最大負載、Firestore文件大小、Functions CPU／P50/P95與手機耗電。不要為減少讀取而略過收據、歸屬或碰撞驗證。

下一步仍為隔離驗收：核准模型／節奏契約，補齊網路失敗後恢復UI、舊PWA更新與實機觸控、全部場景／全武器組合測試及負載量測，再重新 Step A。正式部署、正式白名單、資料操作及逐步發布均未授權。
