# 聊天室與咕咕村落：Realtime Database 讀取遷移

**目前狀態：切換程式、同步函式、匯入與驗證工具已備妥，但正式切換尚未啟用。**

資料庫網址：`https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app/`，專案 `homebasedb`。

## 本階段範圍

Firestore 繼續作為資料來源，所有聊天寫入，以及買賣、餵食、收蛋、偷蛋、首領勝敗仍執行既有 Firestore transaction／寫入。Cloud Functions 將結果鏡像到 RTDB，前端的高頻即時監聽從 RTDB 取得。

這能移走多人聊天室、首頁未讀數與農場畫面的 Firestore 即時監聽讀取，也不必重寫跨群組、跨玩家原子交易。群組、個人資料、管理設定及交易本身仍會讀取 Firestore；後端同步、登入驗證和初次匯入也有讀取與執行成本。RTDB 依傳輸量與連線、Functions 依執行另計費，不等於所有 Firebase 費用歸零。

| 前端資料 | RTDB 路徑（省略 nexus/） |
| --- | --- |
| 自己／拜訪對象的農場 | farms/{groupKey}/{accountKey} |
| 自己可參加的房間與未讀數 | inboxes/{groupKey}/{accountKey}/{roomKey} |
| 目前聊天室設定 | rooms/{groupKey}/{roomKey} |
| 最新 30 則訊息 | messages/{groupKey}/{roomKey}/{messageKey} |
| 群組、帳號與房間權限鏡像 | access/…（客戶端不可直接讀寫） |
| 匯入完成標記 | status/chat、status/farms |

鍵值會轉義 RTDB 禁用字元；資料保留時間戳、空陣列、空物件、null 和含特殊符號的人名。農場鏡像只包含 farm，不包含 users 密碼或其他功能資料。每筆資料附來源版本；較舊的事件不能覆蓋新資料，刪除以 tombstone 防止舊事件復活。

## 登入與群組隔離

專案目前使用既有 users 帳密／PIN 登入，並未使用 Firebase Auth。新增 liveSession callable 僅在後端確認帳密、有效帳號及目前群組成員資格後，簽發此群組的 Firebase 自訂登入 token。密碼／PIN 只用於 HTTPS 驗證，不寫入 RTDB、不放入 token claims、不記錄到日誌。前端 Firebase Auth 採記憶體持續性。

RTDB 規則限制：

- 自己群組可讀該群組雞舍；跨群組僅限來源和目標村落皆公開，且目標仍在該群組。
- 房間清單只能讀自己，房間與訊息只有目前群組且仍為該房間成員的人能讀。
- 訊息查詢必須以 sortTime 排序並限制最後最多 100 則，前端使用 30 則。
- 離開群組、房間移除成員、帳號停用會同步權限撤銷。
- 客戶端不能寫 RTDB；經濟與跨玩家操作仍在 Firestore 重新驗證並交易。

既有聊天室 participants 目前仍以名稱存放。同步函式會以當前群組 members 和 profiles 對應成 accountId 收件者索引；未變動成員的未讀數更新會重用對應，避免每次訊息都重查全群組個人資料。修改姓名／角色／群組成員時會重新建立索引。本次不遷移既有聊天室的 participants 格式。

## 部署順序

先確認帳號具備專案 Functions、RTDB 規則、Firestore 與服務帳戶簽 token 所需權限，專案可執行 Cloud Functions v2（通常需 Blaze 方案）。此版本尚未變更正式資料或 Firebase 規則。

1. 安裝依賴並登入部署帳號：

   ```sh
   npm --prefix functions ci
   npx firebase-tools@14.18.0 login
   ```

2. 在可下載模擬器的環境驗證規則：

   ```sh
   npx firebase-tools@14.18.0 emulators:exec --only database --project demo-nexus-live 'node tests/realtime-rules.cjs'
   ```

3. 檢查規則後部署後端與 RTDB 規則。若該 RTDB 已有其他用途，請合併保留其他節點規則；提供的 database.rules.json 是預設關閉、僅開放 nexus 特定讀取的完整規則。

   ```sh
   npx firebase-tools@14.18.0 deploy --only functions:nexus-live,database --project homebasedb
   ```

   新函式為 liveSession、liveFarmMirror、liveRoomMirror、liveMessageMirror、liveGroupMirror、liveProfileMirror，區域 asia-southeast1。確認 Firebase Authentication 可接受自訂 token；若簽 token 回覆 signBlob 權限錯誤，需為執行函式的服務帳戶補上適當的 Service Account Token Creator 權限。

4. 讓 Node Admin SDK 使用可用的 Application Default Credentials。Firebase CLI 登入和 Node ADC 是兩件事；可使用 gcloud auth application-default login，或在具權限的部署環境綁定服務帳戶。私鑰不能放入 GitHub 或前端。執行匯入前預覽：

   ```sh
   node scripts/backfill-realtime.cjs
   ```

   此指令只讀 Firestore 並列筆數，不修改資料。確認後匯入：

   ```sh
   node scripts/backfill-realtime.cjs --apply
   node scripts/verify-realtime.cjs
   ```

   匯入每頁 250 筆，可重複執行；live trigger 應先部署，才不會漏掉匯入期間的新資料。只有整批成功才寫 ready 標記。驗證會比對所有現有農場／房間，以及各房間最新 30 則訊息；同步仍在進行而版本落後時，應等待同步完成再重跑。訊息驗證沿用既有 roomId + timestamp 索引需求。

5. 將 js/live-read-config.js 的 REALTIME_READS_ENABLED 改為 true，再發布前端。以兩個帳號驗證聊天、新訊息、收回、未讀數、換群組、本家／公開村落、買賣、偷蛋及首領結算，再觀察 Firestore 讀取與 RTDB 流量。

## 回退及延遲

新資料庫尚未 ready、初次連線逾 8 秒或一般連線失敗時會回退 Firestore。新農場尚未鏡像時先從 Firestore 確認，避免空鏡像被當成全新帳號。RTDB 真正傳回權限／登入拒絕時停止讀取，不繞回 Firestore，並顯示重新登入提示。

後端同步是非同步的，寫入成功後畫面更新可能稍晚。Firestore 中的交易資料仍為準。場景或群組切換會關閉監聽；即使 token 請求尚未結束，也不能在離開場景後重新掛上舊監聽。

若需回退，把 REALTIME_READS_ENABLED 改回 false 並發布即可，Firestore 原資料始終保留，不需反向搬資料。後端鏡像函式仍會執行，若要停止其執行需另行調整部署。

## 本次驗證與限制

已通過：

- node --test tests/realtime-core.test.mjs：序列化、版本、刪除、群組收件者同步、缺少鏡像時回退、取消監聽、拒絕權限不回退。
- node tests/realtime-browser.cjs：啟用開關的隔離 RTDB 模擬，真實聊天室與 Phaser 農場畫面能讀取更新，沒有為聊天／農場資料建立 Firestore listeners。
- node tests/chat-members.cjs、node tests/farm-poultry.cjs：關閉開關時既有成員與養殖流程回歸。
- Functions 入口載入與 Node 語法檢查。

**尚未執行成功：正式部署、正式資料匯入，以及 Firebase RTDB Emulator 權限測試。** CLI 回覆未登入；環境指定的 Google 憑證檔不含有效 client_email。模擬器 JAR 下載也遭環境網路回覆 403 Domain forbidden，因此必須在可下載的環境執行 realtime-rules.cjs 後再啟用。未聲稱已驗證正式 Firebase 或已完成線上切換。
