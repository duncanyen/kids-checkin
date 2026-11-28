# iPhone／Safari 隔離驗收環境

日期：2026-11-28（台灣時間）。目的：在真正手機上驗證操作、PWA與交易恢復。**不是正式站，不部署Firebase，不使用正式玩家資料。**

## 現在準備到哪裡

- 獨立啟動器：`scripts/iphone-lab.cjs`。
- 測試伺服器、假資料及adapter：`tests/iphone-lab/`。
- 完整現有Phaser遊戲畫面，現有service與MemoryDB假資料；同源測試adapter取代Firebase SDK／設定。
- 已啟動0.0.0.0:3000，本機 `/lab/health` 可回應，private HTTPS preview尚待平台提供有效URL。**127.0.0.1只在執行環境內可用，不能貼到iPhone。**
- 使用者已回覆新增3000且套用；但平台讀回此環境spec revision 2，仍為`portals: []`。沒有虛構預覽網址。請確認變更套用至此聊天的runtime，而非僅儲存環境範本；待平台可讀到HTTP3000的URL後才提供連結。

## 給測試者的第一個動作

拿到已核對的 **私人HTTPS驗收網址** 後，用iPhone Safari開啟。首頁必須寫「iPhone／Safari隔離驗收站」、顯示安全環境／Web Locks／Service Worker支援狀態，且沒有正式密碼輸入欄。若看到正式網站或homebasedb登入頁，立即停止。

選「小咕A／村落A」→「使用此假帳號」→下載第一份狀態JSON→「進入遊戲」。第一輪只做清單PRE-01、UI-01、SHOP-01、TAB-01，確認可用後才測斷線與強制關閉。

私人HTTP preview可能需要在手機登入同一個環境擁有者帳號。這是平台進入權限，**不是遊戲測試帳號**。如果主畫面PWA被平台登入跳轉阻擋，記為環境BLOCKED，不關掉私人預覽保護。

## 已做的隔離防護

1. Node只建立MemoryDB，不初始化Firebase Admin、不使用ADC、服務帳號、正式Auth或正式資料庫。
2. 假玩家／群組帶每次run獨立namespace，伺服器重啟建立新run，不把舊run的pending當新帳號交易。
3. 正式firebase-config與operations-client只在測試HTTP回應中被換成同源adapter；repository正式檔案不修改。
4. CSP的connect-src限self，第三方SDK來源被阻擋，Phaser3.60.0由本機fixture提供。API不開CORS，POST驗Origin，測試session只綁定列出的假帳號。
5. 靜態檔案只開放遊戲JS/CSS/美術，`.env`、Functions檔案、任意repo檔案／私有ops文件不供瀏覽。前端直接Firestore寫入會被拒絕。
6. 假操作仍經既有可信任service、頁面及交易收據；故障注入只在獨立測試伺服器，不接正式callable。
7. 正式六項功能開關仍false；測試fixture開放不代表正式發布或權限驗收通過。

## 啟動與停止（給準備環境的人，不必先讓手機使用者執行）

在本次工作目錄與Node22環境：

```bash
cd /workspace/kids-checkin
node scripts/prepare-game-admin.cjs
PHASER_FIXTURE=/tmp/kids-phaser.js \
node scripts/iphone-lab.cjs --listen 0.0.0.0 --port 3000
```

目前工作環境Node22位於 `/workspace/.kids-checkin-tools/node_modules/node/bin/node`；若PATH找不到node，可用該完整路徑。Phaser fixture應為3.60.0。**這些檔案尚未推送GitHub，單純git pull main不一定有本工具。**

本機健康檢查：

```bash
curl --fail http://127.0.0.1:3000/lab/health
```

預期kind=`synthetic-MemoryDB`、production=false、outboundFirebase=false。停止時在該server終端Ctrl-C；不要刪正式資料或執行Firebase部署。

伺服器記憶體重啟會重建假資產，請先下載本run報告。重新開站後須回驗收首頁重新選假帳號；不要把新run的餘額與舊run當同一場測試。

## 無Cloud HTTPS preview時的本機替代方式

必須在擁有本次完整工作目錄及Phaser fixture的電腦執行；Cloud Shell的localhost或Cloud執行環境的LAN位址不等於手機可達網址。

若已有可信任的區域網路TLS憑證，工具可直接提供HTTPS：

```bash
node scripts/iphone-lab.cjs \
  --listen 0.0.0.0 --port 3443 \
  --phaser /你的本機路徑/phaser.min.js \
  --tls-cert /你的本機路徑/iphone-lab-cert.pem \
  --tls-key /你的本機路徑/iphone-lab-key.pem
```

iPhone與電腦須同Wi-Fi，憑證SAN包含電腦LAN IP／名稱，且iPhone已信任簽發CA，防火牆允許3443。網址為你電腦實際LAN IP與連接埠，不能使用Cloud的127.0.0.1。工具不替你安裝CA或產生公開隧道。不要只略過自簽憑證警告就宣稱已符合PWA安全環境。

不建議為了驗收直接部署到homebasedb或GitHub Pages正式網址。

## 本站能驗／不能驗

能驗：實機觸控／排版、Phaser實際操作、新協定回饋、同瀏覽器分頁交接、PWA容器行為、真實斷線後本機日誌、受控回應遺失與原ID確認、精煉／解除／開箱UI。

不能據此認證：正式Firebase Auth／App Check、正式Rules、真實Firestore網路與Functions區域延遲、正式worker歷史artifact、正式使用者權限及正式月費。MemoryDBadapter以1.5秒輪詢假快照，並非正式監聽效能；不能用其整體數值宣稱正式環境P50/P95或Firestore讀取量。

手機主畫面PWA可能與Safari使用不同storage／Web Locks分區，實機應觀察並記錄；跨容器不可直接假設共享本機鎖或同一份pending。其他裝置亦由既有伺服器page guard控制。

測試adapter的HTTP保護逾時為22秒（正式operations-client原20秒流程沒有被修改）；網路／Abort例外一律視為結果未明。22秒不能拿來認證正式20秒的精確行為。

Windows使用者可改用完整本機驗收包，見 [Windows準備報告](06-windows-kit-report.md) 與 `tests/iphone-lab/windows/WINDOWS-README.md`。此路徑不依賴Cloud HTTP preview，先驗同Wi-Fi，未完成真行動網路可達性。
