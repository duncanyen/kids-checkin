# 咕咕村落：每日簽到與每日任務交付紀錄

狀態：**部分完成，尚未正式部署**。每日簽到、雙分頁與後端領獎機制完成程式及隔離測試；每日任務的正式遊戲事件接入尚未完成，維持禁止計次／領獎。不得將本文件當成已可完整上線的聲明。

## 1. 已完成與缺口

| 項目 | 程式狀態 | 驗證／限制 |
| --- | --- | --- |
| 沿用每日任務入口 | 已完成 | 只接通既有 HUD 左側圖示；沒有新增第二個入口。仍只在自家顯示，戰鬥及拜訪隱藏規則保留。 |
| 每日簽到／每日任務分頁 | 已完成 | 記住本頁上次分頁；保留 Phaser 場景及原存檔監聽器。 |
| 七天獎勵 | 已完成 | 每日簽到：第 1～6 天各 100、第 7 天 1,000，一輪 1,600 金幣。每日任務維持 200、400、600、800、1,000、1,200、2,000，一輪 6,200 金幣。前端讀伺服器快照，沒有自行決定金額。 |
| 手動簽到及金幣發放 | 已完成、待正式部署 | 重用 `domain.cjs` 的 `award()` 與目前群組農場 `farm.coins`，無第二份餘額。 |
| 台灣午夜／漏做政策 | 已完成 | 以伺服器時間計算 Asia/Taipei 日期；預設 `reset`，可改 `continue`。 |
| 七日循環獨立 | 已完成 | 每日簽到與任務各有狀態，Day 7 領取後，下次可領日期從 Day 1 開始。 |
| 領獎原子性／冪等性 | 已完成、待 Emulator 驗證 | 農場金幣、當日領取狀態、週期狀態及唯一 grant 同一交易更新。相同帳號同種類每日最多一筆；跨裝置、切換群組不能多領。 |
| 收蛋三次 | **未接通** | `MyFarmScene.harvestPreparedEncounter` 後段仍在前端 `runTransaction` 呼叫 `collectPoultry`，無可信任後端操作事件。不能把總雞蛋差額當操作次數。 |
| 協助別人清潔三次 | **未接通** | `VisitScene.cleanTargetFarm()` 在前端交易讀髒亂值並扣除，沒有後端驗證事件。 |
| 擊退怪物三次 | **未接通** | `predators.js`、`giant-store.js`、`mole-store.js`、`cobra-store.js`、`eagle.js` 等勝負結算仍在前端，不能採信玩家送出的 win 或計數。 |
| 真實任務進度／任務領獎 | **未開放** | `VERIFIED_PRODUCERS` 預設為空；config 或客戶端不能自行啟用可信任來源。三項任務仍保留，顯示事件未接通；不換任務、不造假進度。 |
| 後端事件接點 | 已預留、無正式 producer | `consumeVerifiedEvent()` 只供可信任後端程式使用，不是 callable，也沒有綁定可被玩家操作的觸發器。 |
| 設定／玩家／流水查詢 | 已完成 API，無新後台頁面 | `gameOpsAdmin` 新增 `dailyConfig`、`dailyPlayer`、`dailyGrants` 唯讀操作，沿用伺服器 admin 權限驗證。設定第一版由可信任 Firebase Console／Admin SDK 管理。 |
| 正式 Rules | **待人工合併與驗證** | Repository 未包含完整正式 Rules，新增片段不能直接當正式完整 Rules 部署。 |

### 為何沒有直接累計前端操作

Firestore 交易只能保證交易原子性，不能證明來自玩家瀏覽器的「收蛋成功／已清潔／打贏怪物」可信任。直接監看玩家可寫入的數值差額、監聽 logs、收取 client event 或相信 outcome 都不符合本次要求。因此本次沒有為了讓任務可領而擴大重構現有遊戲，先完成可獨立驗證的簽到與領獎骨架。

原 ZIP 附件文件另有「清潔不同玩家」的加強要求，但使用者主指令只指定三次有效協助；本次不額外要求三位不同玩家。未來接入時必須是其他玩家、有效髒亂清除，自己清潔自己不算。怪物隨機出現可能讓每日三次難以達標，需另行評估可完成性，本次不改出怪率或戰鬥規則。

