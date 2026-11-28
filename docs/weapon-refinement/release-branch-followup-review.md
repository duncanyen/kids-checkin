# 發布分支後續審查：原交易重試與安全更新

日期：2026-11-28。審查起點：`c47bd8364fd2768dee009f87a1bd9d50d7b9f08c`，分支 `release/weapon-refinement-compat-20261128`。

## 本輪發現及修正

**RECOVERY-01，中等風險，已修正：** `js/farm/safety-runtime.js` 的 `retryOriginal()` 沒有將重試錯誤交給既有 `notify()`。當未知結果的原請求遇到後端協定更新，或頁面已被其他裝置取代時，畫面停在「交易結果確認中」，沒有更新／重新進入入口。一般命令已有此處理，原交易重試卻遺漏。

新增測試先於原程式重現：預期「遊戲需要更新」，實際仍為「交易結果確認中」。修正僅將錯誤導向共用安全介面並繼續向呼叫端回報；保留原交易 ID、payload 及日誌，不把拒絕或未知結果當成未扣款，也不自動生成新交易。真正成功回覆的既有移除日誌與重新載入流程不變。

本輪修改：

- `js/farm/safety-runtime.js`：原交易重試共用更新／失效頁面處理。
- `tests/farm-safety.test.mjs`：更新要求與失效頁面兩種重現，確認原 ID 保留、新寫入仍被阻擋。
- `tests/weapon-refinement/pwa-safety-browser.cjs`：真實 Chromium 點擊「以原請求重試」，模擬版本拒絕，確認更新介面、原 ID、日誌、金幣餘額。

## 測試證據

本輪結果與原始紀錄見 `evidence/release-followup-2026-11-28/`。單元測試 710/710 通過；PWA Chromium 隔離流程通過，包含原流程及新增的重試更新情境。瀏覽器使用真實 UI／service 與 MemoryDB，不是正式 Firebase 或 iPhone Safari；320×568 截圖為 `browser/retry-update-320.png`。

真正 Firestore／candidate Rules 57/57 項、13 組測試全數通過，來源雜湊核對符合。證據另存於同目錄 `firestore/summary.json`；以驗證工具實際核對，不能沿用修改前來源的通過證據。本輪不擴大宣稱為完整 Auth／Storage／Functions Emulator E2E。

## 審查範圍與限制

本輪聚焦交易恢復及更新／失效頁面分支，並閱讀解除精煉收據、退款計算與分頁協調路徑；不等同完成整個大型發布分支的獨立資安審查。保留先前移轉、退款、戰鬥驗算等隔離測試證據，不藉此修正解除其他正式發布阻擋。

GitHub API 在目前環境被網路政策拒絕；未成功建立 Draft PR。發布分支可供審查，`PR_DRAFT.md` 是說明文件，不能當成 PR 已存在的證據。

正式發布仍為 **NO_GO**。Windows／iPhone／Safari 實機為使用者要求略過的 `DEFERRED_BY_USER`，不是通過。本輪沒有合併 main、部署、操作正式資料或開啟正式旗標；無關平台管理評估文件不納入提交。
