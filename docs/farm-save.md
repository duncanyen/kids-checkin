# 農場存檔：避免慢網路誤初始化

## 原因與修正

原本 MyFarmScene 在監聽收到 `exists() === false` 時，直接 `setDoc({farm: 初始值}, {merge:true})`。Firestore 初始快取可能暫時沒有這份文件；直接寫入不會重新確認伺服器是否已有農場，合併寫入仍會覆蓋 coins、hens、雞蛋和倉庫等同名欄位。舊版 farmgame.js／phaser-farm.js 也有相同初始化風險。

現在所有初始化共用 `js/farm/save-store.js`：

- 以 Firestore transaction 重新讀取伺服器的群組與農場，驗證目前 groupId/accountId 仍為成員。
- 既有農場只讀取，不補初始欄位、不覆寫 farm。零金幣、零隻雞仍是有效存檔。
- 文件已存在但 farm 缺少必要資料、為 null 或有錯誤型別時，停止初始化並顯示重試，不把錯誤資料當成新玩家。
- 僅在伺服器確認農場文件不存在、沒有建立紀錄，且本次連線未看過既有農場時，才可建立初始存檔。
- 建立農場與 `groups/{groupId}/users/{accountId}/farm_meta/creation` 紀錄在同一交易完成。並行首次進入會重試、只建立一次；既有存檔在交易期間出現時，交易重讀後保留它。
- 交易離線失敗不會像一般 setDoc 一樣排入待同步的初始資料，因此不會在恢復連線後用初始金幣／雞數覆蓋存檔。

建立紀錄目前適用於這版首次建立的農場；它不是備份。若先前建立過的農場文件被刪除而子集合仍存在，可以阻止靜默重建。本次不修改既有帳號的資產，也不聲稱能還原已被舊版覆蓋的歷史資料。

## 載入與重連

BootScene 維持單一自己的農場 session，MyFarmScene 共用 registry 裡最後確認的資料，切換場景不重新初始化。快取空白、尚未送達伺服器的寫入、讀取失敗都不能觸發直接寫入初始值。初次載入顯示「讀取存檔中」與 `—`，不是零金幣；已有確認資料時，斷線保留最後的畫面數值。

尚未確認連線時不開放由農莊按鈕進入商店、倉庫或村落，也暫停自動生蛋更新；點擊存檔狀態可重試，瀏覽器 online 事件也會重新確認。延遲驗證完成後，不會用舊資料蓋過更晚到達的伺服器更新。遊戲銷毀後，停止監聽、重連事件與後續初始化。

RTDB 讀取開關仍關閉；此防護亦適用於未來 RTDB 缺少鏡像而回退 Firestore 的情況。初始化永遠以 Firestore 伺服器交易為準。

## 驗證

```sh
node --test tests/farm-save.test.mjs
node tests/farm-save-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8012 node tests/game-group-isolation.cjs
node tests/farm-poultry.cjs
node tests/farm-mail-browser.cjs
node tests/realtime-browser.cjs
```

全部使用隔離資料，不寫正式 Firebase。覆蓋慢網路空快取、離線及重連、伺服器仍有金幣／雞種／雞蛋／倉庫時零初始化寫入、並行建立、較新存檔勝出、不完整資料保留、建立紀錄保護、切換群組與既有養殖及通知流程。

正式 Firestore Rules 需允許合法建立農場的交易建立本人 farm_meta/creation，並避免任意刪除該建立紀錄。本專案未管理正式 Firestore Rules，尚未實測正式權限；規則拒絕時會停止建立並提示重試，不會改用不受保護的寫入。

## 已發生資料遺失

本次修正不能推算遺失前的餘額與雞種。若正式資料已被覆蓋，需先保留現況，再檢查事前已啟用的 Firestore PITR／備份或既有匯出資料，核對正確 groupId/accountId 後另行還原；沒有備份時不能保證恢復。
