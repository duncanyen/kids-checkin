# 精煉／解除與營運中心：真實 Auth HTTP 驗收

日期：2026-11-29（台灣時間）。本輪來源基底為 `2fcd3bd`，實際測試版本以隨附 source／test SHA256 及發布分支提交為準。只使用 localhost `demo-nexus-private-farm`，沒有部署或操作正式資料。

## 結果

| 驗證 | 結果與範圍 |
| --- | --- |
| 完整單元測試 | **725/725**，沒有 fail／cancel／skip |
| 真實 Auth → Functions HTTP → Firestore | **27/27**＝既有核心 6 項＋新增 API 21 項 |
| 真實 Firestore 交易／候選 Rules | **57/57**、13 組，重新執行且來源 proof 符合 |
| API 收據／資源帳本 | 本輪 **8 筆收據、8 筆帳本**，逐筆金幣／材料變更相符，無重複或負餘額 |
| Cloud Shell 原有五服務完整合約 | 沿用使用者回傳的 `e7e4fd5` **9/9**；不是本輪代理重新執行 |

新增 API 透過實際 Auth Emulator 換證、Firebase v2 callable HTTP 與真實 Firestore 執行，沒有偽造 `request.auth`、替換 `auth.getUser`，也沒有在測試中直接呼叫交易／營運 handler。測試 setup 的 Admin SDK 僅用於建立假玩家、初始資產／移轉、Auth 權限及明確的隔離 fixture。

本輪記錄 145 次業務 Callable HTTP 請求，另有 Auth REST／SDK 操作；這不是 Firestore 讀取次數，也不能推論正式雲端延遲或手機網路效能。

## 核心覆蓋

- 真實 Nexus 登入／群組換證；匿名、無效 Token、不同玩家武器與同帳號其他群組拒絕。改密碼後舊 Token 在新精煉讀取／預覽／結果端點失效。
- 營運中心 read／edit／publish／risk 權限；JWT 尚持舊權限但 Auth 使用者已撤權或停用時仍拒絕。前端傳入角色欄位不能升權。
- 草稿、非法負數／機率／能力上限／遞減設定、影響預覽、明確發布、版本失效、不可覆寫的歷史與建立新版本的回復。
- 兩次獨立登入的 HTTP 客戶端使用相同交易 ID 僅扣款一次；不同 ID 競爭同把武器、精煉對出售、精煉對解除只提交一筆合法變更。
- 成功／失敗扣款與能力保留；缺資源、竄改成本／機率、重用 ID 改請求內容、戰鬥衝突均拒絕而不錯扣。
- 解除預覽不退款；同筆解除並發僅退款一次；+0 不重退；失敗投入不退；退款使用歷史實際成功成本及當次有效比例，不以新費用回推。
- 新費用／退款版本讓舊報價失效；緊急暫停新精煉／解除後，已得能力、正常換裝及原交易查詢仍可使用。
- 交易清單 25＋1 分頁、最多 200 筆掃描、游標不可跨篩選條件；統計補算冪等，稽核與實際收據相符；分批快照與完成後重送結果一致，唯讀角色不能啟動工作。

已實際呼叫 `refinement-operations.cjs` 的全部 12 種 action、4 種發布控制、3 種唯讀設定及3種已停用舊發布路徑，合計 22 種營運 action。舊直接發布路徑預期拒絕，不能繞過草稿流程。玩家精煉／解除的全部 9 種 action，以及共用原交易恢復 action 也涵蓋於測試。

## 逾時、抽樣與對帳方法

逾時案例使用本機 HTTP relay：後端確實提交成功後，relay 刻意不回覆客戶端，再觸發客戶端 TimeoutError。之後由原交易 ID 查詢並重送，確認同一收據與餘額，沒有新扣款；不是只測「找得到一筆既有資料」，也不是正式網路效能測試。

失敗恢復案例在私有 demo 資料準備已保留的 `rollBp:9999` pending intent，模擬伺服器保留抽樣後中斷，再用實際 HTTP 恢復；驗證抽樣不變、失敗消耗一次、等級／能力不下降。正常成功請求仍由未修改的可信任服務抽樣。本輪沒有向 callable 暴露 RNG 測試參數。

分頁與快照查詢另用不同日期的非經濟分析 fixture，不冒充真實玩家分布或經濟交易。每日統計對帳使用本輪實際 HTTP 提交的收據。逐筆匯出的 wallet audit 再由獨立 proof checker 核對 owner／transactionId、動作、金額、唯一性、前後差額及安全整數；競態勝者可能不同，因此其他重跑的有效收據數不必固定為 8。

## 程式及重跑

- `game-admin/tests/refinement-http.emulator.cjs`：21 組真實 HTTP／Auth 驗收，含受控斷回覆及收據帳本證據。
- `game-admin/tests/helpers/refinement-http-spec.cjs`：預期案例數。
- `scripts/run-refinement-callable-tests.cjs`：新增 `--refinement`；只在臨時 Functions 副本設測試發布主開關，並經真實營運 API 發布假農場白名單。未指定模式時維持原本關閉。
- `scripts/lib/refinement-http-proof.cjs` 與測試：拒絕 mock、缺少案例、來源漂移、錯誤專案／帳本等證據；不是數位簽章或正式發布核准。
- `scripts/weapon-release-review.cjs`：發布前審查讀取並驗證本輪 HTTP 與 Firestore proof，另外呈現已通過的新 API 驗收。

```bash
# Node 22、原專案依賴及 firebase-tools 已安裝；僅本機 demo
node scripts/run-refinement-callable-tests.cjs --refinement \
  --output /tmp/nexus-refinement-http-$(date +%s)
# 27 項＝核心6＋新API21；本次實際執行並通過。

# 可組合完整五服務，預期30項；本輪環境不能下載官方原生JAR，未執行此組合。
node scripts/run-refinement-callable-tests.cjs --full --refinement \
  --output /tmp/nexus-refinement-full-$(date +%s)
```

若 CLI 安裝在獨立 tools 目錄，可設定 `NEXUS_FIREBASE_TOOLS_DIR`。仍需 Node 22；不接受正式 project／deploy／apply 選項。

## 初跑問題與保留證據

初次 24 項中 22 項通過，失敗是新測試的換裝欄位／改密碼欄位不完整；依實際 UI 契約補 `currentlyEquipped`／`expectedWeaponRevision`，並將 `oldSecret` 改為既有 API 的 `currentSecret`。同時修正出售競態測試的版本／instanceIds 欄位，讓雙方都是合法請求。沒有放寬伺服器檢查或修改正式遊戲邏輯。

完整證據位於 `evidence/refinement-http-2026-11-29/`：初跑失敗、最終 HTTP／ledger／來源 hash、57 項 Firestore 原始紀錄、725 項單元紀錄及發布前審查。失敗原始資料未改為通過；未納入包含敏感 Token 的 debug 資料。

## 發布邊界

這次解除的是新精煉／營運 API 的本機真實 Auth 與交易驗收缺口。App Check 強制驗證、逐支背景觀測器、正式索引 READY、實際正式權限／設定、備份還原、正式資產對帳及發布授權不在本輪完成範圍。實機依使用者要求維持 DEFERRED_BY_USER。

正式六項精煉相關預設開關仍全部 false。未改玩家 UI、正式 Functions 邏輯、Rules 或怪物／武器數值。正式發布仍 **NO_GO**；下一份 [更新後部署前審查](predeploy-review-refinement-http.md) 列出剩餘條件。
