# 咕咕村落 V1.0 工程狀態報告

- 盤點日期：2026-11-09（Asia/Taipei）。
- 程式基準：GitHub `origin/main` 與本機 HEAD 一致，`3849615e6e49696b0e9dfb6bd7b469301c43a883`。本次先 fetch 確認，直接閱讀主要來源，不以過去文件取代證據。
- 範圍：遊戲、營運中心、Firebase 身分／資料流、交易與場景生命週期。只新增四份報告；不改程式、資料、Rules、數值或部署。
- 正式環境：未讀取玩家資料、未查 Console／IAM／備份設定，沒有正式部署權限證據。所有「正式版本」均為**無法確認**，不是逕稱尚未部署。

## 1. 結論與狀態定義

**功能原型與營運工具已相當完整，但目前證據不足以判定可進行具公平競賽／資產可信度要求的 V1.0 正式營運。** 主要阻擋為舊經濟仍由客戶端交易、若干實際參數驗證缺口、完整正式 Firestore Rules 缺失、Emulator／備份還原及真機驗收未完成。

| 狀態 | 本報告定義 |
| --- | --- |
| 已完成 | 指正常路徑程式與相應資料模型存在，不代表已通過正式安全驗收 |
| 部分完成 | 有功能，但有交易權威性、恢復、驗證或營運流程缺口 |
| 未完成 | 在已檢查程式中找不到需要的實作／交付證據 |
| 隔離測試通過 | 本次實跑 Node／記憶體 SDK／Chromium 測試；不等同真實 Firestore Rules 或正式上線 |
| 正式無法確認 | 未取得已部署 SHA、Console 設定／READY 或真人操作證據 |

## 2. 核心功能與交易清單

以下來源皆位於 `js/farm/`，未特別標示者經 Firebase Web SDK 直接執行 Firestore transaction。

