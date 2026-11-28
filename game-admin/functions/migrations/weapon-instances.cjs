/** Server-side migration primitive. CLI supplies reviewed scope authorization; defaults remain closed. */
const D=require('../domain.cjs'),W=require('../weapon-repository.cjs');
function inspect(farm){
 try{
  if(!farm||typeof farm!=='object')throw Error('缺少農場');
  if(farm.weaponSchemaVersion!==undefined&&![1,2].includes(farm.weaponSchemaVersion))throw Error('不支援的武器版本');
  const count=W.counts(farm),melee=farm.equippedWeapon||'club',bow=farm.equippedBow||null;
  if(melee!=='club'&&(!W.WEAPON_IDS.includes(melee)||W.RANGED.has(melee)||!count[melee]))throw Error('近戰裝備無效');
  if(bow&&(!W.RANGED.has(bow)||!count[bow]))throw Error('遠程裝備無效');
  const total=Object.values(count).reduce((a,b)=>a+b,0);if(!Number.isSafeInteger(total))throw Error('總量超出安全整數');
  return{valid:true,counts:count,total,allocationCount:Object.values(count).reduce((n,q)=>n+Math.ceil(q/W.BATCH_SIZE),0),fingerprint:W.signature(farm),equippedWeapon:melee,equippedBow:bow};
 }catch{return{valid:false,issues:['武器數量、農場或裝備資料異常；停止移轉並隔離，不自動修正']};}
}
function createWeaponMigration({db,now=Date.now,testEnvironment=false,authorize=null}){
 const safe=async(t,actor,operation)=>{Object.values({uid:actor?.uid,groupId:actor?.groupId,accountId:actor?.accountId}).forEach(D.id);if(authorize){await authorize(t,actor,operation);return;}if(testEnvironment!==true)D.fail('permission-denied','移轉需明確隔離環境或可信任作業授權');};
 const journal=actor=>db.doc('ops_refining_migrations/'+W.scope(actor));
 const headerRef=actor=>db.doc(W.ownerPath(actor));
 const member=actor=>db.doc(W.farmPath(actor));
 async function review(actor){return db.runTransaction(async t=>{await safe(t,actor,'review');const farm=(await t.get(member(actor))).data()?.farm;return{...inspect(farm),schemaVersion:farm?.weaponSchemaVersion||1,ownerId:W.scope(actor)};},{readOnly:true});}
 async function stage(actor,{generation,expectedFingerprint}={}){
  D.requestId(generation);
  return db.runTransaction(async t=>{
   await safe(t,actor,'stage');
   const [snap,old,active]=await Promise.all([t.get(member(actor)),t.get(headerRef(actor)),t.get(db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)))]),farm=snap.data()?.farm,plan=inspect(farm),stamp=now();
   if(!plan.valid){t.set(db.doc('ops_weapon_quarantine/'+W.scope(actor)),{ownerId:W.scope(actor),issues:plan.issues,createdAt:stamp});return{quarantined:true,issues:plan.issues};}
   if(plan.fingerprint!==expectedFingerprint)D.fail('failed-precondition','來源指紋已變更，請重新 dry-run');
   if(old.exists&&old.data().generation===generation&&['staging','active'].includes(old.data().status))return{status:old.data().status,resumed:true};
   if(old.exists&&old.data().status!=='rolled-back')D.fail('failed-precondition','已有不同或不一致的武器世代，停止重建');
   if(W.isV2(farm)||farm.weaponMigrationState==='staging')D.fail('failed-precondition','已有個體或其他移轉作業');
   if(old.exists&&old.data().generation===generation)D.fail('failed-precondition','回復後請使用新的 generation');
   if(active.data()&&!active.data().result)D.fail('failed-precondition','請先結束戰鬥再移轉');
   const h={schemaVersion:2,instanceIdVersion:2,ownerId:W.scope(actor),profileId:actor.uid,groupId:actor.groupId,accountId:actor.accountId,generation,status:'staging',counts:plan.counts,revision:0,equippedWeapon:plan.equippedWeapon,equippedBow:plan.equippedBow,equippedMeleeInstanceId:plan.equippedWeapon==='club'?W.clubId(actor):W.instanceId(W.allocationId(generation,'migration',plan.equippedWeapon,0,W.scope(actor)),0),equippedBowInstanceId:plan.equippedBow?W.instanceId(W.allocationId(generation,'migration',plan.equippedBow,0,W.scope(actor)),0):null,createdAt:stamp,updatedAt:stamp};
   t.set(headerRef(actor),h);t.set(journal(actor),{generation,instanceIdVersion:2,status:'staging',fingerprint:plan.fingerprint,sourceSnapshot:{counts:plan.counts,equippedWeapon:farm.equippedWeapon??null,equippedBow:farm.equippedBow??null,schemaVersion:farm.weaponSchemaVersion??null},counts:plan.counts,total:plan.total,allocationCount:plan.allocationCount,completed:0,validatedCounts:Object.fromEntries(W.WEAPON_IDS.map(id=>[id,0])),createdAt:stamp,updatedAt:stamp});
   t.update(member(actor),{farm:{...farm,weaponMigrationState:'staging'}});
   return{status:'staging',total:plan.total,allocationCount:plan.allocationCount};
  });
 }
 async function resume(actor,{batchSize=20}={}){
  D.integer(batchSize,1,100);
  return db.runTransaction(async t=>{
   await safe(t,actor,'resume');
   const [snap,hs,js]=await Promise.all([t.get(member(actor)),t.get(headerRef(actor)),t.get(journal(actor))]),farm=snap.data()?.farm,h=hs.data(),j=js.data(),stamp=now();W.assertOwner(actor,h);
   if(h.status==='active')return{status:'active',replayed:true};
   if(h.instanceIdVersion!==2||j?.instanceIdVersion!==2)D.fail('failed-precondition','舊移轉ID算法已停用；請先安全回復測試移轉，再使用新generation');
   if(h.status!=='staging'||j?.generation!==h.generation||farm.weaponMigrationState!=='staging'||W.signature(farm)!==j.fingerprint)D.fail('failed-precondition','移轉來源已變更，停止以免覆蓋資產');
   D.integer(j.completed,0,j.allocationCount);D.integer(j.allocationCount,0,10000);if(D.fingerprint(j.counts)!==D.fingerprint(h.counts)||Object.values(j.counts).some(n=>!Number.isSafeInteger(n)||n<0)||inspect(farm).allocationCount!==j.allocationCount)D.fail('failed-precondition','移轉進度或數量摘要異常');
   const rows=[];let ordinal=0;
   for(const id of W.WEAPON_IDS){
    const chunks=Math.ceil(j.counts[id]/W.BATCH_SIZE),first=Math.max(0,j.completed-ordinal),last=Math.min(chunks,first+batchSize-rows.length);
    for(let chunk=first;chunk<last;chunk++){const start=chunk*W.BATCH_SIZE,aid=W.allocationId(h.generation,'migration',id,chunk,W.scope(actor));rows.push({id:aid,ownerId:W.scope(actor),generation:h.generation,weaponId:id,quantity:Math.min(W.BATCH_SIZE,j.counts[id]-start),removed:[],schemaVersion:2,createdAt:h.createdAt,updatedAt:h.createdAt,source:'migration'});}
    ordinal+=chunks;if(rows.length===batchSize)break;
   }
   const previous=await Promise.all(rows.map(row=>t.get(db.doc(W.ownerPath(actor)+'/allocations/'+row.id))));
   const validated={...j.validatedCounts};rows.forEach((row,i)=>{if(previous[i].exists&&D.fingerprint(previous[i].data())!==D.fingerprint(row))D.fail('failed-precondition','已存在個體批次不一致');validated[row.weaponId]+=row.quantity;});
   const completed=j.completed+rows.length,done=completed===j.allocationCount;
   if(done&&D.fingerprint(validated)!==D.fingerprint(j.counts))D.fail('failed-precondition','武器數量核對失敗');
   // Never activate solely on a progress counter: inspect the actual persisted allocations.
   if(done){const persisted=new Map();let q=db.collection(W.ownerPath(actor)+'/allocations').orderBy('__name__'),scanned=0;while(true){const page=await t.get(q.limit(100));for(const doc of page.docs){if(++scanned>25000)D.fail('failed-precondition','歷史批次超過安全上限，需分開審查');if(doc.data().generation===h.generation)persisted.set(doc.id,doc.data());}if(page.docs.length<100)break;q=q.startAfter(page.docs.at(-1));}for(const row of rows)persisted.set(row.id,row);let expected=0;for(const id of W.WEAPON_IDS)for(const row of W.allocations(actor,h,'migration',id,j.counts[id],h.createdAt)){expected++;if(D.fingerprint(persisted.get(row.id)||null)!==D.fingerprint(row))D.fail('failed-precondition','已完成批次遺失或遭修改，不啟用新版資料');}if(persisted.size!==expected)D.fail('failed-precondition','存在未預期的移轉個體批次');}

   rows.forEach((row,i)=>{if(!previous[i].exists)t.create(db.doc(W.ownerPath(actor)+'/allocations/'+row.id),row);});
   t.set(journal(actor),{...j,completed,validatedCounts:validated,status:done?'active':'staging',updatedAt:stamp});
   if(done){t.set(headerRef(actor),{...h,status:'active',updatedAt:stamp});t.update(member(actor),{farm:{...farm,weaponSchemaVersion:2,weaponGeneration:h.generation,weaponInstanceRevision:0,weaponMigrationState:'complete',equippedWeapon:h.equippedWeapon,equippedBow:h.equippedBow}});}
   return{status:done?'active':'staging',completed,totalAllocations:j.allocationCount,validatedCounts:validated};
  });
 }
 async function verify(actor){
  return db.runTransaction(async t=>{
   await safe(t,actor,'verify');
   const [snap,hs,js]=await Promise.all([t.get(member(actor)),t.get(headerRef(actor)),t.get(journal(actor))]),farm=snap.data()?.farm,h=hs.data(),j=js.data();W.assertOwner(actor,h);
   let q=db.collection(W.ownerPath(actor)+'/allocations').orderBy('__name__'),allCounts=Object.fromEntries(W.WEAPON_IDS.map(id=>[id,0])),documents=0;
   while(true){const docs=(await t.get(q.limit(100))).docs;for(const doc of docs){const row=doc.data();if(row.generation!==h.generation)continue;if(row.id!==doc.id||row.ownerId!==h.ownerId||!W.WEAPON_IDS.includes(row.weaponId)||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>1000||new Set(row.removed).size!==row.removed.length||row.removed.some(i=>!Number.isInteger(i)||i<0||i>=row.quantity))D.fail('failed-precondition','批次資料異常');allCounts[row.weaponId]+=row.quantity-row.removed.length;documents++;}if(docs.length<100)break;q=q.startAfter(docs.at(-1));}
   if(D.fingerprint(allCounts)!==D.fingerprint(h.counts))D.fail('failed-precondition','個體總量不一致');
   if(h.status==='active'){if(h.schemaVersion!==2||farm.weaponSchemaVersion!==2||farm.weaponGeneration!==h.generation||farm.weaponInstanceRevision!==h.revision)D.fail('failed-precondition','農場schema、世代或revision不一致');W.assertProjection(farm,h);const repo=W.createWeaponRepository({db});const melee=await repo.get(t,actor,farm,h.equippedMeleeInstanceId,h),bow=h.equippedBowInstanceId?await repo.get(t,actor,farm,h.equippedBowInstanceId,h):null;if(melee.weaponId!==h.equippedWeapon||(bow?.weaponId||null)!==h.equippedBow)D.fail('failed-precondition','裝備個體種類不一致');}
   return{valid:true,status:h.status,counts:allCounts,documents,revision:h.revision,migrationCompleted:j?.completed};
  });
 }
 async function rollback(actor){
  return db.runTransaction(async t=>{
   await safe(t,actor,'rollback');
   const [snap,hs,js,battle]=await Promise.all([t.get(member(actor)),t.get(headerRef(actor)),t.get(journal(actor)),t.get(db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)))]),farm=snap.data()?.farm,h=hs.data(),j=js.data();W.assertOwner(actor,h);
   if(battle.data()&&!battle.data().result)D.fail('failed-precondition','戰鬥進行中不可回復移轉');
   if(h.status==='rolled-back')return{status:'rolled-back',replayed:true};
   if(h.combatInputProtocol===1)D.fail('failed-precondition','已啟用新版戰鬥輸入，只允許向前修復');
   if(h.revision!==0||W.signature(farm)!==j?.fingerprint)D.fail('failed-precondition','已有新武器交易，僅允許對帳後向前修復');
   const next={...farm};for(const key of ['weaponSchemaVersion','weaponGeneration','weaponInstanceRevision','weaponMigrationState'])delete next[key];
   if(j.sourceSnapshot?.schemaVersion)next.weaponSchemaVersion=j.sourceSnapshot.schemaVersion;
   for(const key of ['equippedWeapon','equippedBow']){if(j.sourceSnapshot?.[key]===null)delete next[key];else if(j.sourceSnapshot?.[key]!==undefined)next[key]=j.sourceSnapshot[key];}
   t.update(member(actor),{farm:next});t.set(headerRef(actor),{...h,status:'rolled-back',updatedAt:now()});t.set(journal(actor),{...j,status:'rolled-back',updatedAt:now()});return{status:'rolled-back'};
  });
 }
 return{review,stage,resume,verify,rollback};
}
module.exports={inspect,createWeaponMigration};
