# 回歸結果與驗收限制

最終526項單元通過，其中39項為新增精煉／安全案例。Phase2原18項也包含在完整單元中，不能再次加總。

初次並行瀏覽器矩陣為27/29通過。以下兩組在 tests/helpers/combat-feedback-browser.cjs:67 的原有血條位置斷言失敗：

- combat_feedback_tests
- critical_feedback_tests

```text
assert.ok(Math.abs(initial.gap-96/2.54*.3)<.1)
```

未改測試容差或正式戰鬥程式，兩組依原命令單獨重跑均exit0；另Phase2實際倉庫／商店入口重跑exit0。保留初次失敗日誌及重跑日誌，列為動畫／幀時序幾何斷言的不穩定觀察，尚未確定根因，不能以重跑通過抹除。

本次真正Emulator在下載Firestore JAR時HTTP403，沒有執行Rules／真實競態assertion。Phase2／3驗收仍未放行，未部署、未進Phase4。

新增每scope全域ID案例修正Phase2算法缺口；舊已建立ID不改號。詳細API、成本及回復見phase-03-report.md。
