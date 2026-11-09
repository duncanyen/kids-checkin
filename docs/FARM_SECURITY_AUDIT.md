# 咕咕村落 V1.0 安全審查

> 日期：2026-11-09（Asia/Taipei）。分析基準：GitHub main `3849615e6e49696b0e9dfb6bd7b469301c43a883`。直接讀取來源並做本機隔離探查；未測試正式帳號、未送出正式利用請求、未讀寫正式資料或修改 Rules。

## 1. 判讀方式

| 證據類別 | 意義 |
| --- | --- |
| A：程式已證實缺口 | 靜態控制流或本機實際方法／純規則重現缺驗證、信任客戶端或缺營運流程。**不等於正式資料庫已可被修改** |
| B：Rules／權限條件風險 | 必須再有正式 Rules 允許相應讀寫、可取得憑證或其他前提，才會造成線上影響；正式 Rules 缺失時不宣稱漏洞已被利用 |
| C：已有防護、正式驗證未完成 | 功能已有後端／交易／清理或交付機制，但仍缺正式版本、Emulator、真機或營運證據；不是指已確認有繞過 |

風險為本專案修復優先級，非已證實發生機率或 CVSS 分數。Critical／High／Medium 表示潛在資產、帳號、跨群組或恢復影響。下列 A 與 B 可同時適用於同一風險的不同層面，不能把「Rules 無法確認」當作「規則必定允許」。

## 2. 最重要前十項

| 排序／ID | 風險 | 類別 | 級別 | 目前證據／線上前提 |
| --- | --- | --- | --- | --- |
| 1 F01 | 經濟客戶端直寫，正式完整 Rules 不在版本庫 | B；直寫事實已確認 | Critical | 若 Rules 只檢查擁有者、不驗證業務，可能任改資產；正式是否允許無法確認 |
| 2 F02 | 升級／一般物品售價外部價格、買藥／擴倉負數未驗證 | A＋B | High | 本機實際方法重現免費升級／金幣增加；正式寫入仍取決 Rules |
| 3 F03 | 戰鬥結算信任勝負，部分無持久已簽發遭遇 | A＋B | High | 前端可要求 win；舊 Boss 有界結果陣列不能提供永久收據／退出懲罰保證 |
| 4 F04 | 偷蛋、抓蟲、養殖與活動成績信任前端亂數／時間 | A＋B | High | 客戶端決定 roll、now 與排行累加；目前沒有對應可信任 API |
| 5 F05 | 舊驗證資料在客戶端，custom-token 橋接缺程式內猜測限流 | A；濫用條件另驗 | High | 可直接比對的 password／pin 欄位與 Web Storage，橋接入口未見帳號／IP 限流 |
| 6 F06 | 成員查詢取得完整 users／農場，缺公開資料投影 | B；完整讀取程式已確認 | High | 若 Rules 允許查 users 且文件含憑證，Firestore 不會自動隱藏個別欄位 |
| 7 F07 | 租犬／禮包 API 安全不代表直接改租約／收據已封鎖 | B＋C | High | callable 有驗證；fragment 未確認合併，且整份 owner delete 要另保護 |
| 8 F08 | 舊買賣等缺跨請求冪等帳本，收據保留窗口不一致 | A（設計缺口）＋B | Medium | busy 鎖只管同頁；未知提交結果重試可能再交易，有限擊殺／Boss 陣列會遺忘舊 id |
| 9 F09 | 前端／兩個後端／Rules／索引／真機缺共同發布證據 | C／就緒性 | High | 程式與部分隔離測試存在；不能確認正式 SHA、READY、IAM 或實際裝置 |
| 10 F10 | 備份、完整還原與可追蹤監控缺交付證據 | C／營運未知 | High | Repository 未找到可驗證演練；不表示 Console 一定沒設定 |

## 3. 詳細發現

### F01：資產主權與正式 Rules 未形成可驗證邊界

