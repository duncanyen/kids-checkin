# Nexus 模組索引

> 2026-11-09，按目前可找到的入口與程式盤點。「存在程式」不代表已部署。各欄位型別見 [DATABASE.md](DATABASE.md)。

## 1. 首頁、帳號與群組

| 項目 | 說明 |
| --- | --- |
| 用途 | 登入／註冊、加入或切換群組，組合首頁小工具、未讀、今日行程、待辦與照片輪播 |
| 主要檔案 | `index.html`；`js/main.js`、`auth.js`、`group.js`、`dashboard.js`、`account-identity.js` |
| 核心函式 | `processLogin`、`evaluateUserGroups`、`enterGroup`、`showDashboard`、`stopDashboardListeners` |
| 資料 | Firestore users、groups、group_requests、userSettings、system_menus；各小工具查詢其業務集合 |
| 關係 | `scoped-profiles.js` 依指定識別分批讀頭像；首頁的快照可在成員補載後重繪，不需另開查詢 |

登入與註冊是既有舊制流程；管理員 Custom Claims 由另一套可信任工具設定。首頁每次重建清除舊訂閱，避免群組資料穿插。

## 2. 聊天

- **用途**：群組房間、成員管理、文字／圖片／回覆／收回、已讀與歷史分頁。
- **檔案**：`chat.html`、`js/chat-core.js`、`chat-rooms.js`、`chat-membership.js`、`chat-history.js`、`chat-identity-core.js`。
- **函式**：`refreshChatGroupMembers`、`watchMemberRooms`、`mutateRoomIdentity`、`listenToMessages`、`ChatHistory.loadOlder`。
- **資料**：Firestore rooms、messages；圖片沿用照片上傳模組；`live-reads.js` 提供可選 RTDB 讀取適配，目前開關關閉。
- **關聯**：groups.members 界定群組，participantIds 界定房間；nameHistory 只做可確認的相容，不能推翻已存在的固定成員。

即時最新頁與歷史頁按訊息 id 合併，每頁 30 筆。程式沒有「只保留一天」的歷史查詢條件；正式 TTL／人工清理政策待確認。

## 3. 行事曆

- **用途**：月／週／日視圖、行程新增／修改／刪除、提醒設定與首頁今日行程。
- **檔案**：`calendar.html`、`js/calendar.js`；首頁由 `dashboard.js` 顯示摘要。
- **函式**：`listenToEvents`、`initCalendar`、`saveEvent`、`deleteEvent`。
- **資料**：Firestore events，帶 groupId；視圖偏好使用本機儲存。
- **限制**：目前訂閱全群組 events 後以前端 public／operator 姓名篩選，並未保存解除函式；不能描述為完整的伺服器私密隔離。

## 4. 記帳本

- **用途**：收入／支出、分類、月份清單與日曆、個人／群組圖表、回顧。
- **檔案**：`expense.html`、`js/expense.js`、`expense-category-icons.js`、`chart-loader.js`。
- **函式**：`initApp`、`loadListPage`、`loadMonthData`、`loadMonthProfiles`、`fetchAndRenderReviewData`、`loadChart`。
- **資料**：Firestore expenses、customCategories；使用 users 的限定識別補頭像。
- **關聯**：首頁金額由 dashboard 查詢；清單每次文件讀取最多 10 筆、統計使用伺服器聚合。note 是可選名稱，不要求新增時填寫。
- **限制**：部分收入權限與缺群組時回退仍為舊邏輯，見問題清單；前端隱藏不等於資料權限。

## 5. 待辦事項

- **用途**：分類、指定人員、截止日期、完成狀態與循環待辦。
- **檔案**：`todo.html`、`js/todo.js`、`todo-core.js`。
- **函式**：`NexusTodoApp.init`、`loadMembers`、`watchMemberProfiles`、`commit`、`refreshRecurring`、`materializeRecurring`。
- **資料**：Firestore `todos/{groupId}` 聚合文件，groups 與 users 查詢成員。
- **關聯**：首頁重用指派解析；accountId 對應最新頭像，歷史 assignees 留作相容。循環實例有固定 id 與進度游標，頁面驅動補齊，沒有後端排程。

