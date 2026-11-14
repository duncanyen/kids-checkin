# 每日任務：正式 Rules 比對與啟用範圍

日期：2026-11-14（台灣）。依使用者提供的正式匯出文字進行分析；尚未由此環境讀取 API release 或改動正式環境。

## 已確認的規則行為

使用者提供的規則等價於 `rules/reference/firestore.user-provided-20261114.rules`：

```text
match /{document=**} {
  allow read, write: if request.time < timestamp.date(2026, 12, 16);
}
```

期限為 **2026/12/16 00:00 UTC，即台灣時間 08:00**。在此之前沒有 request.auth、群組資格、擁有者或欄位限制。這是整個 Firestore 的公開讀寫，不是 Firebase Authentication 或後端驗證已啟用的證據。

已由規則與程式共同證實的影響：

- `ops_daily_days`、`ops_daily_grants`、`ops_verified_farm_events` 等紀錄可由一般客戶端讀寫；不能只靠名稱含 verified 就信任來源。
- `groups/{groupId}/users/{accountId}.farm` 的金幣、雞隻、雞蛋、怪物結果目前也沒有 Rules 寫入防護。
- `users` 可被讀取及修改，而 `js/auth.js` 讀取其中的 password／pin 進行舊制登入，`functions/index.cjs` 的 photoSession 也比較這兩個欄位。只保護每日任務紀錄，仍不能保證玩家身分可信任。
- Firebase Auth 的 Custom Claims 並不存於此 Firestore 規則可寫的欄位；上述問題不等於可直接替任意 Auth 帳號設定 admin claim。
- 在其他 match 加上 `allow read, write: if false` 無法覆蓋目前的廣泛 allow；Firestore 將所有符合的 allow 以 OR 判斷。

## 已準備的完整過渡候選規則

檔案：`rules/firestore.ops-protection.candidate.rules`。

此檔是完整可供 Emulator 檢查的 ruleset，不是需貼入別處的片段：

- 排除所有根集合名稱以 `ops_` 開頭的客戶端讀寫，包含未來新增的 ops 集合及子集合。
- Admin SDK 不受瀏覽器 Security Rules 限制；既有營運中心及每日簽到 callable 不因禁止客戶端直讀 ops 而被改成公開。
- 其他根集合保留使用者提供規則的原始截止時間，沒有延長測試模式、沒有直接改成全站登入才可使用。
- Repository 搜尋未發現玩家／營運前端直接存取 ops 集合；現有入口透過 Cloud Functions。這是程式碼檢查，不等同已驗證正式環境所有外部工具。

**此候選仍允許舊制 users、groups 等公開存取，僅是過渡保護，不足以啟用可信任每日任務。** 不可將它描述為正式發布就緒或完整資料保護。

未修改根目錄 firebase.json，未將候選自動掛入正式部署。`firebase.rules-review.json` 僅供隔離規則測試。

## 三項每日任務的接線缺口

`game-admin/functions/daily-challenges.cjs` 的 VERIFIED_PRODUCERS 仍為空。配置 mission.enabled=true 不能替代來源驗證，不應直接填入 producer 名稱解除封鎖。

| 任務／流程 | 目前實作 | 啟用前必須完成 |
| --- | --- | --- |
| 收蛋三次 | MyFarmScene.js 前端 transaction 呼叫 collectPoultry | 可信任後端讀取受保護養殖狀態、以伺服器時間結算產蛋、確認真實收取量大於 0，成功一次計一次；同筆交易更新遊戲、事件及進度 |
| 協助清潔三次 | VisitScene.js cleanTargetFarm 的前端 transaction | 後端驗證身分、目前／目標群組及公開拜訪資格、非本人、確實移除髒亂值；重送不重複計次 |
| 擊退怪物三次 | 多數戰鬥在前端處理傷害與結算 | 後端建立戰鬥、核對武器與攻擊／時間、導出勝負；不得接受前端直接傳 win 作為驗證。每個成功戰鬥結算只計一次 |
| 獎勵發放 | 已有伺服器時間、日快照、交易及固定 grant ID | 先保護任務與經濟資料並完成真實 producer，再驗證並行、午夜、跨群組與重試；既有交易程式不代表整個遊戲經濟已受保護 |

報表紀錄器 `gameOpsFarmReportCapture` 只觀測已提交存檔，並非動作驗證。不能直接將它的收蛋顆數、前端戰鬥結果或現有報表開關接成 verified daily producer。

## 為何不能只鎖住農場欄位

目前 ShopScene.js 仍直接更新購買／出售／升級的 farm.coins；WarehouseScene.js、MyFarmScene.js、VisitScene.js 與各 Boss store 也有既有交易。直接封鎖整個 farm 或金幣，會同時使原本的商店、養殖、治療、偷蛋及戰鬥失敗。

安全切換至少涵蓋以下兩個比原三項任務更大的範圍：

1. **Nexus 身分與憑證私有化**：舊登入不再由瀏覽器讀取公開 users.password／pin，需相容既有帳號、註冊／改密碼／工作階段及 photoSession／liveSession。憑證搬移及正式切換不能直接在目前正式資料上試做。
2. **咕咕村落共同經濟與遊戲事件後端化**：將會動到相同受保護欄位的購買、出售、產蛋、收蛋、道具、清潔、偷蛋、怪物等寫入接到同一權威資料與後端；保留現有資源模型，不新建第二套可分歧餘額。

建議順序：

1. 先審查過渡 ops 保護規則與模擬測試。
2. 在隔離資料建立相容身分／憑證遷移與回復方案，不先移除正式 users 內的登入欄位。
3. 逐項建立後端遊戲命令、固定請求 ID、交易與受信任事件，前端預設保持舊流程直到整體切換驗證完成。
4. 對所有共用欄位的寫入者完成遷移與相容測試，才用完整正式 Rules 封鎖客戶端特權寫入。
5. 註冊每日任務 producers，驗證收蛋「操作次數」而非蛋數、清潔與怪物、重送／併發／失敗重試／台灣午夜。
6. 安排前端、Functions、Rules 的一致切換，再驗證正式小帳號；不以只部署 Functions 當成每日任務已啟用。

## 測試與目前狀態

新增 `game-admin/tests/transition-rules.emulator.cjs`，驗證匿名／一般帳號／admin-claim 瀏覽器均不能操作 ops、巢狀集合及 query，並明確驗證舊 farm.coins 在過渡期限內仍公開。此測試刻意保留該缺口，避免把相容過渡版誤稱為最終安全版。

本環境已實際執行：

```bash
firebase emulators:exec --config firebase.rules-review.json \
  --project demo-nexus-rules-review --only firestore \
  'node --test game-admin/tests/transition-rules.emulator.cjs'
```

結果：Firestore Emulator JAR 下載遭網路代理回覆 **403 Domain forbidden**，未進入規則測試，不能宣稱候選規則已通過編譯或整合驗證。

可在具備下載權限的 Cloud Shell／本機重跑：

```bash
npm --prefix functions ci
npx firebase-tools@14.18.0 emulators:exec \
  --config firebase.rules-review.json \
  --project demo-nexus-rules-review --only firestore \
  'node --test game-admin/tests/transition-rules.emulator.cjs'
```

這只啟動 demo Emulator，不部署正式規則、不更新或重設玩家資料。

本次未修改或部署正式 Rules，未重設玩家資料，未解除每日任務來源封鎖，也未移動正式登入憑證。需先確認是否將上述登入／憑證及共用經濟後端化納入本次範圍，再實作跨模組切換，避免把「只接三個任務」擴大變更直接套到整個 Nexus。