- **影響**：coins、雞隻、蛋、道具、容量、裝備、計數及他人農場損失；可能影響全體經濟與競賽。
- **來源**：`js/farm/ShopScene.js:369,390,414,440,455,472`；`MyFarmScene.js:452,499,584`；`WarehouseScene.js:249,332`；`VisitScene.js:196,635`；`firebase.json:22` 只列索引，沒有正式 firestore.rules。
- **確定**：這些操作由瀏覽器使用 Web SDK transaction。transaction 重新讀最新資料可防正常並發覆蓋，但無法讓玩家端程式成為可信任服務。
- **未確定**：正式 Rules 是否接受未授權直接 set/update/delete、是否有欄位不變條件。未取得規則，不能聲稱可任意改正式金幣。
- **建議**：先取得並版本化現行完整 Rules、界定經濟欄位；逐組遷移至可信任交易，提供相容閘門，再限制 client 寫入。禁止直接套用測試 deny-all，亦不可一次封鎖仍在用的舊交易而中斷遊戲。
- **驗證**：Emulator 用匿名、一般 Auth、被移除成員、跨群組及管理員瀏覽器測試增資產／整份覆蓋／刪除。合法非經濟更新亦須成功；兩種結果都必要。

### F02：實際交易方法缺少正整數與伺服器價格驗證

- **來源**：`ShopScene.js:406–427` 的 executeSellItem 一般非武器／非蛋商品沿用 unitPrice；`:385–403` 的 executeBuyMedicine；`:450–464` 的 executeUpgradeCoop；`:467–483` 的 executeExpandWarehouse。
- **隔離重現**：使用 Acorn 擷取原始類別方法，注入記憶體 transaction 與真正 inventory-core，不連 Firebase。測試初始值皆為人造資料：

| 方法輸入 | 起始狀態 | 實際結果 |
| --- | --- | --- |
| 升級 level=3、price=0 | coins=1000、Lv.1 | coins 仍 1000，變 Lv.3 |
| 買藥 qty=-1 | coins=1000、medicines=2 | coins=1010、medicines=1 |
| 擴倉 qty=-1 | coins=1000、warehouseLimit=100 | coins=1100、warehouseLimit=90 |
| 出售一隻菜蟲，外部 unitPrice=1000000 | coins=1000、worms=2 | coins=1001000、worms=1 |

- **確定**：這些方法本身未拒絕上述輸入。武器及蛋的售價有重取共用常數，但其他物品仍使用傳入 unitPrice，不能泛稱所有售價都已重新驗證。UI 的 +/- 範圍與 isProcessing 不保護可修改的客戶端。
- **線上前提**：玩家可呼叫／修改方法，且正式 Rules 接受其計算出的更新。未用正式資料重現。
- **建議**：由後端商品 ID 查價、校驗 safe integer／qty>0／上限／進度／餘額，單筆操作收據。前端同樣補驗證以改善錯誤，但不能只修 UI。先處理這四條高風險交易。
- **驗證**：負數、零、分數、NaN、Infinity、巨量、假價格、未知商品、舊設定版、連點及同 operationId 重送；拒絕時零扣款／零變更／零成功收據。

### F03：戰鬥勝負缺可信任遭遇／命中驗證

- **來源**：`eagle.js:16–33`、`dragon.js:36–65`、`gorilla.js:21–44` 由傳入 id／outcome 決定結算；`mole-store.js:33–46`、`giant-store.js:22–30` 及 cobra-store 讀持久 challenge，但仍接受客戶端 outcome。`dragon.js:159–175` 的命中／血量在場景記憶體。
- **確定**：舊 Boss 不讀取由後端簽發的遭遇與期限，即可處理新 id 的 win；地鼠類有 challenge／截止保護，仍沒有證明合法命中。純規則探查建立合法格式的假 challenge，未提供命中紀錄也能由 moleSettlement(...,'win') 得到一個地瓜 patch。
- **退出／重播**：舊 Boss 的場景重建及最近 32 筆結果不是伺服器的持久截止／結果帳本；擊殺收據為最近 128 筆。不能宣稱所有重整／離頁都會正確懲罰或舊 id 永遠只給一次。
- **線上前提**：前端結算相應欄位可寫。缺證據證明正式 Rules 會驗證攻擊序列；不能將未實作的驗證假定存在。
- **建議**：統一後端 claim encounter、伺服器時間、擁有者、敵人、裝備快照／合法切裝與必要攻擊頻率／命中證據。settle 不接受任意勝負；過期結算由後端判定，獎勵與不可重播收據同筆。不要只把現有 outcome 原封轉進 Cloud Function。
- **驗證**：未領遭遇即結算、假 id、零命中 win、提早／過期 win、非法武器、雙分頁、換村、重整、斷線與故障重送；同一遭遇只結算一次。

