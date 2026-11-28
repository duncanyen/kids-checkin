# 武器精煉漸進發布計畫（Step A交付，尚未授權執行）

> 最新復核（2026-11-28）：以下保留Phase8原始審查及B～F規劃，部分「未實作／Emulator阻擋」是當時狀態，不是目前結論。真正Firestore57項、正式scope gate／移轉工具、PWA層已完成隔離驗證；Windows/iPhone實機依使用者要求本輪略過。最新部署範圍、索引差異與未定版／正式證據缺口，請以 [略過實機後復核](predeploy-review-after-manual-skip.md) 為準。本輪未授權B～F。

日期：2026-11-28（台灣時間）。**目前NO-GO**。本文件的正式命令僅供審查；本次沒有執行B～F。不可把「繼續測試」當成部署、備份、移轉、開關或合併main的授權。

## A. 本次已完成的部署前審查

- 來源HEAD `8dbae59e619cc5382853dfeb0e6397eccddd209a`；目前分支main，Phase2～8仍為dirty workspace。**不是可發布的immutable commit**；尚未建立／合併PR、提交或推送。
- Phase1～7的本機證據存在；真實Emulator未通過，正式Rules／索引／兩區服務未核對。Phase6手勢／碰撞反作弊缺口持續存在。
- 預期專案homebasedb、Firestore asia-east1，取自先前使用者盤點及公開設定；**本次沒有向正式專案查證**。不要依Cloud Shell目前預設專案選部署目標。
- ops callable定義是asia-east1＋asia-southeast1，新增統計trigger定義asia-east1；原farm report trigger仍asia-southeast1，沒有藉精煉偷偷搬遷背景服務。RTDB仍新加坡，未移動。
- 五項正式玩家旗標均literal false。不是remote-config開關；現行精煉及解除另強制testEnvironment與隔離scope白名單，**改true並不等於可正式啟用**。
- 現有移轉CLI只准localhost demo。尚無已審查正式adapter、正式批次controller、正式allowlist／穩定分群准入。
- 新索引只是 [候選設定](phase-07-indexes.proposed.json)，未與正式索引合併／驗證READY；目前`game-admin/firebase.json`也沒有直接指向這份候選檔。
- 候選Rules的ops_根deny已盤點，正式release及所有重疊allow未查證；不得用候選deny覆蓋未知正式規則。
- 資料、資安、實機與費用缺口詳見 [Phase8報告](phase-08-report.md)、[最終測試](final-test-report.md)。完成本文件後停止，等待缺口處理與下一步明確授權。

本機審查命令（唯讀Git與本機檔案，不查正式Firebase）：

```bash
node scripts/weapon-release-review.cjs --output /tmp/weapon-step-a-review.json
# exit 3 = NO_GO，不要改寫requirement布林值或忽略後接deploy
```

此工具把未知正式證據保持false，不能代替人工簽核或真實雲端查證。

## B. 相容版本部署（未授權，尚不可執行）

前置：凍結可審查feature branch／commit、完整測試、真實Emulator、安全阻擋解除、正式環境識別與授權、備份隔離還原、候選索引對照與READY、兩區及舊用戶端相容方案。建議以PR審查；不直接合併main。

順序：先在隔離環境部署相容後端／索引與管理模組 → 驗證 → 經正式B授權後先兩區後端及必要索引 → 新統計觀測器 → 獨立營運中心 → 玩家靜態前端。玩家旗標仍關閉；不要部署會拒絕舊遊戲的Rules。每一步核對指定commit及實際endpoint，不使用`--force`略過刪除／區域確認。

**以下僅列出現有Firebase CLI的部署語法，現在不要執行；並非完整可上線指令包**：

```bash
# 在已凍結及授權的checkout中
cd "$HOME/kids-checkin"
node scripts/prepare-game-admin.cjs
firebase deploy --config game-admin/firebase.json --project homebasedb \
  --only 'functions:nexus-ops:gameOpsFarmTransaction,functions:nexus-ops:gameOpsAdmin,functions:nexus-ops:gameOpsDailyChallenges,functions:nexus-ops:gameOpsRedeem'
# 舊頁仍可能呼叫另一區，兩區都要由實際deploy log核對。
```

Phase7新增8支觀測器必須在**另外確認其索引、成本與來源相容性後**列入B的正式核准範圍：gameOpsRefinementReceipt、gameOpsRefinementDailyStone、gameOpsRefinementGiftStone、gameOpsRefinementChestStone、gameOpsRefinementEconomy、gameOpsRefinementBattle、gameOpsRefinementState、gameOpsRefinementFarmSnapshot。部署語法依原codebase的`functions:nexus-ops:<函式名稱>`，不能只更新FarmTransaction就宣稱整合上線。

營運中心target在設定中為`nexus-game-admin`，先讀專案sites及target綁定（經B授權時才執行）：

```bash
firebase hosting:sites:list --project homebasedb
firebase target --project homebasedb
# 僅在核准綁定確認後：
firebase target:apply hosting nexus-game-admin homebasedb --project homebasedb
firebase deploy --config game-admin/firebase.json --project homebasedb --only hosting:nexus-game-admin
```

