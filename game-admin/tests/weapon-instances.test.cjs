const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),W=require('../functions/weapon-repository.cjs'),{createWeaponMigration}=require('../functions/migrations/weapon-instances.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),{createService}=require('../functions/service.cjs'),D=require('../functions/domain.cjs');
function fixture({count=3,enabled=true}={}){
 const db=new MemoryDB(),actor={uid:'profile',groupId:'A',accountId:'alice'},stamp=1800000000000;
 db.data.set(W.farmPath(actor),{keep:'unchanged',farm:{coins:1000000,hens:0,hensState:[],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:200000,coopLevel:1,ironhammer:count,equippedWeapon:count?'ironhammer':'club',equippedBow:null}});
 db.data.set('groups/A',{members:['alice'],farmVillageVisibility:'public'});
 const migration=createWeaponMigration({db,now:()=>stamp,testEnvironment:true}),repository=W.createWeaponRepository({db,enabled:()=>enabled});
 const service=createFarmTransactions({db,now:()=>stamp,player:async()=>actor,enabled:()=>true,weaponInstanceEnabled:()=>enabled,random:()=>.99});
 const farm=()=>db.data.get(W.farmPath(actor)).farm,request=(action,payload={},requestId=crypto.randomUUID())=>({auth:{uid:actor.uid},data:{action,...payload,requestId}}),call=(action,payload,id)=>service.handle(request(action,payload,id)),list=async(options={})=>(await call('listWeapons',options)).result;
 const migrate=async()=>{const plan=await migration.review(actor);await migration.stage(actor,{generation:'phase02-test-generation',expectedFingerprint:plan.fingerprint});let r;do{r=await migration.resume(actor,{batchSize:1});}while(r.status==='staging');return r;};
 return{db,actor,stamp,migration,repository,service,farm,request,call,list,migrate};
}
const rowPayload=(row,more={})=>({item:row.weaponId,expectedWeaponRevision:row.ownerRevision,...more});
test('3 stacked weapons become 3 distinct +0 instances; two migration runs cannot create 6; equipment retained',async()=>{
 const f=fixture();await f.migrate();await f.migrate();const result=await f.list({weaponId:'ironhammer'});assert.equal(result.rows.length,3);assert.equal(new Set(result.rows.map(r=>r.instanceId)).size,3);assert.equal(result.rows.filter(r=>r.equipped).length,1);for(const r of result.rows){assert.equal(r.refineLevel,0);assert.deepEqual(r.refineBonus,{attack:0,criticalRate:0,chainCriticalRate:0});assert.equal(r.ownerId,W.scope(f.actor));}assert.equal(f.farm().ironhammer,3);assert.equal((await f.migration.verify(f.actor)).valid,true);
});
test('buy 2 produces distinct IDs, original receipt replays after reload; sell exactly one leaves its siblings',async()=>{
 const f=fixture();await f.migrate();const request=f.request('buyWeapon',{item:'mace',quantity:2});await f.service.handle(request);await f.service.handle(request);
 const rows=(await f.list({weaponId:'mace'})).rows;assert.equal(rows.length,2);assert.notEqual(rows[0].instanceId,rows[1].instanceId);const payload=rowPayload(rows[0],{quantity:1,instanceIds:[rows[0].instanceId]});await f.call('sellItem',payload);assert.equal((await f.list({weaponId:'mace'})).rows[0].instanceId,rows[1].instanceId);assert.equal(f.farm().coins,997000);await f.migration.verify(f.actor);
});
test('exact-instance equip, unequip, bound free club, special katana ownership and unchanged unpublished status',async()=>{
 const f=fixture();f.farm().katana=1;await f.migrate();const list=await f.list({weaponId:'ironhammer'}),other=list.rows.find(r=>!r.equipped);
 await f.call('equipWeapon',rowPayload(other,{instanceId:other.instanceId,currentlyEquipped:false}));assert.equal((await f.call('getWeapon',{instanceId:other.instanceId})).result.equipped,true);
 const current=(await f.list({weaponId:'ironhammer'})).rows.find(r=>r.equipped);await f.call('equipWeapon',rowPayload(current,{instanceId:current.instanceId,currentlyEquipped:true}));assert.equal(f.farm().equippedWeapon,'club');
 const club=(await f.list({weaponId:'club'})).rows[0];assert.equal(club.equipped,true);assert.equal(club.bound,true);
 await assert.rejects(f.call('discardItem',rowPayload(club,{instanceId:club.instanceId})),{code:'invalid-argument'});
 assert.equal((await f.list({weaponId:'katana'})).rows.length,1);await assert.rejects(f.call('buyWeapon',{item:'katana',quantity:1}),{code:'failed-precondition'});
});
test('same account across groups and another player cannot read, sell or equip an instance',async()=>{
 const f=fixture();await f.migrate();const id=(await f.list({weaponId:'ironhammer'})).rows[1].instanceId;
 const other={...f.actor,groupId:'B'};f.db.data.set(W.farmPath(other),{farm:structuredClone(f.farm())});
 const h={...f.db.data.get(W.ownerPath(f.actor)),ownerId:W.scope(other),groupId:'B'};f.db.data.set(W.ownerPath(other),h);
 await assert.rejects(f.db.runTransaction(t=>f.repository.get(t,other,f.db.data.get(W.farmPath(other)).farm,id)),{code:'permission-denied'});
 await assert.rejects(f.call('sellItem',{item:'ironhammer',quantity:1,instanceIds:[id,id],expectedWeaponRevision:0}),{code:'invalid-argument'});
});
test('multi-device duplicate sale/equip use expected revision; concurrent purchases both commit without loss',async()=>{
 const f=fixture();await f.migrate();const row=(await f.list({weaponId:'ironhammer'})).rows.find(r=>!r.equipped),payload=rowPayload(row,{quantity:1,instanceIds:[row.instanceId]});
 const results=await Promise.allSettled([f.call('sellItem',payload),f.call('sellItem',payload),f.call('equipWeapon',rowPayload(row,{instanceId:row.instanceId,currentlyEquipped:false}))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.farm().ironhammer,2);
 await Promise.all([f.call('buyWeapon',{item:'mace',quantity:2}),f.call('buyWeapon',{item:'mace',quantity:2})]);assert.equal(f.farm().mace,4);assert.equal((await f.list({weaponId:'mace'})).rows.length,4);await f.migration.verify(f.actor);
});
test('staging blocks weapon writers and battle entry, preserves latest coins and other assets; resume and retry original purchase',async()=>{
 const f=fixture({count:2001}),plan=await f.migration.review(f.actor);const pending=f.request('buyWeapon',{item:'mace',quantity:2});
 await f.migration.stage(f.actor,{generation:'phase02-test-generation',expectedFingerprint:plan.fingerprint});await f.migration.resume(f.actor,{batchSize:1});
 await assert.rejects(f.service.handle(pending),{code:'failed-precondition'});await assert.rejects(f.call('homeEncounter'),{code:'failed-precondition'});
 await f.call('buyMedicine',{quantity:2});const latest=f.farm().coins;
 await f.migration.resume(f.actor,{batchSize:1});await f.migration.resume(f.actor,{batchSize:1});assert.equal(f.farm().coins,latest);assert.equal(f.farm().medicines,2);assert.equal(f.farm().ironhammer,2001);
 await f.service.handle(pending);assert.equal(f.farm().mace,2);assert.equal(f.db.data.get(W.farmPath(f.actor)).keep,'unchanged');await f.migration.verify(f.actor);
});
test('stale dry-run cannot overwrite purchases before gate; anomalous data quarantined without modifying farm',async()=>{
 const f=fixture(),plan=await f.migration.review(f.actor);await f.call('buyWeapon',{item:'mace',quantity:1});await assert.rejects(f.migration.stage(f.actor,{generation:'phase02-test-generation',expectedFingerprint:plan.fingerprint}),{code:'failed-precondition'});
 f.farm().ironhammer=1.5;const before=structuredClone(f.farm());assert.equal((await f.migration.review(f.actor)).valid,false);assert.equal((await f.migration.stage(f.actor,{generation:'phase02-test-generation',expectedFingerprint:'bad'})).quarantined,true);assert.deepEqual(f.farm(),before);
});
test('partial rollback preserves current unrelated assets; after new instance operation requires forward repair',async()=>{
 const f=fixture({count:1001}),p=await f.migration.review(f.actor);await f.migration.stage(f.actor,{generation:'phase02-test-generation',expectedFingerprint:p.fingerprint});await f.migration.resume(f.actor,{batchSize:1});await f.call('buyMedicine',{quantity:1});const balance=f.farm().coins;await f.migration.rollback(f.actor);assert.equal(f.farm().weaponSchemaVersion,undefined);assert.equal(f.farm().coins,balance);
 const g=fixture();await g.migrate();await g.call('buyWeapon',{item:'mace',quantity:1});await assert.rejects(g.migration.rollback(g.actor),{code:'failed-precondition'});
});
test('legacy path and switch off preserve existing operations without new collections; migrated assets never fall back to stacks',async()=>{
 const f=fixture({enabled:false});await f.call('buyWeapon',{item:'mace',quantity:2});assert.equal((await f.list()).schemaVersion,1);assert.equal((await f.db.collection('ops_weapon_owners').get()).size,0);
 await f.migrate();await f.call('buyWeapon',{item:'mace',quantity:1});assert.equal((await f.list({weaponId:'mace'})).rows.length,3);await f.migration.verify(f.actor);
 assert.equal(require('../functions/weapon-instance-config.cjs').weaponInstanceEnabled,false);
});
test('sold-out allocation pagination and cursor revision changes do not skip owned weapons',async()=>{
 const f=fixture({count:1001});await f.migrate();let cursor=null,ids=[];do{const page=await f.list({weaponId:'ironhammer',pageSize:37,...(cursor?{cursor}:{})});ids.push(...page.rows.map(r=>r.instanceId));cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,1001);assert.equal(new Set(ids).size,1001);
 const page=await f.list({pageSize:2});await f.call('buyWeapon',{item:'mace',quantity:1});await assert.rejects(f.list({cursor:page.nextCursor,pageSize:2}),{code:'failed-precondition'});
});
test('storage failure is atomic; same ID after reconnect or new service gives exactly the original acquisition',async()=>{
 const f=fixture();await f.migrate();const request=f.request('buyWeapon',{item:'mace',quantity:2}),coins=f.farm().coins;f.db.failAward=true;await assert.rejects(f.service.handle(request),/storage failure/);assert.equal(f.farm().coins,coins);assert.equal((await f.list({weaponId:'mace'})).rows.length,0);
 await f.service.handle(request);const after=(await f.list({weaponId:'mace'})).rows.map(r=>r.instanceId);const other=createFarmTransactions({db:f.db,player:async()=>f.actor,enabled:()=>true,weaponInstanceEnabled:()=>true});await other.handle(request);assert.deepEqual((await f.list({weaponId:'mace'})).rows.map(r=>r.instanceId),after);
});
test('chest and gift allocations share transaction; staged gifts cannot consume quotas',async()=>{
 const f=fixture();await f.migrate();const C=require('../functions/chests.cjs');const box='weapon-chest-test';f.farm().chestCount=1;
 f.db.data.set(C.ownerPath(f.actor)+'/'+box,{...f.actor,id:box,status:'unopened',monster:'eagle',configRevision:1,snapshot:{dropRate:100,coins:{enabled:false,min:0,max:0},items:[{itemId:'mace',quantity:2}]}});
 await f.call('openChest',{chestId:box});assert.equal((await f.list({weaponId:'mace'})).rows.length,2);await f.call('openChest',{chestId:box});assert.equal((await f.list({weaponId:'mace'})).rows.length,2);
 f.db.data.set('users/profile',{accountId:'alice',name:'Alice',role:'member'});const auth={getUser:async()=>({disabled:false,customClaims:{role:'admin'}})},service=createService({db:f.db,auth,now:()=>f.stamp,weaponInstanceEnabled:()=>true});
 const admin={uid:'admin',token:{role:'admin'}},payload={name:'Weapon Gift',description:'',type:'universal',rewards:[{kind:'item',itemKey:'shortbow',amount:2}],maxRedemptions:null,maxRedemptionsPerUser:1,targetAccountIds:[],startAt:f.stamp-1,endAt:f.stamp+10000,status:'active',code:'WEAPON2026'};
 await service.adminAPI({auth:admin,data:{action:'saveGift',payload,requestId:crypto.randomUUID()}});const req={auth:{uid:'profile',token:{photoGroupId:'A',photoAccountId:'alice'}},data:{groupId:'A',code:'WEAPON2026',requestId:crypto.randomUUID()}};
 await service.redeem(req);await service.redeem(req);assert.equal((await f.list({weaponId:'shortbow'})).rows.length,2);await f.migration.verify(f.actor);
});
test('max existing batch reward (20 x 7 x 1000 weapons) fits allocation write budget without truncation',async()=>{
 const f=fixture({count:0});await f.migrate();const next={...f.farm()};for(const id of W.WEAPON_IDS)next[id]=20000;
 await f.db.runTransaction(async t=>{const commit=await f.repository.prepareChange({t,actor:f.actor,before:f.farm(),next,source:'large-reward',stamp:f.stamp,action:'award'});commit();t.update(f.db.doc(W.farmPath(f.actor)),{farm:next});});
 assert.equal((await f.migration.verify(f.actor)).documents,140);assert.equal(f.farm().paladinbow,20000);
});
test('all +0 weapon/enemy damage and critical sequences remain byte-identical to legacy combat input',async()=>{
 const f=fixture();for(const id of W.WEAPON_IDS)f.farm()[id]=1;await f.migrate();const C=await import('../../js/farm/combat-rules.js'),Damage=await import('../../js/farm/combat-damage.js');
 const catalog=Object.keys(C.WEAPONS_CONFIG),enemies=Object.keys(C.ENEMY_HEALTH);
 for(const kind of enemies)for(const melee of catalog.filter(id=>!W.RANGED.has(id)))for(const bow of catalog.filter(id=>W.RANGED.has(id))){
  const input={...f.farm(),equippedWeapon:melee,equippedBow:bow},legacy={...input};for(const k of ['weaponSchemaVersion','weaponGeneration','weaponInstanceRevision','weaponMigrationState'])delete legacy[k];
  const a=Damage.makeCombatSnapshot(input,kind,'same-seed'),b=Damage.makeCombatSnapshot(legacy,kind,'same-seed');assert.deepEqual(a,b);assert.equal(a.maxHealth,C.ENEMY_HEALTH[kind]);assert.equal(a.weapons.melee,melee);assert.equal(a.weapons.ranged,bow);
  for(const mode of ['melee','ranged'])for(let n=0;n<60;n++)assert.deepEqual(Damage.hitResult(a,mode,n),Damage.hitResult(b,mode,n));
 }
});

test('legacy missing equipment defaults normalize to bound club without adding capacity',async()=>{
 const f=fixture({count:0});delete f.farm().equippedWeapon;delete f.farm().equippedBow;await f.migrate();assert.equal(f.farm().equippedWeapon,'club');assert.equal((await f.list()).rows.length,1);await f.migration.verify(f.actor);
});
test('old v1 sell/equip payloads on v2 fail without spending or picking an arbitrary instance',async()=>{
 const f=fixture();await f.migrate();const farm=structuredClone(f.farm());await assert.rejects(f.call('sellItem',{item:'ironhammer',quantity:1}),{code:'invalid-argument'});await assert.rejects(f.call('equipWeapon',{item:'ironhammer',currentlyEquipped:true}),{code:'failed-precondition'});assert.deepEqual(f.farm(),farm);
});
test('staged external gift cannot create old stacks or consume a claim; same request succeeds after resume',async()=>{
 const f=fixture(),p=await f.migration.review(f.actor);await f.migration.stage(f.actor,{generation:'phase02-test-generation',expectedFingerprint:p.fingerprint});
 f.db.data.set('users/profile',{accountId:'alice',role:'member'});const service=createService({db:f.db,auth:{getUser:async()=>({disabled:false,customClaims:{role:'admin'}})},now:()=>f.stamp,weaponInstanceEnabled:()=>true});
 await service.adminAPI({auth:{uid:'admin',token:{role:'admin'}},data:{action:'saveGift',requestId:crypto.randomUUID(),payload:{name:'Staged Gift',description:'',type:'single',rewards:[{kind:'item',itemKey:'mace',amount:2}],maxRedemptions:1,maxRedemptionsPerUser:1,targetAccountIds:[],startAt:f.stamp-1,endAt:f.stamp+10000,status:'active',code:'STAGED2026'}}});
 const req={auth:{uid:'profile',token:{photoGroupId:'A',photoAccountId:'alice'}},data:{groupId:'A',code:'STAGED2026',requestId:crypto.randomUUID()}};
 await assert.rejects(service.redeem(req),{code:'failed-precondition'});assert.equal((await f.db.collection('ops_receipts').get()).size,0);assert.equal((await f.db.collection('ops_gifts').get()).docs[0].data().redeemedCount,0);
 await f.migration.resume(f.actor);await service.redeem(req);assert.equal((await f.list({weaponId:'mace'})).rows.length,2);assert.equal((await f.db.collection('ops_gifts').get()).docs[0].data().redeemedCount,1);
});
test('migration CLI rejects production/non-local destinations before loading any Admin SDK',()=>{
 const {spawnSync}=require('node:child_process'),run=env=>spawnSync(process.execPath,['scripts/weapon-instance-migration.cjs','--project','homebasedb','--profile','a','--group','b','--account','c'],{encoding:'utf8',env:{...process.env,...env}});
 for(const host of ['', 'remote.example:8092','127.0.0.1:8092']){const result=run({FIRESTORE_EMULATOR_HOST:host});assert.notEqual(result.status,0);assert.match(result.stderr,/拒絕正式資料連線/);}
});