### F04：前端亂數與時鐘使防守及排行缺競賽可信度

- **來源**：`MyFarmScene.js:439,450,489,504`；`VisitScene.js:627–665`；`guard-dog-core.js:67`；`ranking-core.js:1–8`；`holiday-clock.js:8–17`；`halloween-core.js:9–35`。
- **確定**：生病、抓蟲、偷蛋攔截 roll 與卵種選擇在玩家端；偷蛋冷卻 now=Date.now。期間排名雖以同來源 HTTP Date 修正偏移，最後仍由可改的瀏覽器 clock 判斷並提交計數。
- **影響條件**：修改前端、傳入不利於防守者的 roll、略過冷卻／期間或直接增排行，需要正式寫入權限配合；不是觀察到有人作弊。
- **建議**：偷蛋／抓蟲／生病／產量結算用後端 now 與亂數；偷蛋 attempt 收據鎖定目標、結果、冷卻、扣蛋、得蛋及分數。排行榜由可信任事件派生，期間不由瀏覽器決定。產蛋以純規則共用但時間來源可信任。
- **驗證**：改本機時鐘、偽造 HEAD Date／clock、固定 Math.random、閉村／退群同時提交、跨目標／跨群組；來源與目標守恆及排行只加一次。

### F05：舊登入與 custom-token 交換的防猜測缺口

- **來源**：`js/auth.js` 的 processLogin 保存 familyCheckInUser；`js/farm/operations-client.js` connect 取 user.password／pin 傳給 photoSession；`functions/index.cjs:43–65` 直接字串比對 password／pin，onCall 只見 maxInstances=5，未見帳號／IP 限流、退避或 App Check。
- **確定**：舊驗證資料會被瀏覽器使用，後端橋接無此程式層的猜測防護。maxInstances 限並行，不等同每帳號限流。Firebase Auth 的原生密碼登入防護不自動保護自訂 photoSession 的 secret 核對。
- **未確定**：正式是否另有網路政策／WAF／監控、現存 PIN 長度／帳號資料品質；未暴力測試正式端點。
- **建議**：先為橋接加入帳號與 IP 的可恢復限流及濫用告警，維持現有通用驗證錯誤；規劃玩家 Firebase Auth 遷移、舊憑證安全驗證與退場，避免瀏覽器取得其他玩家驗證資料。不突然強制管理 MFA 或 App Check 作為修復替代。
- **驗證**：僅用測試帳號驗證失敗限流、分散 IP／單帳號、合法重試、移除成員、帳號停用、刷新及撤權；測試與紀錄不輸出 secret／token。

### F06：完整 users／farm 讀取的隱私風險

- **來源**：`villages.js:38–48` 保存 profile.data() 並展開回傳；`js/game-members.js:11–17`、`js/scoped-profiles.js` 取得完整 users；`rankings.js:27–29` 讀完整 owner.farm，非只讀分數。
- **確定**：程式未在資料庫邊界分離公開名稱／頭像／公開村落與私密驗證、內部租約及帳本。後端 management 玩家清單已有白名單，不能將它誤套到舊玩家頁。
- **線上條件**：Rules 允許取得該文件且其中有敏感欄位。Firestore 文件 read 是整份文件，Rules 不能只遮掉 password／pin 欄位；只在 UI 不顯示仍無法防止瀏覽器收到。
- **建議**：公開 profile／村落／排行投影，私密資料置後端或受限文件。先列依賴與相容遷移，不在本次任意拆 users schema。
- **驗證**：一般玩家、跨公開群組、閉村、移除帳號的 network payload／SDK 返回不含憑證與非必要內部狀態；伺服器和 Rules 同時限制。

