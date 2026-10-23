# 許願牆群組與帳號資料

目前群組優先取 `lastGroupId`，登入資料的 `groupId` 只供舊版相容。
沒有 groupId/accountId 就停止載入，不使用 default_group、unknown_account 或姓名代替。
進入及每次寫入都檢查 `groups/{groupId}.members` 與最新使用者資料；
成員顯示以 members 內的 accountId 查詢 users，包含已加入多群組的成員。
切換群組、恢復舊頁面會重新載入，避免沿用前一群組的畫面。

## 保存位置

| 路徑 | 用途與識別 |
| --- | --- |
| groups/{groupId}/settings/wishWall | 群組共用考試規則、家事規則、獎品；groupId、accountId 記錄最後設定者，createdByAccountId/updatedByAccountId 供稽核 |
| groups/{groupId}/scores/{id} | 成績、家事；groupId 與擁有人 accountId，operator 僅為顯示用歷史名稱 |
| groups/{groupId}/redeems/{id} | 兌換；groupId、擁有人 accountId、giftId 與當次花費；更新狀態不變更擁有人，updatedByAccountId 記錄操作者 |
| groups/{groupId}/messages/{id} | 原有許願通知；包含 groupId、操作者 accountId，與兌換/取消同一筆交易保存 |
| groups/{groupId}/settings/wishWallRevision | 寫入版本與操作者稽核，防止並行兌換使用過時積分 |

設定是群組共用，不會按管理者切成互不相通的設定。新建規則與獎品也帶有 groupId/accountId。
積分以帳號計算，仍沿用原本依規則回算歷史考試累積次數的行為。
改名不需要搬動紀錄，同名帳號不合併積分。儀表板只列目前成員，歷史資料不刪除。

兌換先取得版本，再取得本人紀錄 ID；Firestore 交易重新讀取版本、規則、成績、
兌換與群組成員資格。若紀錄集合有新增/刪除，版本差異會觸發重新查詢。
所有新版許願牆寫入都更新版本。獎品價格與可用積分由最新資料計算，
兩個視窗不能重複使用同一份積分。取消/駁回以狀態回算退點，重複操作不重複退款；
已完成、已取消、已駁回是終止狀態。管理者資格也以最新 users.role 檢查。

## 舊資料

已在正確群組路徑、帶 accountId 的紀錄可直接使用，無需改寫歷史 operator。
缺少 groupId、但已位於群組子集合的舊紀錄，由路徑判定群組；有明確矛盾 groupId
的紀錄不顯示或計分。沒有 accountId 的舊紀錄不按姓名猜測歸屬。
管理者在「得分紀錄審核」或兌換清單，可選擇目前群組的帳號「確認歸屬」。
綁定會保存 groupId/accountId 及更新者，然後重新計算積分。

root 共用集合或 default_group 內的舊資料保留原處，不會自動複製到其他群組，
因為無法可靠推斷其群組與帳號。

## 驗證

- `node --test tests/wishwall-core.test.mjs`
- 開啟本機靜態伺服器後，`WISH_BASE_URL=http://127.0.0.1:8011 node tests/wishwall-browser.cjs`

瀏覽器測試使用持續存在的記憶體資料庫及交易版本衝突重試，驗證群組切換、同名、
改名、設定保存、舊資料綁定、並行兌換、最新價格、取消退點、權限及退出群組。
測試不會讀寫正式 Firebase 資料。程式端檢查不取代部署端的 Firestore 存取規則。
