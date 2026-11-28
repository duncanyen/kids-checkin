# Windows 本機驗收包

2026-11-28（台灣時間）。因本聊天平台未提供可核對的HTTP preview URL，準備Windows本機HTTPS替代路徑。只操作測試工具與公開遊戲素材，未部署、未讀寫正式資料。

## 交付

- 完整包：`/workspace/exports/gugu-windows-iphone-lab.zip`，約60MB。
- 包含遊戲JS/CSS／美術、實際service＋MemoryDB、四種假帳號、Phaser3.60.0與MIT授權、Windows啟動器與操作文件。
- 不含.env、私鑰、node_modules、正式憑證或Git資料；實體firebase-config亦改為demo設定。
- `Start-Lab.ps1`在Windows執行，需Node22、mkcert；不要求Git、npm套件或Firebase CLI。
- `WINDOWS-README.md`是完整Windows→iPhone步驟。憑證在使用者自己的Windows產生；只傳送公用rootCA.cer到iPhone，不傳任何私鑰。

## 驗證與未驗項

- 4項lab測試通過。
- 完整包在無Git PATH且阻擋所有外部Node package的環境可建立四個假身分、讀取初始資產。
- 打包目錄的完整Phaser首頁在Linux Chromium通過，零外部請求、零uncaught JS錯誤。
- 521個包內檔案的SHA256已核對；最終包runtime與已測版本一致。
- **Windows PowerShell、mkcert的Windows系統信任安裝、真iPhone TLS／Safari／PWA均NOT_RUN**；不能拿Linux預檢宣稱實機已通過。
- 此本機LAN方式先驗同Wi-Fi；手機純行動網路無法直接存取Windows的私人LAN IP。行動網路完整驗收仍需要另外可達的隔離HTTPS環境，不要求使用者開正式Firebase或開路由器公網port來繞過。

## 可攜性調整

新增 `tests/iphone-lab/source-info.cjs`，讓日誌來源hash不依賴整份Emulator測試樹，讀取包內lab-build.json基底commit，Git不存在也能執行。只變更獨立lab的metadata，不修改正式runtime、交易、價格、Rules或功能開關。

產包器 `scripts/build-iphone-windows-kit.py`用明確副檔名／路徑白名單，排除node_modules與憑證；Phaser與MIT授權原樣附上。新目的資料夾不得覆蓋既有資料夾。

正式發布仍NO_GO。使用者第一輪先測HTTPS、首頁／倉庫／商店、一次購買及同Safari分頁協調。
