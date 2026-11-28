# Full Emulator：Storage → Firestore Registry 接線修正

> 2026-11-29 最新：使用者已在修正版 `e7e4fd5`、Node 22.23.4 的 Cloud Shell 環境完成完整 Emulator 合約 **9/9 通過**，證據為回傳的終端摘要。先前下載／Registry 阻擋為歷史狀態；其餘正式驗收與授權不因此解除。詳見 [Cloud Shell 完整驗收](cloudshell-full-acceptance.md)。


日期：2026-11-29（台灣時間）。修正前來源：`dc0f85a`。本輪僅修改隔離驗收 runner／測試，沒有修改遊戲、候選 Rules、正式開關或正式資料。

## 使用者 Cloud Shell 日誌與診斷更正

使用者提供的舊版完整模式日誌已有 `ok 1` 至 `ok 7`：實際 HTTP 合約 1 項、Firestore Rules 5 項、RTDB Rules 1 項。接著到 Storage 準備／請求階段，CLI 以 `exitCode: 2` 中斷，沒有輸出最後 TAP summary。

因此舊報告的 `tests:0/pass:0` 代表缺少最終統計，**不能解讀為一項也未執行**；先前僅依摘要做的說明在此更正。7 項已觀察通過也不等於完整 9 項通過。這是使用者提供的部分日誌，不是本機重跑成功。

日誌中的預期 `PERMISSION_DENIED` 均接著對應 `ok`，是 assertFails 的安全驗證，不能為了消除日誌而放寬 Rules。

## 已確認的工具相依缺口

舊 runner 在 `--full` 仍自行啟動 SDK Firestore，只要求 CLI 啟動 Auth／Functions／Storage／RTDB。SDK 雖可用 `FIRESTORE_EMULATOR_HOST` 直連，卻沒有註冊到 CLI 進程內的 Emulator Registry。

Firebase CLI 14.18.0 的 `lib/emulator/storage/rules/runtime.js`，`fetchFirestoreDocument()` 於 try 外呼叫 `EmulatorRegistry.client(FIRESTORE)`；`registry.js` 的 `url()` 在找不到 instance 時拋出 `Cannot determine host and port of firestore`。本機以同版實際 Registry 重現此缺失。Storage 規則使用 `firestore.get()`，因此外部 Firestore 模式不能滿足完整跨服務驗收。使用者提供的節錄未含 firebase-debug.log 的完整 stack，不能把本機重現說成已取得遠端 stack。

## 修正

- 完整模式由 **同一 Firebase CLI 管理五個服務**，Firestore 納入 config 與 `--only`，避免另起第二個 8092 server。
- 完整模式使用 CLI 原生官方 Firestore JAR，核心模式保留已驗證的官方 SDK Firestore。兩種分發的 JAR 雜湊不同，不互相改名冒用。
- 完整模式核對 Firestore／RTDB／Storage 三個快取 JAR 的 SHA256，依安裝 CLI 自帶的官方 metadata 判定；缺檔或不符不得通過。
- 核心模式仍 6 項；完整模式仍需 9 項、CLI exit 0、完整 TAP footer、無 fail/cancel/skip、來源未漂移及套件驗證符合。
- 中途失敗時增加 `observedPass`／`observedFail`／`summaryPresent`，不補造最終 tests/pass 或把部分結果變成 PASS。
- Node 22 前置檢查、可指定 `NEXUS_FIREBASE_TOOLS_DIR`；找不到 CLI 提早報錯。準備生成檔移到來源 hash 擷取之前，修正全新 checkout 首次執行的假漂移。
- 保留並匯出 CLI 管理的 Firestore／Database 日誌；既有失敗結果不覆寫。

完整模式會註冊原有背景觸發器，這與核心模式不同。9 項合約並未逐支驗收所有統計觀測器；不宣稱營運統計、實機或 App Check 已完整驗收。

## 驗證

- 全部單元測試 **719/719 通過**，其中 runner 9 項含完整模式 Registry 接線、部分 TAP、Node 版本及套件完整性。
- 核心 Auth／Functions／官方 Firestore／候選 Rules **6/6 通過**，來源 hash 未漂移。使用直接安裝的 `node-linux-x64@22.23.4` 啟動，並指定 CLI 安裝目錄，覆蓋使用者前次 Node 26 路徑問題的修正方式。
- 本機仍無 `storage.googleapis.com` 網路 grant；**修正後完整 9 項尚待 Cloud Shell 重跑**，不能將上述單元／核心測試當成全套通過。

證據：`evidence/full-registry-fix-2026-11-29/`。未複製使用者整份附檔或憑證到 Git，只保存部分日誌的計數診斷與本機驗證。

## Cloud Shell 續跑

在使用者原先獨立目錄 `gugu-full-review.2FKOds/source`，fetch 本輪修正 commit 並 detached checkout；若有本機 tracked 變更，Git 應正常拒絕，不用 reset/force 清掉資料。沿用現有 tools 與 dependencies，啟動直接安裝的 Node 22 平台套件、指定 tools 目錄後，以新的 output 目錄執行 `--full`。

不用部署、不設定正式專案、不重開玩家旗標、不改正式 Rules。完整結果仍須 `passed:true`、9 項全通過且三項 `artifacts[].verified:true`。目前正式發布結論維持 **NO_GO**。
