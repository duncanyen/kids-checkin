# 私有登入／咕咕村落後端切換程序

2026-11-14（台灣）。本文件是待驗證的維運程序，**不是已完成正式部署的紀錄**。

## 安全邊界與相容性

- Nexus 繼續使用原 users 文件 ID、accountId、群組及 farm 存檔；Firebase Auth UID 改用獨立 namespace，不能碰到營運中心管理員 UID。
- 登入驗證改為私有 scrypt 雜湊；原帳號與密碼／PIN可繼續使用，不是要求所有使用者改註冊 Firebase Email/Password。
- 每日簽到／任務收據仍以原 profile ID 計算。已有領獎紀錄不會因換 Auth UID 再領一次。
- 前端只送操作意圖，不接受客戶端價格、金幣、獎品或勝負。背包、養殖及戰鬥沿用現有純函式模型與數值。
- `ops_farm_transactions`、`ops_farm_active`、`ops_verified_farm_events`、`ops_daily_events` 都不可由玩家直接讀寫；有效操作、獎勵與計次原子提交。
- 群組權限取自已審閱的 scoped role。`groups.nexusRoles` 是後端原子維護的只讀角色對照，供 Storage 的兩筆 Firestore 文件存取額度使用，不接受前端寫入。
- 獨立帳號的個人資料／密碼由本人管理。群組只可重設本群組明確託管帳號的憑證。擁有者可透過編輯成員的角色選單移轉擁有權。
- 戰鬥以伺服器會話、期限、持有武器、累計攻擊及速率驗證，沒有「客戶端宣告勝利」發獎 API。這不是防外掛系統；不宣稱能防止自動化送出合法攻擊命令或在伺服器重演全部畫面／弓箭物理。
- Storage 同時支援舊 profile-ID 照片路徑及新 Auth UID 路徑。RTDB 存取會檢查目前 UID／sessionVersion；跨庫撤銷經鏡像觸發器傳播，有非同步延遲，不宣稱與 Firestore 跨庫原子一致。
- 本次 Rules 僅收緊身分、群組資格及農場經濟相關資料。其他 Nexus 模組不是本次全平台安全稽核，保留的舊期限亦須另外處理。

## 1. 完成隔離驗證

在有 Node、Java、Python、Chromium、Playwright、Phaser 3.80.1 與 Firebase CLI 的測試環境執行：

```bash
node scripts/test-private-farm.cjs --emulator
```

CLI 不在 PATH 時用 `FIREBASE_BIN` 指定可執行檔；Phaser 測試檔可用 `PHASER_FIXTURE` 指定。這只啟動 `demo-nexus-private-farm` 的 Emulator，不連正式資料。六組瀏覽器驗證以 SDK／資料庫替身隔離，包含真實 Phaser 場景。

報告預設為 `/tmp/nexus-private-verification.json`。只有 `unitPassed`、`browserPassed`、`emulatorPassed` 都為 true，且程式及三種 Rules 的 SHA-256 與目前版本完全一致，才能視為此階段通過。程式或候選 Rules 有任何變更就要重測；僅兩個 rollout 布林值允許於已測試的模式間切換。

本環境 Emulator 下載受 403 限制，**目前沒有可供正式啟用的通過報告**。請勿手動把 false 改成 true。

## 2. 建立備份與維護窗口

部署身分須具備讀寫 Firestore、讀取 Rules release、部署兩個 Functions codebase 與必要的 Firebase Auth／custom token 權限。使用安全的 ADC 或平台管理身分，不要將私鑰／Token 寫入 Repository 或聊天。

在私人 GCS 備份位置備份 Firestore，保存當前 Functions、前端、Firestore／Storage／RTDB Rules 的版本與回復程序。舊資料含明文憑證，備份同樣必須限制存取，不得公開。先驗證備份能還原到隔離環境。

安排短暫維護時間，確認現行帳號與資產基準。過去正式規則全庫公開，無法僅靠現有程式證明歷史資料未曾被改動；本次不會猜測或重設玩家資產。

## 3. 盤點帳號與群組，保持開關關閉

```bash
node scripts/identity-migration.cjs --project homebasedb
node scripts/private-cutover.cjs --project homebasedb --phase review > /tmp/nexus.private-roles.json
```

兩者此時只有讀取。處理重複 ID、重複登入名稱、無效憑證與遺失成員後重新盤點。第二份檔案中的每位成員必須人工指定角色，每個群組恰一位 owner；不可用公開 users.role 或「爸爸／媽咪」名稱推測。

角色選項是 `owner`、`admin`、`parent`、`member`、`child`。`managedProfileIds` 只填經確認由該群組託管的 users 文件 ID；同一個帳號不能交由多個群組管理密碼。不要將此檔提交 Git。

新角色與邀請碼尚未生效時，不要開啟 `PRIVATE_IDENTITY_ENABLED` 或 `FARM_BACKEND_ENABLED`。

