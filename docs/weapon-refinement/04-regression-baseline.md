# 04－既有功能回歸測試基準

基準來源：`0233ffd632d82ac0cede326d508718ea3cdbe734`。執行日期：2026-11-27（台灣時間）。沒有變更正式功能、Rules 或正式資料。

> DEVELOPMENT_RULES.md 未提供／main 未找到，規範核對待補。此基準只代表指定來源與隔離測試範圍，**不是正式上線驗證報告**。

## 1. 環境與安全措施

- Node.js 實際版本與開始／結束 UTC 時間記在 `evidence/2026-11-27/baseline-summary.json`。
- Chromium `/usr/bin/chromium`、Phaser 3.60.0 本機 fixture、localhost Python HTTP server。
- 使用既有 `.test.cjs/.test.mjs`、Playwright、MemoryDB、真實 Phaser 及真實後端 service 邏輯；SDK／Auth 資料為測試 fixture，不是正式雲端。
- 瀏覽器額外 context fallback 阻擋非 localhost 出站；既有 page 專屬 SDK mock 路由仍優先。worker 只處理原本同源公開素材。未用任何正式使用者登入憑證。
- `prepare-game-admin/prepare-growth-forest` 只準備測試所需 ignored 封裝輸出；沒有修改 tracked 正式程式。完成後再次確認 tracked runtime 無 diff。
- 原始 runner 放 `/tmp`；提交的 `tests/weapon-refinement/phase1-baseline.cjs` 是相同命令矩陣的可攜化版本，來源路徑／輸出目錄改為可推導。guard 相同；可攜化版本另做語法檢查，不把它說成另跑過第二遍全部測試。

## 2. 本次結果摘要

- **469 項單元測試：469 通過、0 失敗。**
- **29 組主要瀏覽器程式／模式：全部 exit 0。** 準備程式另外 2 組通過，不混算成遊戲功能案例。
- **Emulator：BLOCKED，非通過。** Firestore JAR 下載 HTTP 403 `Domain forbidden`，四個實際 Emulator 檔案尚未執行，沒有把 MemoryDB 當成真實 Firestore Rules／並發驗證。
- 額外檢查舊 `farm-announcements-client-browser.cjs` 初始載入逾時，列為既存 fixture 相容性問題／未覆蓋，不改既有測試使它通過；診斷見第 5 節與 evidence。
- 圖鑑完整收集／里程碑系統：未實作，不標示通過。
- 正式手機、多實體裝置、正式索引／Rules、正式營運金幣資料：未測／未查。

## 3. 功能對照

