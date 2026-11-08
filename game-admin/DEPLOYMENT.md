## 本次程式設定策略（2026-11-08，前後端發布後生效）

依專案擁有者選擇，管理端 App Check 改為選用，預設關閉；管理站不初始化 reCAPTCHA，`gameOpsAdmin` 不要求 App Check Token，但仍以 Firebase Auth、token 的 admin 角色及 Auth 使用者目前的 admin claim／停用狀態驗證每次操作。一般玩家和未登入者不能管理公告。

玩家唯讀 `gameOpsAnnouncements` 依擁有者選擇改為 Firebase Auth、目前群組資格、停用帳號、公告對象與有效期間驗證，不要求 App Check。`gameOpsRedeem` 仍維持正式 App Check 驗證，且玩家前端兌換仍停用。公告前端開關已開啟，詳見 [公告啟用說明](../docs/farm-announcements.md)。這不是前端直接寫公告，也沒有修改資料庫權限或移除操作稽核。

**這次需要前端更新與後端重新部署一起生效。** GitHub Pages 發布前端後，在 Cloud Shell 執行：

```sh
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
node scripts/ensure-announcement-index.cjs --project homebasedb
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

部署成功後關閉舊管理分頁，重新開啟登入。前端入口、runtime 與 config 已增加版本標記，避免沿用舊 reCAPTCHA 初始化程式。舊版後端仍會要求 App Check，單獨更新前端不足以解除 401。

若未來要恢復管理端強制 App Check，需先完成 provider／網域／金鑰註冊，再同步將前端 `adminAppCheckRequired` 與後端 `createCallables(service,{adminAppCheckRequired:true})` 啟用並部署；不能只更改前端旗標。

公告索引須為 READY；可再次執行索引腳本查看狀態。完成部署後強制重新整理咕咕村落，檢查通知中的「營運公告」。公告須為 published 或已到開始時間的 scheduled，並符合玩家對象及有效期間；showPopup=true 才自動彈出。

以下為先前的部署與故障排查紀錄；舊開關、管理端與公告強制 App Check 的敘述以本節目前策略為準。

# 正式部署狀態

使用者已授權正式部署及推送 GitHub。本次先提交原始碼；正式部署因以下實測阻擋未執行，營運開關維持關閉。

- Firebase CLI `firebase projects:list --json --non-interactive` 回報 `Failed to authenticate, have you run firebase login?`。目前執行環境沒有可用的 Firebase 部署身分；雖有 ADC 路徑變數，身份 manifest 的 connections 為空，不能據此視為已有授權。請透過可信任環境／身分連線設定提供具有目標專案部署權限的身分，不要在對話貼密鑰。
- 官方 Emulator 檔案主機 storage.googleapis.com 仍由代理回覆 403；必要 Emulator 與 Security Rules 整合測試尚未執行。該網域已在環境草稿，需將設定套用到執行機器。
- 正式 Firestore 規則尚未提供，既有遊戲經濟仍由前端直接寫入；必須先完成相容遷移並移除寬鬆 allow。測試用全拒絕規則絕不可直接部署取代正式規則。
- 尚未綁定獨立 Hosting site，App Check site key 亦未設定；Auth 須由專案擁有者完成並驗證；Identity Platform／TOTP MFA 為選用設定，不是密碼登入的前置條件。

已通過的測試為後端 10 項隔離測試、既有 120 項單元測試、管理端桌面／手機流程、玩家公告兌換與既有通知回歸。實際 Firebase MFA／Emulator 測試不可由這些替身測試替代。

取得身分與規則、解鎖下載後，依 README 補齊整合驗證，再部署獨立 nexus-ops Functions codebase 及 nexus-game-admin Hosting target；不應重新詢問已授權的部署意願。完成後再啟用玩家營運開關。

2026-11-05：MFA 已改為選用，須一起發布管理站與 `gameOpsAdmin` Functions 更新；後端仍驗證 admin claim、帳號未停用及目前管理員角色。既有已綁定 MFA 的帳號仍由 Firebase 要求第二因素，不自動解除。

## GitHub Pages 呼叫 gameOpsAdmin 出現 CORS 錯誤

管理端 Firebase Auth 登入成功，不代表 Cloud Functions 已部署。GitHub Pages 發布靜態檔案也不會部署 `nexus-ops`。原始碼已使用 Firebase `onCall({ cors: true })`，不要改成 `no-cors` 或移除管理員權限驗證。

在有部署權限的 Cloud Shell 檢查區域與函式：

```sh
gcloud functions describe gameOpsAdmin --gen2 --region=asia-southeast1 --project=homebasedb --format='yaml(state,serviceConfig.uri,serviceConfig.service)'
curl -i -X OPTIONS 'https://asia-southeast1-homebasedb.cloudfunctions.net/gameOpsAdmin' \
  -H 'Origin: https://duncanyen.github.io' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,x-firebase-appcheck'
