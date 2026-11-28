# 正式白名單與功能開關實作報告

日期：2026-11-28（台灣時間）。範圍：工作目錄實作、隔離驗證及發布準備；**尚未部署、尚未指定正式測試帳號，整體發布仍為 NO-GO**。

## 已完成的行為

1. 由可信任後端讀取明確的農場白名單 `{uid, groupId, accountId}`。`uid` 是現有公開 profile 文件 ID，不是 Firebase Auth UID；後端沿用既有私有登入解析，不信任玩家傳入的身分。相同農場在不同裝置取得同一版本與准入，其他群組的同帳號不會一起開放。
2. 正式入口不再需要 `testEnvironment=true`。新增伺服器參數 `NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED`，預設 false；原五個開關亦維持 false。主開關關閉或白名單未命中時，不准新精煉／解除／額外材料來源。未新增前端旗標覆寫入口。
3. 發布設定一次提交所有相依開關。精煉或解除開放必須同時具備 `instances` 與 `combat`；精煉石來源需要 `instances`。發布付費操作前，檢查實際農場已完成 V2 移轉、私有 owner active、generation、數量與裝備投影一致，以及對應能力／退款／材料設定已發布。
4. 暫停只阻止新的精煉與解除，可選擇同時停用新的精煉石來源。既得能力不依准入開關回收：後端仍從私有武器狀態建立戰鬥快照，不新增每次命中的 Firestore 查詢。
5. 已完成 V2 移轉者的正常購買、出售與換裝不因白名單移除或主開關關閉而被封鎖；仍驗證歸屬、revision、數量、裝備／鎖定及精煉出售警告。V1 玩家保持原路徑，不自動移轉。
6. 舊寶箱鎖定的精煉石規則不因停發新來源而消失。開啟時仍驗證原快照與內容雜湊、可信任後端狀態、歸屬及原交易冪等性；原有金幣／物品規則保持。

## 控制資料與安全界線

新增資料路徑（僅隔離測試建立過）：

| 路徑 | 用途 |
| --- | --- |
| `ops_refinement_release/current` | 目前配置、revision、version、contentHash、原因、操作者與時間 |
| `ops_refinement_release_versions/{version}` | 不覆寫的發布版本及前一份配置 |
| `ops_refinement_release_requests/{hash}` | 管理操作冪等收據 |
| `ops_audit/{release-version}` | 沿用稽核，記錄前後狀態 |

配置格式：

```json
{"schemaVersion":1,"flags":{"instances":false,"refinement":false,"combat":false,"reset":false,"stoneSources":false},"allowlist":[]}
```

白名單最多 100 個明確農場，拒絕重複 scope、未知欄位、非 boolean 開關與身分／成員不一致。使用已存在的 `users/{uid}`、`groups/{groupId}` 及農場 owner 資料驗證，並未新增身分資料權威來源。

新管理 API 沿用 `gameOpsAdmin`：

| action | 所需後端權限與輸入 |
| --- | --- |
| `refinementReleaseStatus` | `read`；回傳主開關狀態及配置 |
| `refinementPreviewRelease` | `read + publish + risk`；config、expectedRevision、reason、requestId |
| `refinementPublishRelease` | 同上；再帶同一份 confirmationHash 及 confirm=true |
| `refinementPauseRelease` | 同上；expectedRevision、reason、confirm=true、可選 pauseStoneSources |

服務重新讀取現有管理員 Auth 狀態及 claims，前端隱藏按鈕不構成授權。發布採 revision CAS，版本、pointer、收據與稽核同一原子交易；同 ID 同內容回原結果、異內容拒絕。白名單身分及預備條件也在該交易重驗，不直接修改玩家資產。

精煉及退款報價綁定 release version。暫停後重新開放仍需新報價。意圖保留後、正式扣款前重驗准入；FireStore 衝突重試不造成舊准入繼續扣款。已完成交易的原收據、查詢與重送仍可讀取，不因暫停造成重扣或重退。

配置格式／雜湊錯誤時，新的准入採關閉；原武器操作與既得能力不需要依賴這份配置。網路／Firestore 故障仍回報錯誤，不把服務故障偽裝成成功。

## 營運中心操作

位置：獨立營運中心 → 武器精煉 → **白名單與發布控制**。提供五開關、Profile／群組／帳號欄位、預覽、確認發布與緊急暫停，未加入玩家 App 管理入口。

日後經授權才可依序：確認不可變發布版本與完整移轉方案 → 部署相容程式（主開關關閉）→ 移轉指定測試農場並對帳 → 發布有效精煉／退款／材料設定 → 準備精確白名單 → 核對戰鬥相容性 → 另行授權主開關啟用與白名單發布。**本次未執行上述正式操作**。單純在營運中心保存配置不會繞過關閉的伺服器主開關。

使用者尚未提供正式測試農場的三個識別欄位，因此未猜測或寫入正式帳號。本機畫面中的帳號都是合成 fixture。

## 實際修改檔案

本次新增：

- `game-admin/functions/refinement-release.cjs`：准入／發布／暫停與稽核。
- `game-admin/tests/helpers/release-fixture.cjs`、`refinement-release.test.cjs`、`refinement-release.emulator.cjs`、`refinement-release.browser.cjs`。
- `tests/helpers/refinement-release-player.cjs`：既有倉庫入口的正式准入分支驗證。
- 本報告及 `evidence/release-control-2026-11-28/`。

