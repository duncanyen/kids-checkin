# 咕咕村落收蛋 API 與讀取優化

2026-11-14（台灣）。本次不變更 Firestore 結構、Rules、獎勵、產蛋週期或怪物機率，也不重新遷移帳號。

## 請求與相容性

- 新前端送出既有 `gameOpsFarmTransaction`：`action: "homeEncounter"`、`collectWhenClear: true` 及原有唯一 `requestId`。
- 後端沿用既有怪物判定。無怪物且具有收蛋資格時，在同一筆交易收蛋，回傳 `result.harvest`；怪物存在時只回傳原 challenge，不收蛋、不增加收蛋任務進度。
- 前端收到 `harvest` 後直接顯示結果，不再呼叫 `collectEggs`。收蛋快照仍由原訂閱更新，不先行改寫玩家資產。
- 舊後端會忽略新旗標且不回傳 `harvest`，新前端便接續原本的 `collectEggs`。舊前端不送旗標，也維持原流程。因此前端、Functions 可分開發布。
- 尚待補結算的勝利／逾時事件保留原結算回覆，再走既有收蛋流程，避免把擊退與收蛋兩種任務事件互相覆蓋。這類情境不宣稱只需一次請求。
- 收蛋、產量統計、每日任務事件與防重收據原子提交。相同請求重送回傳原收據；不同裝置不能重收同一批蛋。

## 後端讀取

- `player` 沿用同次私有驗證已取得的 profile，避免再次讀取 `users`。
- 帳號限制與群組資格平行讀取；每日任務當日文件與連續天數狀態也平行讀取。
- 農場交易中的文件讀取以 `transaction-reads.cjs` 共用同一份 Promise。快取只存在於一次交易 callback，Firestore 重試會重新建立。
- Query 不快取；寫入後不使用快取，仍由 SDK 檢查 read-before-write。前置身分驗證與交易內權限驗證保持獨立，不跨兩個階段或跨請求共用快照。
- 自家目標沿用已驗證名稱，不再為自己的 accountId 查詢 `users`。

## 驗證

| 項目 | 本次結果 |
|---|---|
| 全部既有與新增單元測試 | 316 項通過 |
| Phaser 3.60.0、新前端＋新後端隔離測試 | 無怪物收蛋 1 次 `homeEncounter`、0 次 `collectEggs`；連點、任務計次與後續遊戲流程通過 |
| Phaser 3.60.0、新前端＋模擬舊後端 | 正確退回 1 次 `homeEncounter`＋1 次 `collectEggs` |
| 原子性與邊界 | 多裝置、重送、倉庫滿／部分收蛋、空蛋、怪物阻擋、勝利補結算、逾時損失、失敗重試與憑證撤銷通過 |
| 文件讀取計數 | 相同私有帳號、3 顆蛋、無怪物的 MemoryDB 測試：優化後兩段流程 34 次，合併流程 19 次 |
| 本環境真實 Emulator | 未通過；下載 Firestore Emulator 被網路政策以 HTTP 403 Domain forbidden 阻擋，未執行新版本的真實 SDK 合約測試 |
| 正式資料與部署 | 本次未存取或修改正式玩家資料，未執行 Firebase deploy |

讀取數是隔離測試對文件快照的計數，包含身分驗證、限流及任務相關讀取；不是正式帳單或延遲量測。正式等待時間仍受 cold start、資料庫位置與網路影響，不承諾固定秒數或耗時改善百分比。

## 發布程序

1. 在 Cloud Shell 更新至本次提交，保留現有 `.env.homebasedb`，以原測試工具執行 `node scripts/test-private-farm.cjs --emulator`。本次已將合併收蛋與收據重送加入真實 callable Emulator 測試；三項通過後再部署。
2. 只需更新 `nexus-ops`。不需要重新部署 Rules、重跑 `stage`／`purge`／`activate`，也不需要更新 `nexus-live`。

```bash
(
  set -e
  set -o pipefail
  cd ~/kids-checkin
  export NEXUS_TEST_TOOLS="$HOME/.nexus-test-tools"
  export PATH="$NEXUS_TEST_TOOLS/node_modules/node/bin:$NEXUS_TEST_TOOLS/node_modules/.bin:$PATH"
  npm --prefix game-admin/functions ci
  node scripts/prepare-game-admin.cjs
  cd game-admin
  firebase deploy --only functions:nexus-ops --project homebasedb
)
```

3. 等 GitHub Pages 發布並強制重新整理，以 Network 檢查一次無怪物收蛋：應只有一筆 `gameOpsFarmTransaction`，請求 action 是 `homeEncounter` 且 `collectWhenClear` 為 true，回覆包含 `result.harvest`。首次建立玩家工作階段的 Auth／橋接請求應另外辨識。
4. 檢查雞蛋入庫數、雞舍剩餘蛋數、任務有效操作計次、倉庫不足與怪物出現時的行為。若後端尚未更新，觀察到兩段流程屬預期相容行為，不要因此放寬規則或取消後端驗證。
