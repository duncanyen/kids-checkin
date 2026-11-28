# 略過實機步驟後：部署前復核

日期：2026-11-28（台灣時間）。使用者要求略過Windows憑證與iPhone實機操作，繼續下一個動作。本次完成本機Step A復核及命令整理，沒有部署、正式資料讀寫、Git提交／推送或合併main。

## 略過的範圍

Windows憑證設定、iPhone／Safari／主畫面PWA及實際Wi-Fi／行動網路操作，記為 **DEFERRED_BY_USER（本次略過）**。不再要求先完成這些操作才能進行本機發布準備，也不把NOT_RUN改成PASS。這不是正式環境部署或全服開放授權。

原始實機紀錄表保留NOT_RUN，避免日後誤認已有實測。略過理由及範圍另存在本輪review-details.json。

## 復核結果

| 項目 | 目前狀態 |
| --- | --- |
| 最新完整單元基準 | 709／709；其中4項為獨立驗收站工具測試 |
| 真正Firestore交易／candidate Rules | 57／57、13檔suite；本輪重新核對來源hash符合 |
| 原瀏覽器流程 | 前階段11組最終通過，初跑時序／修正紀錄保留；另有獨立lab完整遊戲預檢 |
| 正式六項功能預設值 | 全部false，未修改 |
| 私有原交易查詢、PWA更新及分頁協調 | 工作目錄已實作且隔離測試完成；尚未正式部署 |
| 正式白名單／發布控制 | 既有scope gate已實作及測試；正式帳號／設定、實際權限與部署未核對 |
| 正式移轉及對帳工具 | 已有production-capable guard／計畫／分批工具並以Emulator驗證；未執行正式盤點／移轉，未補造歷史帳本 |
| Git定版 | 已本機建立release/weapon-refinement-compat-20261128，基底8dbae59e619cc5382853dfeb0e6397eccddd209a；大量未提交變更，尚非可部署的固定commit |
| 正式環境／完整Rules／索引READY | 本次未連線查證，不拿repository候選檔代替正式狀態 |
| 備份／隔離還原及正式資產對帳 | 舊日備份不能直接當本次版本最新證據；本次沒有正式執行或核准 |

本輪整體結論仍 **NO_GO，不能直接進正式部署／移轉／開放**。原因不只有被略過的實機驗收，還有未定版、正式環境及部署相容性待確認。審查程式的unknown=false屬未取得正式證據，並不表示已完成的本機功能都失敗；詳見分層表與現存報告。

## 已整理的部署範圍（僅供審查）

### 後端

第一組相容callable候選：`gameOpsFarmTransaction`、`gameOpsAdmin`、`gameOpsDailyChallenges`、`gameOpsRedeem`，屬`nexus-ops`。新增getFarmTransactionResult是既有FarmTransaction的action，不是另外一支Function。

目前callable程式定義兩區asia-east1＋asia-southeast1；不能只看預期台灣區就刪除新加坡區，舊分頁／其他入口可能仍使用。App Check沿原wrapper設定，未偷偷打開玩家驗證需求。

營運統計另有8支觀測器：gameOpsRefinementReceipt、gameOpsRefinementDailyStone、gameOpsRefinementGiftStone、gameOpsRefinementChestStone、gameOpsRefinementEconomy、gameOpsRefinementBattle、gameOpsRefinementState、gameOpsRefinementFarmSnapshot。它們處理提交後事件，即使玩家新功能關閉，也可能產生統計讀寫；須獨立核准範圍／成本，不能把部署4支callable當成完整營運統計已上線，也不自動部署整個codebase。

### 索引

和目前兩份repository索引檔比對，候選都缺：

1. ops_refinement_records：filterTokens CONTAINS＋createdAt DESC。
2. ops_refinement_farm_snapshots：date ASC＋occurredAt ASC。
3. boxes.openedAt的候選field override：保留collection ASC／DESC／CONTAINS，再加入collection-group ASC。

第三項的collection自動索引可能已在正式環境存在，本機差異不能視為正式需重建4個索引。正式讀回後採合併，不覆蓋未知field overrides，也不以整份候選檔替換正式全部索引。未建立／部署任何索引。

### 營運中心與玩家前端

營運中心是獨立Hosting target `nexus-game-admin`，過去使用者提供site ID為homebasedb；實際target綁定未核對。後端與必要索引先可用，再發布相容UI。

玩家網站先前設定GitHub Pages main／root，**推main可能立即更新正式玩家前端**。下個版本應先使用專用發布分支審查，不能把「備份到GitHub」當成無部署影響的main push。前端新恢復查詢需新版後端，順序不可顛倒。

## 仍須明確記錄的相容性限制

- 新PWA安全層對沒有Web Locks的瀏覽器採停止新操作，現有設計會要求更新瀏覽器；略過實機不代表此限制已實測或可保證不影響所有舊裝置。
- 共用物理inputProtocol1目前只有隔離fixture准入；正式入口沒有把測試參數設true。不能把正式精煉白名單writer當成新版物理協定已可正式發布的證據，也不可用testEnvironment=true繞過。
- 未准入舊戰鬥仍使用原aggregate協定，合規自動化／舊路徑風險與真正歷史PWAartifact仍需在正式發布範圍中明確決定。
- 若已取得精煉能力，暫停新增操作必須保留能力與舊箱獎勵，不能以倒退不相容版本或整庫舊備份覆蓋玩家新進度。

## 下一個具體動作

本輪已建立本機專用分支 `release/weapon-refinement-compat-20261128`，不改動main。接著整理本次相關變更，建立可審查的固定commit，再依GitHub推送授權送審；不要直接合併或推main。現有工作目錄仍有先前階段與測試文件變更，應依本輪changes清單挑選，不盲目stage所有檔案。

固定版本後，重跑與該版本相符的隔離驗證；之後另取得正式唯讀盤點／備份／相容版本部署的明確授權，再依B→C→D逐步操作。實機項目本輪維持略過，不再要求先裝mkcert。

## 本輪交付

`evidence/predeploy-review-2026-11-28/` 包含原審查工具結果、source hashes、修改清單、索引離線差異與待授權命令文字檔。命令文字不是可直接執行的發布腳本，沒有執行正式查詢、備份、部署或移轉。
