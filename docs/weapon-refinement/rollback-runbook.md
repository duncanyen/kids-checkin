# 緊急停止與向前修復Runbook

日期：2026-11-28（台灣時間）。本次只是Step A準備，沒有執行停止正式服務、修改旗標或資料回復。現在五項正式flag都false；沒有可直接操作正式遠端release gate的工具。

## 1. 立即停止擴大條件

任一確認的武器遺失、重複個體、錯誤扣款／重扣、錯退／重退、未授權修改，或已開放群組大量不能正常遊玩，立即停止擴大。先保存時間、scope、requestId、instanceId、版本與已完成／未知狀態，不在對話或公開日誌貼Token、私有抽樣或密碼。

一般錯誤／延遲門檻是 [release-plan](release-plan.md) 的待核准提案，不能把單一低樣本波動直接當異常，也不能因樣本不足忽略資產錯誤。

## 2. 緊急停止的順序

1. 停止新精煉准入與新解除准入；保留已完成收據與原交易結果查詢。
2. 正在結果不明的請求，先查原ID，不能自動另建交易退款／重扣。
3. 保留個體資料、已獲精煉石、能力快照與目前戰鬥會話。繼續支援V2個體的正常買賣／換裝，不把weaponInstanceEnabled直接關到讓V2原功能失效。
4. 戰鬥服務繼續讀既有earned bonus，活動中會話固定原快照。不要刪bonus、強制全部+0或切回V4解讀V5戰鬥。
5. 必要時停止**新**材料來源；已鎖定的寶箱／grant與待確認發獎仍須按歷史承諾處理，或明確保留一致待重試狀態，不吞材料、不重發原金幣。
6. 隔離異常scope／交易，保存證據、備份新現況，對帳後向前修復。

### 現有版本的正式阻擋

- release flags是編譯檔literal false，正式服務仍test-only，沒有受權的正式控制API；不能提供不存在的「營運中心一鍵緊急停精煉」指令。
- weaponInstanceEnabled=false會阻止V2武器變動，不能用它當作只暫停精煉的開關。
- refinementStoneRewardEnabled=false目前也會讓已鎖精煉石的寶箱暫停開啟，保留但不消耗。這是安全保留機制，**不是已完成「只停新來源、老寶箱照常開」**。正式release adapter必須拆開新來源准入與既有快照兌付能力，經測試才上線。

上列都是目前NO-GO原因，不在Phase8擅自解除testEnvironment、改全域旗標或修改正式功能來迴避。

## 3. 對帳與修復決策

- 來源一致性：核對完整scope、generation、owner／farm／allocation、私有state、intent／quote／receipt及歷史版本。
- 資源一致性：取得可信任同次提交前後資源證據。只有receipt的post-balance及目前farm，標未完成，不推算補償。
- 同requestId完成：重送讀原結果。pending：由相容服務查原intent／transaction，不刪intent重新抽。rejected：確認沒有經濟提交，不用新的隨機結果覆蓋舊拒絕。
- 多裝置：同scope、同instance、同revision的衝突只允許一方完成；不要修改revision使舊請求強行通過。
- 設定錯誤：用歷史release建立新草稿、重新驗證後發布新版本。保留已取得能力、歷史成功投入及保底進度；不能直接編輯歷史版本。
- 統計錯誤：先停observer／查原因，再按原來源冪等補算、執行有界對帳。統計修復不直接改資產或補錢。
- 真正資產錯誤：由受權管理員建立獨立、具理由／before-after／唯一補償ID的補償交易。可使用既有安全金幣補償；精煉石或個體狀態若缺專用安全補償路徑，先實作與審查，不用Console手改或假裝既有調物品API一定支援。

## 4. 原型移轉rollback的嚴格條件

僅本機Emulator原型支援：owner revision必須0、來源指紋未變、沒有新武器買賣／裝備／精煉／退款，才允許回復必要schema欄位；不刪allocation帳本，保留較新金幣、雞蛋與其他紀錄。

```bash
# 僅localhost demo；需先verify及檢查revision0，正式環境不可照抄
node scripts/weapon-instance-migration.cjs --project demo-nexus-private-farm \
  --profile test-profile --group test-group --account test-player \
  --step rollback --apply
```

一旦有新武器經濟操作，原工具會拒絕，應維持V2並向前修復。不要使用新generation去規避已交易的舊狀態。

## 5. 前後端版本回退

回退候選版本必須能讀既有V2 owner／allocation／state與V5戰鬥，支援原交易恢復及既有快照獎勵。**Phase1 HEAD只含舊版，不能當作已精煉玩家的安全回退版本**。

- 全新功能從未開放、沒有正式移轉或交易：可在有授權與證據後回退到原相容版本；仍核對所有環境與舊頁面。
- 已有V2／精煉／退款：優先停止新交易及向前修復，不回退成忽略個體／能力的舊writer。
- 已在V5戰鬥：相容服務完成原會話，不重開一場賭新爆擊或重新發獎。
- PWA只清公開美術快取；不要清localStorage中結果不明的精煉ID來「修復」。先記下scope／requestId，查結果後再決定快取處理。

**禁止整個正式Firestore匯回舊備份**作為一般回復。災難還原若必要，須另行授權、隔離還原、對照備份後所有資產交易並合併向前補齊，不能覆蓋玩家新遊玩成果。

## 6. 恢復與重新擴大

事故根因、完整對帳、補償防重、相容回歸、成本及安全驗證完成後，產生新的審查artifact／commit，再重新取得D／E所需授權。不得把「問題看起來好了」當成全面發布授權。

## 2026-11-28 工具更新

新受審核移轉 CLI 與退出碼見 [migration-runbook.md](migration-runbook.md) 新增章節。rollback 仍只允許無新武器 revision／無戰鬥且來源指紋一致者；新的金幣及非武器進度保留。交易後必須向前處理，沒有自動補造資產的權限。精煉私有資源帳本 `ops_refinement_wallet` 應與收據／intent／能力歷史一併保留，不得為了讓對帳通過而刪除異常記錄或補造舊 before balance。
