# Phase 5 — 精煉 UI、個體倉庫與解除精煉

日期：2026-11-27（台灣時間）。來源 HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`。本工作目錄保留 Phase 2～4 與後續精煉石美術的未提交工作；本階段沒有提交、推送、部署、正式 Firebase 資料操作或 Rules／索引變更，沒有進入 Phase 6。

## 1. 前置核對與授權範圍

已核對 [開發總規範](DEVELOPMENT_RULES.md)、Phase 1 分析、Phase 2～4 報告、Phase 4 測試證據及 [精煉石圖片替換](refinement-stone-art-update.md)。Phase 4 本機實作、543項單元、材料手機入口及後續39項美術相關測試完成，**仍不能確認正式驗收已通過**：真實 Firestore Emulator JAR 下載遭 HTTP403，前次瀏覽器矩陣有既有戰鬥 HUD 幾何不穩定的初跑失敗。本次依使用者明確 Phase 5 指示，在隔離環境繼續開發，保留前置缺口，不以此宣稱正式可發布。

五個正式預設開關：

```text
weaponInstanceEnabled = false
weaponRefinementEnabled = false
refinementResetEnabled = false
refinementCombatBonusEnabled = false
refinementStoneRewardEnabled = false
```

Phase 5 精煉、解除與精煉武器直接出售還有**後端測試環境＋帳號群組白名單**限制。沒有前端旗標可繞過；正式建構服務沒有測試環境或白名單，縱使誤開一個精煉開關，也不能開放玩家精煉。

## 2. 本次玩家流程

入口僅為「倉庫 → 武器 → 個體詳細資訊 → 精煉／解除精煉」，沒有修改首頁 HUD 或增加入口。

### 武器清單

- 沿用 Phase 2 20筆分頁的個體 Repository；同款三把有三個 Instance ID、三張圖示卡及各自等級。
- 卡片顯示原有圖片、名稱、+0～+9、裝備中、系統綁定與戰鬥鎖定。
- +0～+2 普通木色邊、+3～+5 綠邊、+6～+8 藍邊、+9 金邊及輕微靜態光暈。皆顯示數字，無持續閃爍。
- 未個體化農場沿用原倉庫；其他物品分類、金幣／材料及場景／護衛犬功能不改。
- 僅在清單查詢能力權限，不為每張卡片查能力。清單與權限 RPC 平行發出，詳情只在玩家點開時讀取。

### 詳細資訊

後端 `getWeaponDetails` 提供原始能力快照、精煉加成、最終預覽攻擊力、兩種爆擊率、裝備狀態、原有可攻擊怪物、使用限制、原有出售價與餘額。沒有從前端猜測能力。

顯示的「精煉能力」是測試預覽，介面明示 **「測試中的精煉能力尚未套用至戰鬥」**。本階段不改現有傷害、怪物HP、動畫、攻速或合併攻擊協定；實際戰鬥加成留待 Phase 6。

既有圖片從 Phaser 紋理取得，包括 BootScene 產生的初始木棒；沿用既有木框、羊皮紙、綠色與淺木按鈕、精煉石透明PNG。**沒有新增或覆蓋美術素材**，沒有待補的新素材清單。

### 精煉

- 同一彈窗原地顯示目前／目標級、三項目前／預計／差異、後端成功率、成本與持有量、版本、失敗不降級不毀損。
- 保底關閉時隱藏保底進度；資源不足／戰鬥中／+9不能開始。
- 「開始精煉」即確認該張後端報價，不增加第二層對話框。
- 確定收到結果才顯示成功／失敗效果；一般450ms，成功到+3／+6／+9為1100ms，提供「略過特效」。減少動態設定不播放動畫；已結算時有從按下起最短300ms的按鈕防連點保護，不新增網路等待或戰鬥請求。
- 成功／失敗後留在精煉頁，刷新真實餘額及下一級預覽；+9返回詳細資訊並禁止繼續精煉。沒有自動精煉。
- 視覺動畫失敗不把已成功的交易判成失敗；已收到結果但後續讀取失敗時明示已結算，提供重新讀取，不重新扣款。

### 解除與出售

- 點「解除精煉」取得退款報價，顯示該把武器、+N→+0、三項失去能力、歷史成功投入與預計退款。
- 「取消」只返回原詳細資訊，不送退款請求。「確認解除」才送出一次後端交易。
- 不可復原提醒固定在捲動區外，即使320px畫面也可見；詳情表可捲動，確認與取消保持可操作。
- 精煉武器直接出售前明示原售價、精煉能力永久消失、不返還精煉成本，以及可先解除再出售；取消會返回詳細資訊，不會失去操作入口。
- +0出售不新增精煉確認條件。系統綁定／已裝備不可出售；精煉武器不能直接丟棄。沒有自動解除再出售。

## 3. 測試帳號與功能開關

`game-admin/functions/refinement-access.cjs` 以伺服器驗證後的三欄精確比對：

```js
{ uid: 'alice', groupId: 'A', accountId: 'alice' }
```

這是隔離瀏覽器 fixture 的帳號，**不是正式玩家白名單**。`uid` 是 Nexus profile document ID，不是 `nexus_...` Firebase Auth UID。服務必須以 `refinementTestEnvironment: true` 和 `refinementTestAccounts` 明確建構，再通過私有身分、群組、當前撤權／停權、後端ready、武器歸屬及各功能開關。

未列入的帳號／群組或非隔離環境：不能取得可執行的精煉／退款權限，即使直接呼叫API亦拒絕。自己的已取得能力及已完成交易仍可讀取，不因關閉新操作而隱藏資產。

沒有建立可由正式用戶端傳入的測試開關、亂數或ownerId；測試可控亂數與原 Phase 3 相同，只在明確隔離建構器提供。未設定正式測試帳號或雲端測試部署，本次只在本機fixtures／demo Emulator嘗試。

## 4. 後端 API

不新增 Functions export，沿用 `gameOpsFarmTransaction` dispatcher；呼叫身份與群組沿用既有私有驗證。外層皆帶 `action, groupId, requestId`；現有傳輸附加的 `battlePageId` 不作為身份來源。

| action | 業務欄位 | 回應重點 |
|---|---|---|
| `getRefinementCapabilities` | 無 | 精煉、解除、精煉出售權限、戰鬥鎖定；戰鬥加成固定false |
| `getWeaponDetails` | `instanceId` | 個體、原始／目前能力、使用限制、餘額與權限 |
| `previewRefinement` | `instanceId` | 沿用Phase3報價，新增weaponId及後端餘額供UI |
| `refineWeapon` | `instanceId, quoteId, configVersion, expectedLevel` | 沿用Phase3固定亂數intent、原子扣款及結果 |
| `getRefinementResult` | `transactionId` | 原精煉 pending／rejected／completed |
| `previewRefinementReset` | `instanceId` | 退款報價、原能力／+0能力、歷史成功投入、版本、到期時間 |
| `resetRefinement` | `instanceId, quoteId, configVersion, expectedLevel` | 原子歸零、實際退款、epoch／revision及最新餘額 |
| `getRefinementResetResult` | `transactionId` | 該農場原解除結果；無已完成紀錄回not-found，可用原交易重試 |

退款、成本、ownerId、roll或能力等未允許欄位一律拒絕。preview非精煉或退款，僅寫報價，取消不動資產。

精煉武器出售仍用原 `sellItem`，除 `item,quantity:1,instanceIds:[id],expectedWeaponRevision` 外，必須有 `acknowledgeRefinementLoss:true, expectedStateRevision`。後端重新檢查指定測試帳號、功能、歸屬、未裝備／非綁定及狀態；陳舊精煉等級的出售請求不能默默出售。

## 5. 解除設定與版本

為避免修改既有不可變的 Phase 3 精煉版本內容／雜湊，解除採獨立版本：

```json
{
  "schemaVersion": 1,
  "version": "refinement-reset-v1",
  "effectiveAt": 0,
  "enabled": true,
  "coinsRefundBp": 3000,
  "stonesRefundBp": 5000
}
```

百分比皆為0～10000整數basis points。正式全域開關仍為false；上例是尚需可信任發布的初始設定，不會自動建立正式文件。

新增資料路徑：

- `ops_game_config/refinement-reset`：生效版本、revision與發布人／時間。
- `ops_refinement_reset_versions/{version}`：不可覆寫設定、雜湊、發布人／時間。
- `ops_refinement_reset_config_requests/{hash}`：管理發布指紋與防重結果。
- `ops_refinement_reset_quotes/{quoteId}`：兩分鐘報價、私有binding與雜湊、可顯示public結果與雜湊、acceptedBy。

沿用 `gameOpsAdmin` 的 `refinementResetConfig`／`publishRefinementResetConfig`，後者payload `{config,expectedRevision}`、外層唯一requestId。保留當前Auth admin驗證與發布稽核；本階段沒有營運中心UI，設定發布只在隔離測試內使用。過期revision、重用版本、換內容重送requestId、未生效設定、關閉功能均有後端拒絕。

## 6. 原子解除流程及退款公式

退款：

```text
金幣 = floor(本輪歷史成功金幣合計 × coinsRefundBp / 10000)
材料 = floor(本輪歷史成功精煉石合計 × stonesRefundBp / 10000)
```

實作用BigInt完成乘除後轉回安全整數，不逐級先取整，不使用浮點數，也不依目前精煉費用表重算。

初始表成功到+9合計35,000金幣、16石，退款10,500金幣、8石。額外失敗支出不計；+1成功後+2失敗一次，僅依成功的1000金幣／1石退款300金幣／0石。

單一Firestore Transaction：

1. 重新驗證當前玩家及農場scope；先查既有解除收據，完全相同則回原結果。
2. 驗證測試環境／白名單、兩個後端ready、個體開關、解除開關。
3. 讀目前farm、戰鬥、owner、allocation、private state與當前原始戰鬥設定；+0或戰鬥中拒絕。
4. 讀生效解除版本；核對報價的owner、instance、generation、ownerRevision、stateRevision、epoch、級別、成功／失敗成本、原始能力、設定版本／雜湊及到期時間。
5. 再由歷史成功成本算退款，核對public報價雜湊與退款、餘額上限；任何變更要求重新確認。
6. 原子更新farm餘額、owner revision、武器state、報價使用標記、共用完成receipt與intent。
7. 任一寫入失敗全部回滾，原requestId可安全重試；重送不再次退款。

重置state：+0、三項bonus歸零、refineStatsVersion/baseStatsSnapshot為null、失敗次數與目標保底清空、本輪成功與失敗消耗歸零，state revision及refineEpoch各+1；保留instanceId、createdAt、裝備關聯、數量與原始商品。

解除後+0能力依當時現有原始戰鬥設定。報價同時固定該原始設定，因此中途調整原始能力也須重新確認；既有已精煉能力在解除前仍依原快照讀取。

共用既有 `ops_refinement_transactions` 與 `ops_refinement_intents` 的 `{profileId:requestId}`命名空間，解除指紋含action、farm scope及完整業務欄位，不能把已用編號換成精煉／另一把武器／另一個群組。解除receipt保留beforeState、成功／排除失敗成本與結果，原精煉receipt不刪除。

## 7. 併發與出售

- 同一解除交易重送：第一筆成功，其餘讀同receipt。
- 不同裝置各持一張退款報價：先提交者增加owner/state revision及epoch，後者拒絕，不退款兩次。
- 精煉、解除、出售皆驗證owner/state或allocation，任何先完成者使陳舊提案失效。
- 精煉已保留intent但未扣款時若解除先成功，原精煉結算拒絕舊報價，不再扣金幣／石。
- 精煉武器直接出售沿用原單價及原farm交易，增加明確失去精煉的確認與state revision，不發退款、不自動解除。private state保留soldAt／soldTransactionId作稽核，allocation原子標記移除。
- 關閉新操作後，已完成精煉／解除仍可查回；不得因此再退款或回放舊餘額到畫面。UI在得到結果後重新讀目前資料。

## 8. 網路不明與介面生命週期

`js/farm/refinement-client.js` 在送出前先保存localStorage：

```text
nexus.refinement.pending.v1:[profileDocId,groupId,accountId]
{schemaVersion, action, requestId, display:{weaponId}, payload:{instanceId,quoteId,configVersion,expectedLevel}}
```

不保存密碼、Token、隨機結果或可作權威的金幣資料。儲存被封鎖時先拒絕執行，不送出無法恢復的新扣款；紀錄異常不悄悄清掉。

同一農場有未確認的精煉／解除時，倉庫優先顯示恢復頁，停止新增另一筆精煉／解除。逾時、unavailable、登入暫失效等保留原紀錄；重新開窗／登入後先查 `get...Result`：

- completed：顯示原結果，不重送扣款或退款。
- rejected：顯示拒絕，允許重新預覽。
- pending或not-found：僅在玩家按確認原交易後重送**原action、payload與requestId**。

`farmCommand`新增可選explicitRequestId供此路徑使用，原有呼叫不變。執行中的promise也綁定scope，切換群組不會把前一農場結果當作新操作的回應。舊後端尚無Phase5權限action時，只隱藏新功能，原個體裝備／出售維持；真正網路錯誤不當成開放權限。舊裝備／出售的pending記錄繼續由既有相容層處理。

彈窗沿用createFarmDialog的遮罩、輸入鎖、場景清理及返回焦點。關閉、切場景、換群組後不執行額外交易；已送出的請求由後端完成，UI不在過期場景更新。只有明確新按下開始／確認才新增交易。

## 9. 修改檔案

| 檔案 | 本階段修改 |
|---|---|
| `game-admin/functions/refinement-access.cjs` | 新增隔離環境／精確scope白名單 |
| `game-admin/functions/refinement-reset-config.cjs` | 新增獨立解除版本、發布、稽核 |
| `game-admin/functions/refinement-player-service.cjs` | 新增權限／詳情／解除預覽、退款、結果查詢 |
| `game-admin/functions/refinement-service.cjs` | 沿用Phase3精煉，加入測試帳號限制；報價補weaponId／餘額 |
| `game-admin/functions/weapon-instance-config.cjs` | 新增false的refinementResetEnabled，其餘四開關不變 |
| `game-admin/functions/service.cjs` | 原callable派送新action、admin解除設定、依白名單授權出售 |
| `game-admin/functions/farm-transactions.cjs` | 向既有Repository傳入精煉出售授權，不改售價 |
| `game-admin/functions/weapon-repository.cjs` | 精煉出售明確確認及revision，保留sold稽核；禁止精煉丟棄 |
| `js/farm/refinement-client.js` | 新增持久化原交易恢復，不直接寫Firestore |
| `js/farm/weapon-refinement-ui.js` | 新增同Modal的詳情、精煉、解除與動畫 |
| `js/farm/weapon-instance-ui.js` | 個體框色、詳情入口、精煉出售警告與取消恢復 |
| `js/farm/backend-client.js` | 原farmCommand支援可選原requestId，不改既有預設行為 |
| `css/farm-chest.css` | 只作用於weapons彈窗的框色、表格、材料圖及可捲動底部 |
| `game-admin/tests/refinement-player.test.cjs` | 新增17項後端整合／安全／衝突測試 |
| `tests/refinement-client.test.cjs` | 新增8項離線／收據／儲存／scope測試 |
| `game-admin/tests/refinement-reset.emulator.cjs` | 新增真Firestore競態及candidate Rules測試，localhost demo限定 |
| `game-admin/tests/helpers/refinement-fixture.cjs`、`game-admin/tests/refinement-service.test.cjs` | 原隔離fixture明確提供允許的測試scope |
| `tests/farm-private-backend-browser.cjs`、`tests/helpers/refinement-ui-browser.cjs` | 原遊戲入口的Phase5測試模式 |
| `tests/weapon-refinement/reset-cost-probe.cjs` | 新增隔離讀寫次數探針 |
| 本報告、`DEVELOPMENT_RULES.md`、Phase5 evidence | 階段範圍與實際證據 |

原本就存在的Phase2～4、精煉石圖及其他工作目錄差異不歸為本次新改造。沒有修改村落首頁HUD、原始商品價格、戰鬥結算數值、活動／排行榜／每日任務規則、Firebase Rules、索引或部署設定。

## 10. 測試結果與限制

最終全套單元 **568／568通過**，包含本階段25項（17項後端、8項客戶端）。最終數量、初跑及重跑狀態以 [Phase5 evidence](evidence/phase-05-2026-11-27/phase-05-summary.json) 為準，日誌保留原始失敗，不用重跑抹除。

本階段25項測試含：

- BigInt退款上下限、設定格式、+9的10500／8、失敗成本排除、floor及重煉新epoch。
- +0／戰鬥中／關閉／未列入／非測試環境拒絕；私有身分、當前admin及跨群組交易結果拒絕。
- 同request多裝置、不同報價、退款溢位、原子交付失敗與原ID重試、報價過期／成本與設定變更、public報價竄改。
- 精煉intent與解除、出售與解除的競態；原售價、不退精煉成本、不自動解除及歷史保留。
- 不依現行精煉費用重算退款；所有正式開關false。
- 客戶端離線前未提交、逾時後已提交、先查再原ID重試、明確拒絕、群組隔離／跨群組執行中操作、舊後端action相容、儲存失敗與損毀紀錄不重複扣款。

真Phaser＋真服務函式＋隔離SDK／MemoryDB瀏覽器測試從原本倉庫入口操作，涵蓋三把同款、成功／失敗、一般及減少動態下連點、取消／確認解除、重新載入恢復原交易、陳舊報價、資源不足、+3特效略過、綠／藍／金框、+9上限、精煉出售警告／取消與原價成交。不是靜態HTML展示，沒有直接客戶端Firestore資產寫入。額外注入一次視覺動畫失敗，仍正常顯示已結算成功並繼續操作。

版面尺寸：320×568、390×844、402×874、440×956、768×1024；其中402／440為iPhone17系列尺寸的Chromium模擬，**不是iPhone17實機或Safari驗收**。確認無橫向捲軸、長文字可換行、退款警告及兩個按鈕保持可見。原Phase2裝備／買兩把／賣一把／逾時恢復亦另外重跑。

完整原有瀏覽器矩陣初跑27／29組：`critical_zero_tests` 在既有 `combat-feedback-browser.cjs:67` 血條／頭部水平位置斷言失敗；`navigation_load_tests` 在原有 `farm-navigation-loading.cjs:23` 的80ms載入提示斷言失敗。沒有改戰鬥／載入程式或放寬測試；兩組之後原命令單獨重跑皆exit0。初次失敗與單獨重跑日誌都保留，列為時序不穩定、根因未完全釐清，不以重跑抹除。

真正Firestore Emulator本次再次嘗試，仍在下載 `cloud-firestore-emulator-v1.19.8.jar` 時HTTP403 `Domain forbidden`，沒有跑到Rules／真實競態assertions，狀態 **BLOCKED**。MemoryDB並行與fixture身分驗證不能當真實Firestore／正式Rules通過。正式Rules release未讀取、未部署，安全驗收仍待補。

## 11. 費用與倉庫效能

[成本探針](evidence/phase-05-2026-11-27/cost-probe.json) 是MemoryDB交易介面計數，略過真Auth RPC、節流、網路、Firestore重試與鏡像／報表trigger，不能當正式帳單。

| 直接服務操作 | 讀取 | 寫入 |
|---|---:|---:|
| 測試帳號權限 | 1 | 0 |
| 單把詳情 | 6 | 0 |
| 解除預覽 | 9 | 1 |
| 解除原子提交 | 11 | 6 |
| 已完成解除重送 | 2 | 0 |
| 查原解除結果 | 1 | 0 |

正式呼叫還有既有私有身分／Auth／節流成本，同一次transaction的重複文件讀取由reuseTransactionReads共用；重試會有額外讀取。解除提交6寫為farm、owner、state、quote使用標記、receipt、intent，不另發退款請求。

倉庫仍分頁20個體，不在首頁訂閱全部武器／歷史；清單與權限兩個RPC平行，沒有每卡片的能力RPC；詳情／下一級報價依使用者操作查。原有圖片與精煉石快取沿用，不新增圖片下載。本機冷開倉庫到4張卡片的最後單次計時為 2485ms（樣本數1），一個list RPC、一個capabilities RPC、零個逐卡詳情RPC；資料另存 `warehouse-load.json`，僅為headless Chromium／隔離SDK／MemoryDB及本機HTTP的樣本，含原有素材載入，不是正式網路、實機、前後對照或P95。分頁與API數量驗證比此單一秒數更能說明本次沒有逐把查能力。

單次精煉結果後會讀最新詳情與下一級報價，以保留版本一致性，不能將這些讀取宣稱為零成本。

精煉／解除不新增每下攻擊請求，戰鬥效能不受精煉動畫等待。正式開關關閉且農場未個體化時，原倉庫不開這些新UI交易。成本需以實際精煉／解除次數、每次讀寫單價、地區及免費額度估算，另含Functions運算與文件儲存；沒有營運資料，不虛構月費。

報價兩分鐘過期只表示不能再執行，並非已部署TTL刪除。後續需另外規劃報價清理／歷史保留及儲存費用，本階段不新增正式排程或刪除任務。

## 12. 回復與尚待驗收

- 本次沒有正式新資料，不需要移轉或退款補償。正式預設始終false。
- 若未來測試暫停新精煉／解除，關閉各自開關並保留已取得武器、state、beforeState及receipts；已完成結果仍可讀。
- 有精煉／解除／出售紀錄後，不以整份舊farm覆蓋餘額，不刪除epoch或收據。按原交易ID及資產對帳後向前修復。
- 保留支援既有V2個體與結果的讀取服務，不回退到只理解舊堆疊數量的writer；精煉武器老客戶端無明確個體與確認欄位時拒絕出售，不任意挑武器。
- 所有可達後端區域與舊PWA相容、正式Rules核對、真實Emulator／Rules／Firestore競態、實機及正式網路延遲皆仍待驗收。不提供或執行正式部署。
- 本階段在 **Phase 5停止**，不將能力套到戰鬥，不進Phase6。正式放行狀態尚未成立。

## 13. 隔離重現

已安裝專案既有Node22、依賴、Chromium／Playwright與Phaser3.60 fixture的測試環境：

```bash
node scripts/prepare-game-admin.cjs
node --test game-admin/tests/refinement-player.test.cjs tests/refinement-client.test.cjs
node tests/weapon-refinement/reset-cost-probe.cjs
PHASE1_BASELINE_DIR=/tmp/nexus-phase5-new-baseline node tests/weapon-refinement/phase1-baseline.cjs
```

在本機HTTP server服務專案根目錄後：

```bash
mkdir -p /tmp/nexus-phase5
REFINEMENT_UI_TESTS=1 \
NODE_OPTIONS="--require=$PWD/tests/weapon-refinement/browser-guard.cjs" \
FARM_BASE_URL=http://127.0.0.1:8032 \
node tests/farm-private-backend-browser.cjs
```

真Emulator套件 `game-admin/tests/refinement-reset.emulator.cjs` 限制localhost及 `demo-nexus-private-farm`，環境修復後需跑完，不能把下載失敗改為通過。沒有正式專案部署或啟用指令。

## 14. 實際遊戲入口截圖

- [武器詳細資訊](evidence/phase-05-2026-11-27/weapon-details-390.png)
- [精煉預覽](evidence/phase-05-2026-11-27/refinement-preview-390.png)、[成功](evidence/phase-05-2026-11-27/refinement-success.png)、[失敗](evidence/phase-05-2026-11-27/refinement-failure.png)
- [+3綠框](evidence/phase-05-2026-11-27/inventory-green-plus3.png)、[+6藍框](evidence/phase-05-2026-11-27/inventory-blue-plus6.png)、[+9金框](evidence/phase-05-2026-11-27/inventory-gold-plus9.png)
- [320px解除確認](evidence/phase-05-2026-11-27/reset-plus9-320.png)、[402px解除確認](evidence/phase-05-2026-11-27/reset-plus9-402.png)、[解除完成](evidence/phase-05-2026-11-27/reset-result.png)
- [恢復原交易](evidence/phase-05-2026-11-27/recovered-original-transaction.png)、[精煉出售提醒](evidence/phase-05-2026-11-27/refined-sale-warning.png)

以上為Chromium執行真Phaser場景、隔離SDK及後端交易所得，不是正式帳號、實機截圖或靜態設計稿。