| 要求 | 本次證據 | 判讀／限制 |
|---|---|---|
| 登入與玩家載入 | account-login、private-auth-browser、settings-profile-browser、private-admin-browser、farm-save-browser | 通過本機表單、私有橋接／恢復、資料載入與 SDK 錯誤情境；不代表正式帳號已驗收 |
| 村落首頁 | farm-private-backend-browser、visit_hud、navigation_load | 通過真實 Phaser 首頁／正常導覽、離場與原快取流程 |
| 收蛋／偷蛋／清潔 | farm-private-backend-browser、daily_group、單元交易測試 | 通過私有模式，客戶端 farm transaction 寫入一律拒絕；倉庫／任務隨原交易更新 |
| 購買／出售 | shop_stock、katana、場景／租犬模式、單元交易 | 通過數量、伺服器價格、庫存隱藏、出售分類與滿庫／裝備限制 |
| 武器取得／裝備切換 | 核心 private、katana、combat-v2 單元、chests | 通過現有堆疊模型；不是新個體模型已通過 |
| 所有武器／怪物 | combat-v2／combat-critical／combat-chain 單元；combat_feedback 九怪模式 | 純模型覆蓋八武器與合法／非法對象；瀏覽器九怪主要用大鐵槌／聖騎士弓，不聲稱每種武器實機手打每隻怪物 |
| 原有爆擊／連續爆擊 | critical_feedback、critical_zero、combat-critical／combat-chain | 通過指定機率與連段／批次一致；100%／0% 等是受控設定，不是正式機率抽樣統計 |
| 死亡／戰利品 | 核心 private、combat_feedback、hornet、單元 | 通過伺服器結算、原進度、命中即時顯示與單次發獎 |
| 寶箱取得／單箱／多箱 | chest_flow、chest_batch、chest-art-failure、chests 單元 | 通過真實入口、20箱上限、容量、逾時原收據、跨請求重播及失敗動畫降級 |
| 簽到／每日任務 | daily_group、daily-challenges／private-daily 單元、核心 private | 通過群組隔離、有效事件、發放一次與跨日邊界模型；不是實際等待台灣午夜 |
| 禮包兌換 | service.test.cjs 等單元；ops-management 停用／恢復驗證 | 後端名額、重播、容量、回滾與管理設定通過；玩家端完整現行私有模式兌換畫面尚無本次通過證據，舊 client 測試另列失敗 |
| 排行榜 | weekly_ranking、farm-ranking／ranking 單元 | 通過兩榜、週期／欄位、公開成員、同分及重整；不等於自動發週獎已存在 |
| 圖鑑 | 靜態 hud-ui 的 unavailable 入口 | 完整功能未實作；說明用武器／雞隻圖鑑不是里程碑發獎驗證 |
| 多裝置 | chests／farm transactions 並行請求單元；瀏覽器重播等 | 資料層／模擬並行通過；MemoryDB 不證明真正 Firestore contention。真實兩手機與 Emulator 並發仍缺 |
| 斷線／重連 | account-login、farm-save、核心、chest_batch、chest_flow | 模擬讀取／提交失敗、快取、逾時及同 ID 重試通過；沒有測真實行動網路切換或實機休眠 |
| PWA／舊版 | public-art-cache、daily-assets、legacy-price、導航與協定單元 | 通過目前快取與既有相容分支；還不存在新個體 schema 的舊 PWA 相容驗證 |
| 管理權限 | private-admin、ops-management、service／management 單元 | 通過現有權限、revision、停用與稽核；真實 Rules enforcement 仍因 Emulator 未跑而缺 |

## 4. 執行的主要矩陣

機器可讀清單、完整 arguments、exitCode、耗時與日誌雜湊見 evidence。單元是同一次既有 top-level 測試集合，不重複加總為多份成功。

| 程式／模式 | 結果 | 耗時（秒） |
|---|---|---:|
| `prepare-game-admin` | 通過 | 0.03 |
| `prepare-growth-forest` | 通過 | 0.03 |
| `units` | 通過 | 5.74 |
| `private-auth-browser` | 通過 | 1.73 |
| `settings-profile-browser` | 通過 | 1.65 |
| `account-login` | 通過 | 3.71 |
| `private-admin-browser` | 通過 | 1.71 |
| `farm-save-browser` | 通過 | 10.47 |
| `farm-public-art-cache-browser` | 通過 | 1.59 |
| `farm-daily-assets-browser` | 通過 | 1.69 |
| `ops-management` | 通過 | 7.68 |
| `farm-private-backend-browser` | 通過 | 32.82 |
| `chest_batch_tests` | 通過 | 18.77 |
| `shop_stock_tests` | 通過 | 14.72 |
| `countdown_tests` | 通過 | 116.38 |
| `combat_feedback_tests` | 通過 | 87.78 |
| `critical_feedback_tests` | 通過 | 80.80 |
| `critical_zero_tests` | 通過 | 90.80 |
| `hallstatt_scene_tests` | 通過 | 38.78 |
| `visit_hud_tests` | 通過 | 31.17 |
| `farm_scene_tests` | 通過 | 49.19 |
| `arctic_scene_tests` | 通過 | 36.46 |
| `navigation_load_tests` | 通過 | 25.55 |
| `guard_rental_tests` | 通過 | 22.86 |
| `weekly_ranking_tests` | 通過 | 11.35 |
| `daily_group_tests` | 通過 | 25.24 |
| `hornet_tests` | 通過 | 34.84 |
| `katana_tests` | 通過 | 36.58 |
| `encounter_config_tests` | 通過 | 19.18 |
| `chest_flow_tests` | 通過 | 63.70 |
| `chest-art-failure` | 通過 | 63.29 |
| `scene-legacy-price` | 通過 | 9.31 |

