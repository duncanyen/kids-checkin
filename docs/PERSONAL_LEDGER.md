# Nexus 群組與個人記帳

## 使用方式

- 記帳本上方可選「群組記帳」或「個人記帳」。第一次使用預設群組。
- 群組帳維持既有共用資料、記帳權限及記帳人篩選；既有紀錄不搬移、不複製。
- 個人帳以 `users.accountId` 識別，與群組帳獨立。切換群組或更改顯示名稱，仍為同一本個人帳。
- 個人帳支援支出、收入、完整明細修改、刪除、自訂分類／圖片、月曆、圖表與回顧。群組內的一般成員也能管理自己個人帳的收入；不因此取得群組收入權限。
- 右上「帳本設定」可分別設定「Nexus 首頁本月累計支出」來源與「進入記帳本的預設模式」。兩者互不影響；儲存後於返回首頁／下次進入記帳本套用。
- 月曆原有的群組／個人圖表篩選改標示「群組全部／依記帳人篩選」，避免與獨立個人帳混淆。
- 寫入期間禁止切換帳本；切換時清空舊資料、游標與報表快取，舊查詢結果不能覆蓋新帳本。

## 資料與身分驗證

| 路徑 | 用途／主要欄位 |
| --- | --- |
| `expenses/{id}` | 既有群組明細，`groupId` 隔離；保持原模型。 |
| `customCategories/{id}` | 既有群組自訂分類；保持原模型。 |
| `personalLedgers/{accountId}` | 偏好：`defaultMode`、`homepageSource`，皆為 `group` 或 `personal`。不存在時兩者均為 `group`。 |
| `personalLedgers/{accountId}/expenses/{id}` | 個人明細：`accountId:string`、`date:string(YYYY-MM-DD)`、`type:expense/income`、`category:string`、`amount:number`、`note:string`、`operator:string`、`timestamp:Timestamp`。不含 `groupId`。 |
| `personalLedgers/{accountId}/customCategories/{id}` | `accountId:string`、`type`、`name`、`icon`、`imgBase64:string/null`、`color`。不含 `groupId`。 |

個人帳使用獨立 Firebase App `nexus-personal-ledger`，以既有 `photoSession` callable 驗證 Nexus 帳號憑證及群組資格，交換 custom token 後使用 in-memory Firebase Auth。個人資料權限由 Firestore Rules 檢查 token 的 `photoAccountId`，並比對 `users/{auth.uid}` 的實際帳號及未移除狀態；不信任畫面上選定的 accountId，也不因家長／群組管理員角色而允許讀別人的個人帳。

個人資料仍直接使用 Firestore 查詢及交易，不新增另一套記帳 API。前端不保存個人明細快取到 localStorage，不記錄憑證或 Token。既有 `photoSession` 是登入相容橋接，仍需要使用者屬於目前群組；本次沒有新增「無任何群組帳號」的登入流程。

首頁使用獨立可清理的監聽器；偏好讀取失敗會顯示錯誤，不把錯誤的群組數字冒充個人統計。記帳頁偏好讀取失敗時明示暫用預設群組帳，個人帳連線失敗不會轉存群組帳。

## 上線前必要設定

**本次未部署 Firebase 或修改正式資料。程式整合完成不代表正式個人帳已可使用。**

1. 先備份並取得 Firebase Console 上完整的正式 Firestore Rules。本 Repository 根目錄沒有完整正式 Firestore Rules，不能用測試規則取代正式規則。
2. 將 [personal-ledger.rules.fragment](../rules/personal-ledger.rules.fragment) 合併到正式 `match /databases/{database}/documents` 範圍內。
3. 檢查既有的遞迴 wildcard（例如 `match /{path=**}`）與 `collectionGroup` 規則。Firestore 的 allow 取聯集，較具體的私有規則**無法否決另一條寬鬆 allow**。必須確保其他規則不會授權玩家存取 `personalLedgers` 路徑；若存在寬鬆 wildcard，先調整並完成全站權限回歸測試。
4. 在隔離 Emulator 驗證私有規則：同群組其他玩家、家長、未登入者、偽造 accountId、已移除使用者，皆不得讀寫別人的個人資料。
5. 將核對後的完整正式 Rules 發布；本次提供的是片段，不可直接部署本片段或測試用設定。
6. 部署索引並等候 Ready：`firebase deploy --only firestore:indexes --project homebasedb`。`firestore.indexes.json` 只新增個人清單排序與聚合所需的三組索引，保留所有舊索引。
7. 確認正式 `photoSession` 已存在、可從目前網站來源呼叫、Firebase Custom Token 登入可用。這次沒有修改 Functions，也不需要因本次修改重新部署 Functions；若既有橋接尚未部署，須先完成既有橋接設定。
8. 最後發布前端，使用兩個真實測試帳號、同群組與跨群組情境驗收。確認正式 Rules 後才開放個人資料寫入。

