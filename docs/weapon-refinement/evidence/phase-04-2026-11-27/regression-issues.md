# Phase 4 回歸限制

最終543項單元（含新增17項）通過；最後版面調整後相關前端22項與新材料UI皆通過，22項不另加總。

初次瀏覽器矩陣27/29：
- countdown_tests：既有 combat-feedback-browser.cjs:72 等待地面怪物進入可點區逾時。
- critical_feedback_tests：同 helper :67，血條距離0.3cm斷言失敗。

未改原有測試容差或正式戰鬥程式；兩組原命令單獨重跑 exit0。保留初次失敗與重跑日誌，根因尚未釐清，不宣稱矩陣穩定或以重跑抹除。

新材料UI初跑選錯既有按鈕文案，修正測試後通過；目視發現SVG缺少尺寸呈黑塊，補96×96後重跑與截圖，非正式素材。

真實Emulator於下載JAR被HTTP403阻擋，沒有執行Rules/Firestore競態assertions。MemoryDB及隔離SDK不等同真實Firestore。Phase2/3前置驗收缺口仍保留，正式開關全部false，不部署、不進Phase5。
