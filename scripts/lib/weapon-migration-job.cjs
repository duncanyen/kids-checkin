/** Reviewed scoped coordinator. No project discovery, SDK initialization or deployment. */
const D=require('../../game-admin/functions/domain.cjs'),W=require('../../game-admin/functions/weapon-repository.cjs'),M=require('../../game-admin/functions/migrations/weapon-instances.cjs'),P=require('./weapon-migration-plan.cjs');
function createJob({db,plan,project,now=Date.now,beforeOperation=async()=>{}}){
 P.validate(plan,{project,now:now()});const rows=new Map(plan.scopes.map(r=>[P.scope(r.actor),r]));
 async function authorize(t,a,op){await beforeOperation();P.validate(plan,{project,now:now()});const row=rows.get(P.scope(a));if(!row||D.fingerprint(row.actor)!==D.fingerprint(a))D.fail('permission-denied','不在已審核scope');
  const [profile,group,owner,journal]=await Promise.all([t.get(db.doc('users/'+a.uid)),t.get(db.doc('groups/'+a.groupId)),t.get(db.doc(W.ownerPath(a))),t.get(db.doc('ops_refining_migrations/'+W.scope(a)))]);
  if(profile.data()?.accountId!==a.accountId||profile.data()?.role==='removed'||!group.data()?.members?.includes(a.accountId))D.fail('permission-denied','目前Profile或群組歸屬已變更');
  if(owner.exists&&owner.data().status!=='rolled-back'&&(owner.data().generation!==row.generation||journal.data()?.generation!==row.generation||journal.data()?.fingerprint!==row.fingerprint))D.fail('failed-precondition','其他世代或journal與計畫不符');
  if(journal.exists&&journal.data().generation===row.generation&&journal.data().status==='rolled-back'&&!['review','verify','rollback'].includes(op))D.fail('failed-precondition','已回復的世代不能再次使用，需新計畫');
 }
 const primitive=M.createWeaponMigration({db,now,authorize});
 async function review(){const results=[];for(const row of plan.scopes){try{const r=await primitive.review(row.actor);results.push({scope:W.scope(row.actor),...r,valid:r.valid&&(r.schemaVersion===2||r.fingerprint===row.fingerprint)});}catch(e){results.push({scope:W.scope(row.actor),valid:false,error:{code:e.code||'stopped',message:e.message}});}}return{readOnly:true,results};}
 async function step(row,{batchSize=20,operation='migrate'}={}){
  const approved=rows.get(P.scope(row.actor));if(!approved||D.fingerprint(approved)!==D.fingerprint(row))D.fail('permission-denied','操作列與已審核計畫不同');row=approved;
  if(!['migrate','verify','rollback'].includes(operation))throw Error('未知操作');
  if(operation==='verify')return primitive.verify(row.actor);if(operation==='rollback')return primitive.rollback(row.actor);
  const state=await db.runTransaction(async t=>{await authorize(t,row.actor,'review');const h=(await t.get(db.doc(W.ownerPath(row.actor)))).data();return h;});
  if(state?.generation===row.generation&&state.status==='active')return{...await primitive.verify(row.actor),status:'active',replayed:true};
  if(!state||state.status==='rolled-back'){const r=await primitive.stage(row.actor,{generation:row.generation,expectedFingerprint:row.fingerprint});if(r.quarantined)return r;}
  const r=await primitive.resume(row.actor,{batchSize});if(r.status==='active')return{...r,verification:await primitive.verify(row.actor)};return r;
 }
 async function run({operation='migrate',batchSize=20,maxBatches=1,onProgress=async()=>{}}={}){
  D.integer(batchSize,1,100);D.integer(maxBatches,1,10000);const results=[];let batches=0;
  for(const row of plan.scopes){let result;try{do{result=await step(row,{operation,batchSize});batches+=operation==='migrate'&&result.replayed?0:1;await onProgress({scope:W.scope(row.actor),...result});}while(operation==='migrate'&&result.status==='staging'&&batches<maxBatches);results.push({scope:W.scope(row.actor),...result});}catch(e){const issue={scope:W.scope(row.actor),status:'quarantined',error:{code:e.code||'stopped',message:e.message}};results.push(issue);await onProgress(issue);}
   if(operation==='migrate'&&batches>=maxBatches)break;
  }
  return{runId:plan.runId,planHash:P.hash(plan),operation,batches,complete:results.length===plan.scopes.length&&results.every(r=>operation==='migrate'?r.status==='active':operation==='verify'?r.valid:r.status==='rolled-back'),results};
 }
 return{review,run,step,exportScope:row=>require('../export-weapon-audit.cjs').collect({db,actor:row.actor,authorize})};
}
async function buildPlan({db,project,actors,runId,now=Date.now()}){
 if(!Array.isArray(actors)||actors.length<1||actors.length>50)throw Error('需1至50個明確scope');D.requestId(runId);const scopes=[];
 for(const raw of actors){const a=P.actor(raw),review=await db.runTransaction(async t=>{const [p,g,f]=await Promise.all([t.get(db.doc('users/'+a.uid)),t.get(db.doc('groups/'+a.groupId)),t.get(db.doc(W.farmPath(a)))]);if(p.data()?.accountId!==a.accountId||p.data()?.role==='removed'||!g.data()?.members?.includes(a.accountId))D.fail('permission-denied','scope身分／成員不一致');const farm=f.data()?.farm;if(W.isV2(farm)||farm?.weaponMigrationState==='staging')D.fail('failed-precondition','新計畫只盤點未移轉農場；續跑使用原計畫');return M.inspect(farm);},{readOnly:true});if(!review.valid||review.allocationCount>10000)throw Error('來源武器異常或超過單scope10000批次，停止建立計畫');scopes.push({actor:a,generation:P.generation(runId,a),fingerprint:review.fingerprint,counts:review.counts,allocationCount:review.allocationCount});}
 const plan={schemaVersion:1,kind:'weapon-migration-release',project,database:'(default)',runId,sourceHash:P.sourceHash(),createdAt:now,expiresAt:now+86400000,scopes};return P.validate(plan,{project,now});
}
module.exports={createJob,buildPlan};