本次不存在.firebaserc，不能假設已綁定。上面target寫入本機設定，也需在正式作業checkout核對。玩家前端是GitHub Pages main/root；更新main／push可觸發公開發布，必須與B授權一起安排，不在本階段自行push。

Rules與索引需另有已比對、可審查的完整artifact；本文件不給`--only firestore`一鍵覆蓋未知規則。候選索引不直接整份替代現有設定，不能在未配置的firebase.json上假稱可一鍵部署。

## C. 逐scope移轉（未授權）

完整程序見 [migration-runbook](migration-runbook.md)。先正式資料dry-run與核對、專用測試scope、小批、每批對帳，最後整體覆蓋盤點。

重要相容衝突：現有程式在V2農場且weaponInstanceEnabled=false時會拒絕購買／出售／換裝；staging期間則暫停該scope的武器變動，非武器交易仍可提交。**不能把玩家先搬V2、等D才想起開啟相容writer**。正式adapter須讓已移轉scope使用相容個體writer，不依新的精煉准入而封鎖原武器操作；未移轉scope保持V1。這部分目前未實作，C保持阻擋。

## D. 專用管理測試scope（未授權）

營運人員Auth權限與玩家測試scope分開；玩家以服務驗證後的(profileId,groupId,accountId)辨識，同帳號不同群組互不混用。裝置ID、localStorage或Email前端判斷都不是准入來源。

相依順序需修正為：

1. 為已移轉scope提供相容個體讀寫，確保舊遊戲買賣／裝備仍可用。
2. 開放該scope的精煉石來源，原歷史獎勵不回補。
3. 先確認可信任戰鬥快照服務可讀已取得能力，再以**同一發布版本協調開放精煉交易＋戰鬥能力**，不得產生精煉true但combat false的窗口。
4. 驗證+0、+1、+9、切裝、限武器怪物、逾時原ID及退款。
5. 再開放解除交易，保留歷史成功成本規則。

使用者列出的第3／4項不能彼此獨立先後開啟付費操作；上述是避免付資源卻無能力的必要協調，不是擅自更改攻擊或獎勵。

目前只存在testEnvironment=true的隔離注入，沒有正式遠端准入／白名單writer或UI；**不得在正式服務把testEnvironment設true來繞過隔離限制**。須另行實作、測試及審查正式release gate後才可D。

## E. 小規模逐步開放（每一步另需授權）

現有人少時優先固定白名單，非盲目5%（可能0人或1人）。人數足夠才採5→25→50→100%。每一步核對不同scope總數、實際人數、備份／對帳覆蓋及觀察期間；建議每階段至少24小時且含台灣日切、足夠的收據樣本，不夠則延長，不為湊百分比提早擴大。

穩定分組方案：由後端對固定版本salt＋scope做hash，bucket0～999999，`bucket < percent×10000`。固定salt可保持各裝置一致及比例巢狀；換salt視為新發布。純規劃測試在`scripts/lib/weapon-release-policy.cjs`，**未接正式准入、不能當成已部署gate**。

每階段必需：對帳無錯誤、核心回歸正常、原ID重送正常、已取得能力保留、索引READY、真實帳單與觀測值在核准門檻內，並有明確的下一階段授權紀錄。

## F. 全面開放（未授權）

先完成E所有條件、至少一個完整簽到／任務日切及足夠經濟樣本；核對精煉金幣淨回收、材料供需、武器等級分布、戰鬥／獎勵速度，以及玩家回報。無資產錯誤、無未授權修改、無重大核心回歸且費用接受，經F專項授權才全服。

## 監控及量化門檻（提案，待使用者確認）

| 項目 | 建議停止擴大條件 |
|---|---|
| 遺失／重複武器、錯扣／重扣／重退、未授權資產寫入 | 任1筆可信任證據立即停止新增精煉／解除並隔離對帳，不等統計顯著 |
| 大量登入／倉庫／裝備／戰鬥不能用 | 核心流程無法完成或影響整個已開放群組，立即停止擴大 |
| 一般API錯誤 | 同條件5分鐘窗且≥100請求，錯誤率>1%或高於已量測基準2倍持續2窗，先停止擴大；缺樣本標不足 |
| 延遲 | 同區域、同網路／裝置／暖冷啟動分層後，P95高於核准基準20%持續2窗，調查後再決定；500ms偷蛋目標不是強制偽造結果的時限 |
| 倉庫首屏 | 與同條件的Phase1／V1測量比較；現有本機1樣本不能作正式P95基準 |
| Firestore費用 | 讀／寫每有效動作成本高於核准預算20%，或投影當月超過核准月預算，停止擴大 |
| 經濟 | 玩家日產金幣／材料及BOSS擊殺時間相對核准模型偏差>20%且樣本足夠，先評估；不直接加HP／減掉落 |

1%／20%及窗口是**待核准建議值**。Phase1沒有真實網路／正式錯誤率／P95，不能宣稱是已量測門檻。登入、API、資產、讀寫、成本及回報都要同時看，不能只看Functions成功率。
