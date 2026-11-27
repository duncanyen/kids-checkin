# 03－武器個體化、相容移轉與回復設計

本文件是未實作提案；來源 commit `0233ffd632d82ac0cede326d508718ea3cdbe734`，2026-11-27。指定 DEVELOPMENT_RULES 尚待取得／核對；不得據此直接執行移轉或 Phase 2。

## 1. 個體與權威來源

目前堆疊種類保留作商品目錄，未來每把武器有獨立 ID。owner scope 建議為 canonical JSON `[profileId,groupId,accountId]` 的 hash；跨群組的同帳號不得共享裝備、精煉等級或石頭。

以下集合名稱全部為**建議新增**，目前不存在對應精煉功能，不能當成已可呼叫的 API：

| 建議路徑 | 職責 |
|---|---|
| `ops_weapon_owners/{scopeHash}` | schemaVersion、activeGeneration、revision、武器總數、近戰／弓個體裝備、migrationState |
| `ops_weapon_owners/{scopeHash}/weapons/{instanceId}` | 所有權、種類、state、revision、出生能力、精煉等級、版本快照、失敗次數、本輪實際成功／失敗消耗 |
| `ops_weapon_grants/{sourceId}` | 大批發放的容量預留、分批進度與穩定產生 ID 規則 |
| `ops_weapon_intents/{requestKey}`／`ops_weapon_transactions/{requestKey}` | 私有已接受意圖／固定抽樣；最終不可變收據與退款歷史 |
| `ops_refine_config_drafts`／`ops_refine_config_versions`／`ops_game_config/refining` | 草稿、不可變版本及生效指標／開關 |
| `ops_refining_migrations/{scopeHash}` | 固定 generation、來源指紋、chunk 進度、備份參照及驗證結果 |

使用 ops 私有 namespace 是為避開現有 group user 子集合泛用 allow。客戶端預設不直接讀寫完整私有文件，透過可信任 API 返回最小 DTO；正式 Rules 仍須先與候選比對。

個體資料建議包含 `weaponType、ownerScope、instanceRevision、refineLevel、refineEpoch、baseStatSnapshot、baseCombatVersion、refinePolicyVersion、bonusSnapshot、successfulSpend、failedSpend、failuresByTarget、createdBySource`。同款在倉庫分開圖示。

裝備以 owner 中 `equippedMeleeInstanceId/equippedBowInstanceId` 為唯一權威；個體詳情回傳衍生的 equippedSlot，不在兩處獨立維護矛盾的布林值。近戰缺裝備時使用該農場綁定木棒；木棒是否可精煉／占容量需先確認。

## 2. ID 與發放冪等

新購買／獎勵個體：伺服器依唯一來源交易、獎勵列、scope、序號產生 ID，或首次接受時固定 ID。不能每次重送就 randomUUID 一批新武器。

移轉個體：固定 `generation + sourceFingerprint + scope + weaponType + ordinal` 產生可重複 ID。固定 generation 是整個任務的身份，不是每次重跑都換一個；同款原裝備用固定排序選一把，原本沒有不同屬性，不捏造歷史。

大批來源目前可有 1,000 份／物品與 20 箱，不能假定一個 Transaction 可寫任意多個體。提案：一般安全批量即時交付；超量以來源消耗、付款、容量預留及 grant ticket 原子提交，再以穩定 ID 分批交付。未完成不得顯示全部已入庫，也不可裝備尚未交付的個體。舊箱快照必須仍能兌現。

## 3. 新舊資料相容

- schema1：舊數量＋種類裝備；只由相容的既有路徑處理。
- schema2：個體為權威；種類數量／裝備種類如需保留，僅是後端維護的相容投影，不允許雙向互相同步。
- 每個修改資源的入口（含管理調幣、禮包、每日、箱子、歡迎信）都要尊重 owner migration gate；不能只有 shop 查 gate。
- schema2 收到舊 `buyWeapon/sellItem/equipWeapon` payload 時，明確拒絕並要求更新，或由事先設計的無歧義相容轉換處理。多把同款時不能「隨便挑一把」替舊客戶端賣掉。
- 所有仍可到達的區域部署相容 server writer 後，才切換 farm；只改台灣區、讓舊新加坡區繼續寫舊數量不安全。
- 活躍戰鬥先完成／按原生命周期作廢後再轉換；不在戰鬥中精煉、解除或變更能力。

## 4. PWA／舊版本客戶端

既有 SW 不快取遊戲 JS，只管公開美術；仍不能強迫已開啟頁面卸載舊程式。新增功能必須有伺服器宣告的 `schemaVersion/clientProtocol` 及版本拒絕策略，而非相信 sessionStorage 或常數旗標。

建議先讓新前端可讀 schema1／schema2、伺服器可處理舊新協定，再灰度個體化。舊分頁遇到升版，提示保存目前結果後重新載入；不得因相容錯誤清除存檔、重建農場或重送不同 requestId。

不要求玩家清除全部網站資料／登入憑證才能移轉；清掉本機待確認收據可能使交易難以恢復。公開素材快取可內容更新，私人錢包與結果不交給 SW cache。

## 5. 移轉步驟（本階段不執行）

