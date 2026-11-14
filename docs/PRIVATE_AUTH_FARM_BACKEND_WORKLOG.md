# 私有登入與農場後端化工作紀錄

2026-11-14（台灣），使用者已同意此範圍。正式資料與部署仍待隔離驗證及切換程序。

## 實作階段

1. 私有憑證（scrypt）、穩定 profile/accountId 對應、伺服器限流、Firebase Auth 工作階段。
2. 私有登入／註冊／改密碼與既有 photoSession/liveSession/個人記帳橋接；瀏覽器不再保存密碼。
3. 具備 dry-run／stage／purge 分離的資料遷移；保留 users 文件 ID 與 accountId，不建立第二套金幣。
4. 受保護的群組資格、邀請與群組管理命令；公開 user.role 不授予遊戲／平台後端權限。
5. 農場共用交易、戰鬥會話、冪等收據與可信任每日任務進度。
6. 前端命令切換及正式 Rules；全部寫入者驗證完成前不封鎖正式遊戲或啟用 producer。
7. Emulator／瀏覽器回歸，完整切換與回復程序，最後才安排正式部署。

## 邊界

- 不直接修改正式帳號、移除正式密碼、重設玩家資源或部署未測規則。
- Namespace 分離玩家 Auth UID 與 Firebase 管理員 UID；profile 文件 ID 仍是每日挑戰與管理控制的邏輯識別，避免遷移後重領或重設簽到。
- 原始 Rules 是全庫公開到 2026/12/16 台灣 08:00；過渡 ops 保護不是最終防護。
- 原遊戲／報表觀測器不是可信任每日任務 producer。
- 執行環境 Emulator JAR 下載曾被網路代理 403 阻擋，不能以 MemoryDB 測試代替正式 Rules 驗收。

## 剩餘接線完成（2026-11-14，台灣）

已實作 scoped 管理、現有農場畫面到共用 callable 的接線、怪物伺服器會話、三項每日任務的原子計次、歡迎禮與首次建檔、Storage／RTDB／森林相容性、完整規則候選與維護切換工具。正式開關仍關閉。

本地驗證與待執行的正式前置，改以 `PRIVATE_AUTH_FARM_BACKEND_STATUS.md` 及 `PRIVATE_AUTH_FARM_BACKEND_RUNBOOK.md` 為準；前面的階段清單是起始規劃，不代表仍缺少這些程式接線。
