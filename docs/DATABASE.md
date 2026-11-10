# Firebase 資料模型與查詢

> 2026-11-09，以寫入物件、純資料模型、查詢與儲存庫內規則為依據。這是程式可辨識的邏輯 Schema，不是正式資料庫完整匯出。欄位可能缺漏或有歷史格式；正式 Rules、TTL、備份與實際資料品質均待確認。本文只記欄位名稱，不記任何憑證或實際玩家資料。

## 1. 型別及識別約定

- `string`／`number`／`boolean`／`Array<T>`／`Map<T>` 為概念型別；Firestore 並未因文件存在而自動強制 Schema。
- `Timestamp` 表示 SDK 時間戳，`ms` 表示 Unix 毫秒，`ISO` 表示日期時間字串，`date` 為 YYYY-MM-DD；不可混用比較。
- accountId 是穩定玩家鍵；users 文件 ID 可以與它不同。photoSession 所簽 UID 使用 users 文件 ID；管理員 Auth UID 獨立。
- groupId 應與路徑／查詢及 groups.members 一致。name 是可變顯示資料，舊姓名相容須拒絕歧義。
- 同名子集合不等同頂層集合，例如 `groups/{g}/messages` 不是頂層聊天 messages。

## 2. 帳號、群組與設定

| 路徑 | 主要欄位與型別 | 關聯／查詢與限制 |
| --- | --- | --- |
| `users/{profileId}` | accountId:string、name:string、role:string、avatar:string、menus:Array<string>、nameHistory:Array<string>；groupId:string 等為可選歷史欄位 | accountId 等值／in 分批查詢；groups.members 引用 accountId。舊 password／pin 欄位仍存在於程式模型，只記存在，不記值；前端角色不是 Auth claim |
| `groups/{g}` | name:string、icon:string、members:Array<string>、inviteCode:string、createdAt:Timestamp；farmVillageVisibility:string 為功能選填；遊戲通知目標另存 groups/{g}/settings/gameConfig.targetRoomId | members array-contains accountId；邀請碼等值查詢；公開村落仍需雙方資格判斷 |
| `group_requests/{id}` | groupId:string、userId:string、userName:string、accountId:string、status:string、requestTime:待確認、avatar:string（依審核介面讀取；歷史建立流程與時間原始型別待確認） | 入群審核；歷史請求可能缺 accountId，需依實際來源核對 |
| `userSettings/{accountId}` | accountId:string、modules:Map<boolean>、order:Array<string>、navigation:{items:Array<string>}、appearance:{theme:string,version:number,fontScale?:number}、updatedAt:Timestamp | 個人設定 merge 更新；舊姓名文件僅在可確認唯一歸屬後讀取。字級為 80／90／100／110／120，見 theme-bootstrap.js |
| `system_menus/{id}` | id:string、label:string、isDefault:boolean、group:string、order:number，來源 menu-catalog.js | 系統功能可見性；完整歷史欄位待確認，不等同後端授權 |
| `feedbacks/{id}` | userName:string、type:string、email:string、content:string、timestamp:Timestamp | 主頁聯絡表單；包含聯絡資訊，文件與紀錄不可輸出實際內容 |

來源：`js/auth.js`、`group.js`、`admin.js`、`personal-layout.js`、`appearance-settings.js`、`font-size-settings.js`、`navigation-settings.js`。

## 3. 聊天

| 路徑 | 主要欄位 | 存取模式 |
| --- | --- | --- |
| `rooms/{roomId}` | groupId:string、name:string、avatar:string；participantIds:Array<string>、creatorAccountId:string、readByAccount:Map<number>、unreadByAccount:Map<number>；lastMessage:string、lastMessageTime:Timestamp、lastSenderAccountId:string | groupId＋participantIds array-contains；舊 participants 姓名查詢合併後再次依固定成員過濾 |
| `messages/{messageId}` | roomId:string、groupId?:string、senderAccountId?:string、sender:string、text:string、timestamp:Timestamp、imageUrl?:string、replyTo?:Object、收回相關旗標依訊息流程 | roomId 等值、timestamp desc、limit(30)、startAfter 原始快照；messageQuery 本身未帶 groupId，不能推定其取代房間／Rules 檢查 |

