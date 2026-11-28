# 略過 Draft PR 後：實際 Callable 與多服務隔離驗收

日期：2026-11-28（台灣時間）。來源起點：`4fba7c2905c4c36e3f2973845adcc4ef27bf43a2`，發布分支 `release/weapon-refinement-compat-20261128`。

使用者要求略過草稿 PR 並繼續下一個動作。本輪補做實際 HTTP 合約測試與可重跑工具；略過 PR 不代表合併 main、正式部署、讀取正式玩家資料、備份、移轉或開啟功能已獲授權。

## 結論

- **Auth＋Functions＋官方 Firestore／候選 Firestore Rules：6/6 通過。** 不是 MemoryDB，也不是直接呼叫 service 的假登入測試。
- 完整單元測試 **715/715 通過**，新增 5 項 runner 安全檢查。
- `--full` 的 RTDB／Storage 整合 **BLOCKED**。Firebase CLI 在下載 RTDB 4.11.2 時收到環境代理 HTTP 403，尚未執行任何測試；Storage 官方下載來源的 CONNECT 同樣回 403。不能將零項測試或 CLI 正常停止當成通過。
- 前一輪 57 項 Firestore 交易／Rules 的來源 proof 仍符合；本輪沒有重跑該 13 組，也不把它們冒充完整 Auth／Storage／Functions E2E。
- 正式發布依然 **NO_GO**。新功能正式預設皆關閉，沒有部署、操作正式資料或合併 main。

## 1. 本輪真正驗證的流程

`game-admin/tests/private-callables.emulator.cjs` 的 1 項長合約案例包含真實 Auth custom-token 換證、群組限定身分、實際 Functions HTTP 入口、Firestore 原子交易、收蛋及交易重送、每日簽到、寶箱單開／批次開啟競態、武器使用限制、虎頭蜂戰鬥與結算、相關排行榜事件、同帳號不同群組隔離，以及改密碼後舊憑證失效。

另 5 項 `private-farm-rules.emulator.cjs` 使用官方客戶端／rules-unit-testing，驗證匿名／偽造身分、撤銷版本、權威資產欄位、群組與 ops namespace、私有／公開農場及寶箱設定存取限制。候選 Rules 載入本機 SDK Firestore，不是正式已發布 Rules。

上述 6 項不是「每個遊戲動作各 1 項」；合約案例內有多次實際 HTTP 請求。它也**不代表新精煉管理／精煉交易全部已經由真實 Auth HTTP 逐項驗收**。本輪精煉發布主開關維持 false，相關核心與准入的真實 Firestore 證據沿用既有 57 項。

App Check 沿現有 wrapper 設定；不能由本輪標記 MISSING 而仍被允許的請求推論 App Check 強制驗證已測。背景 Firestore triggers 因 CLI 未接管外部啟動的 Firestore 而不註冊，統計觀測器與鏡像不在本輪覆蓋範圍。

## 2. 發現的舊測試問題與修正

初次 HTTP 合約失敗於虎頭蜂近戰限制 assertion：預期「此武器無法攻擊怪物」，實際收到「怪物進場中，抵達後才能攻擊；此次攻擊未計入」。

原因：舊 fixture 只改 `startedAt`，沒有同步處理後來新增的權威 `approachEndsAt`。後端正確阻擋尚未進場完成的攻擊，屬測試準備不再符合目前協定，不是放寬遊戲安全檢查的理由。

修正僅在測試檔：

1. 先用實際 Callable 證明進場前遠程攻擊遭拒，HP 與已接受攻擊次數不變。
2. 透過 demo Admin SDK 將該假戰鬥的 `startedAt`、`approachEndsAt` 設為已進場，繼續驗證近戰禁用、舊封包拒絕、命中索引、傷害與重送／結算防重。

未調整正式怪物進場時間、HP、武器傷害、攻速或伺服器驗證。

## 3. 可重跑工具與防誤用

新增 `scripts/run-refinement-callable-tests.cjs`：

- 固定 `demo-nexus-private-farm` 與 localhost；繼承非 demo 專案時拒絕，沒有 project／deploy／apply 選項。
- 檢查相關連接埠；不終止現有服務，不覆寫非空證據目錄。
- 使用已核對 SHA256 的官方 SDK Firestore 1.19.8，以原 main class 啟動，沒有改 JAR、Firebase 下載 metadata、proxy 或 TLS。
- 將兩個 Functions source 複製到臨時目錄；只在副本建立 `.env.local` 測試參數，不在原專案寫入環境檔。精煉發布控制仍 false。
- 丟棄繼承的憑證／token／SDK 專案設定及 Node preload；SDK 端點固定本機，metadata discovery 停用。
- HTTP 測試經 Firebase CLI 的 Auth／Functions Emulator，Firestore 使用本工具自己的官方程序。未啟動的 RTDB／Storage 也只指向本機端點。
- `--non-interactive` 避免參數提示被誤認為正在測試；必須取得指定數量的 TAP 通過結果，CLI exit 0 不足以通過。中止在提示畫面的歷史嘗試為 0 項，未計入成功。
- 保存來源與測試 hash、原始日誌及結果；成功後再次核對來源未變，停止自己啟動的程序並清掉臨時副本。

Linux／Cloud Shell 使用方式（在已取得本發布分支且安裝原 Functions／測試依賴的隔離 checkout；需 Node 22、Java 21、本機 firebase-tools、curl、tar）：

```bash
# 核心 HTTP＋Firestore Rules，6 項
node scripts/run-refinement-callable-tests.cjs \
  --output /tmp/nexus-callable-core-$(date +%s)

# 完整多服務合約，9 項；官方 Emulator 下載來源必須可用
node scripts/run-refinement-callable-tests.cjs --full \
  --output /tmp/nexus-callable-full-$(date +%s)
```

兩種模式都不部署，也不使用正式資料。`--full` 不會把核心模式通過當成完整通過。官方下載若遭網路政策拒絕，應在允許該官方來源的測試環境執行，不繞過限制。

## 4. 修改檔案與證據

- `game-admin/tests/private-callables.emulator.cjs`：補進場拒絕及正確 fixture。
- `scripts/run-refinement-callable-tests.cjs`：可重跑隔離 runner。
- `tests/refinement-callable-runner.test.cjs`：正式專案拒絕、端點與憑證隔離、零測試拒絕、選項與完整模式數量驗證。
- 本報告、審查入口／PR 文字與測試證據。

原始證據：`evidence/callable-contract-2026-11-28/`；`core/summary.json` 為 6 項通過及來源未漂移，`full/summary.json` 為失敗且 0 項、日誌保留下載 403。舊 fixture 的 assertion 失敗以上文實際訊息記錄，沒有重建或偽造遺失的完整失敗日誌。

## 5. 下一步與正式邊界

下一項隔離驗收是讓 `--full` 在可下載官方 RTDB／Storage Emulator 的環境完成 9 項合約；其次補新精煉／管理 API 的真實 Auth HTTP 路徑與背景觀測器整合。這些尚未完成，不可宣稱整套上線驗收通過。

正式環境仍需明確授權後才能唯讀核對專案／兩區 Functions、已發布 Rules、索引 READY、Hosting target 及發布設定。正式備份／隔離還原、玩家資產對帳、部署與移轉各自遵守 Step B～F 的授權邊界。Windows／iPhone／Safari 實機維持 `DEFERRED_BY_USER`，本輪不再要求使用者先做實機設定，也不將其標成 PASS。
