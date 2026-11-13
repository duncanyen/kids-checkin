// Repository 只有正式 Rules 的片段。確認正式規則允許這兩個附加累計欄位後，
// 才將開關改為 true 並發布；預設關閉，避免影響既有收蛋與偷蛋交易。
export const FARM_REPORT_COUNTERS_ENABLED = false;
export function reportingCounterPatch(farm,key,amount,enabled=FARM_REPORT_COUNTERS_ENABLED){
 if(!enabled||!Number.isSafeInteger(amount)||amount<=0)return{};
 if(!['reportHarvestedEggs','reportStolenEggs'].includes(key))throw Error('不支援的報表累計欄位');
 const previous=Number.isSafeInteger(farm[key])&&farm[key]>=0?farm[key]:0;
 return{['farm.'+key]:Math.min(Number.MAX_SAFE_INTEGER,previous+amount)};
}