### F07：護衛犬租約及 ops_* 的直接寫入仍待封鎖證據

- **既有防護**：`game-admin/functions/service.cjs:145–177` server catalog、rentable、expectedPrice、登入／群組重查、付款／租約／receipt 同筆；已付款租約不因暫停而中斷。拒絕閉鎖商品不扣款、不建立收據。
- **剩餘風險**：`game-admin/rules/firestore.guard-dogs.fragment.rules:1–10` 只是 create/update 的 guardDogsPreserved 合併函式；另加 deny 不能推翻 broad allow。若 owner delete 仍開放，可造成整份存檔／租約刪除；是否能如此操作正式環境無法確認。
- **ops_* 證據**：ops fragment 有客戶端 deny，但未見完整正式規則。若被 broad allow 覆蓋，公告／code index／claims／receipts／settings 等將不再可信任。
- **建議**：取得現有正式 Rules 後，逐條測試包含覆蓋路徑的 allow；遷移期間保留合法非經濟更新、禁止租約改動及 owner delete；ops 客戶端包含 admin claim 也不可直寫。
- **驗證**：直接新增／替換／刪除／延租、修改 paid／breed／startedAt、刪 owner、重建 owner、偽造所有收據、closed 邊牧 API；缺任何一項不能簽 V1 閘門。

### F08：舊交易的冪等生命週期不一致

- **來源**：ShopScene 的 isProcessing、MyFarmScene 的 isHarvesting／isUpdatingEggs；`combat-progress.js:5–9` slice(-127)；`eagle.js:32` 等結果 slice(-31)。
- **確定**：舊買賣沒有傳入持久 operationId，不能區分同一購買意圖的未知結果重試與新購買。這不是說同頁普通連點必定重複扣款；現有 busy 與庫存重讀對正常操作有效。
- **隔離證據**：129 個擊殺 id 只保留最後 128，重送被裁掉的第一個 id 時 killProgressPatch 再加一次；同樣結果窗口不能當永久防重播。線上寫入／偽造仍屬 B 條件。
- **建議**：後端經濟收據明確保留政策與 payload 綁定；歷史結果作 UI 摘要，與不可重播唯一性分離。收據清理不能早於可重送／可發獎窗口，不能為減文件數任意刪除 claims。
- **驗證**：提交已成功但回應遺失、關頁後重試、跨分頁同 operationId、不同內容誤共用 id、超過 32／128 次後舊 id 重播、故障補發；一次且只有一次狀態變更。

### F09：正式安全與部署版本證據不足

- **來源**：root／game-admin firebase.json 分別是 nexus-live／nexus-ops；site 與玩家前端不同入口；root 索引檔與 ensure-announcement-index 腳本；Emulator 設定與 tests。
- **確定**：32 項後端及 182 項純測試可跑；記憶體 Query 不驗真實索引，HTTP 本機測試不驗 Cloud Run IAM；本次 Emulator 啟動被 JAR 403 阻擋，未跑到任何 Rules 斷言。
- **未確定**：正式哪些函式已部署、是否同 SHA、Rules 版本、索引 READY、App Check Console、Email provider 與正式 CORS／ingress。不是直接認定功能尚未上線。
- **建議／驗證**：建立發布 manifest，staging 用真實 Emulator 與索引測試、後端 role／成員／拒絕及真人流程證據；維持既有選用 MFA／App Check，若要更改另作決策。四種版本獨立列明，Git push 不算後端發版。

### F10：備份還原與監控就緒性無法證明

- **證據範圍**：已查 scripts、Firebase 配置、兩個後端與檔案清單，沒有 farm／ops 備份排程、restore runbook、PITR／保留配置或監控告警 IaC；本次未查正式 Console。
- **影響**：誤調幣、壞版、刪存檔、發獎異常後若只恢復 farm，可能與 claims／收據／額度不一致而少發或重發；回滾程式不等於還原資料。
- **建議**：先確認現況與責任人，定義 RPO／RTO、成本及保留，再以 staging 備份演練整組還原與經濟對帳。RTDB 鏡像不是獨立不可變備份。
- **驗證**：在隔離專案從指定備份恢復 farm／ops／必要 users／groups 關聯，驗證既有成功收據不可再次領取、餘額／額度守恆，量測時間；告警能由故障注入觸發並通知負責人。

