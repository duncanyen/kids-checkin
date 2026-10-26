# Photo Dump：Firebase Storage

新上傳的照片與塗鴉改存 `gs://homebasedb.firebasestorage.app`，壓縮仍為最長邊 1200px、JPEG，一篇最多 5 張。舊 ImgBB 網址繼續顯示，本次沒有自動搬移舊照片。

Firestore 的 photos 集合仍儲存貼文、留言、按讚和照片網址；新貼文另存 uploaderAccountId、uploaderUid、storageProvider、storagePaths，照片路徑為 `photo-dump/{groupId}/{Firebase Auth uid}/{postId}/{隨機檔名}.jpg`。UID 對應 users 文件 ID，accountId 保留原始帳號，改名不影響新貼文擁有者辨識。

## 正式啟用前

此功能不依賴 RTDB 啟用開關，不必先匯入 RTDB，但需要部署照片登入函式與 Storage 規則。只發布前端而未部署後端，新的照片上傳會失敗。

1. 在 Firebase Console 的 Storage 確認 bucket 已建立、專案已啟用付費方案，Authentication 已初始化並可接受 custom token。
2. 若 bucket 已有頭像等其他用途，先將現有規則合併到 storage.rules。本檔只開放 Photo Dump 路徑，其餘預設禁止；不要覆蓋其他功能原有規則。
3. 使用有專案部署權限的帳號，在專案根目錄執行：

   ```sh
   npm --prefix functions ci
   npx firebase-tools@14.18.0 login
   npx firebase-tools@14.18.0 deploy --only functions:nexus-live:photoSession,storage --project homebasedb
   ```

   Storage 規則會查詢 Firestore 的 users 與 groups；首次部署時須允許 Firebase 建立跨服務規則所需的 IAM 權限。Firestore 規則查詢可能產生少量讀取費用。若 custom token 簽發出現 signBlob 權限錯誤，為函式執行服務帳戶設定適當的 Service Account Token Creator 權限。
4. 發布前端後測試：單張／多張／塗鴉、舊照片檢視、上傳中斷重試、刪除自己的貼文、管理者刪除、切換群組。確認 Storage 路徑及 photos 文件的 groupId、uploaderAccountId 正確。

## 權限與檔案清理

photoSession 在伺服器檢查既有密碼或 PIN、有效帳號和目前群組資格，簽發群組限定 token。它與 RTDB 的登入使用不同 Firebase app，互不影響。Storage 規則在每次存取重新確認帳號有效與目前群組成員資格；限制本人建立 JPEG、單張至多 5 MiB、禁止覆寫；本人或該群組有效 admin／parent 可以刪除。

照片使用 Firebase 下載 token 網址供 `<img>` 顯示。這類網址是可分享的持有者連結，取得連結的人即使未登入也可能看圖；Firestore 貼文的群組篩選不會撤銷已分享網址。若需要嚴格私人相簿，應另改為驗證後下載 Blob，並檢視既有 Firestore photos 規則。

上傳或貼文寫入失敗會嘗試清理已完成的上傳；刪除貼文會嘗試刪除 storagePaths 指向的檔案，不會刪除舊 ImgBB 檔案。若清理因斷線或權限失敗，會顯示提示；瀏覽器被強制關閉仍可能留下孤立檔案，可由管理者檢查清理。

## 驗證狀態

本機隔離測試：`node --test tests/gallery-storage.test.mjs`，涵蓋多張上傳、部分失敗清理、穩定帳號欄位、舊資料相容、跨群組路徑拒絕，以及後端帳密／群組／停用帳號驗證。另有 `node tests/gallery-storage-browser.cjs` 驗證真實相簿頁面（SDK 與資料均隔離模擬）。

正式 Storage／Functions 部署與線上權限尚未驗證；Firebase CLI 目前沒有可用登入，模擬器下載先前也遭環境網路限制。發布前需在有權限的環境完成部署及上述實機檢查。