| 功能 | 正常實作／資料流 | 狀態與缺口 | 主要來源／測試 |
| --- | --- | --- | --- |
| 雞隻購買／出售 | ShopScene→tradePoultry，重讀 farm、結算產量、檢查金幣／雞舍容量／品種狀態，再更新逐隻與摘要 | 已完成正常路徑；授權與價格仍在瀏覽器，未提供後端商品交易 API；一般道具售價亦可由方法參數傳入，見 F02 | ShopScene.js:434、poultry.js:112；poultry、onagadori 單元測試及本次雞種瀏覽器 |
| 四種雞與產蛋 | hen／silkie／bresse／onagadori 的 BREEDS；逐隻 laidAt 補算、滿產停鐘、病雞與 48 小時死亡 | 已完成純規則；Date.now 與生病亂數仍由客戶端決定，不是後端排程 | poultry.js:4、:32；MyFarmScene.js:435；養殖單元測試 |
| 雞舍升級與容量 | Lv.1／2／3 容量 3／10／20；升級至 2、3，4／5 尚未開放 | 部分完成：executeUpgradeCoop 接受傳入 price，不重取固定價格；見安全報告 F02 | ShopScene.js:450、combat／poultry 常數；本次隔離探查 |
| 收蛋與蛋出售 | collectPoultry 按倉庫可用量分品種收蛋；售蛋重讀數量，使用 BREEDS.eggPrice | 已完成正常路徑；舊買賣無持久 operationId 收據；權威性待遷移 | MyFarmScene.js:584；ShopScene.js:406；poultry.js:84；本次雞種瀏覽器 |
| 日本長尾雞 | 目前正式可購；6,000／回售 3,000；6 小時一顆、每隻待收上限對應每日產能 4、蛋售 120 | 已完成程式；品種設定與其他三雞共用模型，不能推定線上已是此版本 | poultry.js:8；本次 onagadori 瀏覽器涵蓋買／收／蛋售／雞售與連點 |
| 倉庫／物品 | inventory-core 白名單容量、分類與分頁、裝備、丟棄、餵食 | 已完成正常路徑；大多數寫入仍客戶端交易 | WarehouseScene.js:246、:313、:344；inventory／item-categories 單元測試 |
| 擴倉／買藥 | 扣款及容量／藥量同筆更新 | 部分完成：負數 qty 未在交易方法驗證，可產生反向扣款；F02 | ShopScene.js:385、:467；本次隔離探查 |
| 治療／放風 | 按穩定雞 id 或隨機病雞治療；消耗 medicines；少於六隻全放風，否則至少六隻；室內也產蛋 | 已完成正常規則及選單；非伺服器授權 | poultry-housing.js；MyFarmScene.js:382；poultry-housing-ui.js；housing 單元測試，瀏覽器本次未重跑 |
| 菜園抓蟲／地鼠 | 成功抓蟲加 gardenCatchCount；自家 Lv.2 起每 30 隻；三隻地鼠、60 秒、戰鬥／結算阻止抓蟲 | 已完成程式；抓蟲亂數、里程碑與勝負仍由客戶端寫入 | MyFarmScene.js:468；mole-rules/store/trigger.js；mole、garden 單元測試 |
| 野狼／老虎 | 前端移動／命中／倒數；擊殺進度與掉落同筆交易，最近 128 個擊殺收據 | 部分完成：未經伺服器簽發遭遇及驗證命中，舊收據裁切後可不再去重 | VisitScene.js:427、:510；combat-progress.js；predator／combat 單元測試 |
| 飛龍／巨鷹／巨猩 | BossEncounter UI、弓箭及近戰限制、結果歷史與獎懲交易 | 部分完成：接受 id／outcome，未讀已簽發的持久遭遇；最近結果 32 筆，重入恢復不等同地鼠類 | dragon.js:36、eagle.js:16、gorilla.js:21；各戰鬥純測試 |
| 蛇王／地鼠／遠古巨人 | challenge 保存開始／截止／里程碑，結算比對當前 id、期限與既有結果 | 部分完成：有恢復及重送防護，但 outcome、戰鬥命中及時鐘仍不可信；不能把固定時限當後端防作弊 | cobra-store.js、mole-store.js、giant-store.js；相應單元測試 |
| 遠古巨人規則 | 自家 Lv.3、狼＋虎每 50 擊殺、70 秒；巨石售 600；輸扣至多 300，最低 0 | 已完成版本規則；木棒／狼牙棒／雙手斧／槌 900／800／600／400，下列弓 300／200／150，傷害由共用表計算 | giant-rules.js:2；combat-rules.js:2；giant 單元測試 |
| 武器與裝備 | 共享 damageByEnemy；飛行敵人近戰無效；持有檢查／裝備狀態與出售檢查在交易重讀 | 已完成正常路徑；裝備／命中檢查在瀏覽器，可被改程式繞過，需 Rules／後端 | combat-rules.js:15；WarehouseScene.js:246；ShopScene.js:417 |
| 偷蛋與防守 | 同筆交易讀自己／目標／群組，容量／冷卻、隨機攔截、來源庫存、目標扣蛋與通知更新 | 部分完成：跨群組資格重查是優點，但玩家可控制 roll、時間與排名更新；未有可信任偷蛋 API | VisitScene.js:633；villages.js:15；guard-dog-notices.js；本次護衛犬瀏覽器 |
| 守衛犬租用 | gameOpsGuardDog 驗證 Auth／群組／後端價格／開放；付款與租約／收據原子更新；首次啟用才計時 | 已完成後端與玩家正常流程；正式 Rules 是否禁止直接改／刪整個 owner 文件未知 | game-admin/functions/service.cjs:145；guard-dog-core/store/ui；本次後端／護衛犬瀏覽器 |
| 守衛犬商品狀態 | 大白熊 80／400、米格魯 20／100、邊牧 200／1000 且預設未開；後台可覆寫開放／價格 | 已完成；閉鎖由 API 驗證，不只 disabled；既有邊牧租約保留 80%／活潑行為；實際覆寫資料未讀取 | guard-dog-core.js:2；management.cjs:27；ShopScene.js:143 |
| 偷蛋王排行 | 指定欄位 stolenEggs20261109，台灣時間 11/9 00:00 至 11/15 00:00（不含終點）；公開村落前十 | 部分完成：來源計數仍可由客戶端控制；按群組＋帳號分開計分，不合併；無可信任最終封榜／發獎工作 | ranking-core.js:1；rankings.js:7；ranking 單元測試 |
| 歡迎／訪客通知 | farm_notifications 與 farmMail 領取旗標分離；刪信不重發歡迎禮；訪客／防守通知 | 已完成正常去重；歡迎禮發獎仍在前端交易，不能只靠旗標防惡意直寫 | mail-store.js:43、:74；本次護衛犬及公告兌換瀏覽器 |
| 營運公告／活動碼 | 後端依登入／成員／對象／期間過濾，玩家純文字顯示及複製碼 | 已完成程式；需 gameOpsAnnouncements 與索引就緒；正式無法確認 | service.cjs:134；mail-ui.js:338；本次後端／通知瀏覽器 |
| 禮包兌換 | 標準化碼→雜湊查詢→限額／對象／時間→同筆更新農場、次數、收據、成功紀錄 | 已完成後端及隔離重送／並發／回滾測試；正式 Rules／App Check 配置／容量實測未證明 | service.cjs:185；domain.cjs:56；本次 32 項及通知瀏覽器 |