## 2. UI 與素材

實際使用使用者新提供的 `T1.ng.PNG`、`T2.png.PNG`；先前 ZIP 的簡化素材已從本功能移除。

| 元件 | 原圖及實作 |
| --- | --- |
| 雞頭標題、關閉、木框 | T1 的 `title`、`close`、`window` 切片。 |
| 雙分頁 | T1 原有日曆／剪貼板圖示與選中、未選中底板。 |
| 簽到七張吊牌 | T1 普通、今日及金色皇冠吊牌；使用原圖九宮格圖片延伸空白頁面，不以 CSS 重畫木牌。 |
| 簽到下方 | T2 母雞、T1 金幣獎勵底板、T1 綠色按鈕。 |
| 任務七日節點 | T2 完成、目前、空白節點，T1 木質連線及 T2 寶箱；日期數字動態疊加。 |
| 今日任務列 | T1 空白面板作共用任務框，搭配 T2 雞蛋、掃把、紫色怪物、灰軌、綠條及狀態標記。 |
| 任務底部 | T1 金幣獎勵底板、可領金色與未達標灰色按鈕。 |

素材目錄：`assets/farm/daily-missions/`。`source/` 保存原始 PNG，遊戲不載入整張素材表；實際載入 `v2/` 切片。完整座標、來源 SHA-256、尺寸與修補區域見 `v2/manifest.json`，目前共 37 個來源切片。

切圖腳本：`scripts/extract-daily-ui-assets.py`。像素來源驗證：`scripts/verify-daily-ui-assets.py`。兩者只需離線 Pillow，不是遊戲新相依套件；沒有使用生成式圖片、通用 SVG 或 Emoji。

### 與原參考圖仍有差異

- 原 PNG 的標題、分頁及按鈕已有固定文字；為符合動態文字要求，這些文字區使用同素材的空白木牌／同按鈕的空白色帶處理，再以 DOM 排字。修補區與原字體不是逐像素相同，均在 manifest 記錄。
- 橫幅切圖底部排除了下一個木牌的一小段邊緣；吊牌及母雞切圖也避開其他元件碎片。未修補區域像素及 Alpha 已比對原檔。
- 長吊牌需隨手機寬度延伸空白內頁；窄手機的七張橫排字級較小。短螢幕內文允許滾動，關閉與領獎按鈕保留在面板內。
- 參考圖的 Day 3、2/3 等為排版示意；正式畫面只顯示伺服器資料。本次任務截圖因此顯示 Day 1、0/3 及未接通提示。
- 不含參考圖烙印的假數值、示意文字誤植或單純裝飾性新增入口。

## 3. 後端模型

沿用 `game-admin/functions` 的 `nexus-ops` codebase。新增 callable：`gameOpsDailyChallenges`，區域 `asia-southeast1`。

玩家透過既有 `photoSession` 交換 Firebase Auth 身分；服務核對當前 UID、`photoAccountId`、`photoGroupId`、users profile、群組資格、Auth 停用及 `ops_player_controls`。不採信 payload.accountId、金額、時間、任務進度或勝負。

App Check 沿用現有營運玩家 API 的選用模式，未取消 Firebase Auth。status／claim 每 UID 限制每分鐘 60 次。每次交易再讀當前資格與營運限制，避免只做前端權限判斷。

| 集合 | 用途 |
| --- | --- |
| `ops_daily_configs/current` | `version`、checkin／mission 的 enabled、7 筆 rewards、missedDayPolicy，以及三項 tasks 的 type／target／enabled。完整範例見 `game-admin/config/daily-challenges.example.json`。 |
| `ops_daily_states/{hash(uid:type)}` | 已領到的 day、cycleId、lastClaimDate、accountId、updatedAt。 |
| `ops_daily_days/{hash(uid:type:dateKey)}` | 伺服器日快照：日期、天數、週期、7 筆金額、任務規格、progress、claimedAt、grantId、claimedGroupId。 |
| `ops_daily_grants/{hash(uid:type:dateKey)}` | 不可重複的成功獎勵流水，含 uid、accountId、groupId、type、dateKey、cycleId、requestId、response、createdAt。 |
| `ops_verified_farm_events/{eventId}` | **未接入**的未來後端已驗證事件來源，只能由可信任 Admin SDK 產生。 |
| `ops_daily_events/{eventId}` | 未來事件已消費／忽略憑證，用於防止事件重送。 |

