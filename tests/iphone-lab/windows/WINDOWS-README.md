# Windows → iPhone 隔離驗收

這是完整的獨立假資料驗收包，不需Git、npm install、Firebase CLI、Google登入或正式帳號。只需Node.js22與mkcert；遊戲素材及Phaser3.60.0已在包內。

此包使用目前尚未發布的工作目錄快照，不代表已合併main或正式上線。伺服器僅MemoryDB；重新啟動會重建假資產，不可把新run當原交易恢復。

## 1. 安裝兩個工具（只做一次）

1. 在Windows執行 `node --version`。需要v22.x；若未安裝，從官方 https://nodejs.org/download/release/latest-v22.x/ 下載適合此電腦的Windows MSI（一般64位元Windows請選檔名結尾為-x64.msi的安裝程式）。安裝後關閉並重新開啟PowerShell。
2. 在PowerShell安裝mkcert：

```powershell
winget install --id FiloSottile.mkcert -e
```

完成後重新開啟PowerShell，確認：

```powershell
node --version
mkcert -version
```

若Windows沒有winget，mkcert官方下載位置為 https://github.com/FiloSottile/mkcert/releases ，需要依官方說明安裝並加入PATH。不要下載不明網站的工具。

## 2. 解壓並啟動

把ZIP全部解壓到 `C:\GuguLab`；該資料夾內應直接看得到 `Start-Lab.ps1`。

```powershell
cd C:\GuguLab
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Lab.ps1
```

此處ExecutionPolicy只作用在這個PowerShell程序，不修改整台電腦的永久政策。腳本會安裝**本機測試CA**到Windows信任區、產生含LAN IP的測試憑證並啟動3443；若Windows要求確認，請先核對是mkcert本機測試CA。

若自動判定發現多個網路位址，執行 `ipconfig` 找Wi-Fi或實際LAN的IPv4，再指定，例如：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\Start-Lab.ps1 -LanIp 192.168.1.23
```

**192.168.1.23只是格式範例，務必換成您電腦的實際IPv4。** 不要用Cloud Shell、VPN、127.0.0.1或手機自己的IP。

若Windows Defender防火牆詢問Node.js存取，允許您信任的**私人網路**，不要直接停用整個防火牆或開放公用網路。腳本啟動後保持視窗開啟。

先在Windows瀏覽器打開腳本顯示的 `https://localhost:3443/`，應看到「iPhone／Safari隔離驗收站」。電腦先停在此首頁，不要和iPhone同時用同一假帳號進遊戲，以免既有跨裝置page guard作廢舊頁。

## 3. 讓iPhone信任測試HTTPS

1. Windows與iPhone連同一個Wi-Fi／可互通LAN。訪客Wi-Fi可能隔離裝置，請換成可互通的受信任網路。
2. 將 `C:\GuguLab\certs\iphone-lab-rootCA.cer` **公用憑證**透過自己的郵件／OneDrive等方式送到iPhone並開啟。
3. iPhone若顯示「描述檔已下載」，到「設定 → 一般 → VPN與裝置管理」選擇剛下載的測試憑證並安裝。系統可能要求iPhone解鎖密碼，不是遊戲密碼。
4. 到「設定 → 一般 → 關於本機 → 憑證信任設定」，開啟對該mkcert本機測試根憑證的信任。名稱依您電腦實際產生的憑證為準。
5. Safari打開腳本印出的 `https://電腦實際LAN-IP:3443/`。應沒有TLS警告，首頁「安全環境」為是、Web Locks與Service Worker為支援。

**只傳 `iphone-lab-rootCA.cer`，不要傳 `rootCA-key.pem`、`iphone-lab-key.pem`或任何私鑰。** 不要只略過TLS警告就把PWA判定為可驗。測試結束可在iPhone移除本次憑證描述檔；Windows若不再使用mkcert可依其官方方式解除本機CA信任。

## 4. 第一輪只做四件事

1. 首頁選「小咕A／村落A」，按「使用此假帳號」，下載起始狀態JSON。
2. 進遊戲，確認首頁、商店、倉庫按鈕清楚可按。
3. 商店買一把狼牙棒，確認只扣2,000假金幣、只多一把武器。
4. 從驗收首頁按「同帳號開第二分頁」，確認不會自動搶走原頁操作；按「在此分頁繼續」才交棒。

通過後再依 `docs/weapon-refinement/iphone/03-device-checklist.md` 測故障、精煉、開箱及強制關閉。所有真iPhone案例目前都是NOT_RUN；本包的電腦預檢不是實機驗收。

PWA：Safari分享 → 加入主畫面，名稱應是「咕咕驗收」。這不是正式Nexus；不要覆蓋正式捷徑。Safari與主畫面PWA可能使用不同儲存容器，請如實記錄。

## 故障排除

- 電腦可開、手機逾時：先確認同一個可互通Wi-Fi、LAN IP、防火牆私人網路權限；不要重做Firebase部署。
- 憑證名稱／IP不符：重新用目前LAN IP執行Start-Lab.ps1；Wi-Fi換網段後舊IP憑證可能不適用。
- 手機仍有憑證警告：確認安裝的是公用CA且已開啟「完整信任」，不能只按略過。
- 關閉PowerShell後連不上：伺服器已停止，須重開；這會是新的run，先前報告請保留。
- 需要查看JSON或下載結果：回驗收首頁的「查看本次狀態／下載驗收紀錄JSON」。有pending時不要清網站資料或重啟server補成通過。

此站不驗證正式Firebase Auth、App Check或正式Functions網路延遲；不要輸入正式帳密。若看到真正Firebase登入頁，停止操作並回報。

本機LAN網址只能先測同Wi-Fi。iPhone關閉Wi-Fi而只用4G／5G時，無法直接連到Windows私人LAN IP；行動網路完整測試須另準備外部可達的隔離HTTPS站，不能把此限制當成遊戲bug，也不必開正式Firebase或路由器公網port。

本包的Node／遊戲預檢在Linux完成；Windows PowerShell、Windows憑證安裝與真iPhone實機狀態仍為NOT_RUN，需您實際操作確認。