Boss 掉落在滿倉時仍保留並回報 overflow 是 dragon／giant 等明確行為，不在本次誤列為容量漏洞；是否需要專用暫存獎勵信箱是產品決策。既有季節模組有日期限制，不將過期活動描述為目前正在進行。

## 3. Firebase 資料與權威性

### 3.1 實際集合

| 資料 | 主要結構／用途 | 風險及查詢 |
| --- | --- | --- |
| users/{profileId} | accountId、name、role、avatar 及舊驗證欄位 | 不等於 farm owner 文件；成員讀取常直接取得完整 profile，需私密／公開資料分離 |
| groups/{g} | members:Array<accountId>、farmVillageVisibility、名稱 | readVillageAccess 在交易內重查公開狀態與雙方成員；前端檢查不是 Rules |
| groups/{g}/users/{a} | farm：coins、hensState／readyEggs／摘要、道具、裝備、各 challenge／results、guardDogs、排行與冷卻 | 單文件跨多種經濟變更，交易競爭／大小及受信任欄位須整體保護 |
| 同 owner 下 farm_meta/creation | 初次建檔證據 | 與初始存檔同筆建立，空快取／原存檔損壞不自動補預設 |
| owner.farmMail／farm_notifications | 歡迎建立／領取旗標與可刪通知 | 歡迎旗標在 owner，不是獨立受信任後端收據 |
| groups/{g}/settings/gameConfig | targetRoomId | 防守／遊戲通知通道，需核對 rooms.groupId 及參與資格 |
| rooms／messages | 遊戲廣播與防守通知 | 部分通知可跟主交易提交，其他成功後才送，通知不等於唯一獎勵證據 |
| ops_* | 公告、通知、禮包、claims、兌換、稽核、請求收據、限流、玩家控制、設定、活動 | 管理站走 callable，設計由 Admin SDK 讀寫；最終封鎖依正式 Rules 合併 |
| RTDB nexus/* | Firestore 讀取鏡像與 access／status | 前端 REALTIME_READS_ENABLED=false；不是獎勵主資料，也不是備份 |

### 3.2 身分與交易

- 入口 `constants.js`→readGameContext→requireGameMembership，群組鍵優先 lastGroupId；Boot 等資格後才存取私人農場。
- 玩家主站仍是 users 舊制登入；photoSession 核對帳號／舊憑證／群組再建立 Auth custom token。營運 API 再核對當前 users、token group、groups.members、停用與營運限制。
- 管理站獨立 Firebase Auth Email／Password，後端同時檢查 token 及當前 admin claim。users.role 的 admin／parent 不授予這套管理權。
- MFA／App Check 選用是現行已授權產品設定，不在本次逕列為漏洞或擅自啟用；登入、資格及原子交易仍必要。
- Firestore transaction 有並行重試與原子性，但瀏覽器中的價錢、亂數、勝負可被修改，**原子性不是業務授權**。
- 禮包／租犬／管理寫入有持久 requestId／fingerprint；舊交易主要是 busy 鎖、最新餘額／庫存及有限結果陣列。無法保證未知提交結果跨分頁重試只發生一次。
- Firestore 寫入由 RTDB trigger 非同步鏡像；無跨庫交易，也沒有第二份 RTDB 可重複領取獎勵。

### 3.3 Rules 與索引

完整正式 Firestore Rules：**Repository 不包含可確認的完整版本**。root firebase.json:22 只有 indexes；game-admin 規則為 fragment／測試，growth-forest/firestore.rules 是隔離 Emulator 政策。Storage／RTDB Rules 有追蹤檔，但正式是否已套用無法確認。

護衛犬 fragment 要與每條涵蓋 farm 的 create/update allow 以 AND 合併；若仍有 broad allow，另加 deny 不能阻擋。還須明確檢查 owner 文件 delete，不能只保護欄位 update。

索引檔已包含 ops 通知／活動與部分聊天／生活查詢。`ensure-announcement-index.cjs --notifications --management` 只補公告 feed、通知及活動索引，**不代表涵蓋 Dashboard、禮包、稽核任意組合**。目前 root 索引檔沒有 ops_gifts／ops_redemptions／ops_audit 的複合索引定義；Console 是否另行建立未知。需在 staging 對實際啟用的所有篩選逐一驗證索引，不能用記憶體 Query 成功證明正式 READY。

### 3.4 備份與部署證據

已查 scripts、兩份 firebase.json 與 repository 檔案，未找到 farm／ops 的備份排程、PITR 配置、還原演練、自動化發版監控或儲存庫 .github/workflows。不能推定 Console 也沒有；目前是缺少交付證據。

應備份農場及不可分割的禮包計數、claims、收據、稽核、控制設定；還原僅 farm 會與已兌換收據不一致。回滾前端／Functions 不能撤銷已提交經濟資料，詳見發布清單。

## 4. 營運後台完成度

| 模組 | 程式完成 | 本次隔離驗證 | 正式狀態／限制 |
| --- | --- | --- | --- |
| 登入／角色 | Email／Password、session 恢復、選用 MFA；後端查當前 claims | 後端非管理員／未登入／撤權測試包含於 32 項 | Auth 配置、已部署版本及真人 MFA 未確認 |
| Dashboard | 真實 count aggregation、最近稽核 | 後端相關測試 | 索引 READY 未確認；有效禮包計數只依 active＋時間，不排除已額滿 |
| 玩家管理 | accountId／UID 分開查詢、農場摘要、備註、營運 API 限制 | 管理後端隔離測試 | 不是完整 Auth 封禁、踢出、改密碼或角色分權 |
| 調整金幣 | expectedCoins、增減上限、非負、同筆稽核／收據 | 並行、過期餘額、失敗回滾、重送 | 不能修補其他舊入口直接改 farm 的風險 |
| 遊戲設定 | 護衛犬日租／週租／rentable 可即時更新 | 價格／關閉、舊報價拒絕，護衛犬瀏覽器 | 雞種／武器／怪物唯讀，不是全數值後台 |
| 活動 | draft／scheduled／active／ended／cancelled，連動公告同筆保存 | 指定對象、排程到期、取消、連動擁有權 | 不自動啟動怪物、結算排行榜或發獎 |
| 公告／系統通知 | 發布、排程、指定帳號、複製碼、分頁 | 對象／時間／純文字及玩家流程 | 玩家輪詢不是 FCM 推播；舊 app_notifications 另系統 |
| 禮包 | 建碼、雜湊、限量、指定帳號、兌換、停用 | 正常／並發／額滿／重送／失敗重試 | 目前雞隻獎勵僅 hen，蛋四種；白名單不含所有既有掉落品 |
| 操作稽核 | 成功寫入與狀態同筆；失敗部分另寫 | 32 項包含成功與部分失敗 | auth／throttle／部分參數錯誤在 catch 外，未全面記錄；無保留與告警政策證據 |
| 系統開關 | 公告、兌換、新租犬三個開關 | 後端關閉與保留既有租約 | 不是全遊戲維護／經濟寫入總閘門 |

## 5. 效能與穩定性

- `scene-cleanup.js` 共用 shutdown／destroy 清理；Shop／Warehouse 解除 registry，Visit 解除群組與目標 Listener，MyFarm 清除每秒計時及 Boss／雞隻資源；Boot 的存檔 session 到 Game.destroy 才停止，這是跨場景設計。
- 素材有 CORE_ASSETS 首載、FarmAssetScene 佇列／快取重查、preload gate、失敗重試；不能依舊文件誤稱目前所有 Atlas 都在 Boot 預載。
- 空快取、慢快照與 pending writes 不授權建檔；最後有效快照與驗證請求有世代保護。但離線不能保證經濟操作提交，恢復後仍需確認 authoritative state。
- 版面有 resize／viewport 與 DOM 面板適配；Chromium 模擬手機／桌面只驗幾何與互動，不等於 iPhone／iPad、記憶體、電池及 GPU 已通過。
- 排行榜分批 users 但仍遍歷所有公開村落與每位 farm，缺 server top-N 索引；大量公開玩家的讀取成本與延遲待量測。
- 同 farm 的多交易、限流桶、全服單禮包計數有熱點可能；現有小型並發測試不是多人壓力測試。
- 既有 boss 結算保留差異與重試時效，需改成統一伺服器狀態機，不能只檢查動畫清理就認定斷線不會逃避損失。

## 6. 本次測試證據

所有測試使用本機假資料／SDK transport 或 demo Emulator；未讀寫正式資料。有生成行為的套件測試在 `/tmp/farm-v1-audit` 的 main 快照副本執行。

| 識別 | 本次實跑 | 結果 |
| --- | --- | --- |
| T01 | node --test tests/*.test.mjs tests/*.test.cjs | 182／182 通過，涵蓋養殖／戰鬥／庫存／排行等純邏輯；不是 182 項全為 farm |
| T02 | npm --prefix game-admin/functions test | 32／32 通過，含 callable HTTP middleware、本機 CORS／匿名拒絕、交易及管理模組 |
| T03 | 隔離來源方法探查 | 重現免費傳入價升級、負數買藥、負數擴倉、一般物品假售價、未驗證勝利的純規則發獎、擊殺收據超窗重播；見安全報告 |
| T04 | farm-onagadori-browser.cjs | 通過：6,000 購買、連點、餘額不足、產蛋／收蛋、蛋售 120、雞售 3,000；真實 Phaser＋隔離 SDK |
| T05 | farm-guard-dog-browser.cjs | 通過：租用／付款／啟用／解除／到期、70%／33%／80% 模擬防守、跨村／通知、邊牧關閉與原租約、動態改價及舊報價拒絕 |
| T06 | farm-save-browser.cjs | 通過：空快取／離線不覆寫預設、保留既有資產、重連、缺損存檔拒絕、一次性建檔及刪除後不自動重建 |
| T07 | game-group-isolation.cjs | 通過：所選群組優先、多人名單、遊戲資料／商店／廣播隔離、跨分頁／返回與非成員阻擋 |
| T08 | farm-operations-browser.cjs | 通過：公告對象／時間、系統通知、複製碼、兌換／重送／離頁／錯誤／資產同步及行動版，transport 為替身 |
| T09 | farm-performance.cjs | 通過結構斷言：20 輪場景切換資源不累積、金幣更新保留精靈／計時器、Game.destroy 清理；僅五秒採樣、兩隻雞情境，非長時間壓測 |
| T10 | Firebase emulators:exec，demo-nexus-ops，Auth／Firestore | 失敗於啟動前：下載 cloud-firestore-emulator-v1.19.8.jar 回 403 Domain forbidden；未跑到整合或 Rules 斷言 |

首次瀏覽器啟動因本機 HTTP server 尚未開啟回 ERR_CONNECTION_REFUSED，啟動 server 後重跑；這不是正式服務故障或功能驗收失敗。MemoryDB 的交易以 queue 串行處理，無法證明真實 Firestore 競爭重試或吞吐；本次沒有以它代替 Emulator。

其餘單一怪物／放風／氣候／排行 UI 的專用瀏覽器腳本存在，本次不重跑全部，不能將過去通過當作本次結果。

五秒無頭採樣得到平均約 11.79 FPS、frame median 約 84.9 ms、p95 約 108.8 ms（同時有其他隔離瀏覽器工作）。這只是本環境數據，不具正式裝置代表性，不能據此宣稱達成 60 FPS，也不能不做基準比較就判定版本退步。

暫存測試輸出 `/tmp/farm-v1-*.log`／JSON 只保留在本環境。來源證據依本報告基準 SHA、檔名及行號定位，不依暫存檔作長期稽核。

## 7. 尚未完成與正式決策

**P0 安全關卡未完成前，不建議以排行榜或農場資產作可兌付／具競爭價值的正式獎勵依據。** 這不是已確認有人作弊，也不是要求本次停服；是工程驗收尚缺。

目前沒有可信任排行榜封榜與發獎、完整經濟後端、完整正式 Rules／備份還原／正式監控與真機長測證據。下一階段依 [Roadmap](FARM_V1_ROADMAP.md) 排程；正式發布以 [Release Checklist](FARM_RELEASE_CHECKLIST.md) 關卡簽核，不以 GitHub push 當作完成。
