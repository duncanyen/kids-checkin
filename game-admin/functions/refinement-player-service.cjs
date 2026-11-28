/** Phase 5 read/detail and deterministic reset transactions; never applies combat bonuses. */
const D=require('./domain.cjs'),W=require('./weapon-repository.cjs'),Core=require('./refinement-core.cjs'),Config=require('./refinement-reset-config.cjs'),R=require('./refinement-service.cjs'),{reuseTransactionReads}=require('./transaction-reads.cjs');
const ACTIONS=new Set(['getRefinementCapabilities','getWeaponDetails','previewRefinementReset','resetRefinement','getRefinementResetResult']);
const refund=(amount,bp)=>Number(BigInt(D.integer(amount,0,Number.MAX_SAFE_INTEGER))*BigInt(bp)/10000n);
function resetState(state,stamp){return{...state,revision:D.integer(state.revision+1,0,Number.MAX_SAFE_INTEGER-1),refineEpoch:D.integer(state.refineEpoch+1,0,Number.MAX_SAFE_INTEGER-1),refineLevel:0,refineBonus:Core.zeroBonus(),refineStatsVersion:null,refineFailCount:0,failuresByTarget:{},successfulRefineCost:{coins:0,stones:0},failedRefineCost:{coins:0,stones:0},baseStatsSnapshot:null,updatedAt:stamp};}
function createRefinementPlayerService({db,player,now=Date.now,enabled=()=>false,resetEnabled=()=>false,combatEnabled=()=>require('./weapon-instance-config.cjs').refinementCombatBonusEnabled,instanceEnabled=()=>false,trustedReady=()=>false,testEnvironment=false,testAccounts=[],releaseDecision=null}){
 const allowed=require('./refinement-access.cjs').testAccess(testEnvironment,testAccounts),weapons=W.createWeaponRepository({db,enabled:instanceEnabled});
 async function gate(t,actor){if(!await trustedReady(t)||!(allowed(actor)&&await resetEnabled()&&await combatEnabled()&&await instanceEnabled()||releaseDecision&&(await releaseDecision(t,actor)).flags.reset))Core.reject('FEATURE_DISABLED','解除精煉尚未開放此農場');}
 async function capabilities(t,actor){const tester=allowed(actor),release=releaseDecision?await releaseDecision(t,actor):null,legacyReady=tester&&await instanceEnabled()&&await trustedReady(t),farm=(await t.get(db.doc(W.farmPath(actor)))).data()?.farm,v2=W.isV2(farm)&&farm.weaponMigrationState!=='staging',productionReady=v2&&release?.admitted&&release.flags.instances&&await trustedReady(t),ready=legacyReady||productionReady,battle=v2?(await t.get(db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)))).data():null;return{detailsAvailable:true,testAccount:tester,releaseAdmitted:!!productionReady,releaseVersion:release?.version||null,refinementEnabled:!!(legacyReady&&await enabled()&&await combatEnabled()||productionReady&&release.flags.refinement),resetEnabled:!!(legacyReady&&await resetEnabled()&&await combatEnabled()||productionReady&&release.flags.reset),refinedSalesEnabled:v2,battleLocked:!!battle&&!battle.result,combatBonusEnabled:!!(v2||await combatEnabled())};}

 async function context(t,actor,id,stamp,forReset=false){
  const [farmSnap,battleSnap]=await Promise.all([t.get(db.doc(W.farmPath(actor))),t.get(db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)))]),farm=farmSnap.data()?.farm;
  if(!W.isV2(farm)||farm.weaponMigrationState==='staging')Core.reject('INSTANCE_REQUIRED','請先完成武器個體化');
  const header=await weapons.owner(t,actor,farm),item=await weapons.get(t,actor,farm,id,header),ref=db.doc(W.statePath(actor,id)),raw=(await t.get(ref)).data(),state=raw?Core.validateState(raw,item,header.generation):Core.initialState(item,header.generation),balance=await require('./combat-balance.cjs').config(db,t),base=Core.baseSnapshot(balance.weapons[item.weaponId],balance.revision),currentBase=Core.effectiveBase(state,base),battle=battleSnap.data();
  if(raw&&!header.hasRefinementStates)Core.reject('STATE_INVALID','武器狀態摘要不一致');
  if(forReset&&battle&&!battle.result)Core.reject('BATTLE_CONFLICT','戰鬥中不能解除精煉');
  return{farm,header,item,ref,state,base,currentBase,battle,admissionVersion:releaseDecision?(await releaseDecision(t,actor)).version:null,stats:Core.calculateStats(currentBase,state.refineBonus),coins:D.integer(farm.coins,0,Number.MAX_SAFE_INTEGER),stones:D.integer(farm.refinementStones??0,0,Number.MAX_SAFE_INTEGER)};
 }
 function binding(c,active){return{admissionVersion:c.admissionVersion,instanceId:c.item.instanceId,ownerRevision:c.header.revision,generation:c.header.generation,stateRevision:c.state.revision,epoch:c.state.refineEpoch,level:c.state.refineLevel,bonus:c.state.refineBonus,successfulCost:c.state.successfulRefineCost,failedCost:c.state.failedRefineCost,configVersion:active.config.version,configHash:active.contentHash,configRevision:active.revision,base:c.base,currentBase:c.currentBase};}
 async function handle(request,{admit}={}){
  const p=request.data||{},action=D.enumValue(p.action,[...ACTIONS]);D.requestId(p.requestId);
  const fields=action==='getRefinementCapabilities'?[]:action==='getRefinementResetResult'?['transactionId']:action==='resetRefinement'?['instanceId','expectedLevel','quoteId','configVersion']:['instanceId'];
  if(Object.keys(p).some(k=>!['action','requestId','groupId','battlePageId',...fields].includes(k)))D.fail('invalid-argument','不可指定退款金額或武器能力');
  if(action==='getRefinementResetResult')D.requestId(p.transactionId);else if(action!=='getRefinementCapabilities')D.id(p.instanceId);
  if(action==='resetRefinement'){D.integer(p.expectedLevel,1,9);D.id(p.quoteId);D.id(p.configVersion);}
  let admitted;
  return db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction),actor=await player(request,t),stamp=now();if(admit)await(admitted ||= admit(actor));
   if(action==='getRefinementCapabilities')return{serverNow:stamp,result:await capabilities(t,actor)};
   if(action==='getRefinementResetResult'){
    const r=(await t.get(db.doc(R.receiptPath(actor,p.transactionId)))).data();if(!r)D.fail('not-found','找不到已完成的解除交易；可用原交易重試');if(r.ownerId!==W.scope(actor)||r.response?.action!=='resetRefinement')D.fail('permission-denied','交易種類或農場不符');return{serverNow:stamp,result:{status:'completed',...r.response}};
   }
   if(action==='getWeaponDetails'){
    const c=await context(t,actor,p.instanceId,stamp),rules=await import('./game/combat-rules.js'),catalog=rules.WEAPONS_CONFIG[c.item.weaponId];return{serverNow:stamp,result:{...c.item,baseStats:c.currentBase,stats:c.stats,attackBonus:c.stats.attack-c.currentBase.attack,coins:c.coins,stones:c.stones,capabilities:{...await capabilities(t,actor),existingBonusRetained:c.state.refineLevel>0},locked:!!c.battle&&!c.battle.result,restrictions:{ranged:!!catalog.ranged,allowedMonsters:Object.entries(catalog.damageByEnemy||{}).filter(([,damage])=>damage>0).map(([id])=>id),sellPrice:catalog.sellPrice||0,bound:c.item.bound},refineEpoch:c.state.refineEpoch}};
   }
   const receiptRef=db.doc(R.receiptPath(actor,p.requestId)),intentRef=db.doc(R.intentPath(actor,p.requestId)),canonical={action,instanceId:p.instanceId,expectedLevel:p.expectedLevel,quoteId:p.quoteId,configVersion:p.configVersion};
   // Preview carries no undefined Firestore fields and never writes an economic intent.
   let fingerprint;
   if(action==='resetRefinement'){
    fingerprint=D.fingerprint({ownerId:W.scope(actor),...canonical});const [receipt,intent]=await Promise.all([t.get(receiptRef),t.get(intentRef)]);
    if(receipt.exists){const row=receipt.data();if(row.ownerId!==W.scope(actor)||row.fingerprint!==fingerprint)D.fail('already-exists','交易編號已用於其他操作');return{serverNow:stamp,result:row.response,replayed:true};}
    if(intent.exists)D.fail('already-exists','交易編號已用於其他精煉操作');
   }
   await gate(t,actor);const c=await context(t,actor,p.instanceId,stamp,true);if(c.state.refineLevel===0)Core.reject('RESET_ZERO_LEVEL','+0武器不可解除精煉');
   const active=await Config.active(db,t,stamp);if(!active.config.enabled)Core.reject('FEATURE_DISABLED','解除精煉設定已關閉');
   const bound=binding(c,active),refunds={coins:refund(c.state.successfulRefineCost.coins,active.config.coinsRefundBp),stones:refund(c.state.successfulRefineCost.stones,active.config.stonesRefundBp)};
   if(action==='previewRefinementReset'){
    const quoteId=D.hash(JSON.stringify([W.scope(actor),p.requestId])),ref=db.doc('ops_refinement_reset_quotes/'+quoteId),prior=(await t.get(ref)).data();
    if(prior){if(prior.ownerId!==W.scope(actor)||prior.instanceId!==p.instanceId)D.fail('already-exists','報價編號已使用');return{serverNow:stamp,result:prior.public,replayed:true};}
    const view={quoteId,instanceId:p.instanceId,weaponId:c.item.weaponId,currentLevel:c.state.refineLevel,targetLevel:0,configVersion:active.config.version,configHash:active.contentHash,currentStats:c.stats,nextStats:Core.calculateStats(c.base),refund:refunds,successfulCost:c.state.successfulRefineCost,coinsRefundBp:active.config.coinsRefundBp,stonesRefundBp:active.config.stonesRefundBp,expiresAt:stamp+120000};
    t.create(ref,{ownerId:W.scope(actor),instanceId:p.instanceId,binding:bound,bindingHash:D.fingerprint(bound),public:view,publicHash:D.fingerprint(view),createdAt:stamp});return{serverNow:stamp,result:view};
   }
   const quoteRef=db.doc('ops_refinement_reset_quotes/'+p.quoteId),q=(await t.get(quoteRef)).data();
   if(!q||q.ownerId!==W.scope(actor)||q.instanceId!==p.instanceId||q.bindingHash!==D.fingerprint(q.binding)||q.publicHash!==D.fingerprint(q.public))Core.reject('QUOTE_INVALID','退款報價不一致，請重新確認');
   if(q.public.expiresAt<=stamp||q.public.configVersion!==p.configVersion||q.public.currentLevel!==p.expectedLevel||q.bindingHash!==D.fingerprint(bound)||D.fingerprint(q.public.refund)!==D.fingerprint(refunds)||q.acceptedBy)Core.reject('QUOTE_STALE','武器、歷史成本或退款設定已改變，請重新確認');
   if(!Number.isSafeInteger(c.coins+refunds.coins)||!Number.isSafeInteger(c.stones+refunds.stones))Core.reject('BALANCE_OVERFLOW','餘額超出安全範圍，尚未解除');
   const nextState=resetState(c.state,stamp),revision=D.integer(c.header.revision+1,0,Number.MAX_SAFE_INTEGER-1),nextFarm={...c.farm,coins:c.coins+refunds.coins,refinementStones:c.stones+refunds.stones,weaponInstanceRevision:revision};
   const response={action:'resetRefinement',transactionId:p.requestId,instanceId:p.instanceId,previousLevel:c.state.refineLevel,refineLevel:0,refineBonus:Core.zeroBonus(),refineStatsVersion:null,refineEpoch:nextState.refineEpoch,ownerRevision:revision,stateRevision:nextState.revision,configVersion:active.config.version,refund:refunds,successfulCost:c.state.successfulRefineCost,excludedFailedCost:c.state.failedRefineCost,coins:nextFarm.coins,stones:nextFarm.refinementStones,stats:Core.calculateStats(c.base),completedAt:stamp};
   require('./refinement-wallet.cjs').record(t,db,{actor,id:p.requestId,fingerprint,action:'resetRefinement',before:{coins:c.coins,stones:c.stones},after:{coins:nextFarm.coins,stones:nextFarm.refinementStones},amount:refunds,stamp});t.update(db.doc(W.farmPath(actor)),{farm:nextFarm});t.set(db.doc(W.ownerPath(actor)),{...c.header,revision,hasRefinementStates:true,updatedAt:stamp});t.set(c.ref,nextState);t.update(quoteRef,{acceptedBy:p.requestId});t.create(receiptRef,{analytics:{uid:actor.uid,groupId:actor.groupId,accountId:actor.accountId,weaponId:c.item.weaponId},ownerId:W.scope(actor),fingerprint,response,beforeState:c.state,createdAt:stamp});t.create(intentRef,{ownerId:W.scope(actor),fingerprint,status:'completed',action,requestId:p.requestId,completedAt:stamp});return{serverNow:stamp,result:response};
  });
 }
 async function readConfiguration(){return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction),p=await t.get(db.doc(Config.pointerPath));return p.exists?{configured:true,...await Config.active(db,t,now())}:{configured:false,defaults:Config.defaults()};});}
 async function publishConfiguration(uid,input,requestId){return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction);if(!testEnvironment||!await resetEnabled()||!await combatEnabled()||!await instanceEnabled()||!await trustedReady(t))Core.reject('FEATURE_DISABLED','解除設定僅在隔離測試開放');const prepared=await Config.publish({db,t,uid,input,requestId,stamp:now()});prepared.commit();return prepared.response;});}
 return{handle,readConfiguration,publishConfiguration};
}
module.exports={ACTIONS,refund,resetState,createRefinementPlayerService};
