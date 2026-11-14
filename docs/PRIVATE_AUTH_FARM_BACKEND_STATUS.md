# 私有登入與咕咕村落後端化完成狀態

2026-11-14（台灣）。**剩餘程式接線已完成；正式上線驗證尚未通過，未部署、未遷移正式資料。**

本功能包含前次私有登入基礎與這次剩餘接線。前端兩個開關仍為 false；正式環境不會因本工作區的程式變更自動切換。

## 已完成的程式

| 範圍 | 完成內容 | 主要檔案 |
|---|---|---|
| 私有登入 | salted scrypt、原帳號／PIN相容、namespace Auth UID、限流、註冊唯一性、改名／改密碼、憑證版本撤銷、刪除登入帳戶 | functions/identity-*.cjs、js/private-auth-client.js |
| 群組資格 | 建立／加入、私有邀請、目前成員驗證、scoped roles、移除成員後旋轉邀請碼、擁有權移轉 | functions/identity-groups.cjs、functions/identity-admin.cjs、js/group.js、js/admin.js |
| 管理邊界 | 不用暱稱或全域角色授予管理權；獨立帳號的個資與密碼由本人管理，託管帳號才允許群組重設 | 同上 |
| 農場共用交易 | 真實 callable、伺服器計價與時間、原子收據、固定 requestId 重試、存檔完整性與數值檢查 | game-admin/functions/farm-transactions.cjs、js/farm/backend-client.js |
| 原有遊戲接線 | 首次建檔、產蛋、收蛋、清潔、協助清潔、商店買賣、裝備、放風、餵食、治療、丟棄、菜園、偷蛋、歡迎禮及信箱 | js/farm/MyFarmScene.js、VisitScene.js、ShopScene.js、WarehouseScene.js、save-store.js、mail-store.js |
| 八種怪物 | 後端隨機／里程碑觸發、持久會話、武器持有／傷害、期限與攻擊速率、勝負及掉落／損失；客戶端 outcome 不發獎 | game-admin/functions/farm-combat.cjs、各 boss store／Encounter |
| 防事件繞過 | 收蛋與偷蛋須先經後端怪物檢查；未知會話／超量攻擊／過期勝利拒絕；目標村落改封閉後不會卡住自己的結算 | 同上 |
| 每日任務 | 有效收蛋操作、協助其他成員清潔、伺服器確認的怪物勝利，與原交易原子計次；所有任務達標才可領獎 | game-admin/functions/daily-challenges.cjs、service.cjs、js/farm/daily-ui.js |
| 登入相容性 | 預設 App 恢復 Auth、舊瀏覽器密碼清除、群組／個人記帳、Photo Dump、成長森林、即時讀取橋接；私有模式森林使用 cloud transport | js/firebase-config.js、personal-ledger.js、gallery-storage.js、growth-forest/*、live-read-platform.js |
| 照片與即時資料 | 舊 profile-ID 照片擁有者路徑保留；Storage 兩筆文件存取限制、群組角色更新、RTDB UID／sessionVersion 及憑證鏡像 | rules/storage.private-farm.candidate.rules、rules/database.private-farm.candidate.json、functions/mirror.cjs、liveIdentityMirror |
| 規則候選 | 保護 users 憑證／角色、groups 資格、farm／租約／歡迎收據及全部 ops_ 根集合，避免 broad allow 覆蓋限制 | rules/firestore.private-farm.candidate.rules |
| 遷移與暫停 | 唯讀盤點、私有影本、人工角色核對、憑證／邀請碼清除、版本與備份檢核後 activate；緊急 freeze 不受 Rules 異常阻擋 | functions/migrations/*、scripts/identity-migration.cjs、scripts/private-cutover.cjs |
| 可重跑驗證 | 一次執行單元、六組瀏覽器及五種 Emulator；報告綁定程式與三套 Rules 雜湊，未通過拒絕正式啟用 | scripts/test-private-farm.cjs、private-code-hash.cjs |

沒有第二套金幣餘額；仍更新原本的 `groups/{groupId}/users/{accountId}.farm`。所有帳號及群組 ID 都保留，只有 Firebase Auth UID 使用 namespace。每日領獎仍使用原 profile ID，因此不會重新領取或重設連續天數。

每日簽到預設為第 1～6 天各 100、第 7 天 1,000；每日任務預設仍為 200／400／600／800／1,000／1,200／2,000。正式文件若另有設定，以實際設定與當日快照為準，本次不覆寫正式設定。

## 本次實際驗證

- 單元與現有適用回歸：**303 項通過、0 項失敗**。
- 六組 Chromium 隔離測試通過：舊登入、私有登入、個人設定、私有群組管理、既有存檔生命週期，以及真實 Phaser 遊戲與後端接線。
- 真實 Phaser 測試走完收蛋、購買、裝備、拜訪、清潔、偷蛋、怪物攻擊／勝利結算，並查到三項任務各自正確計次。測試把前端直接 Firestore 寫入一律設為錯誤，流程仍成功。
- 同時請求、相同／不同 requestId、換群組／舊領獎 ID、空收蛋、清潔自己、偽造勝利、過密攻擊、八種怪物及期限損失均有隔離驗證。
- 修正既有 Photo Dump 測試的 DOM 替身：找不到的節點回傳 null；未以修改 Photo Dump 正式行為來讓測試過關。
- 已檢查變更 JavaScript 語法與 Git Diff 空白錯誤。

上述結果使用 MemoryDB／SDK 替身及 Chromium，**不是正式 Firebase、真機或正式資料遷移成功的證明**。

## 未通過的驗證與上線前置

1. 已實際執行五種 Emulator 的完整命令，但下載 `cloud-firestore-emulator-v1.19.8.jar` 被網路代理回覆 **403 Domain forbidden**。已確認下載網域列於環境草稿，但尚未套用到執行中環境；目前工具無法代為套用。Emulator 未啟動，Firestore／Storage／RTDB Rules 編譯與真實 Auth／Functions 契約測試均未執行成功。
2. 報告保留 `emulatorPassed=false`，不可用它 activate。這不是測試略過後視為通過。
3. 尚未設定或使用正式 Google Cloud 部署身分；未查驗正式 release、未執行正式備份、stage、purge、activate 或 Firebase deploy。
4. 正式帳號／群組角色需人工核對，尤其過去 Rules 曾全庫公開，不能推定歷史資料未被修改。本次不重設玩家資產。
5. 正式切換前仍需通過隔離環境與 iPhone／Android／平板真機驗收。切換時舊登入需重新登入一次，帳號與原密碼／PIN不變。
6. 新邀請碼會取代原公開邀請碼。刪除登入帳戶保留歷史資料及帳號 ID，不重新開放該 ID 註冊，避免接手舊帳資產。

完整切換順序、指令、維護與回復邊界見 [操作程序](PRIVATE_AUTH_FARM_BACKEND_RUNBOOK.md)。變更會保存為本地 Git Commit，尚未推送 GitHub，也未變更正式環境。

## 審查材料

- [累積修改檔案清單](PRIVATE_AUTH_FARM_BACKEND_FILES.md)
- [隔離測試報告 JSON](PRIVATE_AUTH_FARM_BACKEND_VERIFICATION.json)
- [實際 Chromium／Phaser 畫面](screenshots/private-farm-backend-isolated-mobile.png)

目前完成的是登入與農場權威交易的開發，不宣稱已完成整個 Nexus 平台所有資料與前端 DOM 注入風險的安全稽核。戰鬥驗證也不等同防外掛或伺服器重演全部弓箭物理。RTDB 撤銷經非同步鏡像傳播，不能宣稱跨資料庫原子撤銷。
