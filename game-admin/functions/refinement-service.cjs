/** Trusted, test-gated refinement service. No battle bonus integration. */
const crypto=require('node:crypto'),D=require('./domain.cjs'),W=require('./weapon-repository.cjs'),Core=require('./refinement-core.cjs'),Config=require('./refinement-config.cjs'),{reuseTransactionReads}=require('./transaction-reads.cjs');
const ACTIONS=new Set(['getRefinementStats','previewRefinement','refineWeapon','getRefinementResult']);
const intentPath=(actor,id)=>'ops_refinement_intents/'+D.hash(actor.uid+':'+id),receiptPath=(actor,id)=>'ops_refinement_transactions/'+D.hash(actor.uid+':'+id);
const failData=e=>({code:e.code,message:e.message,reason:e.reason||'VALIDATION_FAILED'});
const raise=data=>{const error=new D.OpsError(data.code,data.message);error.reason=data.reason;throw error;};
const quotePublic=q=>({quoteId:q.quoteId,instanceId:q.instanceId,weaponId:q.weaponId,configVersion:q.configVersion,configHash:q.configHash,expiresAt:q.expiresAt,baseStats:q.base,...q.view,eligibility:q.eligibility,coins:q.coins,stones:q.stones});
function createRefinementService({db,player,now=Date.now,enabled=()=>false,combatEnabled=()=>require('./weapon-instance-config.cjs').refinementCombatBonusEnabled,instanceEnabled=()=>false,trustedReady=()=>false,testEnvironment=false,testRandomInt=null,testHooks=null,testAccounts=[],releaseAdmission=null,releaseVersion=null}){
 if((testRandomInt||testHooks)&&testEnvironment!==true)throw Error('Refinement RNG/hooks are allowed only in an explicit isolated test harness');
 if(testRandomInt!==null&&typeof testRandomInt!=='function')throw Error('Invalid test RNG');
 const weapons=W.createWeaponRepository({db,enabled:instanceEnabled}),sample=()=>{const n=testRandomInt?testRandomInt(10000):crypto.randomInt(10000);return D.integer(n,0,9999);};
 const allowed=require('./refinement-access.cjs').testAccess(testEnvironment,testAccounts);
 const gate=async(t,actor)=>{if(!await trustedReady(t)||!(testEnvironment&&(!actor||allowed(actor))&&await enabled()&&await combatEnabled()&&await instanceEnabled()||actor&&releaseAdmission&&await releaseAdmission(t,actor)))Core.reject('FEATURE_DISABLED','武器精煉尚未開放');};
 function input(request){
  const p=request.data||{},action=D.enumValue(p.action,[...ACTIONS]);D.requestId(p.requestId);
  const fields=['previewRefinement','getRefinementStats'].includes(action)?['instanceId']:action==='refineWeapon'?['instanceId','expectedLevel','quoteId','configVersion']:['transactionId'];
  if(Object.keys(p).some(key=>!['action','requestId','groupId','battlePageId',...fields].includes(key)))D.fail('invalid-argument','請求含有未允許的欄位；不可指定成本、機率或結果');
  if(action==='getRefinementResult')D.requestId(p.transactionId);else D.id(p.instanceId);
  if(action==='refineWeapon'){D.integer(p.expectedLevel,0,9);D.id(p.quoteId);D.id(p.configVersion);}
  return p;
 }
 function conflict(t,actor,p,error,stamp){if(['CONFIG_CONFLICT','RATE_CAP_CONFLICT'].includes(error.reason))t.set(db.doc('ops_refinement_conflicts/'+D.hash(JSON.stringify([W.scope(actor),p.requestId]))),{ownerId:W.scope(actor),instanceId:p.instanceId,reason:error.reason,...(error.refinementConflict||{}),createdAt:stamp,requestId:p.requestId});}
 async function context(t,actor,id,stamp,currentOnly=false){
  const [snap,battle]=await Promise.all([t.get(db.doc(W.farmPath(actor))),t.get(db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)))]),farm=snap.data()?.farm;
  if(!W.isV2(farm)||farm.weaponMigrationState==='staging')Core.reject('INSTANCE_REQUIRED','請先完成武器個體化');
  if(!currentOnly&&battle.data()&&!battle.data().result)Core.reject('BATTLE_CONFLICT','戰鬥進行中，無法精煉');
  const header=await weapons.owner(t,actor,farm),item=await weapons.get(t,actor,farm,id,header),ref=db.doc(W.statePath(actor,id)),stateSnap=await t.get(ref);
  if(stateSnap.exists&&!header.hasRefinementStates)Core.reject('STATE_INVALID','武器個體狀態摘要不一致');
  const state=stateSnap.exists?Core.validateState(stateSnap.data(),item,header.generation):Core.initialState(item,header.generation);
  const active=currentOnly?null:await Config.active(db,t,stamp);let base=state.baseStatsSnapshot;if(!base||state.refineLevel===0){const balance=await require('./combat-balance.cjs').config(db,t);base=Core.baseSnapshot(balance.weapons[item.weaponId],balance.revision);}
  const view=currentOnly?null:Core.preview(state,active.config,base),coins=D.integer(farm.coins,0,Number.MAX_SAFE_INTEGER),stones=D.integer(farm.refinementStones??0,0,Number.MAX_SAFE_INTEGER);
  return{farm,header,item,state,ref,active,base,view,coins,stones,admissionVersion:releaseVersion?await releaseVersion(t,actor):null,eligibility:view?Core.eligibility(view,{coins,stones}):null};
 }
 const comparable=c=>({admissionVersion:c.admissionVersion,generation:c.header.generation,ownerRevision:c.header.revision,stateRevision:c.state.revision,epoch:c.state.refineEpoch,configVersion:c.active.config.version,configHash:c.active.contentHash,configRevision:c.active.revision,base:c.base,view:c.view});
 function validateQuote(q,c,actor,p,stamp){
  if(!q||q.ownerId!==W.scope(actor)||q.instanceId!==p.instanceId)Core.reject('QUOTE_INVALID','找不到此武器的有效報價');
  if(!q.binding||q.confirmationHash!==D.fingerprint(q.binding)||D.fingerprint(q.view)!==D.fingerprint(q.binding.view)||D.fingerprint(q.base)!==D.fingerprint(q.binding.base)||q.configVersion!==q.binding.configVersion||q.configHash!==q.binding.configHash)Core.reject('QUOTE_INVALID','報價內容不一致，請重新確認');
  if(q.configVersion!==p.configVersion||q.view.currentLevel!==p.expectedLevel||q.expiresAt<=stamp||q.confirmationHash!==D.fingerprint(comparable(c)))Core.reject('QUOTE_STALE','報價、等級或設定已改變，請重新確認');
  if(q.acceptedBy&&q.acceptedBy!==p.requestId)Core.reject('QUOTE_USED','報價已用於另一筆交易，請重新確認');
  if(!c.eligibility.eligible)Core.reject(c.eligibility.reasons[0],c.coins<c.view.cost.coins?'金幣不足，未扣款':'精煉石不足，未扣款');
 }
 async function handle(request,{admit}={}){
  const p=input(request);
  if(p.action==='previewRefinement'&&!releaseAdmission&&(!await enabled()||!await combatEnabled()||!await instanceEnabled()))Core.reject('FEATURE_DISABLED','武器精煉尚未開放');
  let admitted;
  const actorFor=async t=>{const a=await player(request,t);if(admit)await(admitted ||= admit(a));return a;};
  if(p.action==='getRefinementStats')return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction),actor=await actorFor(t),c=await context(t,actor,p.instanceId,now(),true);return{serverNow:now(),result:{instanceId:p.instanceId,refineLevel:c.state.refineLevel,refineBonus:c.state.refineBonus,refineBonusUnit:'basis-points',refineStatsVersion:c.state.refineStatsVersion,stats:Core.calculateStats(c.base,c.state.refineBonus)}};});
  if(p.action==='getRefinementResult')return db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction),actor=await actorFor(t),[receipt,intent]=await Promise.all([t.get(db.doc(receiptPath(actor,p.transactionId))),t.get(db.doc(intentPath(actor,p.transactionId)))]),row=receipt.data()||intent.data();
   if(!row)D.fail('not-found','找不到這筆精煉交易');if(row.ownerId!==W.scope(actor))D.fail('permission-denied','交易不屬於目前農場');
   return{serverNow:now(),result:receipt.exists?{status:'completed',...receipt.data().response}:intent.data().status==='rejected'?{status:'rejected',transactionId:p.transactionId,error:intent.data().error}:{status:'pending',transactionId:p.transactionId}};
  });
  if(p.action==='previewRefinement'){
   const result=await db.runTransaction(async transaction=>{
    const t=reuseTransactionReads(transaction),actor=await actorFor(t);await gate(t,actor);const stamp=now(),quoteId=D.hash(JSON.stringify([W.scope(actor),p.requestId])),ref=db.doc('ops_refinement_quotes/'+quoteId),prior=await t.get(ref);
    if(prior.exists){if(prior.data().instanceId!==p.instanceId||prior.data().ownerId!==W.scope(actor))D.fail('already-exists','報價識別碼已用於其他武器');return{result:quotePublic(prior.data()),serverNow:stamp,replayed:true};}
    try{const c=await context(t,actor,p.instanceId,stamp),q={quoteId,ownerId:W.scope(actor),instanceId:p.instanceId,weaponId:c.item.weaponId,configVersion:c.active.config.version,configHash:c.active.contentHash,confirmationHash:D.fingerprint(comparable(c)),binding:comparable(c),base:c.base,view:c.view,eligibility:c.eligibility,coins:c.coins,stones:c.stones,createdAt:stamp,expiresAt:stamp+120000};t.create(ref,q);return{result:quotePublic(q),serverNow:stamp};}
    catch(error){if(!(error instanceof D.OpsError))throw error;conflict(t,actor,p,error,stamp);return{error:failData(error)};}
   });if(result.error)raise(result.error);return result;
  }
  const canonical={instanceId:p.instanceId,expectedLevel:p.expectedLevel,quoteId:p.quoteId,configVersion:p.configVersion};let roll;
  const reserve=await db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction),actor=await actorFor(t),fingerprint=D.fingerprint({ownerId:W.scope(actor),...canonical}),ref=db.doc(intentPath(actor,p.requestId)),prior=await t.get(ref);
   if(prior.exists){if(prior.data().fingerprint!==fingerprint)D.fail('already-exists','交易編號已用於其他精煉請求');if(prior.data().status==='completed'){const receipt=(await t.get(db.doc(receiptPath(actor,p.requestId)))).data();if(!receipt||receipt.ownerId!==W.scope(actor)||receipt.fingerprint!==fingerprint)D.fail('failed-precondition','交易完成紀錄不一致');return{actor,intent:prior.data(),replay:receipt.response};}return{actor,intent:prior.data()};}
   await gate(t,actor);const stamp=now();let intent;
   try{const c=await context(t,actor,p.instanceId,stamp),qref=db.doc('ops_refinement_quotes/'+p.quoteId),q=(await t.get(qref)).data();validateQuote(q,c,actor,p,stamp);
    roll??=sample();intent={ownerId:W.scope(actor),requestId:p.requestId,fingerprint,...canonical,rollBp:roll,status:'pending',createdAt:stamp};t.update(qref,{acceptedBy:p.requestId});
   }catch(error){if(!(error instanceof D.OpsError))throw error;intent={ownerId:W.scope(actor),requestId:p.requestId,fingerprint,...canonical,status:'rejected',error:failData(error),createdAt:stamp};conflict(t,actor,p,error,stamp);}
   t.create(ref,intent);return{actor,intent};
  });
  if(reserve.replay)return{result:reserve.replay,serverNow:now(),replayed:true};
  if(reserve.intent.status==='rejected')raise(reserve.intent.error);
  if(reserve.intent.status==='pending')await testHooks?.afterIntent?.({requestId:p.requestId});
  const result=await db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction),actor=await actorFor(t),iref=db.doc(intentPath(actor,p.requestId)),rref=db.doc(receiptPath(actor,p.requestId)),[is,rs]=await Promise.all([t.get(iref),t.get(rref)]),intent=is.data(),fingerprint=D.fingerprint({ownerId:W.scope(actor),...canonical});
   if(!intent||intent.fingerprint!==fingerprint)D.fail('already-exists','交易識別碼不符');
   if(rs.exists){if(rs.data().fingerprint!==fingerprint||rs.data().ownerId!==W.scope(actor))D.fail('already-exists','交易識別碼不符');return{result:rs.data().response,serverNow:now(),replayed:true};}
   if(intent.status==='rejected')return{error:intent.error};if(intent.status!=='pending')D.fail('failed-precondition','交易狀態不一致，停止扣款');
   const stamp=now();
   try{
    await gate(t,actor);const c=await context(t,actor,p.instanceId,stamp),q=(await t.get(db.doc('ops_refinement_quotes/'+p.quoteId))).data();validateQuote(q,c,actor,p,stamp);
    const outcome=Core.attempt(c.state,c.view,{rollBp:intent.rollBp,version:c.active.config.version,base:c.base,stamp}),ownerRevision=D.integer(c.header.revision+1,0,Number.MAX_SAFE_INTEGER-1),nextFarm={...c.farm,coins:c.coins-c.view.cost.coins,refinementStones:c.stones-c.view.cost.stones,weaponInstanceRevision:ownerRevision};
    const response={transactionId:p.requestId,instanceId:p.instanceId,success:outcome.success,previousLevel:c.state.refineLevel,refineLevel:outcome.state.refineLevel,refineBonus:outcome.state.refineBonus,refineBonusUnit:'basis-points',configVersion:c.active.config.version,acquiredStatsVersion:outcome.state.refineStatsVersion,stateRevision:outcome.state.revision,ownerRevision,actualCost:c.view.cost,stats:Core.calculateStats(c.base,outcome.state.refineBonus),successfulRefineCost:outcome.state.successfulRefineCost,refineFailCount:outcome.state.refineFailCount,coins:nextFarm.coins,stones:nextFarm.refinementStones,completedAt:stamp};
    require('./refinement-wallet.cjs').record(t,db,{actor,id:p.requestId,fingerprint,action:'refineWeapon',before:{coins:c.coins,stones:c.stones},after:{coins:nextFarm.coins,stones:nextFarm.refinementStones},amount:c.view.cost,stamp});t.update(db.doc(W.farmPath(actor)),{farm:nextFarm});t.set(db.doc(W.ownerPath(actor)),{...c.header,revision:ownerRevision,hasRefinementStates:true,updatedAt:stamp});t.set(c.ref,outcome.state);t.create(rref,{analytics:{uid:actor.uid,groupId:actor.groupId,accountId:actor.accountId,weaponId:c.item.weaponId,beforeBonus:c.state.refineBonus,successRateBp:c.view.effectiveSuccessRateBp},ownerId:W.scope(actor),fingerprint,intentId:p.requestId,response,createdAt:stamp});t.set(iref,{...intent,status:'completed',completedAt:stamp});return{result:response,serverNow:stamp};
   }catch(error){if(!(error instanceof D.OpsError))throw error;conflict(t,actor,p,error,stamp);t.set(iref,{...intent,status:'rejected',error:failData(error),rejectedAt:stamp});return{error:failData(error)};}
  });if(result.error)raise(result.error);return result;
 }
 async function publishConfiguration(uid,input,requestId){
  D.requestId(requestId);return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction);await gate(t);const result=await Config.publish({db,t,uid,input,requestId,stamp:now()});result.commit();return result.response;});
 }
 async function readConfiguration(){return db.runTransaction(async transaction=>{const t=reuseTransactionReads(transaction),snap=await t.get(db.doc(Config.pointerPath));return snap.exists?{configured:true,...await Config.active(db,t,now())}:{configured:false,defaults:Core.defaults()};});}
 return{handle,publishConfiguration,readConfiguration};
}
module.exports={ACTIONS,intentPath,receiptPath,createRefinementService};