## 6. Photo Dump

- **用途**：多圖貼文、按讚、留言、塗鴉、放大檢視、下載與分享。
- **檔案**：`gallery.html`、`js/gallery.js`、`gallery-core.js`、`gallery-identity.js`、`gallery-profiles.js`、`gallery-profile-core.js`、`gallery-storage.js`、`gallery-viewer.js`。
- **函式**：`loadNextPage`、`subscribeRange`、`pauseGallery`、`resumeGallery`、`watchPhotoProfiles`、`photoPerson`、`uploadPhotoPost`、`updatePhotoLike`。
- **資料**：Firestore photos、users、groups；Firebase Storage 儲存新照片，舊照片格式仍相容。
- **關聯**：首頁輪播共用作者／留言者最新名稱解析；優先按 accountId 查 users，歷史姓名只是回退標籤，不批次重寫貼文。

相簿每頁 15 筆、以快照游標建立範圍監聽；卡片與圖片避免全量重建。上傳失敗有檔案補償清理，不宣稱 Storage＋Firestore 為單一交易。

## 7. 吃什麼

- **用途**：群組餐廳、價位／餐別、轉盤、投票與餐食結果。
- **檔案**：`food-decision.html`、`js/food-decision.js`、`food-store.js`。
- **函式**：`initialize`、`loadRestaurants`、`loadVotes`、`saveVote`、`createFoodStore`、`foodDocumentId`。
- **資料**：Firestore food_restaurants、food_votes；群組／日期／餐別組成固定投票文件鍵。
- **關聯**：成員資格由共用模組查核；切換餐別使用版本鎖處理尚未完成的舊訂閱。隨機文件的歷史票只匯入一次，固定文件既有票優先。

## 8. 成長森林

- **用途**：考試／閱讀紀錄、家長審核、星星／水滴／森林金幣、種植澆水、夢想獎勵與同群組森林參觀。
- **檔案**：`wishwall.html`、`js/growth-forest/main.js`、`client.js`、`transport.js`、`direct-client.js`、`firestore-store.js`、`cloud-client.js`、`scene.js`；共用來源 `functions/growth-service.cjs`、`growth-domain.cjs`。
- **函式**：`initialize`、`action`、`connect`、`createFirestoreStore`、`createGrowthService`、`examAward`、`createForest`。
- **資料**：Firestore 群組下 growth*、gardens、gardenPlants、gardenPlots；暫行考卷照片放 growthExamPhotos，舊 Storage 照片仍可讀。
- **關聯**：讀取舊 wishWall／scores／redeems 初始化與保留積分；不為歷史記錄重發新資源。外觀沿用個人設定；森林資源與農場金幣完全分開。

目前選用前端直連，cloud callable 保留但不是目前資料入口。每區九地塊，可持續購地；考試預設待家長審核、閱讀預設依規則自動核准，均可設定。紀錄保存提交時規則快照，更正／撤銷以資源差額交易處理。成員參觀只回傳必要的森林展示欄位。

## 9. 遊戲大廳與舊小遊戲

- **用途**：猜拳、2048 的權限、紀錄、排行及村落入口。
- **檔案**：`games.html`、`js/games.js`；`pet.html` 另保留純本機寵物。
- **函式**：`listenMyPermissions`、`playGame`、`init2048Game`、`makeMove`、`loadLeaderboard`。
- **資料**：Firestore game_permissions、game_records、game_records_2048；寵物使用 localStorage `shared_FamilyPetDB`。
- **限制**：部分舊遊戲文件鍵仍帶姓名；不能推定更名後所有舊資料會自動整併。

## 10. 咕咕村落

