# 正式唯讀盤點：授權、工具與執行邊界

日期：2026-11-29（台灣時間）。使用者已明確授權「先完成正式環境唯讀盤點，核對服務、Rules、索引及參數」。這份授權限於讀取，不包含部署、建立索引、修改 Rules／IAM／參數、備份、移轉或玩家交易。

## 目前狀態

盤點工具與安全測試已完成，**正式盤點尚待使用者 Cloud Shell 執行結果**。

本機沒有 gcloud CLI，也沒有可用的 GCP 連線／登入帳號；目前網路政策未開放正式 Google API。已確認部分環境變數路徑只是空的 binding metadata，不把「變數存在」視為可用身分；沒有印出／複製憑證。本機工具實際回傳 `BLOCKED / GCLOUD_NOT_AVAILABLE`，正式 API 請求與營運文件讀取均為 0。未偽造正式服務狀態、Rules 或 READY 索引。

工具：`scripts/collect-refinement-production-metadata.py`，只需 Cloud Shell 既有 gcloud 登入與 Python 3，不依賴 Node、Firebase CLI、Java或新增套件。

## 固定盤點範圍

- 專案固定 `homebasedb`，預期編號 `476832900272`；不接受其他 project 或任意 URL。
- Firestore `(default)` 的位置與資料庫 metadata。
- 台灣 `asia-east1`、新加坡 `asia-southeast1` 的 Functions metadata：狀態、runtime、URI、執行 service account、資源／併發限制與更新時間。
- Functions 只輸出 `NEXUS_PRIVATE_IDENTITY_ENABLED`、`NEXUS_FARM_BACKEND_ENABLED`、`NEXUS_REFINEMENT_RELEASE_CONTROL_ENABLED` 三個布林參數；其他環境變數與 Secret 值不輸出。未提供的參數標 UNSPECIFIED，不自行當成 false。
- Firestore composite 索引與精煉所需兩個索引對照，`boxes.openedAt` 及兩個現行排行榜欄位的 collection-group 索引狀態；只讀取定義，不查詢使用者文件。
- 目前發布的預設 Firestore、Storage release／ruleset 內容，記錄 hash 並與候選檔對照；RTDB instances metadata 及已知預設實例 `.settings/rules.json`。其他實例不會任意跟隨 URL，標為待查。
- 最多8次指定的非玩家營運設定文件讀取：身分／農場切換 ready、精煉發布控制、三種設定 pointer 及存在的三個 active version。白名單只輸出數量，不輸出玩家 UID／群組 scope。所有層級設定只保留已知數值／布林欄位。
- Hosting sites metadata，以及已存在的本機 `.firebaserc` 中 `homebasedb / nexus-game-admin` 綁定；不套用或建立 target。

不讀取 `users`／`groups` 玩家文件、武器個體、倉庫、交易紀錄、聊天或照片內容，不呼叫遊戲 callable。8次營運設定文件 GET 可能計入少量 Firestore讀取，與 metadata API 查詢不同；沒有玩家全量掃描。

## 防誤用與證據保護

所有盤點 API 請求固定 GET 與明確的 host／path allowlist。禁止 documents 列表、玩家路徑、任意 host、寫入 RPC、URL access_token 及 HTTP redirects；權限不足／分頁不完整明確標示，不推論為不存在或通過。

使用 `gcloud auth print-access-token --quiet` 取得現有登入的短期 token，只保留於程序記憶體並經 Authorization header 傳給固定服務；不顯示、不保存、不要求使用者貼 Token。gcloud 的正常 OAuth 換證與盤點 API 的 GET 是不同層次，不宣稱整個登入流程沒有驗證流量。

輸出目錄需為空，權限0700、檔案0600，不覆寫既有證據。正式 Rules 原文與詳細 metadata 留在使用者本機私人報告資料夾，**不自動提交GitHub**。供對話分析的是已過濾的 `summary.json`；其中沒有 Rules 原文、完整環境變數或 Token。

Rules hash 不同只代表不完全相同、需審閱，不能直接判為不安全；RTDB 使用標準化 JSON 比較，忽略純排版差異。API 403／欄位缺漏保留 UNKNOWN／UNVERIFIED，不自行修改設定修復。

## Cloud Shell 操作

在原隔離 checkout fetch 此次工具 commit；只用 `git show` 取出 Python 檔至新的私人目錄，不 checkout、不改原遊戲目錄。對話中的指令會提供固定 commit SHA。

```bash
# 以對話提供的固定COMMIT取代下列標記；不在這份文件自行執行。
git -C "$HOME/gugu-full-review.2FKOds/source" fetch --depth=8 origin COMMIT
NEXUS_META_DIR="$(mktemp -d "$HOME/nexus-production-readonly.XXXXXX")"
git -C "$HOME/gugu-full-review.2FKOds/source" show FETCH_HEAD:scripts/collect-refinement-production-metadata.py > "$NEXUS_META_DIR/collect.py"
python3 "$NEXUS_META_DIR/collect.py" --output "$NEXUS_META_DIR/report"
```

`READ_ONLY_METADATA_COLLECTED` 只表示盤點請求完成，不是發布 GO；`findings` 仍可能有缺少索引、Rules 差異或參數未確認。`INCOMPLETE_METADATA`／`BLOCKED` 不應反覆重新部署；保留報告確認是哪個唯讀權限或服務尚不可用。

請回傳已過濾的 `summary.json` 後，再依實際結果更新正式審查。執行過程不需要更改 Cloud Shell 的預設專案。

## 驗證與剩餘工作

10個 Python 離線安全測試通過，由1項 Node 測試包覆；整體Node單元測試726/726通過。覆蓋只讀路徑、GET、拒絕轉址、秘密值過濾、錯誤參數、權限未知、分頁不完整與無登入不能聲稱完成。本機 BLOCKED 原始報告及測試日誌存於 `evidence/production-readonly-preparation-2026-11-29/`。

目前只能標「唯讀盤點已授權、工具就緒，待取得正式結果」。不將本機 fixture 或候選檔更新為正式證據；整體發布仍 NO_GO。
