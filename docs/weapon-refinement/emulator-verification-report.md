# Firestore Emulator下載修復與真實驗證

日期：2026-11-28（台灣時間）。範圍：解除原HTTP403下載阻擋，取得真正Firestore交易／候選Rules結果。**本次25／25項真實Emulator測試通過；整體發布仍NO-GO**，沒有部署或操作正式玩家資料。

## 1. 403的實際原因

目前Codex Cloud環境是enforced restricted networking，Firebase CLI原下載主機`storage.googleapis.com`不在允許清單。curl在CONNECT階段回403，回應為環境代理envoy，尚未到Firebase。這不是Firestore Rules拒絕、登入憑證或遊戲交易錯誤，也不表示使用者Cloud Shell一定有相同限制。

沒有關閉TLS、改proxy／CA、繞過網路政策或擴大網域權限。使用原本已允許的Google官方套件來源`dl.google.com`，下載Cloud SDK官方Firestore Emulator component。

最初嘗試最新SDK594.0.1的Emulator1.23.0：封裝無可直接`java -jar`的Main-Class，且需要較新的Java；沒有拿它冒充測試版本。接著找到SDK490.0.0的官方**1.19.8**存檔，和原Firebase CLI要求的版本一致，使用官方main class啟動，保留原JAR位元組不修改。

## 2. 來源與完整性

- Manifest：`https://dl.google.com/dl/cloudsdk/channels/rapid/components-v490.0.0.json`。
- 官方archive：`https://dl.google.com/dl/cloudsdk/channels/rapid/components/google-cloud-sdk-cloud-firestore-emulator-20240816183020.tar.gz`。
- Manifest提供的archive SHA256：`708013ee1eb1fc34fc1b33e8b562e7c276e95749685050f347af0002d96be9ef`。
- 解出的JAR SHA256：`3aeacaf290bf13ad6e829f962858c141320a85d5d8badcb93847893a95b71510`。
- 引擎自行回報：`cloud-firestore-emulator 1.19.8`；本機Java21、Node22。
- 啟動類別：`com.google.cloud.datastore.emulator.firestore.CloudFirestore`，使用官方SDK的`-cp`方式。Cloud SDK分發JAR與Firebase分發JAR包裝／hash不同，不能改名塞進Firebase快取冒充同一檔案。

安裝腳本同時核對archive與JAR的SHA256；既有快取損壞會拒絕使用。沒有修改firebase-tools的下載metadata、正式規則或遊戲邏輯。

## 3. 可重現腳本

新增：

- `scripts/setup-firestore-emulator.cjs`：只下載上述官方固定版本到使用者快取，核對雜湊，不接收project／deploy／apply。
- `scripts/run-refinement-firestore-tests.cjs`：啟動自己擁有的localhost8092 Firestore程序，明確demo專案，逐檔清空demo DB及執行，結束後關閉自己啟動的程序；既有8092有服務則拒絕，不殺別人的服務。
- `scripts/lib/firestore-emulator-proof.cjs`：保存／比對來源雜湊及25項TAP結果；不是數位簽章或部署授權。
- `tests/firestore-emulator-environment.test.cjs`：5項工具安全測試，含損壞快取、零assertion不能算通過、拒正式專案、拒任意suite、舊來源或錯誤引擎不能當最新證據。

在**已取得本工作目錄同版程式及依賴**的環境執行（本次未commit／push，Cloud Shell的舊checkout不會自動有新腳本）：

```bash
# 先進入實際repository；本工作區為 /workspace/kids-checkin
cd /workspace/kids-checkin
(
  export GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm
  export GCLOUD_PROJECT=demo-nexus-private-farm
  node scripts/run-refinement-firestore-tests.cjs --output /tmp/nexus-real-firestore-results
)
```

只在子shell設定demo識別，不執行`gcloud config set project`，不變更正式預設專案。需Node22、Java（本次21）、curl、tar及原專案測試依賴。安裝維持正常proxy／CA與TLS驗證；官方來源若被另一環境限制，應調整經授權的環境設定，不能關閉驗證。