```

正常預檢應回傳 HTTP 204 與 `Access-Control-Allow-Origin: https://duncanyen.github.io`。404／describe 找不到函式時須先部署；403 且沒有 CORS 標頭時須檢查 Cloud Run IAM，因為請求可能還沒進入 callable。

只發布營運 Functions，不發布玩家網站、Firestore 規則或其他 codebase：

```sh
cd ~/kids-checkin
git pull --ff-only origin main
npm --prefix game-admin/functions ci
node scripts/prepare-game-admin.cjs
cd game-admin
npx firebase-tools deploy --only functions:nexus-ops --project homebasedb
```

若確認函式已存在且被 Cloud Run IAM 拒絕，專案擁有者可開放 HTTP 呼叫進入 callable；瀏覽器的 OPTIONS 不帶 Google IAM 身分。使用 describe 取得實際服務名稱，勿猜服務名稱：

```sh
OPS_SERVICE=$(gcloud functions describe gameOpsAdmin --gen2 --region=asia-southeast1 --project=homebasedb --format='value(serviceConfig.service)')
if [ -n "$OPS_SERVICE" ]; then
  gcloud run services add-iam-policy-binding "${OPS_SERVICE##*/}" \
    --region=asia-southeast1 --project=homebasedb \
    --member=allUsers --role=roles/run.invoker
fi
```

這只讓請求到達 callable；Firebase Auth、後端當前 admin claim 及 App Check 的檢查仍保留。若組織政策禁止此 IAM 綁定，須由擁有者確認支援的公開瀏覽器入口，不以放寬資料規則代替。

注意：正式 callable 強制 App Check。管理站 `config.js` 已於 2026-11-08 填入專案擁有者提供的公開 reCAPTCHA Enterprise site key；仍須確認 Firebase App Check 已為同一個 Web App 註冊此 provider，並發布更新後的管理站前端。

本機 `node --test game-admin/tests/callable-http.test.cjs` 使用實際 Firebase callable middleware 與本機 HTTP，驗證三個端點對 GitHub Pages 的 OPTIONS 回應，以及匿名 POST 被拒絕時仍保有 CORS 標頭；不讀寫正式資料，也不能代替線上 IAM／部署檢查。

## 2026-11-08：公告新增故障排查

公告管理仍由 `site/runtime.js` 的 `httpsCallable(functions, 'gameOpsAdmin')` 寫入，沒有切換成前端直接改公告集合。根目錄 `firebase.json` 只有 `nexus-live`；營運管理使用 `game-admin/firebase.json` 的獨立 `nexus-ops`。在根目錄部署原有 Functions 或推送 GitHub，均不能證明營運 API 已發布。

可在 Cloud Shell 的儲存庫目錄執行唯讀檢查：

```sh
node scripts/check-game-ops.cjs --project homebasedb --region asia-southeast1
```

工具以 curl 發送不帶憑證的 OPTIONS，檢查三個 callable 的 HTTP 狀態、Origin、POST 及 Auth／App Check 標頭。網路連線失敗與線上 403 分開回報，不把環境代理拒絕當作 Cloud Run IAM 證據。預檢通過只代表 HTTP／CORS 可通行，不能證明權限或新增公告已成功。

- `NOT_FOUND`：先確認函式名稱、區域，依上面的步驟部署 `nexus-ops`。
- `INGRESS_DENIED`：執行 describe 核對服務及 IAM；必要時由有權限的人設定 `roles/run.invoker`。
- `SERVER_ERROR`：查詢函式啟動與執行錯誤。
- `PREFLIGHT_OK`：接著確認 Firebase 登入、admin claim 及 App Check。

目前使用的 Firebase Functions SDK v6 callable 會自行建立 CORS middleware；單純加一個未出現在部署 manifest 的 `invoker` 參數不能視為 IAM 已修復。以實際部署結果、Cloud Run IAM 及 OPTIONS 回應為準，不修改 SDK 私有 `__endpoint` 欄位。

本次本機 callable HTTP 測試通過，未登入的 POST 仍回傳 401 並帶 CORS 標頭。本執行環境連線到正式函式遭環境代理限制，無法據此確認線上函式是否存在或 IAM 是否正確；未進行正式部署。

