/** Server-only operations workspace. No player asset mutation or release-gate writes. */
const D=require('./domain.cjs'),Core=require('./refinement-core.cjs'),RC=require('./refinement-config.cjs'),Reset=require('./refinement-reset-config.cjs'),Stone=require('./refinement-stone-rewards.cjs');
const ACTIONS=new Set(['refinementOverview','refinementDrafts','refinementSaveDraft','refinementValidateDraft','refinementPublishDraft','refinementHistory','refinementRestoreDraft','refinementTransactions','refinementStatistics','refinementReconcile','refinementBuildSnapshot','refinementAuditStatistics']);
const readActions=new Set(['refinementOverview','refinementDrafts','refinementHistory','refinementTransactions','refinementStatistics']);
const channels={refining:{pointer:RC.pointerPath,path:RC.versionPath,validate:Core.validateConfig,defaults:Core.defaults},reset:{pointer:Reset.pointerPath,path:Reset.versionPath,validate:Reset.validate,defaults:Reset.defaults},stones:{pointer:Stone.POINTER,path:Stone.versionPath,validate:Stone.validate,defaults:Stone.defaults}};
function permissions(user){return Object.fromEntries(['read','edit','publish','risk'].map(k=>[k,user.customClaims?.role==='admin'&&Array.isArray(user.customClaims?.refinementPermissions)&&user.customClaims.refinementPermissions.includes(k)]));}
function requirePermission(grants,k){if(!grants[k])D.fail('permission-denied','缺少精煉營運權限：'+k);}
function validateBundle(raw){if(!raw||Object.keys(raw).sort().join(',')!=='refining,reset,stones')D.fail('invalid-argument','設定必須包含精煉、解除與材料三部分');return Object.fromEntries(Object.entries(channels).map(([k,c])=>[k,c.validate(raw[k])]));}
const reason=v=>{const s=D.text(v,500);if(s.length<4)D.fail('invalid-argument','修改原因至少4字');return s;};
function risks(bundle,before){if(!before)return ['首次建立設定（不開啟正式功能旗標）'];const changed=[];if(bundle.reset.enabled!==before.reset.enabled)changed.push('解除精煉開關');for(let i=0;i<9;i++){const a=bundle.refining.levels[i],b=before.refining.levels[i];if(JSON.stringify(a.pity)!==JSON.stringify(b.pity))changed.push(`+${i+1}保底變更：保留既有目標失敗累計，新門檻套用下一次報價`);if((a.enabled!==false)!==(b.enabled!==false))changed.push(`+${i+1}開放狀態`);}for(const k of ['checkin','mission','gift','chests'])if(JSON.stringify(bundle.stones[k])!==JSON.stringify(before.stones[k]))changed.push('材料來源 '+k);return changed;}
function historyConflicts(bundle,versions){const conflicts=[];for(const old of versions)for(let level=1;level<9;level++)for(const key of ['attack','criticalRate','chainCriticalRate'])if(bundle.refining.levels[level].bonus[key]<old.levels[level-1].bonus[key])conflicts.push({acquiredVersion:old.version,currentLevel:level,targetLevel:level+1,key,acquired:old.levels[level-1].bonus[key],proposed:bundle.refining.levels[level].bonus[key]});return conflicts;}
function createRefinementOperations({db,now=Date.now,statistics}){
 async function current(t){const bundle={},revisions={};for(const [key,c]of Object.entries(channels)){const p=(await t.get(db.doc(c.pointer))).data();revisions[key]=p?.revision||0;if(p){const v=(await t.get(db.doc(c.path(p.activeVersion)))).data();if(!v)D.fail('failed-precondition','生效設定缺失');bundle[key]=c.validate(v);if(v.contentHash!==D.fingerprint(bundle[key]))D.fail('failed-precondition','生效設定雜湊不符');}else bundle[key]=c.defaults();}return{bundle,revisions};}
 async function inspect(t,draft){const active=await current(t);if(D.fingerprint(active.revisions)!==D.fingerprint(draft.expectedRevisions))D.fail('failed-precondition','生效設定已更新，請重新建立或儲存草稿');const q=await t.get(db.collection('ops_refinement_versions').limit(101));if(q.size>100)D.fail('resource-exhausted','歷史能力檢查超過100版，需先建立可驗證的歷史上限摘要');const versions=q.docs.map(r=>Core.validateConfig(r.data()));const conflicts=historyConflicts(draft.bundle,versions);return{...active,conflicts,risks:[...(Object.values(active.revisions).every(v=>v===0)?['首次建立設定（不開啟正式功能旗標）']:[]),...risks(draft.bundle,active.bundle)],pityPolicy:'preserve-target-failures',existingAbilities:'保留個體快照；新費用、成功率及退款只套用新報價',affectedHistoricalVersions:versions.length};}
 async function handle({uid,user,action,payload={},requestId}){
  const grants=permissions(user);requirePermission(grants,'read');
  if(action==='refinementOverview')return db.runTransaction(async t=>({...await current(t),permissions:grants,releaseGates:Object.fromEntries(Object.entries(require('./weapon-instance-config.cjs'))),asOf:now()}));
  if(action==='refinementStatistics')return statistics.dashboard(payload);
  if(action==='refinementTransactions')return statistics.transactions(payload);
  if(action==='refinementAuditStatistics'){requirePermission(grants,'edit');return statistics.audit(payload);}
  if(action==='refinementBuildSnapshot'){requirePermission(grants,'edit');return require('./refinement-snapshots.cjs').createSnapshots({db,now}).build(payload);}
  if(action==='refinementReconcile'){requirePermission(grants,'edit');return statistics.reconcile(payload);}
  if(['refinementDrafts','refinementHistory'].includes(action)){const col=action==='refinementDrafts'?'ops_refinement_drafts':'ops_refinement_releases',q=db.collection(col).orderBy('createdAt','desc').limit(26);let query=q;if(payload.cursor){const p=await db.doc(col+'/'+D.id(payload.cursor)).get();if(!p.exists)D.fail('invalid-argument','分頁游標不存在');query=q.startAfter(p);}const r=await query.get(),rows=r.docs.slice(0,25).map(d=>({id:d.id,...d.data()}));return{rows,nextCursor:r.size>25?rows.at(-1).id:null};}
  requirePermission(grants,action==='refinementPublishDraft'?'publish':action==='refinementValidateDraft'?'read':'edit');D.requestId(requestId);
  const requestRef=db.doc('ops_refinement_admin_requests/'+D.hash(uid+':'+requestId)),fingerprint=D.fingerprint({action,payload});
  return db.runTransaction(async t=>{
   const prior=await t.get(requestRef);if(prior.exists){if(prior.data().fingerprint!==fingerprint)D.fail('already-exists','請求編號已用於其他內容');return{...prior.data().response,replayed:true};}
   let response;const writes=[];const stamp=now(),audit={adminUid:uid,action,requestId,createdAt:stamp,result:'success'};
   if(['refinementSaveDraft','refinementRestoreDraft'].includes(action)){
    let input=payload.bundle,restoredFrom=null;if(action==='refinementRestoreDraft'){const v=await t.get(db.doc('ops_refinement_releases/'+D.id(payload.releaseId)));if(!v.exists)D.fail('not-found','歷史發布不存在');input=v.data().after;restoredFrom=v.id;}
    const bundle=validateBundle(input),active=await current(t),id=payload.draftId?D.id(payload.draftId):D.hash(uid+':'+requestId),ref=db.doc('ops_refinement_drafts/'+id),old=await t.get(ref);
    if(old.exists&&(old.data().status!=='draft'||payload.expectedRevision!==old.data().revision))D.fail('failed-precondition','草稿已變更或已發布');
    const row={bundle,expectedRevisions:active.revisions,reason:reason(payload.reason),revision:(old.data()?.revision||0)+1,status:'draft',modifiedBy:uid,modifiedAt:stamp,createdAt:old.data()?.createdAt||stamp,restoredFrom};
    audit.before=old.data()||null;audit.after=row;writes.push(()=>t.set(ref,row));response={id,revision:row.revision};
   }else{
    const ref=db.doc('ops_refinement_drafts/'+D.id(payload.draftId)),raw=await t.get(ref);if(!raw.exists||raw.data().status!=='draft')D.fail('failed-precondition','草稿不存在或已發布');const draft=raw.data();if(draft.revision!==payload.expectedRevision)D.fail('failed-precondition','草稿版本已更新');draft.bundle=validateBundle(draft.bundle);const impact=await inspect(t,draft),validationHash=D.fingerprint({draft,impact});
    if(action==='refinementValidateDraft'){response={draftId:ref.id,revision:draft.revision,validationHash,...impact,publishable:impact.conflicts.length===0};}
    else if(action==='refinementPublishDraft'){
     if(payload.validationHash!==validationHash||payload.confirm!==true)D.fail('failed-precondition','請先驗證並確認最新影響預覽');if(impact.conflicts.length)D.fail('failed-precondition','新能力低於歷史已取得能力，禁止發布');if(impact.risks.length)requirePermission(grants,'risk');
     if(draft.bundle.refining.levels.some((r,i)=>JSON.stringify(r.pity)!==JSON.stringify(impact.bundle.refining.levels[i].pity))&&payload.pityPolicy!=='preserve-target-failures')D.fail('invalid-argument','必須確認保留既有保底失敗進度');
     const id=D.hash(uid+':'+requestId),after={},revisions={};for(const [key,c]of Object.entries(channels)){const config=c.validate({...draft.bundle[key],version:'ops-'+id,effectiveAt:stamp}),vref=db.doc(c.path(config.version));if((await t.get(vref)).exists)D.fail('already-exists','版本已存在');after[key]=config;revisions[key]=impact.revisions[key]+1;writes.push(()=>{t.create(vref,{...config,contentHash:D.fingerprint(config),publishedBy:uid,publishedAt:stamp});t.set(db.doc(c.pointer),{schemaVersion:1,activeVersion:config.version,revision:revisions[key],updatedBy:uid,updatedAt:stamp});});}
     const release={version:'ops-'+id,before:impact.bundle,after,modifiedBy:draft.modifiedBy,modifiedAt:draft.modifiedAt,publishedBy:uid,publishedAt:stamp,effectiveAt:stamp,createdAt:stamp,reason:draft.reason,status:'published',draftId:ref.id,restoredFrom:draft.restoredFrom,pityPolicy:'preserve-target-failures',revisions};
     writes.push(()=>{t.create(db.doc('ops_refinement_releases/'+id),release);t.update(ref,{status:'published',releaseId:id,publishedAt:stamp});});audit.before=impact.bundle;audit.after=after;response={releaseId:id,version:release.version,revisions,effectiveAt:stamp};
    }else D.fail('invalid-argument','未知精煉管理操作');
   }
   writes.forEach(fn=>fn());t.create(requestRef,{fingerprint,response,createdAt:stamp});t.create(db.doc('ops_audit/refinement-ops-'+D.hash(uid+':'+requestId)),audit);return response;
  });
 }
 return{handle};
}
module.exports={ACTIONS,permissions,requirePermission,validateBundle,historyConflicts,risks,createRefinementOperations};