`chat-identity-core.js` 也相容舊 creator、participants、read／unread 等格式，實際轉換鍵以函式為準。較舊訊息可缺固定識別，不應任意批次替換成目前同名帳號。replyTo 為當時回覆摘要，不承諾其名稱與原作者即時同步。程式沒有一天／30 天 TTL 設定，正式保留政策待確認。

## 4. 生活模組

### 行事曆 events

`events/{id}`：groupId:string、date:date、title:string、desc:string、category:string、visibility:string、isAllDay:boolean、startTime:string|null、endTime:string|null、reminderValue:number、reminderUnit:string、operator:string、accountId:string、timestamp:Timestamp。

`listenToEvents` 查全群組，前端保留 visibility=public 或 operator=目前姓名；首頁另查當日 date。儲存 accountId 仍有舊 `currentUser.id` 優先順序。這些是已存在的行為，不表示更名、私密讀取及 Rules 已統一。

### 記帳 expenses／customCategories

`expenses/{id}`：groupId:string、accountId:string、date:date、amount:number、category:string、type:income|expense、note:string（可空）、operator:string、timestamp:Timestamp。歷史缺 type 當 expense。分類設定 `customCategories/{id}`：groupId:string、name:string、type:string、icon:string、color:string、imgBase64:string|null（依表單寫入）。icon 有新 SVG 鍵及舊值相容。

常用查詢：

- 群組＋date 月份範圍；清單另按 type 與 date desc／documentId desc，limit(10) 及 startAfter。
- sum(amount)／count() 分別計算全月、收入及支出，再相容缺 type 的資料。
- 月曆查當月文件；回顧統計仍可能讀較大群組範圍，不可描述所有統計均已分頁。

來源：`js/expense.js`。目前缺群組時仍有固定預設群組，收入顯示權限亦有舊角色／姓名判斷，待另案處理。

### 待辦 todos

`todos/{groupId}`：groupId:string、accountId:string、updatedByAccountId:string、updatedAt:ISO、categories:Array<string>、todos:Array<Object>、recurringTemplates:Array<Object>。

| 內嵌物件 | 主要欄位 |
| --- | --- |
| todo | id:string 或歷史 number、title:string、note:string、category:string、assigneeScope:string、assigneeAccountIds:Array<string>、assignees:Array<string>、accountId:string、operator:string、groupId:string、deadline:string、dueTime?:string、dueAt?:ISO、completed:boolean、completedAt:string|null、completedDate:date|null |
| recurringTemplate | id:string、基本待辦／指派資訊、frequency:daily/weekly/monthly/yearly、intervalDays:number、startDate:date、startTime:string、endDate?:date、active:boolean、nextIndex:number |

`commit` 在同筆交易重讀 groups 及 todos，normalizeState 後只寫既有欄位。循環實例 id 帶模板及日期，進度 nextIndex 持久化；每輪最多補 200 個。整份聚合文件有 Firestore 大小／寫入競爭限制，不是無限清單儲存。

### Photo Dump photos

`photos/{id}`：groupId:string、caption:string、uploader:string、uploaderAvatar:string|null、uploaderAccountId?:string、uploaderUid?:string、imageUrls:Array<string>、storagePaths:Array<string>、storageProvider:string、timestamp:Timestamp、comments:Array<Object>、likes:Array<string>、likeAccountIds?:Array<string>；舊圖欄位由 gallery 相容讀取。

