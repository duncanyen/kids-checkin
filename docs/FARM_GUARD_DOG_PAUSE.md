# 護衛犬回倉庫、剩餘時間與換犬

日期：2026-11-10。

## 使用流程

1. 租後先存倉庫，尚未啟用不扣時。
2. 啟用後開始值勤，離線期間照常扣時。
3. 點倉庫內的值勤犬，選「解除護衛並保留時間」。犬隻回到倉庫，精確保存剩餘租期，不退金幣、不再扣時。
4. 可啟用另一犬。原犬下次啟用時繼續使用餘額，不再次付費，也不恢復原本整天租期。
5. 同時仍只能一隻值勤，同品種仍最多持有一隻。只有值勤犬攔截偷蛋。

例：日租犬使用 6 小時後回倉，保存 18 小時；在倉庫放 20 天，仍有 18 小時。再用 1.5 小時並回倉，會保存 16.5 小時。

## 資料與交易

沿用 `groups/{groupId}/users/{accountId}.farm.guardDogs` 陣列，租約新增 `remainingMs` 安全整數毫秒欄位，不新增集合。

| 狀態 | startedAt | expiresAt | remainingMs 的用途 |
| --- | --- | --- | --- |
| 未啟用／回倉待命 | null | null | 固定可用餘額，不隨時間減少 |
| 值勤 | 本次啟用時間 | 啟用時間＋保存餘額 | 本次啟用時的餘額快照；即時餘額必須用 expiresAt－目前時間 |

租約的 `days`、`paid`、`rentedAt` 與 ID 保留，不重新購買。顯示統一使用 `guardDogRemainingMs`／`guardDogStatus`，介面到分鐘，後端保存到毫秒，不因顯示進位而多送時間。

- 後端 `gameOpsGuardDog` 以交易內伺服器時間計算餘額，不採信客戶端傳來的 remainingMs、days、expiresAt 或 accountId。
- `pause` 保存餘額並回倉；`resume` 使用餘額啟用。既有 `release`／`activate` 名稱也由新版後端套用相同規則，保護舊客戶端。
- 既有冪等收據維持作用：重送舊的解除／啟用收據只回傳先前結果，不重套狀態、不重新增加時數。
- 不同請求 ID 重複暫停待命犬是無操作。再次啟用已值勤犬仍被拒絕，避免重設租期。
- 同時啟用不同犬由交易保證只成功一筆。扣款、其他犬種與遊戲資料不受影響。
- 待命餘額為零、非法或超過原本付費時數時不回退成完整租期。值勤到期後不能暫停或復活。

## 舊資料相容與版本保護

- 舊待命租約沒有 remainingMs：首次啟用使用原 days × 24 小時。
- 舊值勤租約沒有 remainingMs：第一次暫停保存 expiresAt－伺服器時間。
- 不批次改寫正式玩家資料，不自動補回先前依舊規則已刪除的租約。
- 後端 catalogue 宣告 `leasePolicy: pausable-v1`。新前端確認此能力後才啟用或暫停，否則顯示服務更新中。
- 新前端使用新的 `resume`／`pause` 動作。即使部署切換時請求落到舊服務，也只會因未知動作被拒絕，不會觸發舊的刪除租約或重算完整天數。
- 新資料存在後，不應直接將後端回退至會刪除租約／忽略 remainingMs 的舊版；需回復時保留本次餘額處理能力。

既有護衛犬 Rules fragment 保護整個 guardDogs 陣列，因此新欄位也應禁止客戶端直接改寫。本次沒有修改正式 Security Rules；Repository 不包含可確認的完整正式 Rules，正式合併與部署狀態未驗證。

## 測試

| 測試 | 結果 |
| --- | --- |
| 模型＋護衛服務：精確毫秒、暫停／恢復、離線待命、重送、偽造時數、交易失敗、並行啟用、過期不可恢復 | 21/21 通過 |
| 營運後端完整單元測試 | 40/40 通過，包含前項服務案例，不能直接相加 |
| 柯基行為與下蛋回歸 | 13/13 通過 |
| 暫停專項瀏覽器 | 通過：六小時後回倉餘 18h、放置 20 天、恢復不收費、換犬後餘 16.5h、舊服務不送出破壞性操作 |
| 完整護衛犬瀏覽器 | 通過：原價格、防守、通知、租期、犬種切換及柯基行為回歸 |
| git diff --check | 通過 |
| 真正 Firestore 交易與 Rules Emulator | **未能執行**：Emulator JAR 下載遭環境網路拒絕，HTTP 403 `Domain forbidden` |

新增的 Emulator 測試檔已通過語法檢查，但不宣稱通過實際 Emulator，也不將 MemoryDB／瀏覽器隔離測試當成正式 Firestore 或真機驗收。

### 在可下載 Emulator 的環境執行

```bash
npm --prefix functions ci
npm --prefix game-admin/functions ci
node scripts/prepare-game-admin.cjs
npx firebase-tools@14.27.0 emulators:exec --config game-admin/firebase.test.json --only firestore,auth --project demo-nexus-ops 'node --test --test-concurrency=1 game-admin/tests/emulator.integration.cjs game-admin/tests/guard-dog-rules.emulator.cjs'
```

只使用 demo 專案與本機 Emulator，測試沒有正式資料庫回退路徑。新增案例包括真正並行啟用、暫停餘額、重送，以及玩家不能直接修改 paused remainingMs／startedAt／expiresAt。

## 正式部署

本次沒有推送、沒有部署。需取得本次版本並完成上述 Emulator 驗證，再同步部署後端；只更新 GitHub 前端不會讓新租約規則生效。

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

部署前會自動執行 `scripts/prepare-game-admin.cjs`，打包新版共用模型。若 GitHub Pages 已更新但後端尚未完成，暫停／啟用會顯示服務更新中，保留現有租約不變。部署後以測試帳號確認回倉餘額、重登入與換犬，再開始正式使用。

## 檔案

- `js/farm/guard-dog-core.js`：餘額、啟用、暫停、過期與狀態顯示。
- `js/farm/guard-dog-store.js`：版本檢查及新動作。
- `js/farm/guard-dog-ui.js`：倉庫、按鈕、保留時間說明。
- `game-admin/functions/{service,management}.cjs`：新動作與能力宣告。
- `tests/farm-guard-dog.test.mjs`、`tests/farm-guard-dog-browser.cjs`：新規則及既有流程回歸。瀏覽器可用 `GUARD_PAUSE_ONLY=1` 只跑暫停情境；各獨立測試情境的租約清理僅存在隔離 fixture。
- `game-admin/tests/{guard-dog-service.test,emulator.integration,guard-dog-rules.emulator}.cjs`：後端與 Emulator 案例。
- `docs/DATABASE.md`、`docs/farm-guard-dogs.md`、本文件與截圖：資料模型及操作說明。

[回倉庫保留 18 小時](images/guard-dog-pause/paused-18-hours.webp) · [換犬後保留 16.5 小時](images/guard-dog-pause/switched-remaining.webp)

以上為隔離測試資料與實際頁面截圖，不是正式玩家資料。