只重跑某份既有測試可使用：

```bash
(
  export GOOGLE_CLOUD_PROJECT=demo-nexus-private-farm
  export GCLOUD_PROJECT=demo-nexus-private-farm
  node scripts/run-refinement-firestore-tests.cjs \
    --suite refinement.emulator.cjs --output /tmp/nexus-real-refinement-only
)
```

單檔成功不會被發布審查工具視為完整7檔證據。TAP必須有實際assertions，且無fail／cancel／skip；下載成功或server啟動不等於測試通過。

## 4. 真實結果

第一輪與可重跑腳本第二輪均通過。第二輪來源Hash未漂移：

| 真實Firestore測試檔 | 通過／總數 | 驗證內容 |
|---|---:|---|
| private-farm-rules.emulator.cjs | 5／5 | 既有候選Rules、有效玩家、匿名／偽造身分／撤銷、敏感權威欄位 |
| weapon-instances.emulator.cjs | 5／5 | 真實移轉、重跑3把不變6把、並行買賣與裝備、失敗一致性／Rules |
| refinement.emulator.cjs | 5／5 | 並行同ID僅一次扣款／state、跨請求競態、原交易與安全驗證 |
| refinement-stone-rewards.emulator.cjs | 2／2 | 真實材料發獎防重、私有設定／材料Rules |
| refinement-reset.emulator.cjs | 3／3 | 同ID並行退款一次、精煉與解除衝突、退款／材料權威欄位Rules |
| refinement-combat.emulator.cjs | 2／2 | V5有序批次與結算重送、獎勵一次、拒改戰鬥／能力／餘額 |
| refinement-operations.emulator.cjs | 3／3 | 統計來源防重、草稿發布／撤權、客戶端管理資料禁止讀寫 |
| **合計** | **25／25** | **真實Firestore Emulator，非MemoryDB** |

執行方式為Admin SDK交易直接連接Firestore Emulator，Rules測試使用官方rules-unit-testing／Firebase客戶端SDK；管理端Auth getUser／玩家准入部分仍由既有fixture提供測試身分。**沒有宣稱已跑正式Auth、Storage或Functions HTTPS Emulator整套驗證**。

七個檔案之間清空的只有固定`demo-nexus-private-farm`，不刪正式資料。所有負向Rules拒絕是預期assertFails；server.log中的PERMISSION_DENIED不是套件失敗。

## 5. 發布審查的更新

`scripts/weapon-release-review.cjs`現在會讀本次 [real-firestore-summary.json](evidence/emulator-repair-2026-11-28/real-firestore-summary.json)，確認demo識別、官方版本／hash、7檔皆有assertion且全部通過、無skip／cancel及來源hash一致，才將本機`realEmulatorPassed`判為true。檔案缺失或來源改變會再次失效；不手動改舊報告pass旗標。

`rulesCompatibleVerified`仍false：測到的是Repository候選Rules，不是已核對的正式Rules release。正式環境／備份／索引READY、正式白名單／移轉adapter、資產完整歷史帳本、舊PWA／實機與戰鬥手勢反作弊等阻擋均未解除；整體仍**NO-GO**。舊Phase1～8的403與失敗原始證據保留，新增此報告作後續事實，不將過去改成早已通過。

## 6. 其他回歸及異動範圍

新增測試工具後再跑全套單元，結果見 [summary](evidence/emulator-repair-2026-11-28/summary.json) 與unit-regression.log。這次只改本機安裝／測試／證據判讀工具及文件，未改遊戲交易邏輯、怪物數值、Rules、部署設定或五項正式flag，沒有重新跑無關的全部手機瀏覽器矩陣。

證據包含：代理403、官方manifest、archive／JAR版本資料、失敗的1.23.0嘗試、第一輪與第二輪Java server及TAP原始日誌、來源雜湊、修復後Step A審查。JAR與archive不放Git／交付ZIP；使用固定官方網址與SHA256可重建。

所有正式玩家flag仍false，沒有push、部署、正式資料移轉、Auth權限變更或Step B～F。
