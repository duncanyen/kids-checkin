/** Pure refinement math. Percentages are integer basis points (100 = 1pp). */
const D=require('./domain.cjs');
const BP=10000,MAX_LEVEL=9,MAX_COINS=1000000000,MAX_STONES=1000000;
const ATTACK=[300,600,1000,1400,1900,2500,3200,4000,5000],CRITICAL=[100,200,300,400,500,700,900,1200,1500],SUCCESS=[10000,9000,8000,7000,6000,5000,4000,2000,1000],COINS=[1000,2000,3000,4000,5000,5000,5000,5000,5000],STONES=[1,1,1,1,2,2,2,3,3];
const zeroBonus=()=>({attack:0,criticalRate:0,chainCriticalRate:0});
function reject(reason,message,code='failed-precondition',details=null){const error=new D.OpsError(code,message);error.reason=reason;if(details)error.refinementConflict=details;throw error;}
function defaults(version='refinement-v1',effectiveAt=0){return{schemaVersion:1,version,effectiveAt,levels:ATTACK.map((attack,i)=>({level:i+1,bonus:{attack,criticalRate:CRITICAL[i],chainCriticalRate:CRITICAL[i]},successRateBp:SUCCESS[i],coins:COINS[i],stones:STONES[i],pity:{enabled:false,guaranteeAttempt:0}}))};}
function bonus(value){if(!value||typeof value!=='object')D.fail('invalid-argument','缺少精煉加成');return{attack:D.integer(value.attack,0,5000),criticalRate:D.integer(value.criticalRate,0,1500),chainCriticalRate:D.integer(value.chainCriticalRate,0,1500)};}
function validateConfig(raw){
 if(!raw||raw.schemaVersion!==1||typeof raw.version!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(raw.version)||!Array.isArray(raw.levels)||raw.levels.length!==9)D.fail('invalid-argument','精煉設定版本或等級不完整');
 const effectiveAt=D.integer(raw.effectiveAt,0,8640000000000000);let previous=zeroBonus();
 const levels=raw.levels.map((row,i)=>{
  if(row?.level!==i+1)D.fail('invalid-argument','精煉等級必須依序為1至9');const next=bonus(row.bonus);
  if(Object.keys(previous).some(key=>next[key]<previous[key]))D.fail('invalid-argument','同一版本各級三項加成不得遞減');previous=next;
  if(typeof row.pity?.enabled!=='boolean')D.fail('invalid-argument','保底開關無效');
  if(row.enabled!==undefined&&typeof row.enabled!=='boolean')D.fail('invalid-argument','等級開關無效');
  return{...(row.enabled!==undefined?{enabled:row.enabled}:{}),level:i+1,bonus:next,successRateBp:D.integer(row.successRateBp,0,BP),coins:D.integer(row.coins,0,MAX_COINS),stones:D.integer(row.stones,0,MAX_STONES),pity:{enabled:row.pity.enabled,guaranteeAttempt:D.integer(row.pity.guaranteeAttempt,row.pity.enabled?1:0,1000000)}};
 });
 return{schemaVersion:1,version:raw.version,effectiveAt,levels};
}
function baseSnapshot(weapon,revision=0){
 if(!weapon)reject('BASE_CONFIG_INVALID','找不到武器原始能力');
 const attack=D.integer(weapon.attack,1,1000000),convert=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)D.fail('failed-precondition','武器機率設定無效');const [coefficient,exponent='0']=String(value).toLowerCase().split('e'),[whole,fraction='']=coefficient.split('.'),digits=BigInt(whole+fraction),power=2-fraction.length+Number(exponent);if(power>=0)return Number(digits*10n**BigInt(power));const divisor=10n**BigInt(-power);return Number((digits+divisor/2n)/divisor);};
 return{attack,criticalRateBp:convert(weapon.criticalRate),chainCriticalRateBp:convert(weapon.chainCriticalRate),combatRevision:D.integer(revision,0,Number.MAX_SAFE_INTEGER)};
}
const effectiveBase=(state,liveBase)=>state.refineLevel>0?(state.baseStatsSnapshot||liveBase):liveBase;
function calculateStats(base,extra=zeroBonus()){
 const b=bonus(extra);D.integer(base.attack,1,1000000);D.integer(base.criticalRateBp,0,BP);D.integer(base.chainCriticalRateBp,0,BP);
 const attack=Number((BigInt(base.attack)*BigInt(BP+b.attack)+5000n)/10000n);
 const criticalRateBp=base.criticalRateBp+b.criticalRate,chainCriticalRateBp=base.chainCriticalRateBp+b.chainCriticalRate;
 if(criticalRateBp>BP||chainCriticalRateBp>BP)reject('RATE_CAP_CONFLICT','加成後機率超過100%，請先調整設定；不會降低既有能力');
 return{attack,criticalRateBp,chainCriticalRateBp};
}
function initialState(item,generation,base=null){return{schemaVersion:1,instanceId:item.instanceId,weaponId:item.weaponId,ownerId:item.ownerId,generation,revision:0,refineEpoch:0,refineLevel:0,refineBonus:zeroBonus(),refineBonusUnit:'basis-points',refineStatsVersion:null,refineFailCount:0,failuresByTarget:{},successfulRefineCost:{coins:0,stones:0},failedRefineCost:{coins:0,stones:0},baseStatsSnapshot:base,createdAt:item.createdAt,updatedAt:item.updatedAt};}
function validateState(state,item,generation){
 if(!state||state.schemaVersion!==1||state.instanceId!==item.instanceId||state.weaponId!==item.weaponId||state.ownerId!==item.ownerId||state.generation!==generation)reject('STATE_INVALID','武器精煉資料或歸屬不一致');
 D.integer(state.revision,0,Number.MAX_SAFE_INTEGER-1);D.integer(state.refineEpoch,0,Number.MAX_SAFE_INTEGER-1);D.integer(state.refineLevel,0,9);bonus(state.refineBonus);D.integer(state.refineFailCount,0,Number.MAX_SAFE_INTEGER-1);
 for(const costs of [state.successfulRefineCost,state.failedRefineCost]){D.integer(costs?.coins,0,Number.MAX_SAFE_INTEGER);D.integer(costs?.stones,0,Number.MAX_SAFE_INTEGER);}
 if(!state.failuresByTarget||Object.entries(state.failuresByTarget).some(([key,value])=>!/^([1-9])$/.test(key)||!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER))reject('STATE_INVALID','精煉失敗進度異常');
 if(state.refineBonusUnit!=='basis-points')reject('STATE_INVALID','精煉加成精度不符');
 if(state.baseStatsSnapshot)calculateStats(state.baseStatsSnapshot,state.refineBonus);
 if(state.refineLevel===0&&Object.values(state.refineBonus).some(value=>value!==0))reject('STATE_INVALID','+0武器不可含有精煉加成');
 if(state.refineFailCount!==(state.failuresByTarget[String(state.refineLevel+1)]||0))reject('STATE_INVALID','失敗累計與目標等級不一致');
 if(state.refineLevel>0&&(!state.baseStatsSnapshot||typeof state.refineStatsVersion!=='string'))reject('STATE_INVALID','缺少已取得能力版本');
 return state;
}
function preview(state,config,base){
 if(state.refineLevel>=MAX_LEVEL)reject('MAX_LEVEL','武器已達+9，不能繼續精煉');
 const next=config.levels[state.refineLevel];if(!next||next.level!==state.refineLevel+1)reject('CONFIG_INVALID','精煉設定與目標等級不符');
 if(next.enabled===false)reject('LEVEL_DISABLED','此精煉等級尚未開放');
 const conflictDetails={configVersion:config.version,acquiredStatsVersion:state.refineStatsVersion,currentLevel:state.refineLevel,targetLevel:next.level,currentBonus:state.refineBonus,nextBonus:next.bonus};
 if(Object.keys(state.refineBonus).some(key=>next.bonus[key]<state.refineBonus[key]))reject('CONFIG_CONFLICT','下一級設定低於已取得能力，已停止精煉並記錄設定衝突','failed-precondition',conflictDetails);
 const currentFailures=state.failuresByTarget[String(next.level)]||0,pityDue=next.pity.enabled&&currentFailures+1>=next.pity.guaranteeAttempt;
 if(next.successRateBp===0&&!next.pity.enabled)reject('ZERO_SUCCESS_RATE','此等級成功率為0且未啟用保底，不可精煉');
 let currentStats,nextStats;try{currentStats=calculateStats(base,state.refineBonus);nextStats=calculateStats(base,next.bonus);}catch(error){if(error.reason==='RATE_CAP_CONFLICT')error.refinementConflict=conflictDetails;throw error;}
 return{currentLevel:state.refineLevel,targetLevel:next.level,currentStats,nextStats,bonus:structuredClone(next.bonus),cost:{coins:next.coins,stones:next.stones},successRateBp:next.successRateBp,effectiveSuccessRateBp:pityDue?BP:next.successRateBp,pity:{...next.pity,failures:currentFailures,due:pityDue}};
}
function eligibility(view,{coins,stones}){D.integer(coins,0,Number.MAX_SAFE_INTEGER);D.integer(stones,0,Number.MAX_SAFE_INTEGER);return{eligible:coins>=view.cost.coins&&stones>=view.cost.stones,reasons:[...(coins<view.cost.coins?['INSUFFICIENT_COINS']:[]),...(stones<view.cost.stones?['INSUFFICIENT_STONES']:[])]};}
function attempt(state,view,{rollBp,version,base,stamp}){
 D.integer(rollBp,0,9999);const success=view.pity.due||rollBp<view.successRateBp;
 if(view.currentLevel!==state.refineLevel||view.targetLevel!==state.refineLevel+1)reject('LEVEL_CONFLICT','只能逐次提升一級');
 const next=structuredClone(state),target=String(view.targetLevel);next.revision=D.integer(next.revision+1,0,Number.MAX_SAFE_INTEGER-1);next.updatedAt=stamp;next.baseStatsSnapshot=structuredClone(base);
 const bucket=success?'successfulRefineCost':'failedRefineCost';for(const key of ['coins','stones']){next[bucket][key]+=view.cost[key];D.integer(next[bucket][key],0,Number.MAX_SAFE_INTEGER);}
 if(success){next.refineLevel=view.targetLevel;next.refineBonus=structuredClone(view.bonus);next.refineStatsVersion=version;next.failuresByTarget[target]=0;next.refineFailCount=0;}
 else{next.failuresByTarget[target]=D.integer((next.failuresByTarget[target]||0)+1,0,Number.MAX_SAFE_INTEGER-1);next.refineFailCount=next.failuresByTarget[target];}
 return{success,state:next};
}
module.exports={effectiveBase,BP,MAX_LEVEL,MAX_COINS,MAX_STONES,defaults,validateConfig,zeroBonus,bonus,baseSnapshot,calculateStats,initialState,validateState,preview,eligibility,attempt,reject};
