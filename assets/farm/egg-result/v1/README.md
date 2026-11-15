# 咕咕村落｜收蛋完成 UI 獨立素材包 V1

來源：你提供的「收蛋完成」介面素材表；此 ZIP 中的 PNG 是實際從圖表裁切而成，並非重新設計的替代圖。

## 10 個主要檔案
- `egg_result_panel.png`：空白主面板
- `egg_result_title.png`：收蛋完成木牌
- `egg_result_close.png`：關閉按鈕
- `egg_result_illustration.png`：母雞與蛋籃插畫
- `egg_result_total_banner.png`：只保留雞蛋圖案、沒有任何固定數值的總數底板
- `egg_result_section_title.png`：本次收穫木牌
- `egg_result_row.png`：沒有圖示、沒有文字的明細列底板
- `egg_result_storage_banner.png`：已放入倉庫提示
- `egg_result_confirm.png`：確定按鈕
- `egg_result_decoration.png`：草叢裝飾

## 附加檔
- `egg_result_decoration_right.png`：右側草叢
- `egg_result_eggs_icon.png`：額外雞蛋插圖（非明細列圖示，不要放在每一列左側）
- `contact_sheet.png`：素材總覽
- `manifest.json`：尺寸與用途

## Codex 注意
1. 所有 PNG 保有透明 Alpha；不要用整張參考圖當背景。
2. 將 `egg_result_total_banner.png` 的「本次共收取 XX 顆雞蛋」文字與數值以 DOM 疊加，XX 應是收蛋成功交易回傳總數。
3. 每個 `egg_result_row.png` 只顯示 `雞蛋種類 × 數量`，勿額外加入雞蛋 Icon。
4. 使用實際交易中不同雞種的數量動態產生 0~N 列，若 >3 列，讓明細區可捲動。
5. 本次彈窗完全不顯示收蛋時刻與間隔時間。
6. 確定及關閉僅隱藏彈窗，不能重複收蛋或增加庫存。
7. `egg_result_storage_banner.png` 只能在倉庫確實成功寫入後顯示。
8. 這些是從 AI 合成素材裁切而成，圖片邊緣可能存在細小原始筆觸或柔光像素；整合後請在真機上檢查。