新留言含 id:string、senderAccountId:string、sender:string、text:string、replyTo:string|null、replyToAccountId:string|null、timestamp:ms；附圖留言另含上傳結果的 imageUrls／storagePaths 等。以 `gallery.js` 的 submitComment 與 `gallery-profile-core.js` 為準，歷史缺值待確認。新作者及留言者以固定 accountId 對目前 users 顯示，原姓名保留作歷史標籤。likes 是舊姓名清單，likeAccountIds 是新固定帳號，不可直接相加造成自己重複計數。

查詢：groupId、timestamp desc、limit(15)、startAfter；已載入區間增加 endAt 範圍監聽。Storage 路徑：`photo-dump/{groupId}/{AuthUID}/{postId}/{fileName}`。刪檔及貼文寫入是兩個服務，不存在單一交易。

### 餐食 food_restaurants／food_votes

`food_restaurants/{id}`：groupId:string、name:string、type:string、price:string、food:string、meal:Array<string>、tags:string、note:string、accountId:string、updatedByAccountId?:string、updatedAt:ISO。

`food_votes/{groupId}_{date}_{meal}`：groupId:string、date:date、meal:string、votes:Map<Object>、decision:Object|null、legacyImported?:boolean、updatedAt:ISO。votes 的 key 是 accountId，值含 accountId、name、avatar、choice、restaurantId、source、time:ISO。decision 含 choice、accountId、time。

先依群組＋日期＋餐別找舊隨機文件、一次性匯入固定文件，固定文件既有票優先。交易重查成員；餐廳修改亦核對文件 groupId。

## 5. 成長森林（groups/{groupId} 下）

以下共同欄位依寫入類型可能包含 schemaVersion:number、groupId:string、accountId:string、createdAt:ms、updatedAt:ms、updatedByAccountId:string，不保證每份歷史文件都有全部欄位。

| 子集合／文件 | 主要欄位與型別／用途 |
| --- | --- |
| `growthProfiles/{accountId}` | pointsBalance:number、pointsReserved:number、waterBalance:number、coinBalance:number、redeemedPoints:number、gardenLevel:number；森林資源帳本 |
| `gardens/{accountId}` | plotCount:number、slots:Array<string|null>（舊三格格式）、seeds:Map<number>；初始三地塊，可購擴充 |
| `gardenPlots/{id}` | accountId:string、positionIndex:number、plantId:string|null；種植佔位；購地只增加 gardens.plotCount，種植時才建立此文件 |
| `gardenPlants/{plantId}` | id:string、accountId:string、ownerAccountId:string、plantType:string、growthValue:number、growthStage:number、growthRequired:number、positionIndex:number、plantedAt:ms |
| `growthSettings/main` | examApproval:boolean、readingApproval:boolean、examBands:Array<Object>、improvementBands:Array<Object>、reading:Object、revision:number；規則詳細型別由 growth-domain.settings 驗證 |
| `growthRecords/{id}` | type:exam/reading、eventDate:date、note:string、photoPath:string|null、approvalStatus:string、policy:Object、rewardPoints／Water／Coins:number；exam 有 subject、examType、score、maxScore；reading 有 bookName、readingMinutes、readingPages、chapter |
| `growthReadingDays/{hash}` | accountId:string、eventDate:date、units:number；每日閱讀獎勵份數，避免拆單繞過上限 |
| `growthRecordKeys/{hash}` | recordId:string、accountId:string、createdAt:ms；紀錄內容去重，不以備註／照片作唯一性 |
| `growthRecordHistory/{id}` | recordId:string、accountId:string、before:Object、after:Object、reason:string；更正／重新送審歷程 |
| `growthTransactions/{id}` | kind:string、delta:Object、before:Object、after:Object、source:Object、reason:string、actorAccountId:string；資源變動帳本 |
| `growthRewards/{id}` | id:string、name:string、description:string、cost:number、status:active/inactive、legacyId?:string；夢想獎勵 |
| `growthRewardRequests/{id}` | id:string、accountId:string、giftId?:string、name:string、cost:number、detail:string、status:string、eventDate:date；requested／approved／processing 到 completed／rejected／cancelled 的轉換由服務限制 |
| `growthRewardLocks/{hash}` | accountId:string、giftId:string、requestId:string、active:boolean 等鎖定欄位，以 accountId＋giftId 限制未完成重複申請 |
| `growthRequests/{hash}` | fingerprint:string、result:Object 等冪等收據，按帳號與 requestId 雜湊 |
| `growthAudit/{id}` | action:string、actorAccountId:string、targetAccountId:string、changes:Object|null、result:Object、createdAt:ms；審核與操作稽核 |
| `growthMigrations/{accountId}` | legacyBalance:number、pointsReserved:number、scoreCount:number、requestCount:number、sourceRevision:number、sourceFingerprint:string、sourcePaths:Array<string>；歷史初始化證據 |
| `growthSync/main` | revision:number、updatedAt:ms；前端暫行交易共用鎖與刷新訊號 |
| `growthExamPhotos/{id}` | accountId:string、groupId:string、dataUrl:string、contentType:string、createdAt:ms；目前前端直連的壓縮 JPEG，字串長度上限 650000 |
| `settings/wishWall`、`scores/{id}`、`redeems/{id}` | 舊版規則與積分／夢想兌換來源，依 wishwall-core.js 相容；不整批重寫歷史 |
| `settings/growthForestCutover` | 後端模式可建立的切換標記；direct-client 使用 markCutover:false，不應因新文件存在就假設正式切換 |

