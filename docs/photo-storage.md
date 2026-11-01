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

## 照片檢視、儲存與圖片留言

照片檢視器使用 Pointer Events 實作兩指縮放（1–5 倍）、放大後拖曳與雙擊縮放／重設；原尺寸時仍可左右滑動切換、向下滑動關閉。切換照片會重設縮放，兩指手勢不會觸發換圖。

「下載照片」以圖片 Blob 下載原有照片檔，並非螢幕截圖。支援檔案分享的手機瀏覽器會額外顯示「分享／儲存相簿」，由使用者在系統選單選擇儲存影像。網頁無法直接寫入 iOS／Android 系統相簿，部分瀏覽器會先下載到檔案／下載資料夾。舊外站圖片若不允許跨來源讀取，顯示「開啟原圖」供長按儲存，不宣稱下載成功。原生相簿／分享選單仍需在目標手機實機確認。

按讚改存 `likeAccountIds`，陣列以固定 accountId 去重。相簿及首頁輪播共用同一套邏輯，透過 Firestore transaction 避免同時操作覆蓋。舊 `likes` 名稱陣列保留相容，會以目前帳號的 `nameHistory` 合併舊愛心，下一次操作時移除自己的舊名稱並寫入固定帳號。無法從純名稱可靠辨識的歷史資料不做全庫猜測或批次回填。

留言可純文字、純圖片或兩者一起發佈；最多 3 張照片，原始檔單張上限 20 MB，轉為最長邊 1200px JPEG。預覽可逐張移除，失敗保留草稿，傳送中鎖定表單。新留言帶有 `id`、`senderAccountId`、`sender`、`text`、`replyTo`、`timestamp`；附圖另帶 `imageUrls`、`storagePaths` 等儲存欄位。附圖使用既有 Storage 路徑，postId 設為 `{貼文ID}-comment-{留言ID}`，沿用 photoSession／Storage 驗證，不新增公開儲存規則。

刪除留言會嘗試清理該留言附圖；刪除整篇貼文也會收集留言附圖一併清理。既有 Storage 規則僅允許檔案擁有者或群組 admin／parent 刪除：普通貼文擁有者刪掉其他人附圖的貼文時，部分檔案可能需由管理者清理；介面會明確提示，不會誤報所有檔案已刪除。

本機驗證：`node --test tests/gallery-core.test.mjs`、`node tests/gallery-upgrade-browser.cjs`（真實雙指事件、下載、分享介面替身、跨分頁交易、留言圖片回滾）、既有相簿 Storage／分頁／互動回歸。未部署正式站或修改正式資料。
