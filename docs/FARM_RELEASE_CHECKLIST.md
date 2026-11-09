# 咕咕村落 V1.0 正式發布檢查清單

> 日期：2026-11-09（Asia/Taipei）；程式盤點基準 main `3849615e6e49696b0e9dfb6bd7b469301c43a883`。
> **本文件是發布關卡，不是部署指令或本次部署授權。** 未打勾表示尚無本次交付可用證據，不表示正式 Console 一定未設定。

## 1. Gate 0：範圍、責任與版本 manifest

- [ ] 指定發布負責人、後端／Rules 審查人、客服與回復決策人；設定發布時間、觀測時段與中止條件。
- [ ] 確認 [Roadmap](FARM_V1_ROADMAP.md) R01–R06 的 P0 全部完成，或明確限制測試範圍且不宣稱經濟／競賽可信的 V1.0 正式版。
- [ ] 保存下表，不記任何密碼／Token；以 commit、hash、CLI 輸出及核准紀錄作證據。

| 發布單位 | 必填證據 | 本次盤點能確認 |
| --- | --- | --- |
| 玩家前端 | Git SHA、Pages build／發布 ID、實際網址、資源版本、最小支援 client 版 | 原始碼 3849615；實際線上版本無法確認 |
| 管理站前端 | Git SHA、Hosting target／Pages 路徑、CSP 等實際標頭 | 獨立 site 原始碼存在；不能把 Firebase Hosting headers 假定套用在 GitHub Pages |
| nexus-live | code SHA／artifact hash、Node runtime、區域、photoSession／liveSession 及鏡像／growthForest 的實際版本 | root firebase.json 為 functions/、Node22；正式無法確認 |
| nexus-ops | code SHA／artifact hash、遊戲規則打包 hash、四個 callable、區域／ingress | game-admin/firebase.json 為 functions/、Node22；正式無法確認 |
| Firestore Rules | 完整規則檔 hash、已部署 release／時間、所有重疊 allow 及 delete 審查 | 目前只有片段／測試，完整正式 Rules 不在 Repository |
| Firestore 索引 | 完整 definitions、每個啟用查詢需要的索引與 READY 證據 | root／ops 索引檔存在；READY 無法確認 |
| Auth／App Check | Email provider、custom claim 管理方式、已綁 MFA 的流程、App Check 選用設定與允許網域 | 原始碼目前選用；Console 無法確認 |
| RTDB／Storage | Rules hash、鏡像開關、status ready／backfill（若啟用）、bucket 來源 | Rules 有檔；REALTIME_READS_ENABLED=false；正式套用未知 |
| 資料版本 | farm schema、poultryVersion、經濟 API 版本、設定 revision、任何遷移報告 | 尚無本次正式唯讀盤點或遷移 |

## 2. Gate 1：備份、還原與安全回滾

- [ ] 擁有者核定 RPO、RTO、保留時間、備份儲存位置／加密／存取 IAM、預算及責任人；先確認既有設定，不任意新增費用。
- [ ] 發版前建立可定位的一致性備份證據，含必要 users／groups 關聯、owner farm／farmMail／farm_meta／通知，以及 gifts／claims／receipts／redemptions／admin／guard receipts／audit／設定／活動。
- [ ] 確認 Firestore export／PITR 與 Auth 使用者／Custom Claims、Storage、RTDB 是不同備份範圍；不要以 Firestore 匯出當作包含全部 Auth 或照片檔案。
- [ ] 真實還原到**隔離專案**並執行 schema／金幣／雞蛋／租約／額度／收據對帳，記錄實際 RPO／RTO；不能只測檔案可下載。
- [ ] 還原後相同已成功 requestId 不得再次扣款／發獎；既有 claims／redeemedCount 與資產一致。不能只還原某個 farm，卻保留不同時間的發獎收據。
- [ ] 回滾方案包含前端與兩個 Functions 的相容版本、可回復 Rules 版本、設定及索引策略；不要刪其他模組索引。
- [ ] 明確區分「回滾程式」與「回復已提交資產」，後者需審批與補償帳本，不是重新部署即可還原。
- [ ] 可暫停的新 API／最低 client 能力有安全閘門；現有三個開關只管公告／禮包／新租犬，**不能當作全遊戲維護閘門**。

## 3. Gate 2：Firebase Emulator 與安全整合

