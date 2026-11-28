/** Additional material rewards. Never modifies base gold, loot or chest drop odds. */
const crypto=require('node:crypto'),D=require('./domain.cjs'),{reuseTransactionReads}=require('./transaction-reads.cjs');
const ITEM_ID='refinement_stone',INVENTORY_KEY='refinementStones',MAX_QUANTITY=1000;
const POINTER='ops_game_config/refinement-stones',versionPath=id=>'ops_refinement_stone_versions/'+D.id(id);
const rule=(cycle,min=1,max=min,chanceBp=10000,enabled=true)=>({enabled,chanceBp,min,max,cycle,claimLimit:1});
function defaults(version='stone-rewards-v1',effectiveAt=0){
 const chests=Object.fromEntries(Object.keys(require('./chests.cjs').MONSTERS).map(id=>[id,['wolf','tiger','gorilla'].includes(id)?rule('box-open',1,1,1000):['mole','dragon','eagle'].includes(id)?rule('box-open',1,1,2000):['cobra','giant'].includes(id)?rule('box-open',1,2,5000):rule('box-open',0,0,0,false)]));
 return{schemaVersion:1,version,effectiveAt,checkin:{enabled:true,cycle:'existing-checkin-cycle',claimLimit:1,days:Object.fromEntries(Array.from({length:7},(_,i)=>[String(i+1),i===2?rule('checkin-day',1):i===6?rule('checkin-day',3):rule('checkin-day',0,0,0,false)]))},mission:rule('taipei-day'),chests,gift:rule('existing-gift-claim',1,1000),extensions:{weekly:{enabled:false,implemented:false},encyclopedia:{enabled:false,implemented:false}}};
}
function validateRule(value,cycle){
 if(!value||typeof value.enabled!=='boolean'||value.cycle!==cycle||value.claimLimit!==1)D.fail('invalid-argument','材料來源開關、週期或領取限制無效');
 const out={enabled:value.enabled,chanceBp:D.integer(value.chanceBp,0,10000),min:D.integer(value.min,0,MAX_QUANTITY),max:D.integer(value.max,0,MAX_QUANTITY),cycle,claimLimit:1};
 if(out.min>out.max||out.enabled&&out.chanceBp>0&&out.min<1)D.fail('invalid-argument','材料數量範圍無效');return out;
}
function validate(raw){
 if(!raw||raw.schemaVersion!==1||typeof raw.version!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(raw.version))D.fail('invalid-argument','材料設定版本無效');
 const base=defaults(),days=raw.checkin?.days;
 if(typeof raw.checkin?.enabled!=='boolean'||raw.checkin.cycle!==base.checkin.cycle||raw.checkin.claimLimit!==1||!days||Object.keys(days).sort().join(',')!=='1,2,3,4,5,6,7')D.fail('invalid-argument','簽到材料設定不完整');
 if(!raw.chests||Object.keys(raw.chests).sort().join(',')!==Object.keys(base.chests).sort().join(','))D.fail('invalid-argument','怪物材料來源不完整');
 const gift=validateRule(raw.gift,'existing-gift-claim');if(gift.chanceBp!==10000)D.fail('invalid-argument','明確禮包物品必須保證交付，不可改成抽選');
 for(const id of ['weekly','encyclopedia'])if(raw.extensions?.[id]?.enabled!==false||raw.extensions[id].implemented!==false)D.fail('invalid-argument','尚未實作的活動／圖鑑來源不可啟用');
 return{schemaVersion:1,version:raw.version,effectiveAt:D.integer(raw.effectiveAt,0,8640000000000000),checkin:{enabled:raw.checkin.enabled,cycle:base.checkin.cycle,claimLimit:1,days:Object.fromEntries(Object.entries(days).map(([id,v])=>[id,validateRule(v,'checkin-day')]))},mission:validateRule(raw.mission,'taipei-day'),chests:Object.fromEntries(Object.entries(raw.chests).map(([id,v])=>[id,validateRule(v,'box-open')])),gift,extensions:base.extensions};
}
async function active(db,t,stamp){
 const pointer=(await t.get(db.doc(POINTER))).data();if(!pointer)return null;
 if(pointer.schemaVersion!==1)D.fail('failed-precondition','材料設定指標無效');D.integer(pointer.revision,1,Number.MAX_SAFE_INTEGER-1);
 const raw=(await t.get(db.doc(versionPath(pointer.activeVersion)))).data();let config;try{config=validate(raw);}catch{D.fail('failed-precondition','材料設定無效');}
 if(config.version!==pointer.activeVersion||raw.contentHash!==D.fingerprint(config)||config.effectiveAt>stamp)D.fail('failed-precondition','材料版本內容或生效時間無效');
 return{config,revision:pointer.revision,contentHash:raw.contentHash};
}
function createStoneRewardService({db,now=Date.now,enabled=()=>false,trustedReady=()=>false,testEnvironment=false,testRandomInt=null,sourceAdmission=null,sourceAvailability=null}){
 if(testRandomInt&&testEnvironment!==true)throw Error('Stone RNG injection requires isolated test environment');
 if(testRandomInt!==null&&typeof testRandomInt!=='function')throw Error('Invalid test RNG');
 const isEnabled=async(t,actor)=>!!await trustedReady(t)&&(!!await enabled()||!!(sourceAdmission&&actor&&await sourceAdmission(t,actor)));
 const sampler=()=>{const cache=new Map();return(key,upper)=>{const k=key+':'+upper;if(!cache.has(k))cache.set(k,testRandomInt?testRandomInt(upper):crypto.randomInt(upper));return D.integer(cache.get(k),0,upper-1);};};
 const quantity=(r,draw,key)=>{if(!r.enabled||!r.chanceBp)return 0;if(r.chanceBp<10000&&draw(key+':chance',10000)>=r.chanceBp)return 0;return r.min+(r.min===r.max?0:draw(key+':quantity',r.max-r.min+1));};
 const safeActive=async(t,stamp)=>{try{return await active(db,t,stamp);}catch(error){if(!(error instanceof D.OpsError))throw error;return null;}};
 async function dailyPreview(t,{type,day,actor},stamp){
  if(!await isEnabled(t,actor))return null;const current=await safeActive(t,stamp);if(!current)return null;
  const r=type==='checkin'?{...current.config.checkin.days[String(day)],enabled:current.config.checkin.enabled&&current.config.checkin.days[String(day)].enabled}:current.config.mission;
  return{schemaVersion:1,source:type,version:current.config.version,contentHash:current.contentHash,rule:r};
 }
 async function daily(t,data,stamp,draw){const snapshot=await dailyPreview(t,data,stamp);if(!snapshot)return null;return{...snapshot,quantity:quantity(snapshot.rule,draw,'daily:'+data.grantId),originId:data.grantId};}
 async function captureChest(t,monster,stamp,actor){
  if(!await isEnabled(t,actor))return null;const current=await safeActive(t,stamp);
  const body={schemaVersion:1,source:'chest',monster,version:current?.config.version||null,contentHash:current?.contentHash||null,lockedAt:stamp,rule:current?.config.chests[monster]||rule('box-open',0,0,0,false)};
  return{...body,snapshotHash:D.fingerprint(body)};
 }
 async function openChest(t,chest,draw){
  const value=chest.refinementStoneReward;if(!value)return null;
  const {snapshotHash,...body}=value;
  if(body.schemaVersion!==1||body.source!=='chest'||body.monster!==chest.monster||body.lockedAt!==chest.droppedAt||snapshotHash!==D.fingerprint(body))D.fail('failed-precondition','寶箱材料快照不一致，寶箱未消耗');
  const r=validateRule(body.rule,'box-open');
  if(r.enabled&&r.chanceBp>0&&!await trustedReady(t))D.fail('failed-precondition','材料獎勵維護中，此寶箱保留，尚未消耗');
  return{schemaVersion:1,source:'chest',version:body.version,quantity:quantity(r,draw,'chest:'+chest.id),originId:chest.id};
 }
 async function authorizeGift(t,rewards,stamp,actor){
  const amount=rewards.filter(row=>row.kind==='item'&&row.itemKey===ITEM_ID).reduce((n,row)=>n+row.amount,0);if(!amount)return null;
  if(!await isEnabled(t,actor))D.fail('failed-precondition','精煉石來源尚未開放，禮包與名額均保留');
  const current=await active(db,t,stamp),r=current?.config.gift;
  if(!r?.enabled||amount<r.min||amount>r.max)D.fail('failed-precondition','精煉石禮包數量或來源設定無效，尚未領取');
  return{schemaVersion:1,source:'gift',version:current.config.version,contentHash:current.contentHash,quantity:amount};
 }
 async function giftAvailable(){return db.runTransaction(async t=>{if(!await trustedReady(t)||!await enabled()&&!(sourceAvailability&&await sourceAvailability(t)))return false;return !!(await safeActive(t,now()))?.config.gift.enabled;});}
 async function readConfiguration(){return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction),current=await active(db,t,now());return current?{configured:true,...current}:{configured:false,defaults:defaults()};});}
 async function publishConfiguration(uid,input,requestId){
  D.requestId(requestId);if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['config','expectedRevision'].includes(key)))D.fail('invalid-argument','材料發布資料格式無效');D.integer(input.expectedRevision,0,Number.MAX_SAFE_INTEGER-2);
  const config=validate(input.config);if(config.effectiveAt>now())D.fail('invalid-argument','本階段不支援材料設定排程發布');
  return db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction);if(!await isEnabled(t))D.fail('failed-precondition','材料獎勵尚未開放');
   const priorRef=db.doc('ops_refinement_stone_config_requests/'+D.hash(uid+':'+requestId)),hash=D.fingerprint(input),prior=await t.get(priorRef);
   if(prior.exists){if(prior.data().fingerprint!==hash)D.fail('already-exists','發布編號已用於其他設定');return{...prior.data().response,replayed:true};}
   const [old,version]=await Promise.all([t.get(db.doc(POINTER)),t.get(db.doc(versionPath(config.version)))]);
   if(version.exists)D.fail('already-exists','材料版本不可覆寫');if((old.data()?.revision||0)!==input.expectedRevision)D.fail('failed-precondition','材料設定已更新');
   const stamp=now(),revision=input.expectedRevision+1,contentHash=D.fingerprint(config),response={version:config.version,revision,contentHash};
   t.create(db.doc(versionPath(config.version)),{...config,contentHash,publishedBy:uid,publishedAt:stamp});t.set(db.doc(POINTER),{schemaVersion:1,activeVersion:config.version,revision,updatedBy:uid,updatedAt:stamp});t.create(priorRef,{fingerprint:hash,response,createdAt:stamp});t.create(db.doc('ops_audit/stone-'+D.hash(uid+':'+requestId)),{action:'publishRefinementStoneConfig',adminUid:uid,before:old.data()||null,after:response,createdAt:stamp,result:'success',requestId});return response;
  });
 }
 return{isEnabled,sampler,dailyPreview,daily,captureChest,openChest,authorizeGift,giftAvailable,readConfiguration,publishConfiguration};
}
module.exports={ITEM_ID,INVENTORY_KEY,MAX_QUANTITY,POINTER,versionPath,rule,defaults,validateRule,validate,active,createStoneRewardService};
