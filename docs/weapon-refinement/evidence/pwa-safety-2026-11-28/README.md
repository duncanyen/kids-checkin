# PWA 安全驗證證據

2026-11-28（台灣時間）。資料均為本機fixture／demo，未部署或讀寫正式資料。最新 sourceSha256由 `scripts/lib/firestore-emulator-proof.cjs` 驗證，不能拿MemoryDB通過冒充整套Firebase Emulator。

- `test-summary.json`：705項單元、57項真正Firestore／candidate Rules、11個瀏覽器workflow最終通過。
- `units.log`：全單元紀錄。
- `real-firestore-summary.json`、`real-firestore/`：官方1.19.8 Firestore，13檔suite，來源無變動；包括新4項查詢案例。
- `browser-final/`：實際安全模組＋service＋MemoryDB的雙分頁、offline、原ID恢復與更新測試；是模組harness，不是完整遊戲畫面。
- `game/`：真正Phaser遊戲／商店入口的單次扣款、唯讀恢復、返回村落，以及遊戲上方安全更新遮罩320px截圖。protocol錯誤為UI測試注入，購買與查回走真正service。
- `regression-final/`：原有存檔、核心遊戲、武器個體、精煉戰鬥、戰鬥離開、美術快取、戰鬥回饋七組。
- `verified-input-final/`、`verified-gameplay-summary.json`：原入口新協定9怪物、共用模型與拉弓，未退回每擊請求。
- `legacy-final/`：固定Git舊版／新模組與真正service worker，屬模組工具，不是正式歷史artifact。
- `diagnostics/`：初跑問題，包含最初阻擋正常併發的測試停止、武器pending同步缺口、一次原批次時序失敗及工具問題。不以重跑抹去。
- `step-a-review.json`：仍NO_GO，不是Step B～F授權。

## 重現指令

在repo根目錄，先具備Node22、Java21及本機測試依賴：

```bash
node --test tests/farm-safety.test.mjs game-admin/tests/farm-recovery.test.cjs
node scripts/run-refinement-firestore-tests.cjs --output /tmp/nexus-pwa-recheck
```

第二條命令固定127.0.0.1:8092／demo-nexus-private-farm，自行啟停Emulator；拒絕正式project參數或佔用port，不修改正式Rules。

另一終端提供localhost靜態檔案：

```bash
python3 -m http.server 8052 --bind 127.0.0.1
```

在repo根目錄執行真實雙分頁模組測試：

```bash
FARM_BASE_URL=http://127.0.0.1:8052 \
PWA_SAFETY_OUTPUT=/tmp/nexus-pwa-browser-recheck \
NODE_OPTIONS="--require=$PWD/tests/weapon-refinement/browser-guard.cjs" \
node tests/weapon-refinement/pwa-safety-browser.cjs
```

實際遊戲入口另外需要Phaser3.60.0本機fixture及Chromium：

```bash
PHASER_FIXTURE=/tmp/kids-phaser.js \
FARM_BASE_URL=http://127.0.0.1:8052 \
PWA_SAFETY_TESTS=1 \
NODE_OPTIONS="--require=$PWD/tests/weapon-refinement/browser-guard.cjs" \
node tests/farm-private-backend-browser.cjs
```

以上browser guard拒絕未被fixture攔截的外部網路；服務驗證與資料都在MemoryDB，真正Firestore另驗。結束後在靜態server終端Ctrl-C。

未測物理iPhone、真實Wi-Fi／行動網路、正式部署artifact或正式Rules release；不得因此宣稱全面正式驗收。