目前阻擋：本次以 demo-nexus-ops 啟動 Auth／Firestore，在下載 JAR 階段遭 `403 Domain forbidden`；所有下列 Rules 關卡尚無本次實際通過證據。解決環境下載限制後再跑，不用正式專案替代。

- [ ] 匿名、一般玩家、非成員、跨群組、removed、Auth disabled、營運限制、撤除 admin claim 的拒絕案例。
- [ ] client 直接新增金幣／雞隻／蛋／道具、改價格／成績／challenge、改 guardDogs 全部被拒；合法仍允許的非經濟更新不受影響。
- [ ] 測 owner document create／update／set 覆蓋／delete／刪後重建；包含 broad recursive match，不能只測新增片段。
- [ ] ops_announcements／notifications／gifts／code_index／claims／receipts／redemptions／audit／requests／limits／settings／events／controls 對 client（含 admin browser）不可任意讀寫。
- [ ] 閉鎖商品透過 API 偽造 rentable、價格、accountId、群組、租約 id 仍拒絕，且不扣款／不建租約。
- [ ] 正常、指定帳號、過期、尚未開始、停用、額滿、每人限額、多人搶最後一份的禮包驗證；不同群組不可重置個人次數。
- [ ] 提交成功回應遺失、故障回滾、相同 requestId 重送、不同 payload 重用 id、延遲超時、同玩家多分頁。
- [ ] 敵人未簽發／零命中／非法裝備／過期／重入／同時結算／超窗重播均不能偽造獎勵。
- [ ] 來源與目標的偷蛋守恆、server RNG／time、護衛租期、防守通知及排行事件原子一致。
- [ ] 沒有 Firestore／RTDB 跨庫交易假設；Admin SDK bypass Rules 的 API 必須自己驗證所有業務條件。

可在解鎖環境後執行現有隔離套件（不是部署命令）：

```bash
cd game-admin
firebase emulators:exec --config firebase.test.json \
  --project demo-nexus-ops --only firestore,auth \
  'node --test --test-concurrency=1 tests/emulator.integration.cjs tests/guard-dog-rules.emulator.cjs'
```

現有 Emulator fixture 不是正式 Rules；R01 後還需用合併後的實際規則新增覆蓋測試。不可因現在 fixture 放行一般資產更新，就將其照搬正式。

## 4. Gate 3：Staging 與發布依賴

- [ ] 建立隔離 staging Firebase 專案／站台及人造資料；選定 project／codebase／target，確保指令不會指到正式玩家。
- [ ] 打包後端共用 poultry／inventory／guard 模型並核對 hash；前端、圖鑑、後台唯讀快照一致，動態設定覆寫不遺失。
- [ ] photoSession 可正常提供 Auth 身分；若只發布 nexus-ops 而缺橋接，玩家不能登入新 API。
- [ ] 檢查 gameOpsAdmin／Announcements／GuardDog／Redeem 的 callable preflight／錯誤／Auth；OPTIONS 需到達 callable，但 public invoker 不能取代函式內權限驗證。
- [ ] App Check 保持核准政策；若啟用強制驗證，先完成 provider／site key／網域及登入／兌換實測，再同步前後端，不能只改單邊旗標。
- [ ] 對 Dashboard aggregation、公告／通知 feed、禮包、兌換、稽核、玩家查詢與 events 的**所有 UI 開放篩選組合**核對實際索引，均 READY；ensure-announcement-index 並非所有索引的完整部署器。
- [ ] 部署順序依相容矩陣：備妥向後相容後端與設定 → staging client／Rules 測試 → 經核准的正式順序；不是任意先封規則再更新端點。
- [ ] 原始碼 push 與 Firebase Functions／Rules／索引／Hosting 個別保存狀態，沒有因 Pages 更新就宣稱後端已更新。
- [ ] 正式操作另取得明確授權；此盤點 commit 不執行部署、重設或資料遷移。

## 5. Gate 4：正常功能與相容驗收

