/** Real Auth ID tokens -> real callable HTTP -> real Firestore. No handler/auth mocks. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const PROJECT='demo-nexus-private-farm';
if(process.env.NEXUS_REFINEMENT_HTTP_CONTRACT!=='1'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8092'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098'||process.env.GOOGLE_CLOUD_PROJECT!==PROJECT)throw Error('Explicit localhost demo HTTP runner required');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore'),{getAuth}=sdk('firebase-admin/auth');
const D=require('../functions/domain.cjs'),W=require('../functions/weapon-repository.cjs'),I=require('../../functions/identity-domain.cjs'),RC=require('../functions/refinement-service.cjs'),Wallet=require('../functions/refinement-wallet.cjs');
const uid=()=>crypto.randomUUID(),prefix='http-'+uid().slice(0,8),actor={uid:prefix+'-profile',accountId:prefix+'-player',groupId:prefix+'-group'},other={uid:prefix+'-other',accountId:prefix+'-other',groupId:prefix+'-other-group'},low={uid:prefix+'-low',accountId:prefix+'-low',groupId:prefix+'-low-group'},secondGroup={...actor,groupId:prefix+'-second-group'};
let app,db,auth,mainToken,secondDeviceToken,otherToken,lowToken,secondGroupToken,globalToken,admins={},items={},initialDraft,initialRelease,successful,failed,resetResult,staleQuote,pendingReset,secondarySuccess,otherWeapon;
const checks=[],calls=[],capturedSecrets=[];
const endpoint=name=>`http://127.0.0.1:5008/${PROJECT}/asia-southeast1/${name}`;
async function post(url,data,token){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});return{status:r.status,body:await r.json()};}
async function call(name,data,token){calls.push({name,action:data.action,requestId:data.requestId||null});return post(endpoint(name),{data},token);}
const good=r=>{assert.equal(r.status,200,JSON.stringify(r.body.error||{}));return r.body.result;};
const denied=(r,code)=>{assert.equal(r.status,code,JSON.stringify(r.body));assert.ok(r.body.error);return r;};
const farm=(action,payload={},id=uid(),token=mainToken,groupId=actor.groupId)=>call('gameOpsFarmTransaction',{action,groupId,requestId:id,...payload},token);
const farmOK=async(...args)=>good(await farm(...args));
const admin=(role,action,payload={},id=uid())=>call('gameOpsAdmin',{action,payload,requestId:id},admins[role]);
const adminOK=async(...args)=>good(await admin(...args));
const assets=async(a=actor)=>(await db.doc(W.farmPath(a)).get()).data().farm;
const state=async(id)=>(await db.doc(W.statePath(actor,id)).get()).data();
const quote=async(id=items.primary,token=mainToken,a=actor)=>(await farmOK('previewRefinement',{instanceId:id},uid(),token,a.groupId)).result;
const refinePayload=q=>({instanceId:q.instanceId,expectedLevel:q.currentLevel,quoteId:q.quoteId,configVersion:q.configVersion});
const resetPayload=q=>({instanceId:q.instanceId,expectedLevel:q.currentLevel,quoteId:q.quoteId,configVersion:q.configVersion});
const resetQuote=async(id=items.primary,token=mainToken,a=actor)=>(await farmOK('previewRefinementReset',{instanceId:id},uid(),token,a.groupId)).result;
async function login(a){const login=good(await call('nexusIdentity',{action:'login',identifier:a.accountId,secret:'http-only-secret'}));const signed=await post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{token:login.token,returnSecureToken:true});assert.equal(signed.status,200);capturedSecrets.push(login.token,signed.body.idToken);const scoped=good(await call('nexusIdentity',{action:'groupToken',groupId:a.groupId},signed.body.idToken));const grouped=await post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{token:scoped.token,returnSecureToken:true});assert.equal(grouped.status,200);capturedSecrets.push(scoped.token,grouped.body.idToken);return{token:grouped.body.idToken,global:signed.body.idToken};}
async function seedFarm(a,coins=1000000,stones=100){
 if(!(await db.doc('users/'+a.uid).get()).exists){await db.doc('users/'+a.uid).set({accountId:a.accountId,name:'HTTP Test Player',role:'member'});await db.doc('ops_identity_credentials/'+a.uid).set({authUid:I.profileUid(a.uid),accountId:a.accountId,sessionVersion:1,disabled:false,secrets:[await I.hashSecret('http-only-secret')]});await db.doc('ops_identity_accounts/'+I.hash(a.accountId)).set({profileId:a.uid});}
 await db.doc('groups/'+a.groupId).set({members:[a.accountId],farmVillageVisibility:'closed'});
 await db.doc(W.farmPath(a)).set({farm:{coins,refinementStones:stones,hens:0,hensState:[],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:1000,coopLevel:1,ironhammer:3,mace:2,equippedWeapon:'ironhammer',equippedBow:null}});
 // Initial migration is test-data preparation; all actions under test use HTTP.
 const migration=require('../functions/migrations/weapon-instances.cjs').createWeaponMigration({db,testEnvironment:true}),plan=await migration.review(a);await migration.stage(a,{generation:'http-generation-'+uid().slice(0,8),expectedFingerprint:plan.fingerprint});await migration.resume(a);
}
async function publishBundle(bundle){const d=await adminOK('full','refinementSaveDraft',{bundle,reason:'真實HTTP隔離設定驗收'}),v=await adminOK('full','refinementValidateDraft',{draftId:d.id,expectedRevision:d.revision});assert.equal(v.publishable,true);return adminOK('full','refinementPublishDraft',{draftId:d.id,expectedRevision:d.revision,validationHash:v.validationHash,confirm:true,pityPolicy:'preserve-target-failures'});}
async function publishGate(){const current=await adminOK('full','refinementReleaseStatus'),payload={config:{schemaVersion:1,flags:{instances:true,refinement:true,combat:true,reset:true,stoneSources:false},allowlist:[actor,other,low]},expectedRevision:current.revision,reason:'真實HTTP假帳號白名單'};const p=await adminOK('full','refinementPreviewRelease',payload);return adminOK('full','refinementPublishRelease',{...payload,confirmationHash:p.confirmationHash,confirm:true});}
async function lostResponse(data,token){
 const http=require('node:http');let resolveCommit,rejectCommit;
 const committed=new Promise((resolve,reject)=>{resolveCommit=resolve;rejectCommit=reject;});
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const part of req)chunks.push(part);const forwarded=JSON.parse(Buffer.concat(chunks).toString());const reply=await call('gameOpsFarmTransaction',forwarded,req.headers.authorization?.slice(7));resolveCommit(reply);/* Deliberately withhold the committed reply. */}catch(error){rejectCommit(error);res.destroy();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const controller=new AbortController();let pending;
 try{
  pending=fetch('http://127.0.0.1:'+server.address().port,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(data),signal:controller.signal}).then(()=>({receivedReply:true}),error=>({error:error.name}));
  const reply=await committed;good(reply);controller.abort(new DOMException('Isolated timeout after server commit','TimeoutError'));assert.deepEqual(await pending,{error:'TimeoutError'});return good(reply).result;
 }finally{controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(pending)await pending;}
}
function check(name,fn){test(name,{concurrency:false},async()=>{try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false});throw e;}});}
test.before(async()=>{
 app=initializeApp({projectId:PROJECT},'refinement-http-'+prefix);db=getFirestore(app);auth=getAuth(app);
 await db.doc('ops_identity_state/global').set({ready:true,farmReady:true});
 for(const a of [actor,other,low,secondGroup])await seedFarm(a,a===low?0:1000000,a===low?0:100);
 for(const [role,permissions]of Object.entries({full:['read','edit','publish','risk'],read:['read'],edit:['read','edit'],publish:['read','publish'],revoked:['read','edit','publish','risk'],disabled:['read','edit','publish','risk']})){
  const id=prefix+'-admin-'+role;await auth.createUser({uid:id});await auth.setCustomUserClaims(id,{role:'admin',refinementPermissions:permissions});const token=await auth.createCustomToken(id),r=await post('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{token,returnSecureToken:true});assert.equal(r.status,200);admins[role]=r.body.idToken;capturedSecrets.push(token,r.body.idToken);
 }
 mainToken=(await login(actor)).token;secondDeviceToken=(await login(actor)).token;globalToken=(await login(actor)).global;otherToken=(await login(other)).token;lowToken=(await login(low)).token;secondGroupToken=(await login(secondGroup)).token;
 const list=(await farmOK('listWeapons',{weaponId:'ironhammer'})).result.rows.filter(x=>!x.equipped);assert.equal(list.length,2);items={primary:list[0].instanceId,secondary:list[1].instanceId};
});
test.after(async()=>{const expected=require('./helpers/refinement-http-spec.cjs').caseCount,out=process.env.REFINEMENT_HTTP_REPORT_DIR;if(out){let walletAudit=null;if(checks.length===expected&&checks.every(x=>x.passed)){
 const receipts=(await db.collection('ops_refinement_transactions').get()).docs.filter(x=>[actor.uid,other.uid,low.uid].includes(x.data().analytics?.uid)).map(x=>{const r=x.data();return{ownerId:r.ownerId,transactionId:r.response.transactionId,action:r.response.action==='resetRefinement'?'resetRefinement':'refineWeapon',amount:r.response.action==='resetRefinement'?r.response.refund:r.response.actualCost};});
 const keys=new Set(receipts.map(x=>x.ownerId+':'+x.transactionId)),ledger=(await db.collection('ops_refinement_wallet').get()).docs.map(x=>x.data()).filter(x=>keys.has(x.ownerId+':'+x.transactionId));
 assert.equal(ledger.length,receipts.length);assert.equal(new Set(ledger.map(x=>x.ownerId+':'+x.transactionId)).size,ledger.length);
 for(const row of ledger){const receipt=receipts.find(x=>x.ownerId===row.ownerId&&x.transactionId===row.transactionId);assert.equal(row.action,receipt.action);assert.deepEqual(row.amount,receipt.amount);for(const k of ['coins','stones']){assert.ok(Number.isSafeInteger(row.after[k])&&row.after[k]>=0);assert.equal(row.after[k]-row.before[k],(row.action==='resetRefinement'?1:-1)*row.amount[k]);}}
 walletAudit={verified:true,receiptsCount:receipts.length,ledgerCount:ledger.length,receipts,ledger};
 }const report={schema:1,project:PROJECT,realAuth:true,realFunctionsHTTP:true,realFirestore:true,authOrHandlerMocks:false,walletAudit,productionData:false,deployed:false,checks,calls,expectedChecks:expected,passed:checks.length===expected&&checks.every(x=>x.passed),limitations:['App Check enforcement, physical devices and background observers are not exercised by this core HTTP suite','One failed recovered intent uses a private demo fixture roll; no RNG override is exposed through the callable','Pagination and snapshot APIs use separate non-economic analytical fixtures, not production population statistics']};const json=JSON.stringify(report,null,2);assert.ok(capturedSecrets.every(s=>!json.includes(s)));fs.writeFileSync(path.join(out,'refinement-http.json'),json,{mode:0o600});}if(app)await deleteApp(app);});
check('real Nexus login and Auth tokens; anonymous, invalid token and closed admission rejected',async()=>{
 denied(await farm('getRefinementCapabilities',{},uid(),null),401);denied(await farm('getRefinementCapabilities',{},uid(),'invalid-id-token'),401);
 const caps=(await farmOK('getRefinementCapabilities')).result;assert.equal(caps.refinementEnabled,false);denied(await farm('previewRefinement',{instanceId:items.primary}),400);
 const d=(await farmOK('getWeaponDetails',{instanceId:items.primary})).result;assert.equal(d.refineLevel,0);assert.equal(d.stats.attack,d.baseStats.attack);
});
check('real Auth admin read/edit/publish/risk separation and initial draft publication',async()=>{
 denied(await call('gameOpsAdmin',{action:'refinementOverview'},null),401);denied(await call('gameOpsAdmin',{action:'refinementOverview'},mainToken),403);
 const o=await adminOK('read','refinementOverview');assert.ok(Object.values(o.releaseGates).every(x=>x===false));for(const action of ['refinementConfig','refinementResetConfig','refinementStoneConfig'])await adminOK('read',action);
 denied(await admin('read','refinementSaveDraft',{bundle:o.bundle,reason:'偽造權限請求',role:'admin',refinementPermissions:['edit']}),403);
 initialDraft=await adminOK('edit','refinementSaveDraft',{bundle:o.bundle,reason:'首次HTTP管理設定'});
 const v=await adminOK('read','refinementValidateDraft',{draftId:initialDraft.id,expectedRevision:initialDraft.revision});
 const p={draftId:initialDraft.id,expectedRevision:initialDraft.revision,validationHash:v.validationHash,confirm:true,pityPolicy:'preserve-target-failures'};
 denied(await admin('edit','refinementPublishDraft',p),403);denied(await admin('publish','refinementPublishDraft',p),403);
 initialRelease=await adminOK('full','refinementPublishDraft',p);assert.equal((await adminOK('read','refinementOverview')).bundle.refining.version,initialRelease.version);
});
check('invalid settings rejected and current Auth claims override stale administrator ID tokens',async()=>{
 const bundle=(await adminOK('read','refinementOverview')).bundle;for(const action of ['publishRefinementConfig','publishRefinementResetConfig','publishRefinementStoneConfig'])denied(await admin('full',action,{}),400);
 for(const mutate of [b=>b.refining.levels[0].coins=-1,b=>b.refining.levels[0].successRateBp=10001,b=>b.refining.levels[8].bonus.attack=5001,b=>b.refining.levels[1].bonus.attack=0]){const b=structuredClone(bundle);mutate(b);denied(await admin('full','refinementSaveDraft',{bundle:b,reason:'非法設定阻擋驗收'}),400);}
 await auth.setCustomUserClaims(prefix+'-admin-revoked',{role:'admin',refinementPermissions:[]});denied(await admin('revoked','refinementOverview'),403);
 await auth.updateUser(prefix+'-admin-disabled',{disabled:true});denied(await admin('disabled','refinementOverview'),403);
});
check('release API validates dependencies, scope and explicit preview before admitting test farms',async()=>{
 const status=await adminOK('full','refinementReleaseStatus');assert.equal(status.serverGateEnabled,true);
 const config={schemaVersion:1,flags:{instances:true,refinement:true,combat:false,reset:true,stoneSources:false},allowlist:[actor]};
 denied(await admin('full','refinementPreviewRelease',{config,expectedRevision:status.revision,reason:'相依旗標錯誤驗收'}),400);
 denied(await admin('publish','refinementPauseRelease',{expectedRevision:status.revision,reason:'缺少高風險權限',confirm:true}),403);
 await publishGate();const caps=(await farmOK('getRefinementCapabilities')).result;assert.equal(caps.refinementEnabled,true);assert.equal(caps.resetEnabled,true);assert.equal(caps.combatBonusEnabled,true);
});
check('two real device tokens refining the same quote debit and grant once',async()=>{
 const q=await quote(),before=await assets(),id=uid(),payload=refinePayload(q),r=await Promise.all([farm('refineWeapon',payload,id),farm('refineWeapon',payload,id,secondDeviceToken)]);
 r.forEach(good);assert.ok(r.some(x=>x.body.result.replayed===true));successful=good(r[0]).result;assert.equal(successful.success,true);assert.equal(successful.refineLevel,1);
 const after=await assets();assert.equal(after.coins,before.coins-q.cost.coins);assert.equal(after.refinementStones,before.refinementStones-q.cost.stones);assert.equal((await state(items.primary)).refineBonus.attack,300);assert.ok((await db.doc(Wallet.path(actor,id)).get()).exists);
 successful={...successful,payload};
});
check('lost-success reply recovery is read-only, exact ID/content bound and safe on unknown results',async()=>{
 const otherItem=(await farmOK('listWeapons',{weaponId:'mace'},uid(),otherToken,other.groupId)).result.rows[0].instanceId,tq=await quote(otherItem,otherToken,other),tid=uid(),tp=refinePayload(tq),otherBefore=await assets(other);
 await lostResponse({action:'refineWeapon',groupId:other.groupId,requestId:tid,...tp},otherToken);
 const recovered=(await farmOK('getFarmTransactionResult',{transactionId:tid,originalAction:'refineWeapon',originalPayload:tp},uid(),otherToken,other.groupId)).result;assert.equal(recovered.status,'completed');assert.equal(recovered.result.refineLevel,1);
 const otherAfter=await assets(other);assert.equal(otherAfter.coins,otherBefore.coins-tq.cost.coins);assert.equal(otherAfter.refinementStones,otherBefore.refinementStones-tq.cost.stones);
 assert.equal((await farmOK('refineWeapon',tp,tid,otherToken,other.groupId)).replayed,true);assert.deepEqual(await assets(other),otherAfter);
 const before=await assets(),q=(await farmOK('getRefinementResult',{transactionId:successful.transactionId})).result;assert.equal(q.status,'completed');assert.equal(q.success,true);
 const r=(await farmOK('getFarmTransactionResult',{transactionId:successful.transactionId,originalAction:'refineWeapon',originalPayload:successful.payload})).result;assert.equal(r.status,'completed');assert.equal(r.result.transactionId,successful.transactionId);
 denied(await farm('getFarmTransactionResult',{transactionId:successful.transactionId,originalAction:'refineWeapon',originalPayload:{...successful.payload,expectedLevel:8}}),409);
 denied(await farm('refineWeapon',{...successful.payload,instanceId:items.secondary},successful.transactionId),409);
 const unknown=(await farmOK('getFarmTransactionResult',{transactionId:uid(),originalAction:'refineWeapon',originalPayload:successful.payload})).result;assert.equal(unknown.status,'unknown');assert.deepEqual(await assets(),before);
});
check('recovering an already reserved failed draw consumes once, retains level and cannot reroll',async()=>{
 const q=await quote(),payload=refinePayload(q),id=uid(),fingerprint=D.fingerprint({ownerId:W.scope(actor),...payload}),before=await assets(),previous=await state(items.primary);
 // Private demo fixture models a process stopping AFTER a trusted draw reservation.
 // This is not a callable parameter and never changes the HTTP service's RNG.
 await db.runTransaction(async t=>{const ref=db.doc('ops_refinement_quotes/'+q.quoteId);await t.get(ref);t.update(ref,{acceptedBy:id});t.create(db.doc(RC.intentPath(actor,id)),{ownerId:W.scope(actor),requestId:id,fingerprint,...payload,rollBp:9999,status:'pending',createdAt:Date.now()});});
 assert.equal((await farmOK('getFarmTransactionResult',{transactionId:id,originalAction:'refineWeapon',originalPayload:payload})).result.status,'pending');
 const replies=await Promise.all([farm('refineWeapon',payload,id),farm('refineWeapon',payload,id,secondDeviceToken)]);replies.forEach(good);failed=good(replies[0]).result;
 assert.equal(failed.success,false);assert.equal(failed.refineLevel,1);assert.deepEqual((await state(items.primary)).refineBonus,previous.refineBonus);assert.equal((await state(items.primary)).refineFailCount,1);
 const after=await assets();assert.equal(after.coins,before.coins-q.cost.coins);assert.equal(after.refinementStones,before.refinementStones-q.cost.stones);assert.equal((await db.doc(RC.intentPath(actor,id)).get()).data().rollBp,9999);
 denied(await farm('refineWeapon',{...payload,rollBp:0},uid()),400);assert.deepEqual(await assets(),after);
});
check('reset preview is read-only and concurrent reset refunds historical successes only once',async()=>{
 const before=await assets(),ownerBefore=(await db.doc(W.ownerPath(actor)).get()).data(),q=await resetQuote(),id=uid(),payload=resetPayload(q);assert.deepEqual(await assets(),before);assert.deepEqual(q.refund,{coins:300,stones:0});
 const replies=await Promise.all([farm('resetRefinement',payload,id),farm('resetRefinement',payload,id,secondDeviceToken)]);replies.forEach(good);resetResult=good(replies[0]).result;assert.deepEqual(resetResult.refund,{coins:300,stones:0});assert.deepEqual(resetResult.excludedFailedCost,{coins:2000,stones:1});
 const after=await assets(),s=await state(items.primary),header=(await db.doc(W.ownerPath(actor)).get()).data();assert.equal(after.coins,before.coins+300);assert.equal(after.refinementStones,before.refinementStones);assert.equal(s.refineLevel,0);assert.equal(s.refineFailCount,0);assert.deepEqual(s.successfulRefineCost,{coins:0,stones:0});assert.equal(header.equippedMeleeInstanceId,ownerBefore.equippedMeleeInstanceId);
 resetResult={...resetResult,payload};
});
check('zero-level reset cannot refund again while original reset receipts remain readable',async()=>{
 const before=await assets();denied(await farm('previewRefinementReset',{instanceId:items.primary}),400);
 const replay=await farmOK('resetRefinement',resetResult.payload,resetResult.transactionId);assert.equal(replay.replayed,true);
 const lookup=(await farmOK('getRefinementResetResult',{transactionId:resetResult.transactionId})).result;assert.equal(lookup.status,'completed');assert.deepEqual(await assets(),before);
});
check('published config invalidates prior refinement quotes without charging or weakening snapshots',async()=>{
 staleQuote=await quote(items.secondary);const before=await assets(),o=await adminOK('full','refinementOverview'),bundle=structuredClone(o.bundle);bundle.refining.levels[0].coins=1111;await publishBundle(bundle);
 const id=uid();denied(await farm('refineWeapon',refinePayload(staleQuote),id),400);assert.deepEqual(await assets(),before);assert.equal((await farmOK('getRefinementResult',{transactionId:id})).result.status,'rejected');
 const q=await quote(items.secondary);assert.equal(q.cost.coins,1111);secondarySuccess=(await farmOK('refineWeapon',refinePayload(q))).result;assert.equal(secondarySuccess.success,true);assert.equal(secondarySuccess.refineLevel,1);
});
check('reset quote version changes require reconfirmation and refunds use actual historic costs',async()=>{
 const q=await resetQuote(items.secondary),before=await assets();assert.equal(q.refund.coins,333);const o=await adminOK('full','refinementOverview'),b=structuredClone(o.bundle);b.reset.coinsRefundBp=4000;b.refining.levels[0].coins=2000;await publishBundle(b);
 denied(await farm('resetRefinement',resetPayload(q)),400);assert.deepEqual(await assets(),before);
 pendingReset=await resetQuote(items.secondary);assert.equal(pendingReset.refund.coins,444);assert.equal(pendingReset.successfulCost.coins,1111);assert.equal((await state(items.secondary)).refineLevel,1);
});
check('insufficient resources, forged cost/ownership and other-group tokens cannot mutate assets',async()=>{
 const lowId=(await farmOK('listWeapons',{weaponId:'ironhammer'},uid(),lowToken,low.groupId)).result.rows[0].instanceId,q=await quote(lowId,lowToken,low);
 const before=await assets(low);assert.equal(q.eligibility.eligible,false);denied(await farm('refineWeapon',refinePayload(q),uid(),lowToken,low.groupId),400);assert.deepEqual(await assets(low),before);
 denied(await farm('refineWeapon',{...refinePayload(q),coins:0,successRateBp:10000},uid(),lowToken,low.groupId),400);
 denied(await farm('previewRefinement',{instanceId:items.secondary},uid(),otherToken,other.groupId),403);
 denied(await farm('getWeaponDetails',{instanceId:items.secondary},uid(),secondGroupToken,secondGroup.groupId),403);
 denied(await farm('previewRefinement',{instanceId:items.primary},uid(),secondGroupToken,actor.groupId),403);
});
check('active battle blocks refinement and reset without consuming resources',async()=>{
 const q=await quote(items.primary),rq=await resetQuote(items.secondary),before=await assets(),ref=db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId));
 await ref.set({id:prefix+'-battle',kind:'wolf',startedAt:Date.now(),deadline:Date.now()+60000,result:null});
 try{denied(await farm('refineWeapon',refinePayload(q)),400);denied(await farm('resetRefinement',resetPayload(rq)),400);assert.deepEqual(await assets(),before);}finally{await ref.delete();}
});
check('refinement versus sale race changes either inventory or refinement, never both incorrectly',async()=>{
 const q=await quote(items.primary),detail=(await farmOK('getWeaponDetails',{instanceId:items.primary})).result,before=await assets(),r=await Promise.all([farm('refineWeapon',refinePayload(q)),farm('sellItem',{item:'ironhammer',instanceIds:[items.primary],quantity:1,expectedWeaponRevision:detail.ownerRevision})]);
 assert.equal(r.filter(x=>x.status===200).length,1);const after=await assets();if(r[0].status===200){assert.equal(good(r[0]).result.success,true);assert.equal(after.ironhammer,before.ironhammer);assert.equal(after.coins,before.coins-q.cost.coins);}else{good(r[1]);assert.equal(after.ironhammer,before.ironhammer-1);assert.equal(after.refinementStones,before.refinementStones);assert.ok(after.coins>before.coins);}
});
check('different requests on the same weapon cannot both consume a level-zero quote',async()=>{
 otherWeapon=(await farmOK('listWeapons',{weaponId:'ironhammer'},uid(),otherToken,other.groupId)).result.rows.find(x=>!x.equipped).instanceId;
 const q1=await quote(otherWeapon,otherToken,other),q2=await quote(otherWeapon,otherToken,other),before=await assets(other),r=await Promise.all([farm('refineWeapon',refinePayload(q1),uid(),otherToken,other.groupId),farm('refineWeapon',refinePayload(q2),uid(),otherToken,other.groupId)]);
 assert.equal(r.filter(x=>x.status===200).length,1);assert.equal(r.filter(x=>x.status===400).length,1);const after=await assets(other);assert.equal(after.coins,before.coins-q1.cost.coins);assert.equal(after.refinementStones,before.refinementStones-q1.cost.stones);
 assert.equal((await db.doc(W.statePath(other,otherWeapon)).get()).data().refineLevel,1);
});
check('reset versus refinement race commits one complete wallet change on real HTTP',async()=>{
 const q=await quote(otherWeapon,otherToken,other),rq=await resetQuote(otherWeapon,otherToken,other),before=await assets(other),r=await Promise.all([farm('refineWeapon',refinePayload(q),uid(),otherToken,other.groupId),farm('resetRefinement',resetPayload(rq),uid(),otherToken,other.groupId)]);
 assert.equal(r.filter(x=>x.status===200).length,1);assert.equal(r.filter(x=>x.status===400).length,1);const after=await assets(other);
 if(r[0].status===200){assert.equal(after.coins,before.coins-q.cost.coins);assert.equal(after.refinementStones,before.refinementStones-q.cost.stones);}else{assert.equal(after.coins,before.coins+rq.refund.coins);assert.equal(after.refinementStones,before.refinementStones+rq.refund.stones);assert.equal((await db.doc(W.statePath(other,otherWeapon)).get()).data().refineLevel,0);}
});
check('risk pause denies new refine/reset while preserving earned stats and ordinary weapon operations',async()=>{
 const q=await quote(items.secondary),rq=await resetQuote(items.secondary),before=await assets(),s=await state(items.secondary),gate=await adminOK('full','refinementReleaseStatus');
 await adminOK('full','refinementPauseRelease',{expectedRevision:gate.revision,reason:'真實HTTP緊急暫停',confirm:true});
 denied(await farm('refineWeapon',refinePayload(q)),400);denied(await farm('resetRefinement',resetPayload(rq)),400);assert.deepEqual(await assets(),before);
 const stats=(await farmOK('getRefinementStats',{instanceId:items.secondary})).result;assert.equal(stats.refineLevel,1);assert.deepEqual(stats.refineBonus,s.refineBonus);
 const selected=(await farmOK('getWeaponDetails',{instanceId:items.secondary})).result;await farmOK('equipWeapon',{instanceId:items.secondary,item:'ironhammer',currentlyEquipped:selected.equipped,expectedWeaponRevision:selected.ownerRevision});assert.equal((await state(items.secondary)).refineStatsVersion,s.refineStatsVersion);
 assert.equal((await farmOK('getRefinementResult',{transactionId:secondarySuccess.transactionId})).result.status,'completed');
});
check('read-only statistics, idempotent reconciliation and audit agree with real HTTP receipts',async()=>{
 const date=require('../functions/refinement-statistics.cjs').dayKey(Date.now()),range={startDate:date,endDate:date};
 denied(await admin('read','refinementReconcile',{source:'receipts'}),403);await adminOK('full','refinementReconcile',{source:'receipts'});
 const before=await adminOK('read','refinementStatistics',range),again=await adminOK('full','refinementReconcile',{source:'receipts'});assert.equal(again.applied,0);assert.deepEqual((await adminOK('read','refinementStatistics',range)).daily,before.daily);
 const receipts=(await db.collection('ops_refinement_transactions').get()).docs.map(x=>x.data().response),spent=receipts.filter(x=>!x.action).reduce((n,x)=>n+x.actualCost.coins,0),refund=receipts.filter(x=>x.action==='resetRefinement').reduce((n,x)=>n+x.refund.coins,0),day=before.daily[date];assert.equal(day.coinsSpent,spent);assert.equal(day.coinsRefunded,refund);assert.equal(day.coinsNetSink,spent-refund);
 const audit=await adminOK('full','refinementAuditStatistics',{date,jobId:uid()});assert.equal(audit.status,'matched');
});
check('admin history rollback creates a new immutable version and retains acquired abilities',async()=>{
 const original=(await db.doc('ops_refinement_releases/'+initialRelease.releaseId).get()).data(),before=await state(items.secondary),d=await adminOK('full','refinementRestoreDraft',{releaseId:initialRelease.releaseId,reason:'真實HTTP版本回復'}),v=await adminOK('full','refinementValidateDraft',{draftId:d.id,expectedRevision:d.revision});
 const published=await adminOK('full','refinementPublishDraft',{draftId:d.id,expectedRevision:d.revision,validationHash:v.validationHash,confirm:true,pityPolicy:'preserve-target-failures'});assert.notEqual(published.version,initialRelease.version);assert.deepEqual((await db.doc('ops_refinement_releases/'+initialRelease.releaseId).get()).data(),original);assert.deepEqual(await state(items.secondary),before);
 const h=await adminOK('read','refinementHistory');assert.ok(h.rows.some(x=>x.id===published.releaseId));
});
check('read-only transaction pagination is bounded and cursors cannot cross filter scopes',async()=>{
 // Query-only markers on a different date; not receipts, assets or economic projections.
 const player=prefix+'-pagination',stamp=Date.parse('2025-01-15T00:00:00+08:00');
 for(let n=0;n<26;n++)await db.doc('ops_refinement_records/'+prefix+'-page-'+n).set({kind:'http-pagination-fixture',player,createdAt:stamp+n,filterTokens:['player:'+player,'kind:http-pagination-fixture']});
 const payload={startDate:'2025-01-15',endDate:'2025-01-15',player,kind:'http-pagination-fixture'},before=await assets(),first=await adminOK('read','refinementTransactions',payload);assert.equal(first.rows.length,25);assert.ok(first.nextCursor);assert.ok(first.scannedDocuments<=200);
 const second=await adminOK('read','refinementTransactions',{...payload,cursor:first.nextCursor});assert.equal(second.rows.length,1);assert.ok(!first.rows.some(x=>x.id===second.rows[0].id));
 denied(await admin('read','refinementTransactions',{...payload,player:'different-scope',cursor:first.nextCursor}),400);assert.deepEqual(await assets(),before);
 assert.ok((await adminOK('read','refinementDrafts')).rows.length<=25);
 // Bounded snapshot-job API uses separate analytical fixtures, never assets.
 for(const [i,coins]of [100,300].entries())await db.doc('ops_refinement_farm_snapshots/'+prefix+'-snapshot-'+i).set({date:'2025-01-15',groupId:prefix+'-snapshot',accountId:'sample-'+i,occurredAt:stamp+i,coins,counts:{club:1,ironhammer:1},sourceId:'http-query-fixture'});
 const job={date:'2025-01-15',jobId:uid()};denied(await admin('read','refinementBuildSnapshot',job),403);
 let built;for(let n=0;n<4;n++){built=await adminOK('edit','refinementBuildSnapshot',job);if(built.complete)break;}
 assert.equal(built.complete,true);assert.equal(built.result.observedFarms,2);assert.equal(built.result.coinMedian,100);assert.equal(built.result.coinP90,300);assert.equal(built.result.fullPopulationCoverage,false);
 assert.deepEqual((await adminOK('edit','refinementBuildSnapshot',job)).result,built.result);assert.deepEqual(await assets(),before);
});
check('password revocation invalidates old player tokens on all new refinement endpoints',async()=>{
 const before=await assets(),changed=good(await call('nexusIdentity',{action:'changePassword',currentSecret:'http-only-secret',newSecret:'http-only-new-secret'},globalToken));assert.ok(changed);
 for(const [action,payload]of [['getRefinementStats',{instanceId:items.secondary}],['previewRefinement',{instanceId:items.secondary}],['previewRefinementReset',{instanceId:items.secondary}],['getRefinementResult',{transactionId:secondarySuccess.transactionId}]])denied(await farm(action,payload),401);
 assert.deepEqual(await assets(),before);
});