1. 取得正式規則 release／區域／開關的唯讀盤點，與所有 writer 清單比對；取得 DEVELOPMENT_RULES。
2. 正式備份及隔離還原演練，記錄來源 commit、備份時間、manifest hash、設定版本。不可在文件放原始私人玩家資料。
3. 唯讀 dry-run 所有農場，不只目前 members：驗證正整數數量、裝備存在、profile 對應、孤兒資料、容量，產出例外清單；不得擅自補造付費武器。
4. 部署相容後端／前端與正確規則須另經批准；Phase 1 沒有任何部署。設定 per-owner 武器異動鎖，擋所有包含武器的發放並等待戰鬥結束。其他資源仍可運作，但最終交易須保留它們的最新值。
5. 固定出生能力的 combat 設定快照及來源武器 fingerprint，分批建立 staged generation，記錄每 chunk 校驗。失敗只重跑未完成 chunk。
6. 比對每種類個體數＝原數量、ID 唯一、裝備有效、非武器資產及容量不變。初始木棒另列明確規則，不因新增木棒多占一格。
7. 最終 Transaction 重讀最新 farm、gate、來源武器指紋與 staged manifest，原子切 active generation／schema。不得用幾分鐘前的整份 farm 覆蓋這期間收蛋／金幣。
8. 小量 scope 驗收後逐批開放；同 generation 重跑只驗證不再發個體。保留備份、來源及目標指紋、錯誤、執行身份與時間。

## 6. 多裝置與精煉／解除的安全契約

所有付費操作使用 scope＋requestId 的固定 key、完整 canonical payload fingerprint、expectedInstanceRevision／epoch。成功與失敗都增加 revision；兩裝置同一 revision 只有一筆扣款，第二筆不能自動當成下一次精煉。

建議私有 intent 固定已接受的設定版本與伺服器抽樣；同一 intent 跨 Transaction 自動重試、程序重啟或網路逾時都沿用，不把抽樣值回傳。扣金幣、扣材料、更新個體、成本累計、收據與完成狀態在同一經濟 Transaction。

只在 callback 外抽一次可保單次呼叫內重試，不足以處理所有跨呼叫版本邊界。精煉不可使用前端或可見戰鬥 damageSeed 抽成功率。取消／過期請求保留終止防重標記，不允許刪除後以同 ID 再抽。

解除：按本把本輪「實際成功」成本總和算 30%／50%，加總後一次 floor；失敗成本不退。退款、清加成／保底／累計、epoch＋1 和原子收據一起完成，原歷史保留。+0、舊 epoch、重送不得再次退款；材料滿倉可先整筆拒絕，不先清加成再說放不下。

戰鬥建立讀裝備個體＋能力 revision 並凍結；每次攻擊依快照驗算，不新增逐擊讀取。交易與進場共讀 owner／battle 狀態，避免換裝、精煉、解除或出售同時進場的競態。

## 7. 能力與政策版本（待確認）

建議出生／移轉時固定原始能力，本輪第一個有效精煉操作固定九級政策及退款比例。舊武器再升級沿用舊輪次政策，解除後新一輪用當時精煉政策，不把各版累計加成相加。

這會改變目前「營運調基礎攻擊，下場戰鬥全體生效」的語意；需明確同意。只凍結加成比例、卻允許原始攻擊下調，仍會削弱玩家。

低攻擊 +3% 會有小數；建議固定小數面板與最終傷害取整的新協定。V4 1.5 倍與舊 V3 分支需保留，不能把新數字版本直接送進舊算法。基礎爆擊可設到100%，加15個百分點的封頂／資格規則也需先確認。

## 8. 開關與回復

精煉、解除、材料來源、schema2 新建立、既有個體讀取分開開關。關閉新精煉仍應可讀／裝備舊精煉武器；不能切回 legacy 數量模式解決新 UI 問題。

- staged 未發布：可移除該 generation，原 schema1 仍權威。
- 已發布且完全無新交易：核對 journal 後可受控回退 pointer 與原資料。
- 已有新購買／精煉／出售／退款：先停新寫入、保留個體資料與相容讀取，依帳本修復／補償。**不可全庫回灌舊備份，也不可把精煉個體直接壓回種類數量。**

正式備份不是日常回滾按鈕。所有回復需隔離演練、影響清單、重新對帳及防重驗證，不能藉回復多領或取消已付款資產。

## 9. Firebase 成本設計估算

個體只在倉庫頁按需分頁（例如20把），其他場景只取摘要／裝備；交易回傳變更個體與目前餘額，不再立即全量查詢。戰鬥入場多讀近戰／弓各一份，逐擊增量讀取為0。

意圖＋經濟兩段方案可先用約23讀／6寫每次作容量估算（包含兩段權限／成員／開關驗證、intent／receipt、owner、instance、farm、設定及戰鬥鎖；寫入預留 intent、farm、owner、instance、receipt、完成標記）。此數量是保守預算，不是已確定的最小讀寫清單，若共享文件／驗證快取或額外稽核不同就會改變；既有 report capture 再約2讀／1寫，即25讀／7寫。這是提案估算，不是已實測的新系統成本，未含重試、分頁、索引、統計、儲存及 RTDB 下載。

100位玩家每日各5次，30天15,000次，基本約375,000讀／105,000寫；1,000位則約3,750,000讀／1,050,000寫。費用應乘正式地區／版本單價，不能只算 callable 次數；原有報表／mirror 也會觸發 Functions。

分片日統計由不可變交易增量、按事件ID去重，可延遲但不作餘額依據。既有金幣餘額不應搬進 RTDB 以追求免費讀取；RTDB 鏡像是非跨庫原子且有下載成本。索引依查詢建立，不索引大型能力／私有抽樣與成本詳情。
