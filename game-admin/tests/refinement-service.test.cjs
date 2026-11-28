const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{fixture}=require('./helpers/refinement-fixture.cjs'),Core=require('../functions/refinement-core.cjs'),Config=require('../functions/refinement-config.cjs'),W=require('../functions/weapon-repository.cjs'),R=require('../functions/refinement-service.cjs'),D=require('../functions/domain.cjs');
const rejectReason=reason=>e=>e.reason===reason;
const snapshot=async f=>({farm:await f.farm(),state:await f.state(),owner:await f.owner()});
test('+1 is guaranteed, exact costs and one sparse individual; no sibling gains',async()=>{
 const f=await fixture();f.roll(9999);const q=await f.quote(),result=(await f.execute(q)).result;assert.equal(result.success,true);assert.equal(result.refineLevel,1);assert.deepEqual(result.actualCost,{coins:1000,stones:1});assert.equal((await f.farm()).coins,999000);assert.equal((await f.farm()).refinementStones,999);assert.deepEqual((await f.state()).successfulRefineCost,{coins:1000,stones:1});
 const list=(await f.transactions.handle(f.request('listWeapons',{weaponId:'ironhammer'}))).result.rows;assert.deepEqual(list.map(i=>i.refineLevel).sort(),[0,0,1]);assert.equal(list.find(i=>i.refineLevel===1).instanceId,f.item.instanceId);assert.equal(result.stats.attack,206);assert.equal(f.draws(),1);
});
test('failure consumes resources but retains level, acquired version/bonus and successful-only costs',async()=>{
 const f=await fixture();await f.execute(await f.quote());f.roll(9999);const original=await f.state(),q=await f.quote(),result=(await f.execute(q)).result,state=await f.state();assert.equal(result.success,false);assert.equal(state.refineLevel,1);assert.deepEqual(state.refineBonus,original.refineBonus);assert.equal(state.refineStatsVersion,original.refineStatsVersion);assert.deepEqual(state.successfulRefineCost,{coins:1000,stones:1});assert.deepEqual(state.failedRefineCost,{coins:2000,stones:1});assert.equal(state.refineFailCount,1);assert.equal(state.failuresByTarget['2'],1);assert.equal((await f.farm()).coins,997000);assert.equal((await f.farm()).refinementStones,998);
});
test('up to +9 one level at a time, original-base bonuses; +9 cannot spend again',async()=>{
 const f=await fixture();for(let level=1;level<=9;level++){const q=await f.quote(),r=(await f.execute(q)).result;assert.equal(r.refineLevel,level);}
 assert.deepEqual((await f.state()).successfulRefineCost,{coins:35000,stones:16});assert.equal(Core.calculateStats((await f.state()).baseStatsSnapshot,(await f.state()).refineBonus).attack,300);const before=await snapshot(f);await assert.rejects(f.quote(),rejectReason('MAX_LEVEL'));assert.deepEqual(await snapshot(f),before);
});
test('insufficient coins or stones never debit, and rejected transaction ID cannot be repurposed',async()=>{
 for(const resources of [{coins:0,refinementStones:1000},{coins:1000000,refinementStones:0}]){const f=await fixture(),q=await f.quote();await f.farmRef.update({farm:{...await f.farm(),...resources}});const before=await snapshot(f),id=crypto.randomUUID();await assert.rejects(f.execute(q,id),e=>/^INSUFFICIENT_/.test(e.reason));assert.deepEqual(await snapshot(f),before);assert.equal(f.draws(),0);await assert.rejects(f.execute(q,id,{expectedLevel:1}),{code:'already-exists'});await f.farmRef.update({farm:{...await f.farm(),coins:1000000,refinementStones:1000}});await assert.rejects(f.execute(q,id),e=>/^INSUFFICIENT_/.test(e.reason));assert.equal(f.draws(),0);}
});
test('zero chance with no pity blocks preview/execute; first release pity stays disabled',async()=>{
 const f=await fixture(),q=await f.quote(),config=Core.defaults('zero');config.levels[0].successRateBp=0;await f.publish(config,1);const before=await snapshot(f);await assert.rejects(f.quote(),rejectReason('ZERO_SUCCESS_RATE'));await assert.rejects(f.execute(q),rejectReason('ZERO_SUCCESS_RATE'));assert.deepEqual(await snapshot(f),before);assert.equal(f.draws(),0);
});
test('same request replay/concurrent delivery makes one draw, one payment, one immutable receipt',async()=>{
 const f=await fixture(),q=await f.quote(),id=crypto.randomUUID(),results=await Promise.all([f.execute(q,id),f.execute(q,id),f.execute(q,id)]);assert.equal(results.filter(r=>r.replayed).length,2);assert.equal(f.draws(),1);assert.equal((await f.db.collection('ops_refinement_transactions').get()).size,1);assert.equal((await f.farm()).coins,999000);assert.equal((await f.state()).revision,1);
 const before=await snapshot(f);await assert.rejects(f.execute(q,id,{instanceId:(await f.transactions.handle(f.request('listWeapons',{weaponId:'mace'}))).result.rows[0].instanceId}),{code:'already-exists'});assert.deepEqual(await snapshot(f),before);
});
test('two device quotes for same weapon are revision-bound; only one succeeds',async()=>{
 const f=await fixture(),q1=await f.quote(),q2=await f.quote(),results=await Promise.allSettled([f.execute(q1),f.execute(q2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.reason,'QUOTE_STALE');assert.equal((await f.farm()).coins,999000);assert.equal((await f.state()).refineLevel,1);
});
test('a quote can be accepted by one transaction ID only',async()=>{
 const f=await fixture(),q=await f.quote(),results=await Promise.allSettled([f.execute(q),f.execute(q)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.db.collection('ops_refinement_transactions').get()).size,1);assert.equal(f.draws(),1);
});
test('sale between intent and settlement wins without refine debit; sold weapon cannot be refined',async()=>{
 const f=await fixture(),q=await f.quote();let sold=false;f.hook(async()=>{if(sold)return;sold=true;await f.transactions.handle(f.request('sellItem',{item:'ironhammer',quantity:1,instanceIds:[f.item.instanceId],expectedWeaponRevision:(await f.owner()).revision}));});
 const coins=(await f.farm()).coins;await assert.rejects(f.execute(q),{code:'not-found'});assert.equal((await f.farm()).coins,coins+7500);assert.equal((await f.farm()).refinementStones,1000);assert.equal((await f.db.collection('ops_refinement_transactions').get()).size,0);await f.migration.verify(f.actor);
});
test('refinement winning race blocks stale sale and later refined discard/sale; no implicit refund',async()=>{
 const f=await fixture(),q=await f.quote();await f.execute(q);const before=await snapshot(f);for(const action of ['sellItem','discardItem'])await assert.rejects(f.transactions.handle(f.request(action,{item:'ironhammer',quantity:1,instanceIds:[f.item.instanceId],instanceId:f.item.instanceId,expectedWeaponRevision:(await f.owner()).revision})),{code:'failed-precondition'});assert.deepEqual(await snapshot(f),before);
});
test('lost response: query original receipt and replay after disabled gate do not spend or redraw',async()=>{
 const f=await fixture(),q=await f.quote(),id=crypto.randomUUID(),first=await f.execute(q,id),before=await snapshot(f);const queried=await f.call('getRefinementResult',{transactionId:id});assert.equal(queried.status,'completed');assert.equal(queried.refineLevel,1);f.flags.refine=false;assert.equal((await f.call('getRefinementResult',{transactionId:id})).coins,first.result.coins);assert.equal((await f.execute(q,id)).replayed,true);await assert.rejects(f.execute(q),rejectReason('FEATURE_DISABLED'));assert.deepEqual(await snapshot(f),before);assert.equal(f.draws(),1);
});
test('crash after intent retains secret roll across new invocation, pending query and changed RNG',async()=>{
 const f=await fixture();await f.execute(await f.quote());f.roll(8999);const q=await f.quote(),id=crypto.randomUUID();f.hook(()=>{throw Error('simulated process crash');});const before=await snapshot(f);await assert.rejects(f.execute(q,id),/process crash/);assert.deepEqual(await snapshot(f),before);const pending=await f.call('getRefinementResult',{transactionId:id});assert.equal(pending.status,'pending');assert.equal(pending.rollBp,undefined);f.roll(9999);f.hook(null);const result=(await f.execute(q,id)).result;assert.equal(result.success,true);assert.equal(result.refineLevel,2);assert.equal(f.draws(),2);
});
test('Firestore callback retry at reservation or settlement reuses outcome and debits exactly once',async()=>{
 for(const retryCall of [1,2]){const f=await fixture(),q=await f.quote(),original=f.db.runTransaction.bind(f.db);let transactionNumber=0;f.db.runTransaction=callback=>{const number=++transactionNumber;return original(async t=>{if(number===retryCall)await callback({...t,set:()=>{},create:()=>{},update:()=>{},delete:()=>{}});return callback(t);});};await f.execute(q);assert.equal(f.draws(),1);assert.equal((await f.farm()).coins,999000);assert.equal((await f.state()).revision,1);assert.equal((await f.db.collection('ops_refinement_transactions').get()).size,1);}
});
test('failed storage commit leaves intent pending and assets intact; retry applies original draw once',async()=>{
 const f=await fixture(),q=await f.quote(),id=crypto.randomUUID(),before=await snapshot(f);f.db.failAward=true;await assert.rejects(f.execute(q,id),/storage failure/);assert.deepEqual(await snapshot(f),before);assert.equal((await f.call('getRefinementResult',{transactionId:id})).status,'pending');await f.execute(q,id);assert.equal(f.draws(),1);assert.equal((await f.farm()).coins,999000);
});
test('forged wallet/cost/rate/owner/result fields and jump-level request are rejected before payment',async()=>{
 const f=await fixture(),q=await f.quote(),before=await snapshot(f);for(const extra of [{cost:0},{coins:9999999},{stones:0},{successRateBp:10000},{ownerId:'another'},{rollBp:0},{success:true},{expectedLevel:10}])await assert.rejects(f.execute(q,crypto.randomUUID(),extra),{code:'invalid-argument'});await assert.rejects(f.execute(q,crypto.randomUUID(),{expectedLevel:8}),rejectReason('QUOTE_STALE'));assert.deepEqual(await snapshot(f),before);assert.equal(f.draws(),0);
});
test('identity, scope, cross-owner instance/quote/result ownership remain server-verified',async()=>{
 const f=await fixture(),other=await fixture({db:f.db,actor:{uid:'other',groupId:'B',accountId:'bob'}});assert.notEqual(other.item.instanceId,f.item.instanceId,'same generation must still have globally distinct instance IDs');
 await assert.rejects(f.service.handle({...f.request('previewRefinement',{instanceId:f.item.instanceId}),auth:null}),{code:'unauthenticated'});await assert.rejects(other.quote(f.item.instanceId),{code:'permission-denied'});
 const q=await f.quote(),id=crypto.randomUUID();await f.execute(q,id);await assert.rejects(other.call('getRefinementResult',{transactionId:id}),{code:'not-found'});
 const cross=await fixture({db:f.db,actor:{...f.actor,groupId:'C'}});await assert.rejects(cross.call('getRefinementResult',{transactionId:id}),{code:'permission-denied'});await assert.rejects(cross.execute({...q,instanceId:cross.item.instanceId},id),{code:'already-exists'});
});
test('immutable version publishing, stale policy quote and tampered saved content cannot debit',async()=>{
 const f=await fixture(),q=await f.quote(),newConfig=Core.defaults('version-2');newConfig.levels[0].coins=2000;await f.publish(newConfig,1);await assert.rejects(f.execute(q),rejectReason('QUOTE_STALE'));assert.equal(f.draws(),0);await assert.rejects(f.publish(newConfig,2),{code:'already-exists'});
 const fresh=await f.quote(),ref=f.db.doc(Config.versionPath('version-2')),raw=(await ref.get()).data();await ref.set({...raw,levels:raw.levels.map((r,i)=>i? r:{...r,coins:0})});await assert.rejects(f.execute(fresh),rejectReason('CONFIG_INVALID'));assert.equal((await f.farm()).coins,1000000);
});
test('config changes after accepted intent reject old quote; cannot swap new quote into same ID',async()=>{
 const f=await fixture(),q=await f.quote(),id=crypto.randomUUID();f.hook(async()=>{f.hook(null);await f.publish(Core.defaults('v2'),1);});await assert.rejects(f.execute(q,id),rejectReason('QUOTE_STALE'));assert.equal((await f.farm()).coins,1000000);assert.equal((await f.call('getRefinementResult',{transactionId:id})).status,'rejected');await assert.rejects(f.execute(await f.quote(),id),{code:'already-exists'});
});
test('expired quote and feature gates reject without resource mutation',async()=>{
 const f=await fixture(),q=await f.quote(),before=await snapshot(f);f.clock.stamp+=120001;await assert.rejects(f.execute(q),rejectReason('QUOTE_STALE'));assert.deepEqual(await snapshot(f),before);
 for(const gate of ['refine','instances','trusted']){const g=await fixture(),quote=await g.quote(),original=await snapshot(g);g.flags[gate]=false;await assert.rejects(g.execute(quote),rejectReason('FEATURE_DISABLED'));assert.deepEqual(await snapshot(g),original);assert.equal(g.draws(),0);}
});
test('lower next-version abilities are logged as config conflict; acquired stats remain frozen',async()=>{
 const f=await fixture();for(let i=0;i<3;i++)await f.execute(await f.quote());const before=await snapshot(f),lower=Core.defaults('lower');lower.levels=lower.levels.map((r,i)=>({...r,bonus:{attack:(i+1)*100,criticalRate:(i+1)*10,chainCriticalRate:(i+1)*10}}));await f.publish(lower,1);await assert.rejects(f.quote(),rejectReason('CONFIG_CONFLICT'));assert.deepEqual(await snapshot(f),before);const conflicts=await f.db.collection('ops_refinement_conflicts').get();assert.equal(conflicts.size,1);assert.equal(conflicts.docs[0].data().configVersion,'lower');assert.equal(conflicts.docs[0].data().currentLevel,3);assert.equal(conflicts.docs[0].data().targetLevel,4);
});
test('base snapshot survives operator base reduction; high critical cap is explicit conflict, not nerf',async()=>{
 const f=await fixture();await f.execute(await f.quote());const original=(await f.state()).baseStatsSnapshot;
 await f.db.doc('ops_game_config/combat').set({revision:5,weapons:{ironhammer:{attack:1,criticalRate:0,chainCriticalRate:0}}});const q=await f.quote();assert.deepEqual(q.baseStats,original);assert.equal(q.nextStats.attack,212);
 const other=await fixture();await other.db.doc('ops_game_config/combat').set({revision:1,weapons:{ironhammer:{attack:200,criticalRate:100,chainCriticalRate:5}}});await assert.rejects(other.quote(),rejectReason('RATE_CAP_CONFLICT'));assert.equal((await other.db.collection('ops_refinement_conflicts').get()).size,1);
});
test('pity per target/person is isolated, resets only after success, initial defaults never enable it',async()=>{
 const f=await fixture(),config=Core.defaults('pity');config.levels[0].successRateBp=0;config.levels[0].pity={enabled:true,guaranteeAttempt:2};await f.publish(config,1);f.roll(9999);assert.equal((await f.execute(await f.quote())).result.success,false);
 const otherId=(await f.transactions.handle(f.request('listWeapons',{weaponId:'mace'}))).result.rows[0].instanceId;assert.equal((await f.quote(otherId)).pity.due,false);const quote=await f.quote();assert.equal(quote.pity.due,true);assert.equal((await f.execute(quote)).result.success,true);assert.equal((await f.state()).refineFailCount,0);assert.equal((await f.quote()).pity.failures,0);
});
test('battle/migration conflicts reject before debit, default gates stay false, injected RNG is test-only',async()=>{
 const f=await fixture(),q=await f.quote();await f.db.doc('ops_farm_active/'+D.hash(f.actor.uid+':'+f.actor.groupId)).set({kind:'wolf',result:null});await assert.rejects(f.execute(q),rejectReason('BATTLE_CONFLICT'));assert.equal((await f.farm()).coins,1000000);
 const config=require('../functions/weapon-instance-config.cjs');assert.equal(config.weaponInstanceEnabled,false);assert.equal(config.weaponRefinementEnabled,false);assert.equal(config.refinementCombatBonusEnabled,false);assert.throws(()=>R.createRefinementService({db:f.db,player:f.player,testRandomInt:()=>0}),/isolated test harness/);
});
test('refining free club keeps it bound and outside capacity; legacy builder still ignores private instance bonuses',async()=>{
 const f=await fixture(),id=W.clubId(f.actor),before=await f.farm(),Damage=await import('../../js/farm/combat-damage.js'),snapshotBefore=Damage.makeCombatSnapshot(before,'wolf','seed');await f.execute(await f.quote(id));const after=await f.farm();assert.equal(after.coins,before.coins-1000);assert.equal(after.equippedWeapon,before.equippedWeapon);assert.equal(after.ironhammer,before.ironhammer);assert.deepEqual(Damage.makeCombatSnapshot(after,'wolf','seed'),snapshotBefore);const club=(await f.transactions.handle(f.request('getWeapon',{instanceId:id}))).result;assert.equal(club.bound,true);assert.equal(club.refineLevel,1);
});
test('same generation across farms produces globally distinct allocations; old staged algorithms require safe restart',async()=>{
 const f=await fixture(),other=await fixture({db:f.db,actor:{...f.actor,groupId:'B'}});assert.notEqual(f.item.instanceId,other.item.instanceId);assert.notEqual((await f.owner()).equippedMeleeInstanceId,(await other.owner()).equippedMeleeInstanceId);
 const version=await other.owner();
 // Explicit old fixture without undefined values, matching Firestore encoding.
 const legacy={...version,status:'staging'};delete legacy.instanceIdVersion;await other.db.doc(W.ownerPath(other.actor)).set(legacy);await other.farmRef.update({farm:{...await other.farm(),weaponMigrationState:'staging'}});await assert.rejects(other.migration.resume(other.actor),{code:'failed-precondition'});
});
test('saved quote content cannot change player-approved costs even while active config stays unchanged',async()=>{
 const f=await fixture(),q=await f.quote(),ref=f.db.doc('ops_refinement_quotes/'+q.quoteId),raw=(await ref.get()).data();await ref.set({...raw,view:{...raw.view,cost:{coins:0,stones:0}}});await assert.rejects(f.execute(q),rejectReason('QUOTE_INVALID'));assert.equal((await f.farm()).coins,1000000);
});
test('initial unpublished or malformed config fails closed without synthesizing production settings',async()=>{
 const f=await fixture();f.db.data.delete(Config.pointerPath);await assert.rejects(f.quote(),rejectReason('CONFIG_UNPUBLISHED'));assert.equal(f.db.data.has(Config.pointerPath),false);assert.equal((await f.farm()).coins,1000000);
});
test('+9 acquired stats remain queryable while disabled or active settings are invalid',async()=>{
 const f=await fixture();for(let i=0;i<9;i++)await f.execute(await f.quote());f.flags.refine=false;f.db.data.delete(Config.pointerPath);const stats=await f.call('getRefinementStats',{instanceId:f.item.instanceId});assert.equal(stats.refineLevel,9);assert.equal(stats.stats.attack,300);assert.equal(stats.stats.criticalRateBp,2000);assert.equal(stats.refineBonusUnit,'basis-points');
});
test('existing callable service verifies private identity, current admin claims and closed default gate',async()=>{
 const f=await fixture(),I=require('../../functions/identity-domain.cjs'),{createService}=require('../functions/service.cjs');let adminEnabled=true;
 await f.db.doc('users/profile').set({accountId:'alice',name:'Alice',role:'member'});await f.db.doc('ops_identity_credentials/profile').set({authUid:I.profileUid('profile'),accountId:'alice',disabled:false,sessionVersion:1});await f.db.doc('ops_identity_state/global').set({ready:true,farmReady:true});await f.db.doc('groups/A').set({members:['alice'],farmVillageVisibility:'public'});
 const auth={getUser:async uid=>({disabled:false,customClaims:uid==='admin'&&adminEnabled?{role:'admin',refinementPermissions:['read','edit','publish','risk'],opsLegacyAccess:true}:{}})},options={db:f.db,auth,now:()=>f.clock.stamp,privateIdentityEnabled:()=>true,farmBackendEnabled:()=>true,weaponInstanceEnabled:()=>true},service=createService({...options,weaponRefinementEnabled:()=>true,refinementCombatBonusEnabled:()=>true,refinementTestEnvironment:true,refinementTestAccounts:[{uid:'profile',groupId:'A',accountId:'alice'}],refinementRandomInt:()=>0}),token={nexusProfileId:'profile',nexusAccountId:'alice',nexusSessionVersion:1,photoGroupId:'A',photoAccountId:'alice'},authPlayer={uid:I.profileUid('profile'),token};
 const req=(action,payload={})=>({auth:authPlayer,data:{action,groupId:'A',requestId:crypto.randomUUID(),...payload}});
 const q=(await service.farmTransaction(req('previewRefinement',{instanceId:f.item.instanceId}))).result,result=(await service.farmTransaction(req('refineWeapon',{instanceId:q.instanceId,quoteId:q.quoteId,configVersion:q.configVersion,expectedLevel:q.currentLevel}))).result;assert.equal(result.refineLevel,1);
 await assert.rejects(service.farmTransaction({...req('previewRefinement',{instanceId:f.item.instanceId}),auth:null}),{code:'unauthenticated'});token.nexusSessionVersion=0;await assert.rejects(service.farmTransaction(req('getRefinementStats',{instanceId:f.item.instanceId})),{code:'unauthenticated'});token.nexusSessionVersion=1;
 await assert.rejects(service.adminAPI({auth:authPlayer,data:{action:'refinementConfig'}}),{code:'permission-denied'});
 const adminReq={auth:{uid:'admin',token:{role:'admin'}},data:{action:'publishRefinementConfig',requestId:crypto.randomUUID(),payload:{config:Core.defaults('admin-v2'),expectedRevision:1}}};await assert.rejects(service.adminAPI(adminReq),{code:'failed-precondition'});
 assert.equal((await service.adminAPI({...adminReq,data:{action:'refinementConfig'}})).config.version,'refinement-v1');
 adminEnabled=false;await assert.rejects(service.adminAPI({...adminReq,data:{action:'refinementConfig'}}),{code:'permission-denied'});
 const closed=createService(options),before=await f.farm();await assert.rejects(closed.farmTransaction(req('previewRefinement',{instanceId:f.item.instanceId})),rejectReason('FEATURE_DISABLED'));assert.deepEqual(await f.farm(),before);
});
test('legacy V4 builder remains unchanged; private bonuses must enter through the trusted ability resolver',async()=>{
 const f=await fixture(),id=(await f.owner()).equippedMeleeInstanceId,Damage=await import('../../js/farm/combat-damage.js'),before=await f.farm();await f.execute(await f.quote(id));const after=await f.farm();for(const kind of ['wolf','tiger','eagle','dragon','hornet','mole','cobra','giant','gorilla']){const a=Damage.makeCombatSnapshot(before,kind,'fixed'),b=Damage.makeCombatSnapshot(after,kind,'fixed');assert.deepEqual(a,b);for(let n=0;n<80;n++)assert.deepEqual(Damage.hitResult(a,'melee',n),Damage.hitResult(b,'melee',n));}
});
test('gate closing after accepted intent does not debit, query records rejection, no reroll',async()=>{
 const f=await fixture(),q=await f.quote(),id=crypto.randomUUID(),before=await snapshot(f);f.hook(()=>{f.flags.refine=false;});await assert.rejects(f.execute(q,id),rejectReason('FEATURE_DISABLED'));assert.deepEqual(await snapshot(f),before);assert.equal((await f.call('getRefinementResult',{transactionId:id})).status,'rejected');assert.equal(f.draws(),1);
});
test('unrelated normal game transaction between intent and settlement is preserved, not overwritten',async()=>{
 const f=await fixture(),q=await f.quote();let bought=false;f.hook(async()=>{if(bought)return;bought=true;await f.transactions.handle(f.request('buyMedicine',{quantity:2}));});await f.execute(q);const farm=await f.farm();assert.equal(farm.medicines,2);assert.equal(farm.coins,1000000-20-1000);assert.equal(farm.refinementStones,999);assert.equal(farm.ironhammer,3);
});
