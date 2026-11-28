# Cloud Shell 完整 Emulator 合約驗收結果

> 2026-11-29 新增：新精煉／解除與營運 API 的真實 Auth HTTP 驗收 **27/27** 通過（新增21情境），單元725項、Firestore57項通過且來源proof符合。詳見 [HTTP驗收](refinement-http-acceptance.md) 與 [更新後發布前審查](predeploy-review-refinement-http.md)。正式發布仍NO_GO，沒有部署或操作正式資料。


登錄日期：2026-11-29（台灣時間）。本次由使用者在自己的獨立 Cloud Shell 目錄執行，非代理在本機重跑。

## 結果：9/9 通過

使用者回傳確認：

- checkout：`e7e4fd5808268441b0b5453e85f0626f84bc7c83`。
- Node：`v22.23.4`。
- 輸出目錄名稱：`results-fixed-1795899338`。
- `passed:true`，9 項測試全通過，fail／cancelled／skipped 為 0。
- `summaryPresent:true`、`observedPass:9`、`observedFail:0`、`exitCode:0`。

這解除本次既有 HTTP／候選 Rules 多服務合約驗收的下載與 Registry 接線阻擋。舊版本 403、Node 26 路徑問題、7 項後中斷，以及當時摘要 0 的原始證據仍保留，不修改成成功紀錄。

## 覆蓋與證據界線

測試為既有 `private-callables` 1 項整合案例、Firestore Rules 5 項、RTDB Rules 1 項及 Storage Rules 2 項，合計 9 項；在完整模式中，五個 Emulator 由同一 Firebase CLI 管理。成功代表這些合約已完成，不是「只有服務啟動成功」。

原始 console 的結構化轉錄存於 [reported-result.json](evidence/cloudshell-full-2026-11-29/reported-result.json)。本輪收到的是終端摘要，尚未收到完整 `summary.json`、原始成功日誌、source hash 及 artifact hash；因此不宣稱代理獨立核對過遠端檔案。依該版 runner 程式，`passed:true` 必須同時符合測試、來源未漂移及三個原生 Emulator 套件雜湊條件，但這與另行稽核原始證據不同。

## 更新後的驗收狀態

| 項目 | 狀態 |
| --- | --- |
| 本機單元測試 | 719/719，既有本機證據 |
| 本機真實 Firestore／候選 Rules | 57/57，既有來源 proof |
| 本機 Auth＋Functions＋SDK Firestore 核心合約 | 6/6，既有本機證據 |
| Cloud Shell 完整 Auth／Functions／Firestore／RTDB／Storage 合約 | **9/9，使用者回傳摘要** |
| 新精煉／管理 API 全部真實 Auth HTTP 路徑、各統計觀測器 | 尚未因本次 9 項而取得完整驗收 |
| Windows／iPhone／Safari 實機 | DEFERRED_BY_USER，不改為通過 |
| 正式專案、Rules release、索引 READY、Hosting target 等查證 | 尚未正式執行／核對 |
| 正式備份／隔離還原、資產對帳、移轉及部署 | 尚未執行，需個別明確授權 |

## 下一步

重整 Step A 的剩餘條件，優先完成新精煉／管理 API 真實 Auth HTTP 權限與交易恢復，以及背景統計整合的隔離驗收；不能以既有 9 項取代新功能尚未覆蓋的路徑。正式環境唯讀盤點、備份／還原、Step B～F 仍遵守原授權界線。

**整體正式發布維持 NO_GO；完整 Emulator 合約這一項已通過。** 本次只登錄證據與更新文件，不改遊戲、Rules、功能開關，不部署、不讀寫正式玩家資料、不合併 main。草稿 PR 沿用使用者指示略過。