不要為了讓畫面讀取成功將 Firestore 改成全站公開。完整 Rules 尚未確認前，不得聲稱正式環境的個人資料隔離已驗證。

## 驗證指令

瀏覽器測試全部使用攔截的 Firebase SDK 與本機假資料，不連正式 Firebase：

```bash
python -m http.server 8012 --bind 127.0.0.1
# 另一終端機
node tests/expense-list-browser.cjs
node tests/personal-ledger-browser.cjs
node tests/personal-ledger-widget.cjs
```

Rules 測試限定 Emulator；沒有 `FIRESTORE_EMULATOR_HOST` 會直接停止：

```bash
npm --prefix functions ci
npx firebase-tools emulators:exec \
  --config tests/firebase.personal-ledger.json \
  --only firestore --project demo-personal-ledger \
  'node --test tests/personal-ledger-rules.cjs'
```

測試專案限定 `demo-personal-ledger`；測試程式會將正式使用的片段包入完整、預設拒絕規則後，載入隔離測試專案。測試設定不是正式部署設定。

## 本次驗證結果（2026-11-11）

- 既有記帳瀏覽器回歸：通過（五欄位完整修改、原 metadata 保留、月份切換、分頁／聚合、空白名稱、失敗重試、重複點擊、群組隔離及原有收入權限）。
- 個人帳瀏覽器測試：通過（群組／個人資料及分類隔離、個人收入、偏好儲存、個人新增／修改／刪除、交易期間不能切換、月曆／回顧、舊查詢不覆蓋新範圍、跨群組／更名仍為同一帳、390px／1280px 版面）。
- 首頁統計測試：通過（正確來源／金額、排除收入、月份條件、讀取設定失敗不顯示另一來源、訂閱清理及連線中取消）。
- Rules Emulator：**未通過驗證、待執行**。目前執行環境下載 `cloud-firestore-emulator-v1.19.8.jar` 遭 HTTP 403 `Domain forbidden`，測試尚未啟動；不是 Rules 測試通過，也不是已證實 Rules 錯誤。
- 真實 Firebase 權限、索引 Ready、正式登入橋接、iPhone／iPad 真機：本次未驗證。
- 瀏覽器截圖：`/tmp/nexus-personal-ledger-mobile.png`、`/tmp/nexus-personal-ledger-desktop.png`，均為隔離假資料畫面。

## 修改範圍

- `expense.html`、`css/expense.css`：帳本選擇及兩項設定。
- `js/expense.js`：範圍一致的查詢、聚合、分類與明細 CRUD、狀態重置及交易防護。
- `js/personal-ledger.js`：獨立 Auth、個人資料庫與偏好讀寫。
- `js/expense-home-widget.js`、`js/dashboard.js`：依個人設定讀取首頁本月支出並清理監聽器。
- `firestore.indexes.json`：個人帳查詢索引。
- `rules/personal-ledger.rules.fragment`：需人工合併的私有權限規則。
- `tests/expense-list-browser.cjs`、`tests/fixtures/expense-sdk.cjs`：原有記帳回歸及共用假 SDK。
- `tests/personal-ledger-browser.cjs`、`tests/personal-ledger-widget.cjs`：新增功能瀏覽器測試。
- `tests/personal-ledger-rules.cjs`、`tests/firebase.personal-ledger.json`：隔離 Rules 測試及設定。
- 本文件。