本次在前階段工作目錄檔案上調整：

- `game-admin/functions/index.cjs`、`weapon-instance-config.cjs`、`service.cjs`：伺服器參數與交易／管理接線。
- `refinement-service.cjs`、`refinement-player-service.cjs`：可信任准入、報價版本、暫停收據與 UI 能力。
- `weapon-repository.cjs`、`farm-transactions.cjs`：既有 V2 正常操作不依賴新准入。
- `refinement-stone-rewards.cjs`、`daily-challenges.cjs`、`chests.cjs`：按農場判定新來源、保留舊快照。
- `game-admin/site/refinement.js`：獨立管理控制頁。
- `game-admin/tests/refinement-stone-rewards.test.cjs`、`weapon-instances.test.cjs`、`tests/weapon-refinement/migration-rehearsal.cjs`：維護期保留既有權益的回歸期望。
- `tests/farm-private-backend-browser.cjs`：隔離 fixture 與玩家入口測試分支。
- `scripts/run-refinement-firestore-tests.cjs`、`scripts/lib/firestore-emulator-proof.cjs`、`scripts/weapon-release-review.cjs`：加入新真實交易套件與證據驗證。
- `DEVELOPMENT_RULES.md`、`operations-guide.md`：當次授權範圍與操作指南補充。

整個工作目錄另包含先前 Phase 2～8 尚未提交的檔案；本次不將全部 dirty diff 宣稱為新增修改，也未覆寫其他平台分析文件。

## 驗證與證據

- 全量單元測試：**651 / 651** 通過；新增發布控制 17 項。
- 官方 Firestore 1.19.8、Java 21、`demo-nexus-private-farm`、`127.0.0.1:8092`：**8 檔、30 項真實 Transaction／候選 Rules 測試通過**，不是 MemoryDB。涵蓋並行同 ID、暫停／扣款競態、白名單移除／主開關停用、V2 買賣換裝與舊箱並行開啟；一般前端不能讀寫發布控制文件。
- 獨立營運中心實際導航與手機 390×844：預覽、發布、暫停、唯讀狀態通過。透過隔離服務與管理 fixture 接線，並未連正式 Firebase。
- 玩家從遊戲倉庫／武器入口開啟：`testEnvironment=false`、`testAccount=false`，精煉一次至 +1、暫停後入口關閉但攻擊力 206 保留；無重複請求與 pageerror。
- 既有 29 組瀏覽器：初跑 26 通過、3 失敗（怪物頭頂血條座標斷言與等待逾時）；三項獨立循序重跑均通過。沒有放寬斷言或更改正式戰鬥來達成重跑，仍保留時序不穩風險與初跑失敗紀錄。結果彙整另存 `validation-summary.json`。
- 手機圖：`player-release-plus1.png`、`player-release-paused.png`；管理圖：`release-mobile.png`、`release-paused.png`。它們是實際入口的隔離測試圖，非正式玩家畫面。

可本機重跑（不接正式服務）：

```bash
node --test game-admin/tests/refinement-release.test.cjs
node scripts/run-refinement-firestore-tests.cjs --output /tmp/nexus-release-check
node game-admin/tests/refinement-release.browser.cjs
```

後兩者需本機既有 Chromium、Playwright、官方 Emulator 與 Java 環境；玩家入口測試另需本機 HTTP server、PHASER_FIXTURE 與 browser guard，完整測試啟動紀錄隨證據保存。

## 成本、效能與回復

主開關關閉時，玩家新准入不讀發布 pointer。開啟後每個相關交易嘗試讀一份 pointer，交易內讀取快取避免同文件重複讀；沒有全服監聽、沒有每次攻擊的新白名單查詢。新報價仍有原有私有武器／參數驗證成本，重試增加讀取是必要一致性成本。

發布是管理端低頻操作：每 scope 最多驗證四份文件（profile、group、farm、owner），再加 pointer／收據／參數版本等固定讀取；正式發布四次文件寫入。這是操作量估算，不冒充正式帳單或延遲實測。新增路徑使用單文件 ID 查詢，不需新增查詢索引。

緊急處理優先用「暫停新精煉與解除」，必要時勾停新材料；保留 combat 與既有武器資料。即使主開關關閉，私有能力仍解析、舊箱仍按原快照開啟。不刪武器、不整批還原備份、不回退到不相容 V1 程式。回復開放建立新版本，先重新預覽；舊報價不復活。

## 尚未解除的發布阻擋

正式測試 scope 與權限尚待確認；正式移轉 adapter、真實資產歷史對帳、已部署 Rules／索引與 Auth／Storage／Functions 全套證據、舊 PWA 實機／網路相容、戰鬥反作弊及正式成本仍需逐項驗收。此次解決的是可上線架構的白名單與准入控制缺口，並不代表授權或已完成 Step B～F。

Git 基準 HEAD：`8dbae59e619cc5382853dfeb0e6397eccddd209a`；交付為未提交的工作目錄變更，**沒有新的 commit hash、沒有推送**。
