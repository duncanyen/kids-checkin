# 武器精煉相容版本：發布分支審查入口

> 2026-11-29 最新：使用者已在修正版 `e7e4fd5`、Node 22.23.4 的 Cloud Shell 環境完成完整 Emulator 合約 **9/9 通過**，證據為回傳的終端摘要。先前下載／Registry 阻擋為歷史狀態；其餘正式驗收與授權不因此解除。詳見 [Cloud Shell 完整驗收](cloudshell-full-acceptance.md)。


分支：`release/weapon-refinement-compat-20261128`。基底為Phase1盤點commit `8dbae59e619cc5382853dfeb0e6397eccddd209a`。本分支提交工作目錄中的Phase2～8與後續隔離修復，**供審查，不合併main、不部署、不執行正式資料操作**。

程式與測試集中在commit `fa74b6a`；文件及歷史證據為另一提交。原始log保持原樣，gitattributes僅把大量機器紀錄標為generated／不展開diff，未移除失敗紀錄或改寫通過結果。

## 審查範圍

- 武器個體與舊數量相容層、具scope／指紋／分批及續跑保護的移轉、資產對帳。
- 精煉／解除、成功成本與能力快照、原ID收據、精煉石與原獎勵整合、倉庫UI及戰鬥能力。
- 獨立營運中心的版本設定、權限、查詢、非同步統計及補算設計。
- 進場限制、共用運動／碰撞模型、inputProtocol1與後端合併輸入驗算；新物理准入仍僅隔離fixture，不能當成正式開放。
- PWA安全更新、同瀏覽器分頁操作權、唯讀原交易查詢與固定ID恢復。
- 獨立iPhone／Windows MemoryDB驗收站與可攜產包工具，不初始化正式SDK或讀寫正式資料。

## 證據及限制

- 最新719項單元測試通過；正式六項預設開關皆為false。
- 真正Firestore57項／13檔suite的來源hash重新核對符合。本證據只涵蓋本機Firestore與candidate Rules，不是正式Rules或完整Auth／Storage／Functions E2E。
- 前階段11組瀏覽器流程最終通過，另有獨立lab預檢；初跑失敗與時序紀錄一併保留於evidence，不把重跑通過說成從未失敗。
- Windows憑證／iPhone／Safari／行動網路由使用者明確要求本輪略過，記DEFERRED_BY_USER，未轉為PASS。
- 正式環境／索引READY／備份隔離還原／歷史資產對帳與舊PWA artifact未在本次取得新證據。部署審查仍NO_GO。
- 有一份不相關的`docs/NEXUS_PLATFORM_ADMIN_ASSESSMENT.md`保留在本機，未納入此分支提交。

## 建議閱讀順序

1. [最新部署前復核](predeploy-review-after-manual-skip.md)：本輪略過、Function範圍及索引差異。
2. [發布控制](release-control-report.md)、[移轉與對帳](migration-and-reconciliation-report.md)。
3. [共用物理協定](verified-input-report.md)、[PWA安全層](pwa-safety-report.md)。
4. Phase02～08報告與[evidence](evidence)。早期文件包含歷史阻擋，與後續修復分層閱讀。
5. [發布順序](release-plan.md)、[回復方案](rollback-runbook.md)：僅規劃，Step B～F未授權。

本分支推送不包含merge/main push、Firebase部署、索引發布、正式備份／移轉、旗標開放。使用者先前設定GitHub Pages由main/root發布，因此審查應留在此發布分支，避免main push影響正式玩家。

本輪後續修正與最新證據：[原交易重試與安全更新審查](release-branch-followup-review.md)。

最新多服務隔離驗收：[實際 Callable 整合結果](callable-emulator-integration-report.md)；核心 6 項通過，完整 RTDB／Storage 模式仍受官方下載 HTTP403 阻擋。草稿 PR 依使用者指示略過，不代表正式發布授權。

2026-11-29：[Full Emulator Registry 接線修正](full-emulator-registry-fix.md)；Cloud Shell 舊工具已觀察 7 項通過後在 Storage 中斷，新完整模式仍待重跑，不標為 9 項通過。