- [ ] 四雞的買／賣／產蛋／收蛋／蛋出售與價格保持原規則；批量、餘額不足、倉庫滿與離線上限／停鐘正確。
- [ ] Lv.1／2／3 升級與容量；4／5 不可買；負數／零／分數／未知商品／假價格一律拒絕。
- [ ] 外面最低 min(6,總雞數)，室內仍產蛋／生病；外面點雞與雞舍隨機治療、病雞數、取消／退出皆釋放輸入鎖。
- [ ] 裝備中禁止出售，兩種裝備槽及庫存一致；各怪物、飛行無效與武器命中數按共用表，不另改平衡。
- [ ] 地鼠／蛇王／巨人門檻、互斥、時限、戰鬥／結算停止抓蟲及重入恢復；傳統 Boss 也有可驗證退出／斷線政策。
- [ ] 偷蛋跨公開村與本村、閉村／移除成員即時拒絕、防守成功、冷卻、到期租約與通知正確。
- [ ] 邊牧預設展示不可新租、200／1000；後台覆寫只在管理員明確儲存後生效；原租約保留。
- [ ] 舊存檔不完整時停止，不自動重設；斷線／快取／pending writes 不造成預設覆寫，切群組不讀錯 farm。
- [ ] 公告、系統通知、活動碼複製／帶入、兌換成功／失敗／離開／重開／重試全流程；純文字不能執行 HTML。
- [ ] 同帳號多群組、改名、同名、UID≠accountId、帳號被停用及舊 client 都在測試矩陣。
- [ ] 活動結束誰封榜、誰審查異常、誰發獎、如何防重頒有明確流程；沒有自動頒獎時 UI／公告不能宣稱已自動完成。

## 6. Gate 5：真機、長時間與負載

- [ ] iPhone Safari 與加入主畫面、iPad 直向／橫向／分割視窗、Android Chrome；記錄機型、OS、瀏覽器、版本 SHA 與影片。
- [ ] 地址列／安全區、旋轉、縮放、Canvas 點擊、弓箭觸控、DOM 表單、數字鍵盤、複製活動碼、面板取消／返回及頁面捲動均正常。
- [ ] 真機前景至少 15–30 分鐘與背景／鎖屏／系統暫停恢復；記錄 GPU／heap／溫度／電池與錯誤，不用五秒 Chromium FPS 代替。
- [ ] 切場景至少 20 輪、關閉重開、多分頁、切群組；Listener／timer／Tween／DOM／Object URL 不隨輪次累積。
- [ ] 丟包、慢網、離線、提交成功回應遺失、重連、SDK／Atlas 下載失敗，存檔及收據一致，不重複建檔／扣款／發獎。
- [ ] 以核定規模在隔離環境測多人同時兌換、買賣、偷蛋／防守與改設定；記錄 transaction contention、重試、p95／p99 延遲、429／5xx、讀寫成本。
- [ ] 公開村落排行與完整 farm 讀取量有容量規劃；大群組／長通知歷史不超文件大小與使用成本門檻。

## 7. Gate 6：正式觀測與回復演練

- [ ] 設 Functions 錯誤率／延遲／限流、Auth 交換失敗、403／索引缺失、資料交易重試及發獎異常告警，告警通知到實際責任人。
- [ ] 有金幣／蛋／道具異常增加、無來源獎勵、負值、租期異常、排行榜異常成長的對帳報表；不自動歸零玩家資料。
- [ ] correlationId 連結玩家操作、receipt、經濟 ledger、ops audit；日誌禁止完整 Token、secret、私鑰、未過濾 profile。
- [ ] Firestore／Storage／Functions／網路費用與讀寫量有預算及警示；限流桶 expiresAt 不代表已設定 TTL 清理。
- [ ] 定義紀錄保留、刪除與查詢權限；保留防重播所需的最小不可變收據，不能為清資料造成重領。
- [ ] 發布後用授權測試帳號做少量 smoke test，使用真實端點但有核准範圍；不使用正式玩家存檔測試負數或偽造結算。
- [ ] 有客訴／補償／停用／回滾值班程序；錯誤回滾與資料修復先備份、審核、記錄，不直接改欄位湊平。

## 8. 本次關卡結論

已具備部分正常功能、後端交易及隔離測試基線；完整結果見 [狀態報告](FARM_V1_STATUS_REPORT.md)。本次沒有完成任何正式部署簽核、Rules／真實 Emulator、備份還原、真人帳號、真機長測或負載驗證。

只有上述必要關卡的負責人、證據與版本都補齊後，才可將狀態改為「V1.0 營運就緒」。本文件不以工作量百分比代替發布判斷。