## 4. 部署已驗證的過渡 ops 保護，再建立私有影本

在完成 Emulator 驗證與備份後，才由操作人員部署 `rules/firestore.ops-protection.candidate.rules`。這一步只保護 ops 根集合，**其餘仍不安全，不能啟用每日任務**。

```bash
node scripts/identity-migration.cjs --project homebasedb --stage --fingerprint '<已審閱盤點指紋>'
node scripts/private-cutover.cjs --project homebasedb --phase stage-groups --roles /tmp/nexus.private-roles.json
```

工具會實際核對已發布的過渡 Rules，來源不同即拒絕，不提供 skip-rules。stage 不清除公開密碼、不開啟 ready。分文件交易可能部分完成，可在重新盤點後重跑；遇到不同憑證版本不會覆寫私有資料。

邀請碼會旋轉為新的私有亂數碼，切換後需從群組邀請功能取得新連結；舊公開邀請碼不再有效。

## 5. 在維護窗口協調正式切換

此階段不能只部署一個 Functions 或只更新 GitHub。需要一起處理：

1. 發布已驗證的 Firestore、Storage、RTDB 三套候選 Rules。舊客戶端將無法直接寫農場或登入憑證。
2. 部署根目錄 `nexus-live` 與 `game-admin` 的 `nexus-ops`，兩邊均設定 `NEXUS_PRIVATE_IDENTITY_ENABLED=true`；ops 另設 `NEXUS_FARM_BACKEND_ENABLED=true`。保留私有狀態 ready=false，暫不接受新登入／交易。
3. 發布已驗證的前端，將 `js/identity-config.js` 與 `js/farm/backend-client.js` 的對應開關設為 true。不要先向正式使用者發布只開一半的版本。
4. 核對 RTDB 的帳號鏡像已帶入 authUid／sessionVersion，以及兩個 codebase 的版本與參數。新的 `liveIdentityMirror` 會維護憑證異動的即時存取鏡像。
5. 執行 purge，最後才 activate。

發佈前的實際 deploy script 應依通過測試的 Git 版本、私有設定與維護窗口固定下來。本次沒有執行上述正式變更。

purge／activate 都須比對正式三套 Rules，需明確指定實際 Storage bucket 與 Database URL：

```bash
node scripts/private-cutover.cjs --project homebasedb --phase purge \
  --storage-bucket homebasedb.firebasestorage.app \
  --database-url https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app

node scripts/private-cutover.cjs --project homebasedb --phase activate \
  --storage-bucket homebasedb.firebasestorage.app \
  --database-url https://homebasedb-default-rtdb.asia-southeast1.firebasedatabase.app \
  --attestation /tmp/nexus-private-verification.json \
  --backup-reference '<已驗證的私人備份識別>'
```

purge 先完整預檢憑證對應，再以交易移除 password／pin／secret 與公開 inviteCode，保留帳號 ID、原始密碼的私有雜湊及農場存檔。若中斷可重新執行，但不會開放登入。

activate 會再核對憑證、帳號索引、角色、公開敏感欄位與測試報告後，才原子設定 ready／farmReady。此工具適用目前少量群組；大量帳號的切換應另做分批版本。

## 6. 正式驗收

- 原帳號及原密碼／PIN登入；登出、重新登入、改名、改密碼正常，舊工作階段失效。部分使用者需要重新登入一次。
- 原個人記帳、Photo Dump、舊照片刪除、即時資料、成長森林與群組切換正常。
- 群組託管帳號新增／編輯、空白密碼保留、成員移除／邀請碼旋轉、擁有權移轉正常。
- 商店／倉庫／治療／菜園／偷蛋／護衛犬正常，既有金幣及物品沒有被重設。
- 每日任務三項各有效操作 3 次，未完成不可領；同一筆重送、多裝置及換群組不會重複領獎。
- 第七天循環、漏做規則、台灣午夜與重新整理正確。確認實際 ops_daily_configs/current 的金額符合預期，不以部署預設值推測正式文件內容。
- 以 iPhone、Android、平板真機操作；Chromium 隔離測試不等於真機通過。
- 監看 callable 錯誤、權限拒絕、RTDB 鏡像及交易重試；完成後再結束維護窗口。

## 異常時暫停

以 `node scripts/private-cutover.cjs --project homebasedb --phase freeze` 將 ready／farmReady 設為 false。緊急暫停不以 Rules 版本相符為前提，避免規則異常時反而無法停機。這是暫停新登入及農場後端，不是回復公開密碼／公開 Rules；已取得的 Storage 工作階段另以個別憑證撤銷處理。

需要回復時使用已驗證的私有登入相容版本，或在保持維護狀態下從私人備份還原到隔離環境核對。**不可重新發布全庫公開規則或把明文密碼放回瀏覽器來解決問題。**