## 5. 既有問題、基準阻擋與未覆蓋

| ID | 分類 | 狀態及證據 | 處理方式 |
|---|---|---|---|
| BASE-01 | 環境阻擋 | Emulator 在下載 `cloud-firestore-emulator-v1.19.8.jar` 回 403；沒有跑到 Rules assertion | 在允許下載且隔離的環境重跑同一 demo project，不跳過 Rules 測試／不偽造 passed |
| BASE-02 | 舊自動化 fixture 不相容 | `tests/farm-announcements-client-browser.cjs` 等待 `window.__client` 30 秒逾時；其小型 HTTP server 只供應部分 JS，沒有跟上私有登入模組依賴 | 保留原檔，記錄診斷；下一階段可獨立修 fixture，或建立現行私有模式的禮包端到端測試。不據此宣稱正式兌換故障 |
| BASE-03 | 文件前提缺失 | DEVELOPMENT_RULES 未找到／待使用者提供 | 不填造、不宣稱核對完成 |
| BASE-04 | 正式環境證據缺失 | 未取得正式 Rules、Index READY、部署版本／IAM、實際弱網與實機 | 靜態規則、MemoryDB／SDK mock 不代表正式防護或實測延遲 |
| BASE-05 | 功能不存在 | 圖鑑完整收集／里程碑與精煉皆未實作 | 記未實作，不列為回歸失敗或既有 API |

額外測試的確切 console／錯誤及 log SHA 見 evidence 與原始日誌封包。本次沒有修正式邏輯，也沒有為了消除基準失敗去改舊測試。

## 6. 重跑方式（只限隔離測試）

已有 Node 22、Playwright、Chromium、sharp、Functions 測試依賴及 `/tmp/kids-phaser.js` 時：

```bash
node tests/weapon-refinement/phase1-baseline.cjs
```

可指定 `PHASE1_BASELINE_DIR` 保存結果；程式使用 localhost、既有 fixtures，分兩個 worker 執行。輸出外部目錄，不部署；新 runner 自己不新增任何遊戲 API。

Emulator 的獨立命令：

```bash
GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm \
GCLOUD_PROJECT=demo-nexus-private-farm \
NEXUS_PRIVATE_IDENTITY_ENABLED=true \
NEXUS_FARM_BACKEND_ENABLED=true \
firebase emulators:exec --non-interactive \
  --config firebase.private-farm-review.json \
  --project demo-nexus-private-farm \
  --only firestore,storage,database,auth,functions \
  'node --test --test-concurrency=1 game-admin/tests/private-farm-rules.emulator.cjs game-admin/tests/private-storage.emulator.cjs game-admin/tests/private-realtime.emulator.cjs game-admin/tests/private-callables.emulator.cjs'
```

不可以改成正式 project 測試。這裡的 isolated Auth／Functions／Firestore 是必要範圍，不執行 deploy、migration、backfill 或 formal rules write。

## 7. 下一階段測試計畫（未實作）

1. 補齊治理文件、真正 Emulator Rules／並發基準，保留現在的基準版本。
2. 補現行私有登入下「開啟禮包 UI → 兌換 → 成功回應遺失 → 原 ID 確認」；驗證原名額及帳號／群組語意。
3. 兩個瀏覽器 context／兩台實體手機對同把個體同時升級、解除、出售、裝備，檢查只有一次經濟變更。
4. 保留 V4 戰鬥 golden sequences；新協定固定小數、個體 revision 與批次切割測試不得改掉舊結果。
5. 移轉斷點、重跑、舊 PWA writer、跨群組、舊寶箱大量武器與容量預留，全部在匿名備份／demo 專案驗證。
6. 實機 iPhone／Android 低記憶體、離線／重連、背景恢復、快取 quota、長列表與觸控；不把 Chromium 尺寸模擬當實體裝置通過。

本階段結束時不發出「正式可上線」結論，僅建立後續比較基準。
