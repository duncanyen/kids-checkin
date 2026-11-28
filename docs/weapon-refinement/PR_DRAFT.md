# feat: stage weapon refinement, verified combat and PWA recovery

> 2026-11-29 最新：使用者已在修正版 `e7e4fd5`、Node 22.23.4 的 Cloud Shell 環境完成完整 Emulator 合約 **9/9 通過**，證據為回傳的終端摘要。先前下載／Registry 阻擋為歷史狀態；其餘正式驗收與授權不因此解除。詳見 [Cloud Shell 完整驗收](cloudshell-full-acceptance.md)。


原武器按數量堆疊，無法獨立保存精煉等級、能力與歷史投入；舊戰鬥的aggregate命中回報與跨頁交易恢復也有驗證缺口。本變更新增受控的武器養成、交易驗算與用戶端恢復層，供發布前審查。

## 變更範圍

- 武器個體與舊資料相容層、具scope／指紋／分批續跑的移轉及資產對帳。
- 精煉／解除原子交易、原ID收據、能力與成本快照、精煉石獎勵、倉庫UI、獨立營運中心版本及統計。
- 進場攻擊限制、共用運動／碰撞模型、合併輸入與後端命中驗算；inputProtocol1仍僅在隔離fixture准入。
- PWA更新遮罩、同瀏覽器分頁交棒及原經濟交易查詢／恢復，另附獨立MemoryDB手機驗收工具。

## 驗證

- 719項單元測試通過。
- 57項真正Firestore／candidate Rules測試、13個suite，來源hash符合；不是正式Rules或完整Auth／Storage／Functions E2E。
- 前階段11組瀏覽器流程最終通過，另有獨立lab預檢；初跑失敗及時序紀錄保留。
- Windows／iPhone／Safari實機及行動網路依使用者要求DEFERRED_BY_USER，未標成PASS。

## 發布狀態與審查重點

所有正式新功能預設關閉。未合併main、未部署、未操作正式資料，目前NO_GO。這是草稿審查，不是正式發布授權。

請特別檢查移轉與收據防重、舊版／新schema相容、戰鬥快照與合法輸入的殘餘風險，以及PWA安全層對缺少Web Locks的瀏覽器行為。正式索引READY、備份隔離還原、歷史資產對帳及真實舊PWA artifact仍待核對。8支統計觀測器須另確認成本及部署範圍，不能以玩家旗標關閉推定無讀寫成本。

程式與測試集中於 `fa74b6a`，文件與歷史證據於 `58fe8e0`。大量機器log保持原樣並標為generated，方便聚焦程式diff；無關的平台管理評估文件未納入。

審查入口：`docs/weapon-refinement/RELEASE_REVIEW.md`。
最新復核：`docs/weapon-refinement/predeploy-review-after-manual-skip.md`。

本輪後續修正與最新證據：[原交易重試與安全更新審查](release-branch-followup-review.md)。

最新多服務隔離驗收：[實際 Callable 整合結果](callable-emulator-integration-report.md)；核心 6 項通過，完整 RTDB／Storage 模式仍受官方下載 HTTP403 阻擋。草稿 PR 依使用者指示略過，不代表正式發布授權。

2026-11-29：[Full Emulator Registry 接線修正](full-emulator-registry-fix.md)；Cloud Shell 舊工具已觀察 7 項通過後在 Storage 中斷，新完整模式仍待重跑，不標為 9 項通過。