## CORS 通過後收到 HTTP 401

HTTP 401 本身不能區分 Firebase Auth 與 App Check。管理站 `site/config.js` 的 `appCheckSiteKey` 空白時，不會初始化 App Check；正式 `gameOpsAdmin` 卻啟用 `enforceAppCheck`，所以即使 Firebase Auth 的管理員登入 Token 有效，也會在進入 handler 前收到 401／UNAUTHENTICATED。角色不符的 handler 通常回 403。

修正方式：

1. 在 Google Cloud／Firebase 的 homebasedb 專案建立網站用 reCAPTCHA Enterprise site key，允許網域 `duncanyen.github.io`。
2. Firebase Console → App Check → 選擇管理站 config.js 中 appId 對應的 Web App，註冊 reCAPTCHA Enterprise provider，使用同一個網站金鑰。
3. 將公開 site key 填入 `game-admin/site/config.js` 的 `appCheckSiteKey`，並發布管理站前端。Firebase 的 `apiKey` 與此網站金鑰不同，無需私密金鑰或 Admin SDK 憑證。
4. 更新前端後重新整理管理站並重新登入。這一步的設定在前端，單純重複部署 Functions 不會填入此值。

若仍失敗，可在 Cloud Shell 查驗證日誌：

```sh
gcloud functions logs read gameOpsAdmin --gen2 \
  --region=asia-southeast1 --project=homebasedb --limit=30
```

只需檢查 `verifications`：`auth: VALID, app: MISSING` 代表沒送出 App Check Token；`app: INVALID` 代表 App Check 驗證失敗，需核對網站金鑰、Web App、網域及 provider；`auth: MISSING/INVALID` 則先重新登入或檢查登入來源。不要分享完整 Authorization、App Check Token 或私密金鑰。

本機 HTTP 測試以假的有效管理員 Auth 驗證結果重現「沒有 App Check 即回 401」，並確認沒有呼叫帳號查詢或資料庫 handler；沒有使用正式登入 Token 或修改正式資料。

2026-11-08 更新：已依專案擁有者提供的公開網站金鑰填入管理站 App Check 設定，語法檢查通過。前端發布後會初始化 reCAPTCHA Enterprise provider 並自動更新 Token；尚未由此環境驗證正式 Firebase provider 註冊與線上公告寫入。

## App Check Token 交換回傳 400／initial-throttle

`exchangeRecaptchaEnterpriseToken` 回 400 表示前端已嘗試向 App Check 換 Token，但驗證未成功；不能只憑瀏覽器的狀態碼判定是未註冊、provider／金鑰不符、網域或其他驗證失敗。`initial-throttle`／`throttled` 是 SDK 針對先前錯誤的退避，不代表等待後即可解決設定問題。

需核對 homebasedb 中 appId `1:476832900272:web:443bacb7cbc3113e9f8775` 對應的 Web App，是否已註冊 reCAPTCHA Enterprise provider、使用前端相同 site key，以及金鑰是否允許 `duncanyen.github.io`。傳統 reCAPTCHA v3 與 Enterprise 不可僅以 key 字串格式猜測或互換 provider。

定位時僅取得 Network 中該交換請求 Response 的 `error.code`、`error.message`、`error.status`，不要收集請求的 Token、Authorization 或 Request Payload。

管理站 `runtime.api` 現在會先等待 `getToken(appCheck, false)`；取不到有效 Token 時在畫面顯示網站驗證錯誤，不再繼續呼叫營運 API 形成額外 401。這不會自動更改 Firebase 註冊設定或關閉後端驗證。已有有效 Token 時沿用 SDK 快取，不強制重新產生，並保留原本 requestId。

驗證：`node game-admin/tests/app-check-runtime.browser.cjs` 使用實際 runtime 與隔離 SDK transport，涵蓋 400／退避時封鎖管理呼叫、成功路徑、缺少設定、穩定請求 ID，以及 Emulator 路徑。


目前策略驗證：

- `node --test game-admin/tests/admin-app-check.test.cjs game-admin/tests/callable-http.test.cjs game-admin/tests/service.test.cjs`：實際 callable HTTP middleware、有效管理員新增公告、未登入／玩家／停用／撤銷角色被拒絕、操作稽核，以及玩家 API 仍強制 App Check。
- `node game-admin/tests/app-check-runtime.browser.cjs`：管理端選用模式不初始化 reCAPTCHA、不換取 App Check Token；另驗證強制模式與 Emulator 路徑。
- `node game-admin/tests/ui.browser.cjs`：登入、公告發布、禮包及管理介面回歸。
