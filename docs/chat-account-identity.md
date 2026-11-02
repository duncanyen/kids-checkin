# 聊天室使用固定帳號

聊天室不再以可變的顯示名稱判斷身分。

- `rooms.participantIds`：成員的原始 `users.accountId`，不更改大小寫。
- `creatorAccountId`：建立者；改名後仍保有原本的管理能力。
- 訊息與回覆的 `senderAccountId`：訊息歸屬。名稱只用於顯示。
- `unreadByAccount`、`readByAccount`：以固定帳號為鍵的未讀與已讀資料。
- `lastSenderAccountId`：首頁未讀提示使用的最後發訊帳號。

新建、邀請、移除、退出、收回訊息與成員顯示均使用固定帳號。
舊訊息不批次改寫，會透過聊天室已確認的名稱對應辨識歸屬。

## 既有聊天室

舊資料的 `participants` 保留作歷史相容用途。一旦有 `participantIds`，
便以它為準；即使是空陣列，也不會靠舊名稱重新加入已移除的成員。
可唯一辨識的舊聊天室在進入／儲存已讀狀態時以交易轉換，保留原訊息、
建立者與已讀／未讀對應。交易會重新核對目前群組資格。

個人設定及管理者改名會將原名稱加入 `users.nameHistory`，協助舊聊天室轉換。
同名或名稱被他人使用時不自動猜測歸屬。

已經改名且沒有歷史對應的舊聊天室：請目前群組的管理者在聊天室清單按
「確認舊聊天室成員」，逐一指定舊名稱對應的固定帳號。已離開的成員可以
明確選擇排除；不會自動把管理者或整個群組加入私人聊天室。
帳號確認後，原成員重新整理即可進入。

本次沒有由開發工具直接讀寫正式聊天室資料，也沒有部署 Firebase Functions。
目前 `REALTIME_READS_ENABLED` 維持 `false`。未來啟用 RTDB 前，需依
`realtime-migration.md` 部署更新後的鏡像函式。

## 驗證

- `node tests/chat-identity.test.mjs`：改名、同名、舊資料轉換與固定鍵。
- `node tests/chat-profile-rename.cjs`：個人設定連續改名保留帳號及歷史名稱。
- `CHAT_BASE_URL=http://127.0.0.1:8012 node tests/chat-members.cjs`：真實頁面、
  改名後重新登入／傳送、訊息歸屬與回覆、未讀／已讀、建立者移除成員、
  舊聊天室管理者確認、退出與拒絕未授權操作；使用隔離資料。
- `node tests/realtime-core.test.mjs`、`tests/realtime-browser.cjs`：鏡像及讀取相容。
- `tests/admin-members.cjs` 可用 `FIREBASE_APP_FIXTURE` 指定本機官方 App SDK。
  此環境的 gstatic 下載被網路政策拒絕，管理者流程以專案已安裝的官方
  Firebase 11.10.0 App SDK 加上隔離 Firestore 驗證；沒有更改產品的 SDK 版本。

## 訊息換行與多張照片

一般 Enter／手機換行鍵保留為文字換行，點傳送按鈕或 Ctrl／⌘＋Enter 才送出；中文輸入組字期間不觸發快捷送出。輸入框維持原有自動長高與 @標記。

可一次選最多 5 張圖片（單張原始檔不超過 20 MB），依選取順序壓縮為最長邊 800px JPEG，沿用一張一則 imageUrl 訊息，因此舊照片相簿、引用、收回仍相容。傳送時顯示進度、鎖定重複送出，不清空文字草稿；圖片解碼錯誤或中途失敗會還原按鈕，保留未送出的檔案供重試或取消。已成功寫入訊息的照片不因聊天室摘要更新失敗而重送。

每批綁定選取當時的聊天室與帳號／群組，逐張重驗成員資格；切換聊天室後停止尚未傳送的檔案，需回原聊天室才能重試，不會將剩餘圖片發到新聊天室。重試佇列僅留在目前頁面記憶體，重新整理會清除，已成功的訊息則保留。