紀錄 policy 為提交當時快照；核准、撤銷、更正不能用後來規則重發整份獎勵。pointsBalance 不得低於 pointsReserved；森林金幣、水滴與星星不是農場 coins。

目前 direct 模式候選查詢最多 2000 筆，超限拒絕；列表通常每頁 20，森林每區九格。雲端模式的複合查詢與索引、暫行模式的本機篩選不可混述。

## 6. 咕咕村落

主路徑 `groups/{groupId}/users/{accountId}`，主要遊戲欄位集中於 `farm:Object`。同文件還可有 farmMail 等資料，不能用整份 setDoc 覆蓋。

| farm 欄位 | 型別／設計 |
| --- | --- |
| coins、coopLevel、warehouseLimit | number；金幣、雞舍等級、倉庫容量 |
| hens、hensState | number、Array<Object>；明細含 id:string、breed:string、laidAt:ms、isSick:boolean、sickTimestamp?:ms、pausedFull?:boolean |
| poultryVersion、readyEggs、eggsReady | number、Map<number>、number；版本 2 的 hen／silkie／bresse／onagadori 未收蛋明細及總和 |
| inventoryEggs、silkieEggs、bresseEggs、onagadoriEggs | number；收入倉庫的蛋，與 readyEggs 分開 |
| outdoorHensByBreed | Map<number>；放風數，最低規則由 poultry-housing 處理，總養殖與產能不變 |
| worms、earthworms、medicines、武器與掉落欄位 | number；合法容量由 inventory-core 的白名單計算，不能把所有數字欄位都當道具 |
| equippedWeapon、equippedBow | string；近戰與弓裝備鍵，出售須依現有裝備檢查 |
| cleanliness、moral、lastLayTime | number、number、ms；清潔度及舊版相容摘要 |
| gardenCatchCount、moleLastMilestone、moleChallenge、moleResults | number、number、Object、Array<Object>；抓蟲里程碑、持久化挑戰與結算 |
| combatKills、giantLastMilestone、giantChallenge、giantResults | Map<number>、number、Object、Array<Object>；擊殺門檻與遠古巨人結果 |
| cobraLastMilestone、cobraChallenge、cobraResults | number、Object、Array<Object>；蛇王遭遇與結算 |
| guardDogs | Array<Object>；id、breedId、days、paid、rentedAt:ms、startedAt:ms|null、expiresAt:ms|null、remainingMs:number（毫秒餘額）；待命不扣時，啟用／解除由後端更新；舊待命租約缺少 remainingMs 時按原 days 相容 |