### 時間與週期

日期只由伺服器 `now()` 算出台灣 UTC+8 的 dateKey；前端使用 serverNow／nextResetAt 加 `performance.now()` 計算畫面重整時機，不用手機日期決定發獎。舊 dateKey 的 claim 跨午夜會拒絕，必須重新讀取新一天，避免重送時不小心領走下一天。

挑戰進度以帳號 UID 全域隔離，不按群組重開一輪。領取當下發到目前群組的既有農場；同一天改群組重送只回傳原流水，不把獎金再發到另一個群組。這是避免跨群組重領的選擇，沒有修改各群組原農場的獨立性。

當日第一次 status／claim 會鎖定當日金額與任務快照，避免管理員中途修改讓已顯示金額突然變動。enabled 可即時停止領取；金額、任務規格及漏做政策以新日快照套用。預設未領獎跨過一天後重置 Day 1；`continue` 可保留上次已領天數。任務全部停用不會變成免費領獎。

交易 ID 採 UID＋類型＋日期的雜湊，一天同種類只能有一筆，即使週期或 requestId 改變也不能增加領取次數；cycleId 與 day 另在請求中驗證並保留於流水。簽到與任務的 type 不同，因此互不占用領取額度。

### 管理查詢

透過現有 `gameOpsAdmin`（需要後端 admin claim）：

- `{action:'dailyConfig', payload:{}}`：目前設定及實際可信任 producer 名單。
- `{action:'dailyPlayer', payload:{uid, dateKey?}}`：該 UID 指定日期兩種挑戰的狀態與日紀錄。
- `{action:'dailyGrants', payload:{uid, pageSize?, cursor?}}`：實際成功流水、分頁及下一頁游標；pageSize 上限 50。

設定文件由可信任 Console 或 Admin SDK 管理。沒有新增可供玩家寫入設定或進度的 API，也沒有建立新後台 UI。新增流水查詢索引：`ops_daily_grants(uid ASC, createdAt DESC)`。

## 4. 事件後續接入條件

1. 先取得完整正式 Rules，保護每日狀態及事件來源，確認沒有寬鬆 wildcard 繞過。
2. 遷移有效收蛋為後端操作：重讀農場、計算有效產蛋與倉庫、操作成功收得大於 0 才建立一筆驗證事件；一次收 50 顆仍算一次，空收不算。
3. 遷移協助清潔為後端操作：驗證村落拜訪資格、目標不是自己、確實扣除髒亂、限制重送；成功才建立事件。
4. 為全部怪物建立可驗證的後端遭遇、攻擊與結算協議；不能直接接受 client win。只有成功擊退才產生一筆事件，三隻地鼠的一場戰鬥不能擅自當三場勝利。
5. 遊戲操作的可信任事件需可恢復派送，再呼叫 `consumeVerifiedEvent()`；事件去重與當日進度在同一交易。過期日期、未來時間、無效事件來源、空收蛋、清自己或失敗戰鬥均拒絕。
6. 後端程式接通實際 producer 後才更新 `VERIFIED_PRODUCERS`。這不是一個可由 config 改成 true 的安全開關。
7. 客戶端成功操作後可 emit `dailyChallengeChanged` 重新讀取後端狀態；這個訊號只會觸發查詢，不能自行加進度。
8. 以真實 Emulator 測試事件重送、多人及多裝置並行，再正式啟用每日任務領獎。

目前未大幅改寫既有怪物或經濟操作。既有玩家端可寫入的農場經濟資料安全性仍需依先前 Farm Security Audit 分階段處理；新增領獎交易不代表整個既有經濟模型已全部後端化。

## 5. 上線前設定（本次沒有執行部署）