## 4. 其他觀察（非前十排序）

| ID | 觀察／程式證據 | 分類與處理 |
| --- | --- | --- |
| F11 | ranking-core.js:17 顯示截止後發獎，但沒有可信任封榜／頒獎與領取狀態機；events 只連公告 | A 業務流程未完成／P1：發布活動前明確人工或後端結算責任，不以客戶端榜單自動發獎 |
| F12 | service.cjs:114–126 的 auth、throttle、requestId 等失敗在 catch 外；guardDog 沒有與管理寫入同種完整失敗稽核；缺保留／異常告警 | A 覆蓋不足／P1：安全事件、交易成功、營運稽核分開設計；不要記明碼、token 或所有秘密 payload |
| F13 | rankings.js 迭代所有公開村落、讀各玩家完整 farm；單 farm、限流與單禮包計數熱點，無大規模測試 | C／P1-P2：並發與成本基線、後端 top-N 投影、容量／寫入競爭及真機長測 |
| F14 | 自家生病隨機邏輯在 MyFarmScene.eggTick，拜訪補算產量則直接 settlePoultry；養殖流程並未收斂為同一權威結算 | A 行為不一致／P1：後端集中結算並驗證不同入口得一致病程／產量，避免只修畫面 |
| F15 | Dashboard effectiveGifts 依 active 與時間計數，未扣除 redeemedCount 已達上限；名稱若當作「可兌換」可能誤導 | A 指標定義／P2：清楚區分時間有效與仍可兌換；容量及個人對象不能用單一總數承諾 |
| F16 | 舊版 js/farmgame.js／phaser-farm.js 仍存在，正式 farmgame.html 入口用 farm/entry.js | C／P2：盤點殘留可達入口，遷移 Rules 時不能只搜尋新場景而漏掉舊寫入；不在本次刪檔 |
| F17 | farm/main.js 未見全遊戲 pagehide／persisted pageshow 統一銷毀／恢復；個別氣候／載入模組另有 handler，Phaser 自身也管理可見性 | C／P1：場景清理測試不能推定 iOS bfcache／鎖屏資源釋放已驗證；以實機測試決定是否需統一生命週期，不在本次逕改 |

## 5. 已有防護與尚缺驗證

- 管理 API：token admin＋Auth 當前 claim／disabled 雙查；不用 users.role 冒充，管理寫入同筆稽核及冪等，已由隔離測試驗證。
- 玩家營運 API：token 群組、users.accountId、groups.members、removed／disabled 與 ops 限制；兌換限流含格式錯誤、每玩家／IP 桶；真實部署與規則仍需核對。
- 禮包：雜湊碼、全服／帳號限額、目標／期間、獎勵白名單、容量、receipt 綁定碼與群組、成功原子更新；失敗不佔額。未發現可由 API payload 直接指定他人 accountId 或獎勵的程式路徑。
- 租犬：server 定價、關閉拒絕、舊報價拒絕、付款與租約原子、既有租約仍可啟用／解除；未發現可經正常 API 的 rentable／expectedPrice 偽造獲得免費新租約。
- 村落：雙方公開、來源／目標成員、交易內重讀；不存在「完全沒有群組檢查」的結論。缺的是這些檢查仍可被修改客戶端略過，以及正式 Rules／後端證據。
- 存檔：伺服器交易初始化、建立收據、invalid save 拒絕、快照世代與 stale verification 保護；功能測試不等同任何 client delete 均已被規則阻止。
- UI：村落公告及排行用 textContent／Phaser text，未在已查動態內容發現直接執行公告 HTML 的路徑；這不代表 Nexus 其他頁沒有 XSS 或可忽略共同來源風險。

完整本次測試、就緒狀態與未執行項目以 [狀態報告](FARM_V1_STATUS_REPORT.md) 為準；修復順序見 [Roadmap](FARM_V1_ROADMAP.md)。
