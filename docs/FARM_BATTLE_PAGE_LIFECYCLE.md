# 戰鬥鎖定與離頁作廢

## 玩家流程

- 拜訪村落的「溜走」按鈕在進場確認、怪物出現、交戰及後端結算期間呈停用外觀，點擊不切換場景。伺服器確認結束後恢復。
- 每次實際開啟／重新整理遊戲頁面產生記憶體內的新 battlePageId。首次 farm callable 前只登記一次，並行請求共用登記 Promise；後續操作不額外登記。
- pagehide 嘗試送出 abandonBattlePage。手機強制關閉可能不觸發事件或來不及送達，因此新頁面的 beginBattlePage 一律作廢舊頁面未結算會話，不依賴關閉請求才能正確運作。
- 舊戰鬥不恢復血量、不補結算勝負；不發掉落、不扣金幣／雞蛋、不增加擊殺、任務或營運戰鬥統計。新進場按既有條件重新判定怪物。
- 里程碑只退回此場消耗的 LastMilestone 並清除未結算 Challenge，既有真實擊殺／抓蟲次數不清空。一般出怪機率不變。
- 同帳號同群組在另一個新頁面進入，會取代舊頁面的戰鬥資格；舊頁面後續命令被後端拒絕。不同群組會話仍各自隔離。背景切換／鎖屏的 visibilitychange 不視為離頁。
- BFCache 返回已離開的舊頁面時重新載入，避免沿用已作廢的記憶體場景。

## 伺服器邊界

新增 beginBattlePage／abandonBattlePage，仍經原身分、群組、開關、限流及 Firestore Transaction。ops_farm_active 保存 ownerPageId 與 pageClosed；實際戰鬥繼承所有權。過期頁面不能取消新頁面戰鬥或送出新攻擊／結算，舊 challenge 收據也不能使已作廢怪物復活。

battlePageId 為頁面生命週期識別，不是權限憑證。一般經濟交易的指紋不含此欄位，使已提交收蛋／偷蛋收據仍可於重新整理後查回，不重複扣蛋、入庫或發獎。頁面登記／關閉收據則綁定 pageId。純攻擊、結算、進場判定的 pending key 不跨頁恢復。

以伺服器原子交易是否已完成結算為界：已提交的合法勝利不因之後關閉而回滾；仍未結算（包括 health=0、已過 deadline）的舊會話在新頁面被作廢。無法聲稱伺服器可即時偵測所有手機強制終止或撤回已提交交易，亦不以不可靠的 unload 通知作為唯一防護。

保留收據及作廢狀態供防重／診斷，不將其當有效戰鬥統計。沒有清空既有歷史、玩家資產或有效任務進度。

## 相容與發布

新前端碰到舊後端對 beginBattlePage 明確回覆「選項無效」時，維持舊協定以避免先後發布造成無法進入；其他錯誤不可降級。完整離頁作廢功能必須等新 Functions 部署並重新開頁才啟用，舊分頁不會憑空升級。

只需部署 game-admin 的 `functions:nexus-ops:gameOpsFarmTransaction`，沿既有設定更新台灣與新加坡兩區。不需部署 Rules、nexus-live 或改每日任務設定。這階段未部署正式環境，也沒有修改正式玩家資料。

## 驗證

- 371 項 Node 測試通過：新頁面作廢未結算／零血量／到期戰鬥、不發獎或損失、舊頁攻擊與取消拒絕、收據防重、已完成勝利保留、里程碑門檻退回及經濟收據跨頁重播。
- 真實 Phaser 公開村落原入口：怪物出現時點「溜走」留在拜訪場景，前端擊敗但後端結算尚未完成仍不能離開；結算完成可離開且只發一次獎勵。
- 自家／拜訪舊會話兩種重開測試通過：刻意阻擋 pagehide 通知，重新整理仍不恢復舊戰鬥，零血量／到期會話不增加掉落、任務或損失，重新判定後新怪完整血量。
- 完整私有遊戲收蛋／商店／打掃／偷蛋／打怪／每日任務通過；舊協定後端回歸通過。
- 偷蛋延遲、連點、逾時同收據及跨群組同帳號清潔回歸通過。
- 瀏覽器為 Linux Chromium、真實 Phaser、隔離 Firebase SDK／MemoryDB，非 iPhone 真機強制關閉或正式 Firestore 併發驗收；正式 Emulator 本次未執行。

```bash
node --test tests/*.test.cjs tests/*.test.mjs game-admin/tests/*.test.cjs
BATTLE_EXIT_TESTS=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
RESUME_PENDING_BATTLE=home PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
RESUME_PENDING_BATTLE=visit PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
LEGACY_BATTLE_PAGE_BACKEND=1 PHASER_FIXTURE=/tmp/nexus-phaser-3.60.0.js node tests/farm-private-backend-browser.cjs
```
