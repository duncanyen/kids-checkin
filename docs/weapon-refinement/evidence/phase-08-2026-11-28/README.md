# Phase8證據索引

日期：2026-11-28（台灣時間）。本次僅Step A；NO-GO不是測試報告遺失，而是正式驗收條件尚未滿足。

- `unit-release-review.log`：最終629項全部通過；較早unit-final／unit-delivery是在最後工具測試加入前的627／628項，不相加。
- `baseline/summary.json`及原始log：原29組瀏覽器初跑26通過、3時序斷言失敗。`regression-rerun/`與`regression-combat-rerun/`保留3組獨立重跑通過；不代表不穩根因已消失。
- 根目錄5組階段UI初跑log：HTTP server未啟動而connection refused。`extra-rerun/`為有管理localhost server的5組實際入口重跑，全通過。
- `emulator.log`：官方Firestore JAR下載HTTP403，未執行6份測試assertions；非真正Firestore／Rules通過。
- `synthetic-reconciliation.json`：合成已提交+9／失敗／解除交易與同次資源前後證據通過，非正式玩家。
- `incomplete-reconciliation.json`：相同資料缺walletJournal會正確INCOMPLETE，不能用手填餘額補過。
- `migration-rehearsal.json`：2001把、3份allocation、1份一批、中斷／重播與較新非武器資產保留，MemoryDB介面計數非帳單。
- `step-a-local-review.json`：本機已知與未知項，未知正式條件保持false；工具不自授部署權。
- `source-manifest.json`：目前dirty工作目錄來源hash，不是immutable Git commit；正式版本必須另行凍結審查。

`emulator.local.example.json`是相對repository root的範本。若要在本機允許官方artifact下載的測試環境重現，先把範本放到repository root（例如`.refinement-emulator.review.json`），再明確指定localhost demo，逐檔以乾淨demo資料庫執行Emulator檔。不要直接將此evidence子目錄當firebase project root，也不要拿homebasedb來代替Emulator。範例（只限本機測試，不會部署）：

```bash
cp docs/weapon-refinement/evidence/phase-08-2026-11-28/emulator.local.example.json .refinement-emulator.review.json
firebase emulators:exec --config .refinement-emulator.review.json \
  --project demo-nexus-private-farm --only firestore \
  'node --test game-admin/tests/refinement-operations.emulator.cjs'
```

Emulator服務需與其他本機作業的port分離；這條命令在本次環境仍會遇下載403，不是已驗證成功的替代命令。先保留測試失敗，再修復受允許環境。正式備份、Rules、Auth、移轉、部署、開關或GitHub Pages更新全部另需明確授權。
