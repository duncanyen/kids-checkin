# 更新部署前審查：新精煉與營運 API 真實驗收完成

日期：2026-11-29（台灣時間）。僅 Step A 複核；沒有執行正式盤點、備份、部署、移轉、Rules／索引發布或開放玩家。

## 已解除的本機阻擋

新精煉／解除與營運中心的真實 Auth HTTP 權限、版本與交易驗收 **27/27**（其中新增21項）通過；8筆實際 demo 收據與8筆資源帳本一致。這份證據與原本直接呼叫 service 的測試分開，不使用假 Auth handler。詳見 [驗收報告](refinement-http-acceptance.md)。

本輪完整單元 **725/725**；FireStore 交易／候選 Rules **57/57** 重新執行。來源雜湊與目前測試版本相符。Cloud Shell 五服務既有合約9/9仍保留為使用者回傳的獨立證據，不混算為本機新30項組合已通過。

## 審查結果：NO_GO，尚不部署

| 項目 | 現況與後續 |
| --- | --- |
| 新 API 真實登入／權限／交易 | **通過**，審查工具 `refinementHttpVerification.verified=true` |
| Firestore 本機交易／候選 Rules | **通過**，審查工具來源 proof 符合 |
| 正式預設旗標 | 六項皆 false；本輪只對臨時副本及假scope開測試准入 |
| 正式專案／服務／已發布 Rules／索引 READY／Hosting target | 尚未正式唯讀核對；本機設定不能代替正式狀態 |
| 正式測試帳號與權限、移轉計畫來源綁定 | 程式與隔離工具已驗證，實際正式 scope／IAM／版本接受仍待核對 |
| 正式備份／隔離還原及資產對帳 | 尚未執行，需明確授權；demo 帳本不能冒充正式歷史證據 |
| 全階段回歸及版本相容簽核 | 保留先前瀏覽器時序、歷史 PWA artifact、舊 aggregate 戰鬥與新協定正式准入的限制 |
| 觀測器、App Check與正式成本 | 本輪未逐支驗收背景觀測器；Core HTTP 不驗證 App Check／正式網路或帳單 |
| iPhone／Safari／行動網路實機 | DEFERRED_BY_USER；不改為PASS，也不阻擋本輪隔離API驗收 |

自動審查的 `unitAndIntegrationPassed`、`allPriorPhasesAccepted` 是整體驗收簽核門檻，本輪不手動設成 true；本地單元／API通過由明確的獨立證據呈現。`immutableReleaseCommit` 也保留工作樹檢查，不隱藏尚未提交或無關的本機檔案；正式作業應使用凍結的乾淨 checkout。

## 下一個可審核動作

準備正式環境唯讀配置盤點：指定專案／兩區 Functions、已發布 Rules、Firestore索引、Hosting target、發布開關及實際測試scope。只讀 metadata 的命令也須遵守使用者 Phase8「正式環境操作需明確授權」的邊界；本輪沒有執行。

盤點通過後，再依原計畫處理核准的備份／隔離還原、相容版本部署、分批移轉與白名單驗收。每一正式步驟另取授權，不因27項通過就合併main或觸發GitHub Pages正式發布。
