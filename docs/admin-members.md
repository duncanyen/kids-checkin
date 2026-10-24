# 家族成員管理

群組成員資格以 `groups/{groupId}.members` 的 accountId 為準。`users.groupId` 僅為舊版個人群組欄位，不能代表一個帳號參與的多個群組，後台不再用它篩選名單。

後台使用共用成員查詢，以 accountId 分批讀取有效的 users 資料，並保留真實文件 ID 供編輯。開啟列表、群組成員變動、瀏覽器返回頁面時會更新；切換帳號或群組後重新載入，避免沿用舊群組。過期查詢結果不覆寫新名單。

- 新增成員：transaction 同時建立個人資料與加入目前群組；失敗不留半套資料。既有帳號請用邀請碼加入，避免複製帳號。
- 審核通過：重用既有 accountId 對應的個人資料；舊申請的 userId 若為文件 ID，先讀取其 accountId。transaction 同時更新名單與申請狀態。
- 編輯：使用文件 ID 與 accountId 辨識目標，送出前確認仍在群組。同名成員不會被當成目前登入者；只調整權限時可保留既有密碼格式。
- 退出：僅從目前群組 members 移除 accountId，不清除個人 groupId、不設為全站 removed，也不變動其他群組。

姓名、密碼、角色與 menus 沿用既有 users 欄位結構；本次沒有遷移為各群組獨立的個人設定。已停用（role=removed）的帳號不列入有效成員。

驗證使用實際後台搭配記憶體 Firestore，不讀寫正式資料庫：

```sh
ADMIN_BASE_URL=http://127.0.0.1:8012 node tests/admin-members.cjs
```
