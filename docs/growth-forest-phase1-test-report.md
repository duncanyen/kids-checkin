# 成長森林 Phase 1 測試報告

日期：2026-11-05（台灣）
分支：`feature/growth-forest-phase1`
環境：Node.js 22.23.4、Chromium／Playwright、Java 21、隔離記憶體 Firestore fixture。

**本報告只記錄實際執行結果。未對正式 Firebase 發獎、寫入或遷移。真實 Emulator 尚未成功啟動，不列為通過。**

## 1. 測試摘要

| 實際執行項目 | 結果 | 能證明的範圍 |
| --- | --- | --- |
| 全專案 `tests/*.test.mjs`、`tests/*.test.cjs` | **149 通過、0 失敗** | 既有單元測試及新增成長森林領域測試 |
| 成長森林後端＋閱讀時鐘子集 | **16 通過、0 失敗**（包含在上述 149 中，非額外加總） | 業務規則、資源／狀態／遷移、時間戳與權限分支 |
| 成長森林完整瀏覽器流程 | **通過** | 真實 HTML/CSS/JS 與 Phaser；隔離 Auth/Firestore transport，服務使用真實 domain/service |
| Nexus 導覽瀏覽器回歸 | **通過** | 七個功能頁、六個自訂入口、相容舊路由、底部導覽與畫面不溢出 |
| 既有營運後端服務測試 | **10 通過、0 失敗** | 共用記憶體 fixture 增加日期比較後，營運服務原有測試仍通過 |
| `git diff --check`、新增 JS/CJS 語法檢查 | **通過** | 差異空白與基本語法 |
| Firestore／Storage Emulator 整合 | **阻擋，未執行測試案例** | 官方 JAR 下載遭環境代理 403 |
| 正式 Firebase Auth／Storage／Rules／實機 | **未執行** | 需受控測試專案與正式規則，不得視為上述隔離測試已涵蓋 |

## 2. 實際執行指令

工具環境透過下列 Node 路徑固定版本；一般開發者可在 Node 22 環境直接用 `node`。

```sh
node scripts/prepare-growth-forest.cjs
/workspace/.kids-checkin-tools/node_modules/node/bin/node --test tests/*.test.mjs tests/*.test.cjs
/workspace/.kids-checkin-tools/node_modules/node/bin/node --test tests/growth-forest-service.test.cjs tests/growth-forest-clock.test.mjs
/workspace/.kids-checkin-tools/node_modules/node/bin/node --test game-admin/tests/service.test.cjs
```

啟動本機伺服器後：

```sh
python3 -m http.server 8030 --bind 127.0.0.1
GROWTH_BASE_URL=http://127.0.0.1:8030 /workspace/.kids-checkin-tools/node_modules/node/bin/node tests/growth-forest-browser.cjs
FARM_BASE_URL=http://127.0.0.1:8030 /workspace/.kids-checkin-tools/node_modules/node/bin/node tests/navigation-browser.cjs
```

瀏覽器流程的資料保存在 Node fixture，不連接正式資料庫；Auth transport 是測試替身。Phaser 使用與咕咕村落相同的 3.60.0 真實引擎，SVG 圖像由本機伺服器載入。

## 3. 後端與計時器覆蓋

`tests/growth-forest-service.test.cjs` 的 14 個測試：

1. 舊積分、保留額、獎品、已發放及未完成申請銜接；重複初始化不重複入帳；原始來源文件不改寫。
2. 40／50 正確視為 80%；95／100 相比增加 15 百分點；待審核不發獎；規則改版不影響既有提交快照；並行核准不重發。
3. 閱讀自動核准、未達門檻保留、重複核心內容拒絕、同日不同紀錄競爭每日上限及真實概覽數值。
4. 初始免費種子、不能憑空種第二顆、後端價格購買、水滴不足拒絕、十次澆水成熟及成熟不再扣水。
5. 申請冪等保留、餘額／進行中限制、家長拒絕釋放、孩子取消釋放、完成正式扣除及重試不再扣除。
6. 已核准成績更正／撤銷的差額交易、歷史保存、已花掉水滴時拒絕負餘額沖回。
7. 匿名、偽造 accountId／role／獎勵、跨群組、孩子自審、退出群組均拒絕。
8. 閱讀需審核時不先發獎、退回不發獎、儲存失敗原子回滾、同 requestId 重試恢復與指紋衝突。
9. 待審核／退回紀錄可修正重新送審，核准只發一次；孩子不能直接編輯已核准紀錄。
10. 舊有效成績用作新紀錄進步比較，但不重發舊水滴／金幣。
11. 紀錄分頁與篩選、不同擁有人隔離；負歷史餘額停止初始化而非歸零。
12. 閱讀每日上限日後提高，補章節不會錯誤沖回先前合法取得的獎勵。
13. 同一可負擔獎品的兩筆不同 requestId 並行申請，仍只保留一次積分。
14. 無效請求、其他群組／帳號、巢狀或非允許副檔名的考卷路徑均拒絕。

