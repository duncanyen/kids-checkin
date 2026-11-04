# 正式部署狀態

使用者已授權正式部署及推送 GitHub。本次先提交原始碼；正式部署因以下實測阻擋未執行，營運開關維持關閉。

- Firebase CLI `firebase projects:list --json --non-interactive` 回報 `Failed to authenticate, have you run firebase login?`。目前執行環境沒有可用的 Firebase 部署身分；雖有 ADC 路徑變數，身份 manifest 的 connections 為空，不能據此視為已有授權。請透過可信任環境／身分連線設定提供具有目標專案部署權限的身分，不要在對話貼密鑰。
- 官方 Emulator 檔案主機 storage.googleapis.com 仍由代理回覆 403；必要 Emulator 與 Security Rules 整合測試尚未執行。該網域已在環境草稿，需將設定套用到執行機器。
- 正式 Firestore 規則尚未提供，既有遊戲經濟仍由前端直接寫入；必須先完成相容遷移並移除寬鬆 allow。測試用全拒絕規則絕不可直接部署取代正式規則。
- 尚未綁定獨立 Hosting site，App Check site key 亦未設定；Auth 須由專案擁有者完成並驗證；Identity Platform／TOTP MFA 為選用設定，不是密碼登入的前置條件。

已通過的測試為後端 10 項隔離測試、既有 120 項單元測試、管理端桌面／手機流程、玩家公告兌換與既有通知回歸。實際 Firebase MFA／Emulator 測試不可由這些替身測試替代。

取得身分與規則、解鎖下載後，依 README 補齊整合驗證，再部署獨立 nexus-ops Functions codebase 及 nexus-game-admin Hosting target；不應重新詢問已授權的部署意願。完成後再啟用玩家營運開關。

2026-11-05：MFA 已改為選用，須一起發布管理站與 `gameOpsAdmin` Functions 更新；後端仍驗證 admin claim、帳號未停用及目前管理員角色。既有已綁定 MFA 的帳號仍由 Firebase 要求第二因素，不自動解除。