| 區域 | 主要檔案／函式 | 職責 |
| --- | --- | --- |
| 入口與存檔 | entry、BootScene、save-store；ensureFarmSave、startFarmSaveSession | 平行載入、成員閘門、伺服器存檔確認及跨場景 session |
| 場景 | MyFarmScene、LobbyScene、VisitScene、ShopScene、WarehouseScene | 自家、村落、拜訪、商店、倉庫 |
| 素材／生命週期 | assets、asset-manifest、scene-cleanup；ensureAssets、onSceneExit | 佇列去重、按需素材、離場清理 |
| 養殖與庫存 | poultry、poultry-housing、inventory-core；settlePoultry、collectPoultry、tradePoultry | 逐隻產蛋、容量、放風與裝備；室內雞仍有產能 |
| 戰鬥 | combat-rules、predators、mole、cobra、giant 及各 rules／store／trigger | 怪物互斥、門檻、倒數、命中與獎懲；不同怪物持久化程度不完全一致 |
| 護衛犬 | guard-dog-core／store／ui；rentalPrice、rentGuardDog | 租約、啟用、解除、防偷與巡邏；新交易經營運後端 |
| 通知／營運 | mail-store、mail-ui、operations-client | 歡迎禮／訪客、營運公告、活動碼複製及禮包兌換 |
| 社交與排行 | villages、rankings、ranking-core／ui | 群組村落、跨村資格、活動期間排行與偷蛋 |

資料核心為 `groups/{groupId}/users/{accountId}.farm` 與其通知／收據子集合。養殖純計算與畫面精靈分開；每隻 hensState 才是產能來源。既有買賣及部分戰鬥仍在玩家端交易，新租犬／禮包／管理調幣經後端，不能統稱所有資產已由伺服器授權。細節交叉參考各 `farm-*.md`。

## 11. 個人設定與共用介面

- **用途**：名稱、驗證資料、主題／字級、首頁排序、顯示模組與底部導覽。
- **檔案**：`settings.html`、`personal-layout.js`、`appearance-settings.js`、`theme-bootstrap.js`、`font-size-settings.js`、`navigation-settings.js`、`ui-icons.js`。
- **函式**：`loadPersonalConfig`、`readPersonalLayout`、`mountAppearanceSettings`、`mountAppNavigation`。
- **資料**：Firestore users、userSettings；按 accountId 隔離的瀏覽器快取。
- **生命週期**：theme-bootstrap 同步套本機偏好，不等待 SDK；hydrate 不應覆蓋已進行中的預覽。

## 12. 玩家站管理、打卡與舊系統通知

`admin.html`／`js/admin.js` 管理群組成員、功能與遊戲設定、入群審核及 logs。`readManagedGroup` 僅重查成員資格，不能描述為重新驗證 Auth admin。角色、頁面顯示及實際 Rules 需分開評估。

`checkin.html` 內嵌舊打卡讀寫、`settings/checkinConfig` 通知目標。`notifications.html` 讀 app_notifications 最近 30 筆，與村落營運通知不是同一系統；目前未按群組查詢。

## 13. 獨立營運中心

- **檔案**：`game-admin/site/` 登入與 Dashboard；`game-admin/functions/service.cjs`、`management.cjs`、`domain.cjs`、`callables.cjs`。
- **函式**：`createService`、`createManagement`、`adminAPI`、`redeem`、`createManagementUI`。
- **資料**：Firestore ops_*，以及被明確交易修改的玩家 farm；管理站不直接寫營運集合。
- **實際能力**：公告、系統通知、禮包／兌換紀錄／稽核、玩家查詢／備註／營運限制／金幣調整、護衛犬價格與開放、活動連動公告、三個服務開關。
- **限制**：雞種及武器數值唯讀；活動不自動發獎／產生怪物／重置排行；營運限制不是全站封禁。見 [營運第二階段](../game-admin/OPERATIONS_PHASE2.md)。

## 14. RTDB 鏡像與照片後端

`functions/index.cjs`、`mirror.cjs`、`live-model.cjs` 與 `js/live-read-*` 提供版本化鏡像及適配。`photoSession`、`liveSession` 共用舊憑證驗證，但 claims 用途不同。前端 RTDB 開關目前 false，寫入仍以 Firestore 為主。鏡像部署／回填／READY 旗標及正式規則需另驗。
