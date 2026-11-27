# 本次基準限制與既有 fixture 問題

- 來源 commit：0233ffd632d82ac0cede326d508718ea3cdbe734。
- 主矩陣 469 項單元、29 組瀏覽器通過；另有兩組準備命令，不計功能測試。
- Emulator 未執行 assertion：下載 cloud-firestore-emulator-v1.19.8.jar 回 HTTP 403 Domain forbidden。狀態為 BLOCKED。
- 額外舊測試 tests/farm-announcements-client-browser.cjs 在第24行等待 window.__client 30秒逾時。診斷回報：

```text
FIXTURE_BROWSER_ERROR Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html". Strict MIME type checking is enforced for module scripts per HTML spec.
page.waitForFunction: Timeout 30000ms exceeded.
    at /workspace/kids-checkin/tests/farm-announcements-client-browser.cjs:24:75 {
  log: [],
  name: 'TimeoutError'
}
```

該 fixture 的小型 HTTP server 未完整供應現行私有登入的相依模組，模組請求收到 text/html。本次不改原測試或正式程式；此結果不能推論正式兌換已故障。現行私有模式禮包完整 UI 尚待補測。

DEVELOPMENT_RULES.md 尚未找到；正式 Rules／資料、真實行動網路與兩台實體裝置未檢查。完整圖鑑里程碑功能不存在，不能標示通過。

原始日誌保存在交付 ZIP；baseline-summary.json 含每份日誌 SHA-256。執行時間以原始 UTC 時戳保存，日期為台灣2026-11-27。
