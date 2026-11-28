# Phase5 驗收限制

最終568項單元（新增17後端＋8客戶端，共25項）全部通過。真Phaser／隔離SDK的Phase5及原Phase2倉庫操作皆通過。

原有29組瀏覽器矩陣初跑27/29。critical_zero_tests在原有combat-feedback-browser.cjs:67血條／頭部水平位置斷言失敗；navigation_load_tests在原有farm-navigation-loading.cjs:23的80ms載入提示斷言失敗。未更動正式戰鬥／載入程式或測試容差，兩者單獨原命令重跑皆通過。保留全部原始日誌，仍列為時序不穩定，不以重跑抹除，未確定完整根因。

Phase5本次瀏覽器測試各輪均通過；最後增加了動畫失敗、減少動態下連點及出售取消驗證。最後一次冷進倉庫效能樣本僅本機環境，樣本數1，不可當正式網路P95或實機效能。

本次真實Emulator仍於下載JAR被HTTP403阻擋，沒有執行Firestore競態／Rules assertions。正式Rules release未查證；MemoryDB通過不等同真實Firestore通過。Phase4前提驗收缺口保持原狀。五個正式開關false，不部署、不進Phase6。
