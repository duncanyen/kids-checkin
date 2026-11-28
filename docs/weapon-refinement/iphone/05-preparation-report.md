# iPhone驗收準備結果

日期：2026-11-28（台灣時間）。基底commit：`8dbae59e619cc5382853dfeb0e6397eccddd209a`，使用未提交工作目錄，**不是已核准正式release**。

## 已準備

- 獨立 `scripts/iphone-lab.cjs` 啟動器，綁定0.0.0.0:3000；無project／deploy／ADC參數。
- `tests/iphone-lab/world.cjs`：四種假身分、每run獨立namespace、預置+0及+9武器、精煉材料與3個寶箱、既有service＋MemoryDB。
- `tests/iphone-lab/server.cjs`：同源資源／假API，HTTP／已有憑證的HTTPS支援、CSP、來源／session檢查及檔案白名單。
- `firestore.js`、`operations.js`、`client.js`、`bootstrap.js`：獨立測試adapter，不初始化真正Firebase SDK。HTTP回應中替換正式設定／第三方SDK；網路及Abort例外保留為結果未明。
- `panel.html`、`panel.js`：身分選擇、下一筆回應遺失／尚未執行／延遲／協定更新注入、下次遭遇、狀態與JSON下載。
- `tests/iphone-lab.test.cjs`：4項隔離／命令／scope／原ID交易測試。
- `tests/iphone-lab/smoke.cjs`：完整原遊戲／商店HTTP adapter預檢，正常購買、回應遺失、收據查回、一次扣款、網路錯誤保留、阻擋私有文件與正式設定。
- 文件01環境、02帳號、03實機清單、04空白結果CSV。

沒有修改正式遊戲JS、Functions核心、Rules、索引、功能開關；沒有部署、正式讀寫、commit或push。只新增測試工具與文件，並補充開發規範中的授權範圍。

## 驗證

- 全單元測試 **709／709**。其中本次隔離工具4項，最終fixture亦獨立重跑通過。
- Chromium完整遊戲預檢通過：從假帳號選擇進入Phaser首頁與商店、沒有外部請求、無uncaught JS錯誤、正式設定改為demo、私有ops讀取遭拒、原購買與回應遺失恢復只各扣一次。
- 真正手機／Safari／PWA：**NOT_RUN**。localhost被Chromium視為安全來源，不等於iPhone已取得可信HTTPS。
- 既有57項Firestore／candidate Rules為前一階段證據，本階段未新增或部署後端API；本次MemoryDB預檢不能取代那份真正交易／Rules證據或正式部署驗收。
- 手機樣本P50／P95、真Wi-Fi／行動網路：尚未取得，沒有填造數字。

初跑測試HTTP server把靜態atlas JSON再次JSON.stringify，造成Phaser frame錯誤；已修正測試server原樣傳送Buffer，未改正式載入程式。修正後同一完整入口重跑通過。預期的私有文件拒絕／受控回應遺失／飛航例外會有console網路錯誤，不能誤認為未處理的遊戲JS錯誤；其案例與注入標記均保留。

## 唯一目前連線阻擋

使用者已告知新增3000並Apply；但環境工具連續讀回相同environment_id、spec revision 2、`portals: []`。本機服務與3000監聽正常，**未取得可連手機的HTTPS URL**。這是平台預覽設定尚未反映的阻擋，不能用Cloud localhost冒充手機連結，也不以正式Firebase部署繞過。

待此聊天runtime的HTTP preview 3000回傳URL後，還需要核對該URL可到達本次run的隔離首頁、`/lab/health`、遊戲JS與worker，才交給手機測試。平台登入／PWA容器若阻擋則另外記BLOCKED，不關閉平台存取保護。

## 接下來由您操作

先完成私人HTTPS預覽入口生效，再依 `03-device-checklist.md` 的 PRE-01、UI-01、SHOP-01、TAB-01 開始第一輪。需要真手機才知道的包含Safari觸控、安全區、加入主畫面、App強制關閉、背景／鎖屏、真飛航與Wi-Fi／行動網路；不能由本機自動化代勞或先標通過。

其他完整案例已列清單，建議第一輪可用後才進行。每案保存runId、前後JSON及錄影，出現資產異常停止，不清資料／重開server補成成功。

正式發布仍 **NO_GO**，不進Step B～F。
