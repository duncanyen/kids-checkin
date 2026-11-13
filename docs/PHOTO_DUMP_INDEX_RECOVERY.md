# Photo Dump 讀取失敗：索引補齊

## 2026-11-12 盤點結果

- 主頁輪播與相簿分頁都使用 `photos`、`groupId == 目前群組`、`timestamp DESC`。
- 主頁未讀數量使用 `photos`、`groupId == 目前群組`、`timestamp > 最後閱讀時間` 的 count 聚合。
- 原本 Repository 索引檔沒有列出 `photos` 複合索引。本次新增時間升冪、降冪各一組，保留其餘索引。
- 使用者提供的 Console 確認上述未讀 count 查詢回傳 `failed-precondition`。此現象與缺少／尚未就緒的索引一致；尚未取得完整 FirebaseError.message 或正式索引清單，不能證實正式索引是否被刪除。
- 最新 GitHub Pages 發布流程 `43098505460` 已成功，因此先前的 Pages 啟動失敗不能解釋這次的 Firestore 查詢錯誤。
- 使用者同時回報記帳本 `failed-precondition`，這是不同查詢，需依完整錯誤及其建立索引連結另外確認。現在首頁保留完整 FirebaseError，方便確認。

## 不等待前端發版的恢復方式

在 Firebase Console → homebasedb → Firestore Database → 索引 → 複合索引，確認／補上以下兩組：

| 集合 ID | 範圍 | 欄位 1 | 欄位 2 |
| --- | --- | --- | --- |
| `photos` | Collection／集合 | `groupId` 升冪 | `timestamp` 降冪 |
| `photos` | Collection／集合 | `groupId` 升冪 | `timestamp` 升冪 |

若已存在，確認不是 Building／建置中；等待狀態為 Ready／Enabled 後，重新整理主頁及相簿頁。這個動作不修改照片、留言、按讚或 Security Rules。

也可在本次修正推送後，更新工作目錄再部署索引：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npx firebase-tools deploy --only firestore:indexes --project homebasedb
```

**若 CLI 詢問是否刪除線上未列於 Repository 的其他索引，先選 No。** Repository 尚未與完整正式索引清單比對，不能把未列出的索引直接視為無用。不要加 `--force`。必要時先從 Console 只新增上表兩組。

如果索引 Ready 後仍然失敗，取得該筆 FirebaseError 的完整 message；`permission-denied` 需核對正式 Rules，`failed-precondition` 需依實際查詢確認索引，不能靠放寬權限或移除群組條件處理。

## 程式修正與驗證

- 主頁讀取失敗不再靜默隱藏整個 Photo Dump；顯示說明與重新載入按鈕。
- 相簿頁區分缺索引、登入／權限及網路錯誤，保留分頁、即時訂閱及重試流程。
- `node --test tests/gallery-index.test.cjs`：檢查索引、錯誤分類與主頁重試。
- `node tests/gallery-pagination-browser.cjs`：隔離瀏覽器驗證分頁、空群組即時更新、重連、20 次離頁返回與群組切換防護。
- 沒有部署正式 Firebase、刪除索引或修改正式玩家資料。隔離測試不等同正式資料庫驗證。
