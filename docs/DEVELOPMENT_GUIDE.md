# Nexus 開發與註解規範

> 適用目前原生多頁網站、Phaser 及 Firebase codebase。本文規定後續維護方式，不代表本次已重構全部歷史格式。架構入口：[ARCHITECTURE.md](ARCHITECTURE.md)。

## 1. 新增或修改功能的流程

1. 確認玩家入口、所選 accountId／groupId、資料來源與目前開關；先讀對應模組、資料模型及測試。
2. 找到共用規則來源，區分純計算、頁面控制、資料存取與可信任後端。先評估能否沿用既有介面，不為單一需求複製整套 SDK 初始化。
3. 列出資料讀寫範圍、權限、失敗／重試／離頁情境、既有存檔相容，以及所需索引。不能由 users.role 或 localStorage 推定營運管理權。
4. 實作前明確區分需變更的層；不順便調整其他商品、遊戲經濟、資料鍵或 UI。
5. 更新對應文件與必要測試，以 Git Diff 檢查範圍；資料遷移及正式 Rules 改動須獨立審查。
6. 原始碼提交、GitHub 靜態站、Functions、Rules／索引及資料遷移分開記錄驗收。未經授權不部署。

## 2. 命名與責任

- 延續現有 camelCase 函式／變數、PascalCase 類別／Scene、UPPER_SNAKE_CASE 常數。
- 動作以用途命名，例如 load／read（取得）、watch／subscribe（持續接收）、ensure（建立前提）、settle（結算）、commit／mutate（交易）、stop／destroy（結束）。名稱不是授權保證，仍需讀實作。
- 保留既有 public export、window 介面與參數；若需改名或拆分，視為功能／重構任務，不夾帶在文件化提交。
- 日期、毫秒、頁碼及外部識別在參數說明中標出單位、從零或一開始、所屬群組。
- 產生檔只修改共用來源與產生工具，不直接手改輸出。本次註解作業不執行產生腳本覆寫產物。

## 3. 註解標準

說明文字採繁體中文台灣用語；變數與函式名稱不翻譯；JSDoc 使用標準英文標籤；Firestore、onSnapshot、Promise 等保留原文。

### 函式 JSDoc

優先註解跨模組介面、資料存取、權限與資源交易、生命週期、複雜純規則。顯而易見的 DOM 小函式不必每個都加註。

```js
/**
 * 訂閱指定群組資料，呼叫端離頁時必須解除。
 * @param {string} groupId - 已確認成員資格的群組 ID。
 * @param {Function} receive - 接收目前有效群組的資料。
 * @returns {Function} 解除監聽的函式。
 */
```

按實際簽章描述：

- `@param`：每個公開參數的型別、用途；options 可在一段說明關鍵屬性，必要時用屬性標籤細分。
- `@returns`：真實回傳值；區分 Function、Promise<Function>、Promise<void>、資料 patch 與已提交結果。
- `@throws`：只記實際向外丟出的例外；內部 catch 後顯示提示的函式，不寫不存在的 throw。
- `@description`／`@see`：重要依賴、冪等／快取／相容邏輯、權限與清理責任。
- 模組入口可用 `@module` 簡述責任、來源及生命週期；不在每個純工具重複貼全站架構。

### 商業邏輯與 Firebase 註解

解釋「為什麼」：為何保留同時間的文件游標、為何快取不能授權建檔、為何姓名不能當成帳號、為何逾時不能換 requestId。不要逐行重述 `if`／`for`。

需指出 collection／document 目的、groupId 範圍、查詢排序／分頁、原子寫入邊界、未知結果與重試方式。區分本機防誤操作、可信任後端驗證及 Security Rules；不得寫「前端禁用所以絕對不可繞過」。