護衛犬值勤中的 `remainingMs` 為本次啟用餘額快照，即時餘額應以 `expiresAt－目前時間` 計算；待命時才直接使用保存的 `remainingMs`。統一透過 `guardDogRemainingMs` 讀取，避免誤把值勤餘額顯示成固定值。

其他怪物、偷蛋通知、冷卻與排行榜欄位以 `farm-*.md`、各 rules／store 為準；不同遭遇不可假設都有相同持久化 Schema。

玩家文件子集合：`farm_meta/creation` 保存初始建檔證據；歡迎禮收據保存於玩家文件 farmMail.welcomeCreatedAt／welcomeClaimedAt；`farm_notifications/{id}` 保存訪客／系統通知，包含 type、內容、createdAt:ms、readAt、claimedAt 等依種類欄位。歡迎禮的不可刪收據與可刪信件分離。`isFarmSave` 檢查總雞數、明細與蛋摘要一致，空快取不能授權自動重建。

## 7. 營運集合

均為頂層 `ops_*`；設計為僅 Admin SDK 存取，瀏覽器須呼叫 API。正式規則合併仍待確認。

| 集合／文件 | 主要欄位與用途 |
| --- | --- |
| `ops_announcements/{id}`、`ops_notifications/{id}` | announcementId／notificationId:string、title:string、content:string、type:string、priority:number、targetType:all/accounts、targetAccountIds:Array<string>、startAt／endAt:ms、showPopup:boolean、status:draft/scheduled/published/archived、activityCode:string、createdBy:string、createdAt／updatedAt:ms；searchTokens、audienceKeys:Array<string> 支援查詢 |
| `ops_gifts/{id}` | giftCodeId、name、description、type:universal/limited/single/targeted、codeHash:string、rewards:Array<Object>、maxRedemptions:number|null、maxRedemptionsPerUser:number、redeemedCount:number、targetAccountIds、startAt／endAt:ms、status:draft/active/inactive、建立／更新欄位 |
| `ops_gifts/{id}/claims/{hash}` | count:number 等帳號次數；以固定帳號計算，不因換村落重置 |
| `ops_code_index/{hash}` | giftCodeId:string；正規化碼的 SHA-256 索引，避免查詢明碼 |
| `ops_receipts/{hash}` | codeHash:string、groupId:string、response:Object 等；UID＋requestId 綁定重送結果 |
| `ops_redemptions/{id}` | giftCodeId、name、uid、accountId、groupId、createdAt:ms、result:success/failed、rewards:Array、failureReason、errorCode、requestId |
| `ops_audit/{id}` | adminUid:string、createdAt:ms、action:string、target:string|null、before／after:Object、result:string、reason?:string、requestId；失敗紀錄可只含 errorCode |
| `ops_admin_requests/{hash}` | fingerprint:string、response:Object、createdAt:ms；管理寫入冪等，不保存完整登入憑證 |
| `ops_guard_requests/{hash}` | fingerprint:string、response:Object 等；租犬／啟用／解除／到期重送收據 |
| `ops_limits/{hash}` | 限流桶計數及時間；使用 UID／IP 雜湊，不保存明文 IP |
| `ops_player_controls/{users UID}` | blocked:boolean、notes:string、reason:string、revision:number、updatedAt:ms、updatedBy:string；限制公告／兌換／租犬，不等同停用 Auth |
| `ops_game_config/guard-dogs` | guardDogs:Map<{dayPrice:number,weekPrice:number,rentable:boolean}>、revision:number、updatedAt:ms、updatedBy:string |
| `ops_settings/global` | values:{announcementsEnabled:boolean,redemptionEnabled:boolean,guardDogRentalsEnabled:boolean,pauseMessage:string}、revision:number、更新欄位 |
| `ops_events/{id}` | eventId、title、description、type:community/seasonal/competition、status:draft/scheduled/active/ended/cancelled、priority、targetType、targetAccountIds、startAt／endAt:ms、activityCode、showPopup、searchTokens、revision、建立／更新者 |

