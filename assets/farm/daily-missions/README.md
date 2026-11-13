# 每日挑戰 UI 素材

本版僅使用使用者提供的 T1/T2 原始 PNG，不使用前一包簡化素材。

- `source/T1.png`、`source/T2.png`：原始檔，SHA-256 記錄於 `v2/manifest.json`。遊戲不載入整張素材表。
- `v2/*.png`：實際使用的切片；座標與修補範圍見 manifest。
- `scripts/extract-daily-ui-assets.py`：離線切圖腳本，需要 Pillow；不使用生成式繪圖。
- 原圖已烙上的標題、分頁與按鈕文字，使用同圖的空白木牌／同按鈕空白區替換，再由 DOM 顯示動態文字。這些區域有修補，不能稱為逐像素完全相同。
- 橫幅底部排除屬於下一個元件的細線；吊牌、皇冠、母雞切圖邊界也已避開鄰近元件。
- 其餘未修補區域保持來源 PNG 像素，原有透明邊緣亦保留。原素材本身有些低透明度光暈，不做重新生成或配色修改。
- 長吊牌以原圖九宮格圖片延伸空白內頁；使用原圖作 border-image，沒有以 CSS 漸層或陰影重畫木框。

重建：

```bash
python scripts/extract-daily-ui-assets.py \
  assets/farm/daily-missions/source/T1.png \
  assets/farm/daily-missions/source/T2.png
```


## 固定圖片快取

`farm-daily-sw.js` 只控制 `farmgame.html` 文件，且只攔截本資料夾 `v2/` 的 PNG GET。原始素材表、程式、登入、Firebase、每日狀態與領獎 API 不進此快取。

**每次修改 v2 切圖後，必須同步更新 `js/farm/daily-assets-cache.js` 的 `DAILY_ART_REVISION`。** 新版本會建立獨立快取；既有遊戲離開後才啟用新版本，避免遊玩途中換掉圖片。只清除此功能舊版快取，不刪除其他功能的資料。瀏覽器禁用 Service Worker、儲存空間不足或清除網站資料時，會回到一般 HTTP 載入。
