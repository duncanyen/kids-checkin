# 聊天室照片收回修正

## 原因與操作

原本圖片 click 會 stopPropagation 並直接開啟大圖，無法觸發訊息泡泡的回覆／收回選單。保留點擊放大，在大圖預覽底部增加「收回照片」，綁定該訊息文件 ID 與房間 ID，不以圖片 URL 辨識訊息。

沿用本人訊息、24 小時內的資格；他人、過期、已收回與時間戳未確認的訊息不顯示按鈕。執行時重新核對目前訊息與房間，不相信 UI 傳入的 isMine。原文字訊息的選單收回仍可使用。

## 資料與生命週期

- 沿用 Firestore messages 原文件的 updateDoc：isRetracted=true、text=''、imageUrl=null。沒有第二套刪除或發送流程。
- 原生確認取消不寫入；處理期間停用按鈕與以 message ID 防重，失敗提示並恢復操作。
- 收回後關閉對應大圖，訊息列表顯示既有收回提示，更新最後一則訊息的房間摘要。
- 切房間／返回列表關閉舊預覽；已送出的請求完成時仍綁定原房間，不更新新房間的 UI 或摘要。遠端收回亦會關閉正在檢視的照片。
- 不修改 Firebase Rules、Functions、聊天室成員規則或照片上傳流程。前端資格顯示不是伺服器授權的替代品。

## 驗證

- 363 項 Node 測試通過。
- CHAT_PHOTO_RETRACT_TESTS=1 真實聊天室頁面與隔離 Firebase SDK：原建立房間入口、點照片放大、他人／超過 24 小時不顯示、偽造 isMine 不可收回、取消不寫入、失敗可重試、快速連點只一次、清空 imageUrl、重新整理仍收回、摘要更新、文字收回及切房間保護通過。
- 原 chat-members.cjs 多照片傳送、失敗重試、改名、同名、聊天室管理權與群組隔離回歸通過。
- 原 chat-history-browser.cjs 分頁／歷史合併／房間切換回歸通過。
- 測試 SDK 的 timestamp 與 lastMessageTime 改用 toDate/toMillis 介面，與真正 Firestore Timestamp 一致，避免以文件 ID 代替時間排序。
- [390×844 圖片預覽操作截圖](verification/chat-photo-retraction/viewer-390.png)。Linux Chromium 隔離測試，未操作正式玩家資料、未驗收 iPhone 真機。

```bash
CHAT_PHOTO_RETRACT_TESTS=1 CHAT_BASE_URL=http://127.0.0.1:8032 node tests/chat-members.cjs
CHAT_BASE_URL=http://127.0.0.1:8032 node tests/chat-members.cjs
CHAT_BASE_URL=http://127.0.0.1:8032 node tests/chat-history-browser.cjs
```

修改檔案為 chat.html、css/chat.css、js/chat-core.js、tests/chat-members.cjs 與本文件／截圖。只需前端發布，不需 Firebase Functions 或 Rules 部署。