註解須與實際行為一致。無法確認的正式配置標「待確認」，已知缺陷另記 [問題清單](DOCUMENTATION_AUDIT.md#既有問題與待確認事項)，不要在本次順手修正。

## 4. Firebase 存取

- 保持 users 文件 ID、accountId、Auth UID 與 groupId 的區分；查指定群組成員後才做 users in 分批讀取。不同模組的歷史相容順序不要擅自統一。
- 寫入前重新確認必要成員／文件歸屬；金幣、獎勵與特權操作依現有可信任 API，不新增可任意提交完整 farm 的入口。
- Firestore transaction callback 可能重試：不得在裡面直接寄信、播放一次性 UI 或呼叫外部發獎服務。所有讀取須在寫入前完成。
- 操作 requestId 必須跨未知結果重試保持固定，並與內容 fingerprint 綁定；busy 鎖只防同頁連點，不能取代後端冪等收據。
- 用 merge 或明確 patch 保留同文件其他模組資料；既有農場不因缺一個欄位就以 initialFarm 覆蓋。
- 索引與查詢一併審查；使用文件快照 cursor 保留 timestamp 精度與相同值的次序，不以 JavaScript 毫秒自行代替。
- 不能假定 Firestore／RTDB／Storage 能做單一跨服務交易；需記錄鏡像延遲及檔案補償清理失敗。
- Rules 多個 allow 是 OR；新增 deny 不會封住原 broad allow。正式規則未知時不能直接部署隔離測試規則。
- 不輸出玩家憑證、完整 token、Admin SDK 金鑰或敏感欄位至文件／日誌。診斷依 action、匿名化目標與 error code。

## 5. 初始化與清理

| 情境 | 規範／現有參考 |
| --- | --- |
| 多頁進入 | 使用 HTTP 載入 ES Modules；先確認上下文再建立資料訂閱 |
| 重複初始化／換群組 | 先 stop 舊監聽，提升 generation／version；延遲結果需檢查仍是同一上下文 |
| 非同步建立監聽 | await 完成時若已離頁，立即呼叫剛取得的 stop；不能只在離頁當下判斷 null |
| pagehide／bfcache | 清理可重啟資源，pageshow 恢復時核對帳號／群組；不同頁的既有策略有 reload 與 resume 之別 |
| Phaser | 場景 shutdown／destroy 用 onSceneExit；跨場景共享存檔 session 在 Game.destroy 結束 |
| 圖片與手勢 | 釋放 Object URL、Observer、timer、DOM handler 與指標狀態；不要只隱藏元素 |
| 成長森林 | 離頁停止資料／外觀訂閱、閱讀計時及 Canvas，保留固定請求識別以供重試 |

目前行事曆等舊頁未完全符合此規範；本文不宣稱已全面修復，請按問題清單另案排程。

## 6. 效能要求

先讀 [PERFORMANCE.md](PERFORMANCE.md)：不可用「簡化程式」取代既有分頁、增量渲染、pending Promise 共用、限定帳號批次或快取可信度檢查。避免在動畫每影格讀寫 Firebase、在每次快照重新建整個遊戲／全部圖片，或為頭像阻塞帳務金額。

效能測試需區分隔離 SDK 的請求計數、正式 Firestore 計費讀取、瀏覽器採樣與真機體感。未測量的 FPS、長期 heap、iPhone 耗電與成本不可用推測數字代替。

## 7. 本機環境與測試

玩家站為靜態網站，可使用 Node.js 22 跑測試、Chromium／Playwright 跑隔離流程；Emulator 另需適當 Java／Firebase CLI。前端不要以 file:// 啟動。

```bash
python3 -m http.server 8030 --bind 127.0.0.1
node --test tests/*.test.mjs tests/*.test.cjs
npm --prefix game-admin/functions test
```

後端測試需要原有依賴及共用遊戲模型；**首次設定環境**通常執行 `npm --prefix functions ci`、`npm --prefix game-admin/functions ci`、`node scripts/prepare-game-admin.cjs`。`prepare-growth-forest.cjs` 會改寫追蹤中的 direct 產生檔，執行後必須檢查 diff；純註解任務不執行它來更新產物。

瀏覽器測試每支有自己的 fixtures／server／環境變數，先讀檔頭，不把 Node 單元測試 glob 當全部整合驗證。代表性檢查：

```bash
node tests/navigation-performance.cjs
node tests/gallery-performance.cjs
node tests/growth-forest-browser.cjs
node game-admin/tests/ui.browser.cjs
node game-admin/tests/management.browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-operations-browser.cjs
```

實際命令與已執行結果記於 [本次驗收](DOCUMENTATION_AUDIT.md)。不必為純文件修改重跑所有長時遊戲採樣；應以程式不變性檢查及相關既有測試提供證據。Emulator／Rules 測試不能以記憶體替身冒充，無法執行需記具體阻擋原因。

## 8. 文件化變更的驗收

1. `git diff --check`，確認沒有 CSS、Rules、索引、套件鎖、素材、產生檔或行為變更。
2. 對修改的 JS／CJS 與 HTML inline script，比較修改前後 AST 與可執行 token；註解可改，程式語法與字面值不可變。
3. HTML 除 script 內容外逐位元組比對，確認 DOM、樣式與頁面文字未改。
4. 交叉核對函式名稱／參數／回傳、路徑及欄位；不把舊文件的部署狀態當作目前事實。
5. 執行適用的既有測試，列出替身及正式驗證界線，提供獨立 commit 與未修正問題。