`tests/growth-forest-clock.test.mjs` 的 2 個測試：

- 開始後跨背景時間差、重新建立頁面、暫停不累加、繼續到 20 分鐘、完成歸零、不同帳號／群組 key 隔離。
- 損壞儲存內容及時鐘倒退不產生負時間。

記憶體 transaction fixture 檢查讀取必須在寫入之前、原子提交與失敗回滾，但其序列化排程不等於真正 Firestore 多機競爭；後者仍需 Emulator 案例。

## 4. 瀏覽器實際操作流程

已完成以下真實點擊／輸入流程：

1. 孩子登入上下文包含過期名稱與過期 profile groupId；後端依 accountId 與選定群組返回正確資料。
2. 孩子不顯示家長入口；首次免費向日葵種子能種入第一格。
3. 提交數學 95 分，畫面顯示等待家長，積分維持 0。
4. 家長以後端角色進入管理頁，查看孩子紀錄並核准。
5. 孩子資源同步到 100 星星、25 水滴、10 金幣；澆水兩次到 20／100 並換成發芽 sprite。
6. 手動提交 20 分鐘／15 頁閱讀，依預設獎勵入帳。
7. 家長修改未來閱讀金幣規則；之後的新閱讀紀錄使用新規則。
8. 金幣足夠時購買鬱金香，再選第二格種植；重新整理仍保留該植物。
9. 書名含 `<img src=x onerror=...>` 時只顯示文字，紀錄容器沒有注入的圖片節點。
10. 查看資源交易明細與來源。
11. 孩子申請原有獎品，家長完成發放，餘額／保留額正確更新。
12. 390 × 844 手機及 1440 × 1000 桌面無橫向溢出；Phaser 與實際頁面均參與測試。

測試產生的本機截圖（非正式玩家資料）：

- `/tmp/nexus-growth-forest-child.png`
- `/tmp/nexus-growth-forest-progress.png`
- `/tmp/nexus-growth-forest-parent.png`

## 5. Emulator 嘗試與未執行案例

已實際嘗試：

```sh
PATH=/workspace/.kids-checkin-tools/node_modules/node/bin:$PATH \
/workspace/.kids-checkin-tools/node_modules/.bin/firebase emulators:exec \
 --project demo-nexus-growth --config growth-forest/firebase.json \
 --only firestore,storage 'node tests/growth-forest-emulator.cjs'
```

結果：Firestore Emulator JAR `cloud-firestore-emulator-v1.19.8.jar` 下載失敗：

```text
Error: download failed, status 403: Domain forbidden
```

因此以下三個已編寫的整合測試**沒有執行、沒有通過紀錄**：

1. 真實 Firestore Rules：本人／家長讀取、跨群組與匿名拒絕、禁止客戶端改資源／角色／紀錄、查詢隔離。
2. 真實 Storage Rules：本人上傳、家長讀取、跨群組拒絕、禁止寫他人路徑、非法 MIME 與大於 5 MB 拒絕。
3. 真實 Firestore Admin SDK：並行閱讀每日上限、同獎品並行保留只成功一次。

測試程式缺少 Emulator host 環境變數就立即失敗，不能回退正式服務。解除下載阻擋後須重跑，並確認三個案例均真正執行。Firebase 原生身分橋接、Functions HTTP transport 及 iPhone 實機仍是另外的驗收工作，不能由這三個案例代替。

## 6. 開發期間發現並已修正

- 家長紀錄清單一開始預設查自己的帳號，導致看不到孩子：改由家長頁明確查群組全員，再套用孩子篩選。
- 舊照片 Auth 測試的 require 替身不提供新模組：將成長服務改成只在 `growthForest` 被呼叫時延遲載入，並確認原照片測試通過。
- 背景頁截圖曾逾時：最後截圖前將該頁帶到前景；完整業務流程並未藉此跳過。
- 導覽測試替身缺少既有記帳頁的 aggregate 與 documentId 匯出：補齊替身後重新執行，七個功能頁導覽回歸通過。
- 閱讀上限調整後更正章節可能重新算掉舊獎勵：保留原已獲份數，再計算可新增份數，新增回歸測試通過。

初次測試使用錯誤的本機連接埠所造成的 connection refused，不列為功能通過結果；以上摘要均使用伺服器運行於 8030 的最終重跑結果。

## 7. 尚未驗收

- 正式專案 Rules／Storage／索引部署與舊直接寫入凍結。
- 正式資料遷移 dry-run、apply、匯出及復原流程。
- 真實 Firebase Auth 橋接、MFA／其他 Nexus 帳號工作階段互動；本功能不變更管理站 MFA 政策。
- iPhone Safari/PWA 真機、低網速、大量歷史資料、照片讀取 CORS、記憶體量測。
- 正式插畫與音效品質評審。

這些項目未執行，不標示為完成。詳細功能與限制見 [Phase 1 開發報告](growth-forest-phase1-report.md)。
