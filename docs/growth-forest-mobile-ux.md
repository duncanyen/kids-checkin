# 成長森林：載入與手機介面調整

日期：2026-11-13。

## 載入流程

程式檢查發現原本先完成帳號連線、初始化／森林 snapshot，才載入 Phaser 與 31 張森林／植物階段圖片。家長帳號的成員查詢也排在森林土地查詢後逐批執行。

- 頁面啟動即預載公開引擎與森林圖片，和 Firebase 連線／查詢平行。預載不建立 Canvas；正式場景仍由原生命週期建立、暫停及銷毀。
- 素材預載 Promise 在同頁共用，圖片沿用瀏覽器 HTTP 快取；未新增 Service Worker 或離線帳號資料快取。跨次進頁能否命中 HTTP 快取仍取決於伺服器快取標頭與瀏覽器策略。
- snapshot 的成員批次、資源查詢與後續土地／植物讀取平行排程，保留原查詢條件與結果順序。每批仍最多十個 accountId。
- 同步更新共用服務及其生成的 direct-service.js；目前使用 firestore 傳輸，因此這些改善包含在前端版本。沒有切換傳輸方式，也沒有部署 Firebase。

這些調整減少串行等待，沒有減少所有 Firestore 讀取。初始化、土地及植物仍需連線取得，正式行動網路實際秒數尚未量測。未改寫獎勵、資源或群組授權規則。

## 家長管理

七項既有功能改為單列可水平滑動的分頁，取代兩欄／四欄按鈕矩陣。選取分頁以個人主題色底線標示，觸控高度至少 44px。使用 tablist、tab、tabpanel 與 aria-selected；支援左右鍵、Home、End，選取分頁自動移入可視區。

原有功能、順序、紀錄預設收合與清單內捲動維持。未更名功能或增加入口。

## 成長紀錄篩選

個人與家長紀錄共用兩欄軌道，各欄最高 11rem，窄螢幕自動縮至可用寬度。統一欄位高度 44px、標籤與間距；狀態／考試類型及開始／結束日期成對對齊，保留原生日期選擇器。篩選參數、分頁與查詢語意不變。

## 驗證

- 成長森林服務、direct adapter 及閱讀計時器：25 項通過。
- 隔離瀏覽器：320／390／768／1440px 的日期、篩選、分頁、橫向分頁列與鍵盤操作通過，頁面無橫向溢出。
- 延遲連線／snapshot 的啟動測試：真實 Phaser 在資源餘額仍未返回前載入、植物素材預載且只建立一個 Canvas。
- 完整 direct Firestore fixture 回歸通過：考試、家長審核、閱讀、獎勵規則、購種、種植、澆水、土地分頁、重新整理、兌換與六種植物。
- Git diff 空白檢查通過。

瀏覽器測試採真實頁面／CSS／Phaser 和隔離 Firebase fixture，未讀寫正式資料；不代表已完成 iPhone／iPad 真機或正式網路效能驗收。

```sh
node --test tests/growth-forest-service.test.cjs tests/growth-forest-direct.test.cjs tests/growth-forest-clock.test.mjs
# 先於專案根目錄啟動 python3 -m http.server 8030
GROWTH_STARTUP_ONLY=1 node tests/growth-forest-browser.cjs
GROWTH_LAYOUT_ONLY=1 GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
GROWTH_DIRECT_BROWSER=1 node tests/growth-forest-browser.cjs
```

## 修改檔案

- wishwall.html：家長分頁語意。
- css/growth-forest.css：橫向分頁及一致的篩選欄位。
- js/growth-forest/main.js：素材預載啟動與分頁互動。
- js/growth-forest/scene.js：共用美術及引擎預載。
- functions/growth-service.cjs：獨立查詢平行化。
- js/growth-forest/direct-service.js：由 scripts/build-growth-direct.cjs 生成。
- tests/growth-forest-browser.cjs：啟動／分頁／排版驗證。
- docs/growth-forest-mobile-ux.md：本說明。

## 後續修正：分頁輸入隔離與欄位一致性

- 原本 pause 只呼叫 game.loop.sleep，並未停用場景輸入；現在停止場景點擊，並於花朵／土壤回呼與 plot 入口檢查目前分頁。避免原生下拉選單操作期間，隱藏森林收到殘留事件而開啟植物視窗。
- 全域 Phaser Input Manager 保持啟用，以接收 mouseup／touchend 並完成指標狀態清理；場景輸入由分頁、頁面可見性、對話框和暫停狀態共同決定。場景延遲建立時也沿用先前設定。
- 紀錄與審核移除重複的「查看成員」，原「孩子」篩選改為「成員」，依選取文字計算選單寬度且不超出容器。其他管理分頁仍保留必要的「成員」操作對象選單。
- 個人／家長紀錄的開始及結束日期，寬度對齊狀態欄位，高度固定 44px；調整 WebKit 原生日期控制項的內部 padding，保留原生日期選擇行為。
- 新增真實 Phaser 回歸：種植後切到審核，切換三種成員選項並向隱藏場景發送 pointerup，均不開植物視窗；回森林後仍能正常點花。驗證 320／390／768／1440px，兩處日期與狀態的實際邊界框等寬等高。
- 未進行 iPhone／iPad 真機驗收，未修改 Firebase 或遊戲獎勵規則。

## 後續修正：獎勵規則分頁的非同步競態

已以延遲成長概覽回應的隔離瀏覽器測試重現：切到獎勵規則後，舊 renderParent 仍向已移除的 manualReward 綁定 onclick，造成 null 錯誤。原程式也可能在 await 之後依新的 parentMode 繼續執行其他分頁分支。

修正方式：渲染開始時固定 mode／accountId，使用 parentGeneration 與 panel.isConnected 確認非同步回應仍屬於目前畫面，並使舊紀錄查詢失效。概覽、申請、明細與資料銜接不再更新已離開的分頁；事件綁定使用該次渲染的區域元素，避免誤綁其他分頁。同時保護申請與積分清單的過期回應及分頁載入。

驗證：新增測試先確認舊版本失敗；修正後將概覽、申請、資料銜接、紀錄與明細回應分別延遲，切到獎勵規則並編輯金額，再釋放回應，確認沒有錯誤、表單不被覆寫，仍可儲存規則及使用概覽／申請操作。測試採隔離 Firebase fixture，未修改正式設定或獎勵數值。

```sh
GROWTH_PARENT_RACE_ONLY=1 node tests/growth-forest-browser.cjs
```
