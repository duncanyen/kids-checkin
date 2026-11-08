# 商店商品開放狀態與租犬交易（2026-11-09）

## 商品設定

| 商品 | 狀態 | 價格與保留規則 |
| --- | --- | --- |
| 邊境牧羊犬 | 展示、尚未開放租用 | 日租 200、週租 1,000；80% 攔截、4 小時禁偷、60% 活潑巡邏維持原設定 |
| 日本長尾雞 | 正式開賣 | 買 6,000、賣 3,000；每 6 小時產 1 顆、每日產能 4 顆；蛋賣 120 |

護衛犬共用 `GUARD_DOG_BREEDS[breedId].rentable`，邊牧為 false，其餘犬種為 true。商店卡片保留圖片、名稱、能力與價格，增加「🔒 即將開放」。可開啟商品詳情，日租、週租與送出控制停用並顯示「尚未開放」。不靠停用控制當作權限保護。

日本長尾雞沿用 `BREEDS.onagadori.purchasable=true`。購買仍走既有 Firestore transaction／tradePoultry，檢查最新餘額、數量及雞舍容量，新增獨立雞隻 ID 與產蛋時鐘；isProcessing 防止同時重複點擊。出售及蛋價、產能、倉庫、放風、治病規則沿用原模型。

## 可信任的護衛犬操作

新增同一 nexus-ops codebase 的 callable `gameOpsGuardDog`，支援 rent、activate、release、expire。玩家端透過既有 photoSession 取得 Firebase Auth 身分；後端驗證目前 users profile、停用狀態、群組資格與操作資料，並限速。沿用既有 App Check 選用政策。

- 伺服器從打包的共用 guard-dog-core.js 讀取價格與 rentable，不接受客戶端價格、開放旗標、扣款數或帳號。
- 關閉的商品在建立租用收據或農場修改前拒絕，即使前端把 rentable 改成 true 也無效。
- 金幣、guardDogs 清單及 ops_guard_requests 收據在同一筆 Firestore transaction 完成；重送沿用 requestId，重試不重複扣款。收據以 UID 與 requestId 雜湊識別，保留操作 fingerprint 以防不同操作共用識別碼。
- 啟用、解除與到期也由後端處理，才能完整禁止玩家直接改寫 guardDogs 清單，包括把其他犬種改成邊牧或延長租期。
- 舊租約不重算價格，原 paid／days 保留；已租的邊牧仍能啟用、巡邏與防守，到期或解除仍照原規則。
- 各操作只修改原有 farm.coins／farm.guardDogs 的內容；農場其他欄位及同文件其他資料保留。新集合只有伺服器使用的 ops_guard_requests，沒有批次改寫玩家現有存檔。

## 必須完成的 Security Rules 整合

**目前儲存庫沒有正式 Firestore Security Rules，尚未完成正式規則合併。僅部署 callable 無法阻止既有寬鬆規則允許的直接 Firestore 寫入。**

`game-admin/rules/firestore.guard-dogs.fragment.rules` 提供 guardDogsPreserved()。必須把它與現有權限條件以 AND 合併到所有涵蓋 groups/{groupId}/users/{accountId} 的 create/update allow，確保一般遊戲更新可寫入其他欄位，但不能新增、刪除、替換或延長 guardDogs。禁止玩家存取 ops_guard_requests 的片段在 firestore.ops.fragment.rules。

不能只新增一段 deny：Firestore 會把多個 match 的 allow 取 OR，舊有 root／group 遞迴 allow 仍可繞過。須先取得目前正式規則，逐一保留既有權限並收斂涵蓋農場的寬鬆 allow。不能部署測試用規則取代正式規則。本次沒有修改或部署正式規則，也不能宣稱線上已封鎖所有直接寫入。

## 發布順序

1. 先在可信任環境部署新的 Functions，並整合、測試及發布正式 Firestore 規則。
2. 再發布玩家前端並要求重新整理，讓租犬／啟用／解除改呼叫後端。**不要只發布前端，否則未更新的後端無法處理護衛犬操作。**
3. 驗證關閉商品、其他兩犬的租用與倉庫操作、日本長尾雞購買、蛋出售及母雞回售。

後端部署指令（需先取得這次原始碼）：

