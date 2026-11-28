# 隔離驗證證據

2026-11-28（台灣時間）。不部署、不讀寫正式資料；production flags仍為false。`test-summary.json` 為彙整，真實交易以 `real-firestore-summary.json` 的來源雜湊核驗為準。

## 重現

在 repository 根目錄、Node22、Java21 與本機測試依賴已安裝的環境執行：

```bash
node scripts/prepare-game-admin.cjs
node --test tests/verified-combat.test.mjs tests/verified-input-client.test.mjs game-admin/tests/verified-input.test.cjs
node scripts/run-refinement-firestore-tests.cjs --output /tmp/nexus-input-proof
```

第三條命令固定使用 `demo-nexus-private-farm`／127.0.0.1:8092，會自己啟停官方Firestore Emulator；若該port已有程序則拒絕啟動。不得改成正式project或在執行途中修改來源檔案。完整12檔結果才可通過本機proof驗證；不是Auth／Storage／Functions整套測試。

瀏覽器需本機Phaser3.60.0 fixture、Chromium及Playwright；先用獨立終端在repo根目錄提供localhost靜態頁面：

```bash
python3 -m http.server 8050 --bind 127.0.0.1
```

另一個終端：

```bash
PHASER_FIXTURE=/tmp/kids-phaser.js \
FARM_BASE_URL=http://127.0.0.1:8050 \
NODE_OPTIONS="--require=$PWD/tests/weapon-refinement/browser-guard.cjs" \
VERIFIED_INPUT_TESTS=1 \
node tests/farm-private-backend-browser.cjs
```

這條命令經原村落入口，真實Phaser和sprite pointer handler（近戰）、真實mouse拉弓（遠程）、原service與MemoryDB；結果不冒稱真實Functions E2E。瀏覽器guard拒絕非localhost網路。結束後在server終端按Ctrl-C。

完整單元收集方式同 `scripts/test-private-farm.cjs`：取 `tests/`、`game-admin/tests/` 第一層所有 `.test.cjs`／`.test.mjs`；不把手動的Emulator檔案混入unit數量。

## 檔案

- `unit.log`：688/688。
- `real-firestore-summary.json`、`real-firestore/`：最終來源固定的12檔真實交易／candidate Rules證據。
- `browser-actual/`：新版9怪物，實際拜訪入口及拉弓，整個workflow通過。
- `regression/`：原7個workflow首輪6通過／1失敗；`regression-repeat/`為失敗項測試修正後通過。
- `legacy-pwa/`：真實worker及固定舊版模組harness，獨立1個workflow通過。
- `gameplay-summary.json`、`gameplay-victory.png`、`game-hornet.png`：新協定遊戲入口、勝利及弓箭命中畫面。
- `diagnostics/`：早期測試與中途來源修改導致無效的證據。不能拿這些summary當發布通過。
- `step-a-review.json`：仍為NO_GO，並非部署授權。

總計9個瀏覽器workflow最終通過，但曾有載入／resize／確認批次競態與原20擊測試問題，不能以重跑通過消除時序紀錄。此次未測物理iPhone、Wi-Fi／行動網路P50/P95，也未驗收正式PWA artifact與正式Rules。