活動與 `ops_announcements/event-{id}` 同筆寫入，公告含 sourceEventId；實際狀態由時間判斷，不另寫定時狀態。公告玩家查詢使用 status in、audienceKeys array-contains-any，依 priority／createdAt 排序後在後端檢查有效期與對象；管理搜尋為名稱前綴 tokens，非全文搜尋。活動複合索引已列於索引檔。

獎勵格式依 `domain.rewards`：`{kind:'coins',amount}`、`{kind:'eggs',breed,amount}`、`{kind:'chicken',breed:'hen',amount}`、`{kind:'item',itemKey,amount}`。目前只有母雞可作雞隻獎勵；道具必須在 ITEMS 白名單，存在於農場的道具不代表已可營運發放。禮包明碼只在建立成功時一次顯示，公告 activityCode 則刻意是可公開的活動碼，兩者不要混淆。

## 8. 舊功能與輔助資料

- `game_permissions`、`game_records`、`game_records_2048`：遊戲權限、猜拳統計、2048 最高分等；部分鍵為 groupId＋姓名，完整歷史差異以 games.js／admin.js 為準。
- `checkins`：date、time、operator、timestamp；目前舊寫入未帶 groupId。`settings/checkinConfig` 保存 targetRoomId 共用通知目標。
- `app_notifications`：date、title、content、author、timestamp、lastEditedAt 等；讀最近 30 筆，不是 ops_notifications。
- `logs`：groupId?:string、datetime:string、operator:string、actionType:string、details:string、timestamp:Timestamp；部分舊寫入沒有 groupId，不能視為安全稽核或完整帳務紀錄。

## 9. RTDB 與 Storage

RTDB 根節點為 `nexus`，含 farms、inboxes、rooms、messages、access、status。節點以版本化 wire 格式編碼 Firestore 值與 Timestamp，事件使用 `newer` 交易避免舊事件覆蓋。它是讀取鏡像；前端 `REALTIME_READS_ENABLED=false`。

`database.rules.json` 預設拒絕，指定路徑依 Auth claims、active、群組／房間成員開放讀取；訊息要求 sortTime 與 limitToLast≤100。沒有一般客戶端寫入 allow。正式套用狀態待確認。

`storage.rules` 包含 photo-dump 及 growth-exams 路徑，依 photoGroupId、photoAccountId、users/{UID} 及群組成員判斷。照片建立有大小／MIME 限制，作者或管理角色可刪。現在森林新照片走 Firestore 暫行模式，不能把此 Storage policy 描述為已保護 growthExamPhotos。

## 10. 權限與文件可信度

| 證據 | 能確認的事 | 待確認 |
| --- | --- | --- |
| root firebase.json | 設有 Firestore 索引，未指定正式 Firestore Rules 檔 | 正式讀寫 allow、遞迴匹配、欄位驗證 |
| game-admin/rules/*.fragment.rules | 營運集合與護衛犬欄位的合併建議 | 是否合併到全部 broad allow 並正式部署 |
| growth-forest/firestore.rules | 隔離 Emulator 用的後端模式政策 | 不能直接替代目前 direct 模式／全站正式規則 |
| database.rules.json／storage.rules | 儲存庫中的 RTDB／Storage 政策 | 正式版本及部署時間 |
| service／transaction | 程式的資格、額度、重送與原子更新 | 無法單獨阻止其他寬鬆 Rules 下的直接寫入 |

Firestore 多個匹配 allow 採 OR；額外寫 deny 不會推翻既有寬鬆 allow。本次不更動任何 Rules、索引或資料，不對正式安全程度作推定。