1. 備份並取得完整正式 Firestore Rules。
2. 合併 `game-admin/rules/firestore.daily.fragment.rules`，確認其他 allow 不會授權 `ops_daily_*` 或 `ops_verified_farm_events`。Firestore allow 取聯集，具體 deny 不能覆蓋寬鬆 allow。
3. 在可執行 Emulator 的環境完成下節測試。片段與 `firestore.test.rules` 不可直接取代完整正式規則。
4. 檢查 config 範例；若省略 config 文件，服務使用後端預設值。正式上線前先確認獎勵與系統經濟承受度。
5. 部署 `nexus-ops` Functions 與新增索引，確認索引 Ready 後再發布前端。索引部署若詢問刪除其他線上索引，先拒絕並核對。
6. 簽到可在完成正式驗證後開放；每日任務仍待可信任事件遷移，不可宣稱可完整營運。

準備好正式 Rules 且獲准部署後，Functions 指令：

```bash
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

索引從 Repository 根目錄部署；本工作目錄還保有前次 Photo Dump／記帳索引修正，部署前應確認範圍：

```bash
npx firebase-tools deploy --only firestore:indexes --project homebasedb
```

## 6. 測試及截圖

- 後端每日挑戰 9 項：七日／第八日、兩種類型獨立、台灣午夜、漏做 reset／continue、當日快照鎖定、多裝置並行、跨群組重送、原子失敗重試、偽造時間／身分／金額、匿名／停用／群組錯誤、可信任事件去重／有效操作計次、管理查詢、全部停用不可免費領獎。
- 事件測試的 producer 只注入於隔離測試，不能當作正式遊戲已接入的證據。
- 既有禮包與護衛犬服務回歸通過；新增 callable 的 CORS preflight 與匿名拒絕通過。
- 真正 Phaser 場景＋實際後端服務邏輯（隔離 MemoryDB）瀏覽器測試通過：唯一 HUD 入口、雙分頁、七張吊牌與金額、原圖載入、金幣監聽同步、未接通任務不可領、關閉後輸入恢復、慢請求快速關閉重開、網路重試、刷新仍保留伺服器天數、怪物出現自動關閉、destroy 清理。
- 畫面尺寸：320、390、430、768px；檢查主視窗邊界、水平溢出、三條任務可見，以及素材 HTTP 失敗。不代表 iPhone／iPad 真機已通過。
- 37 個切片的來源雜湊、尺寸、Alpha 及未修補像素比對通過。
- **Firebase Emulator 未能執行**：下載 `cloud-firestore-emulator-v1.19.8.jar` 遭 HTTP 403 `Domain forbidden`。真實 Firestore 併發與 Security Rules 尚未驗證；測試檔已保留，不宣稱通過。

指令：

```bash
node --test game-admin/tests/daily-challenges.test.cjs
node --test game-admin/tests/callable-http.test.cjs game-admin/tests/admin-app-check.test.cjs
node --test game-admin/tests/service.test.cjs game-admin/tests/guard-dog-service.test.cjs
python scripts/verify-daily-ui-assets.py
python -m http.server 8012 --bind 127.0.0.1
# 另一個終端
node tests/farm-daily-browser.cjs
node tests/farm-housing-browser.cjs
```

Emulator（只能使用 demo 專案，測試檔會拒絕沒有 Emulator 環境的執行）：

```bash
npx firebase-tools emulators:exec --config game-admin/firebase.test.json \
  --only firestore,auth --project demo-daily-challenges \
  'node --test game-admin/tests/daily-challenges.emulator.cjs'