```bash
npm --prefix game-admin/functions ci
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

之後重新開放邊牧：調整同一份 rentable=true，先部署後端，再發布前端；不需修改既有租約。

## 驗證及限制

- 純邏輯測試：價格、關閉拒絕、原租約保留、機率與產蛋／出售數值。
- 後端測試：匿名／非群組拒絕、偽造前端商品狀態仍被拒絕、零扣款／零租約／零收據、伺服器定價、並行操作與重送、寫入失敗回滾及舊租約啟用／解除／到期。
- 瀏覽器：實際 Phaser 商品卡片、停用控制、手機與桌面、日本長尾雞購買及連點防護、金幣不足、產蛋、蛋出售及回售；其餘兩犬與既有邊牧的正常流程。使用隔離資料與傳輸替身，不讀寫正式玩家資料。
- `game-admin/tests/guard-dog-rules.emulator.cjs` 準備了直接 Firestore 新增、覆寫、延長、刪除租約與偽造收據的拒絕案例。測試啟動時下載 Firestore Emulator JAR 被環境代理以 403 Domain forbidden 拒絕，**尚未成功執行規則 Emulator 測試**。

```bash
node --test tests/*.test.mjs tests/*.test.cjs
node scripts/prepare-game-admin.cjs
npm --prefix game-admin/functions test
node tests/farm-announcements-client-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-guard-dog-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 node tests/farm-onagadori-browser.cjs
# 需要能下載 Firestore Emulator 的環境：
# firebase emulators:exec --only firestore --project demo-nexus-ops --config game-admin/firebase.test.json 'node game-admin/tests/guard-dog-rules.emulator.cjs'
```

## 本次測試結果

| 檢查 | 結果 |
| --- | --- |
| 儲存庫單元測試 | 181／181 通過 |
| 營運後端測試 | 22／22 通過，含真實 callable HTTP middleware 的未登入拒絕與關閉商品拒絕 |
| 玩家 API 瀏覽器測試 | 通過；護衛犬請求身分、重送收據與既有公告／兌換流程 |
| 護衛犬瀏覽器流程 | 通過；其他兩犬正常租用、付款、啟用、解除與到期；邊牧關閉 UI／API 拒絕、原租約仍可使用；手機與桌面 |
| 日本長尾雞瀏覽器流程 | 通過；開賣、6,000 購買、連點僅一筆、餘額不足、產蛋與收蛋、蛋售 120、回售 3,000；手機與桌面 |
| Security Rules Emulator | 未執行成功；JAR 下載 403 Domain forbidden |
| 額外舊分類整合測試 farm-item-categories.cjs | 未通過；fixture 仍預期三種雞，實際商店已有四種。以修改前 HEAD 的 ShopScene／poultry 程式重跑也得到相同錯誤，已確認為既有測試 fixture 問題；本次未修改該測試或其他商品以迎合舊預期 |

正式規則整合、正式 Functions／規則／前端部署及線上驗收尚未進行；未讀寫正式玩家資料。

## 修改檔案清單

| 區域 | 檔案 |
| --- | --- |
| 商品與玩家介面 | js/farm/ShopScene.js、js/farm/poultry.js、js/farm/guard-dog-core.js、js/farm/guard-dog-ui.js |
| 玩家交易串接 | js/farm/guard-dog-store.js、js/farm/operations-client.js |
| 後端與模型打包 | game-admin/functions/service.cjs、game-admin/functions/callables.cjs、scripts/prepare-game-admin.cjs |
| 規則片段 | game-admin/rules/firestore.guard-dogs.fragment.rules、game-admin/rules/firestore.ops.fragment.rules |
| 後端與規則測試 | game-admin/tests/admin-app-check.test.cjs、game-admin/tests/guard-dog-service.test.cjs、game-admin/tests/guard-dog-rules.emulator.cjs |
| 前端與商品測試 | tests/farm-announcements-client-browser.cjs、tests/farm-guard-dog-browser.cjs、tests/farm-guard-dog.test.mjs、tests/farm-onagadori-browser.cjs、tests/farm-onagadori.test.mjs |
| 文件 | docs/farm-shop-availability.md、docs/farm-guard-dogs.md、docs/farm-poultry.md、game-admin/README.md |