```

截圖都是實際執行的測試版 Phaser 畫面，使用隔離假帳號及資料，沒有讀取正式玩家資料：

- [簽到與任務並排](screenshots/daily-challenges/comparison.png)
- [每日簽到 390px](screenshots/daily-challenges/checkin-390.png)
- [每日任務 390px](screenshots/daily-challenges/missions-390.png)
- [第七天 390px](screenshots/daily-challenges/day7-390.png)
- [每日簽到 320px](screenshots/daily-challenges/checkin-320.png)

## 7. 本功能修改檔案

- `farmgame.html`：每日挑戰樣式載入。
- `css/farm-daily.css`：僅限每日挑戰的原圖版面、九宮格吊牌及 RWD。
- `js/farm/main.js`、`js/farm/hud-ui.js`：掛載面板並接回原入口。
- `js/farm/daily-ui.js`：雙分頁、動態文字、領獎、逾時重試與生命週期。
- `js/farm/operations-client.js`：獨立每日挑戰 Auth 連線與 callable。
- `game-admin/functions/daily-challenges.cjs`：狀態、簽到、領獎、管理唯讀查詢及未來可信任事件接點。
- `game-admin/functions/service.cjs`、`game-admin/functions/callables.cjs`：沿用玩家／管理員驗證並新增服務。
- `game-admin/config/daily-challenges.example.json`：可配置文件範例。
- `game-admin/rules/firestore.daily.fragment.rules`：新資料集合最小權限片段。
- `firestore.indexes.json`：新增每日獎勵流水查詢索引；前次相簿／記帳索引變更仍獨立保留。
- `game-admin/tests/daily-challenges.test.cjs`、`daily-challenges.emulator.cjs`、`callable-http.test.cjs`：單元／整合／新 API 驗證。
- `tests/farm-daily-browser.cjs`、`tests/fixtures/farm-daily-sdk.js`：實際場景隔離瀏覽器測試。
- `scripts/extract-daily-ui-assets.py`、`scripts/verify-daily-ui-assets.py`：原圖切分及像素驗證。
- `assets/farm/daily-missions/README.md`、`source/*.png`、`v2/*.png`、`v2/manifest.json`：原始與衍生素材。
- `docs/screenshots/daily-challenges/*.png`、本文件：驗收與交接。

沒有修改其他未提交的平台盤點文件，也沒有為本功能執行正式 Rules 發布或 Firebase deploy。


## 2026-11-13：依新參考圖調整任務元件

本次只調整每日挑戰呈現與隔離畫面測試，沒有更改任務條件、計次、金額、領獎資格、Firebase Rules 或資料寫入。

- 三個任務放入同一個原圖面板，以細分隔線區分，去除圖示、標題與次數各自的底框。
- 放大左側雞蛋／掃把／紫色怪物與右側完成標記；進度條、次數、標記統一對齊。
- 「協助其他玩家清潔」在畫面採參考圖的「協助別人打掃」用字；後端任務類型與條件不變。
- 「第 N 天任務」木牌壓在任務框上緣；底部獎勵與領取按鈕重新調整比例、留白與對齊。
- 七日節點的完成／目前／未開放圖形重新修正切圖邊界，移除相鄰母雞元件碎片並使節點數字置中。
- 320／390／430／768px 檢查圖示、進度條、次數及標記沒有互相重疊。

[與參考狀態相近的版面示意](screenshots/daily-challenges/layout-example-comparison.png) 使用**隔離測試資料**展示第 3 天、3/3、2/3、0/3；它是測試端注入可信任 producer 後，透過後端事件消費器產生的範例，不是正式遊戲已接通的進度。正式程式的 `VERIFIED_PRODUCERS` 仍為空，仍不計次、不發任務獎勵。[實際未接通狀態](screenshots/daily-challenges/missions-390.png) 另行保留。

此次新增素材：`v2/mission-table.png`、`v2/task-empty.png`；其餘素材為修正既有節點切圖邊界。來源切片共 37 個，像素來源檢查與原有實際 Phaser 瀏覽器測試通過。沒有重新執行不受影響的後端測試或正式部署。


## 2026-11-13：調整每日簽到金額

每日簽到預設改為 `[100,100,100,100,100,100,1000]`，預設設定版本為 `v2-checkin-100`；每日任務金額不變。同步更新後端預設、設定範例與既有七日／冪等性／瀏覽器驗證。

正式環境若已建立 `ops_daily_configs/current`，該文件優先於程式預設，需同步更新其 `checkin.rewards` 與 `version`，保留其他欄位。已建立的當日日快照依既有機制保留原金額，從新建立的日快照套用；不改寫已領紀錄或重複補發。僅推送前端不會更新正式 Functions／設定。
