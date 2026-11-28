// Actual Firestore contention and candidate Rules; never use ADC/production.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const project='demo-nexus-private-farm',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^((127\.0\.0\.1)|(localhost)|(\[::1\])):[0-9]+$/.test(host||'')||process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT!==project)throw Error('Only localhost demo Firestore permitted');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore'),{createWeaponMigration}=require('../functions/migrations/weapon-instances.cjs'),W=require('../functions/weapon-repository.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs');
let db,app;test.before(()=>{app=initializeApp({projectId:project},'weapon-phase02');db=getFirestore(app);});test.after(()=>deleteApp(app));
async function fixture(count=3){
 const suffix=crypto.randomBytes(6).toString('hex'),actor={uid:'weapons-'+suffix,groupId:'weapon-group-'+suffix,accountId:'weapon-account'},ref=db.doc(W.farmPath(actor));
 await ref.set({keep:'unchanged',farm:{coins:100000,hens:0,hensState:[],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:10000,ironhammer:count,equippedWeapon:'ironhammer',equippedBow:null}});
 const migration=createWeaponMigration({db,testEnvironment:true}),repo=W.createWeaponRepository({db,enabled:()=>true}),service=createFarmTransactions({db,player:async()=>actor,enabled:()=>true,weaponInstanceEnabled:()=>true});
 const req=(action,payload={},id=crypto.randomUUID())=>({auth:{uid:actor.uid},data:{action,...payload,requestId:id}}),call=(action,payload,id)=>service.handle(req(action,payload,id)),farm=async()=>(await ref.get()).data().farm;
 async function stage(){const p=await migration.review(actor);return migration.stage(actor,{generation:'emulator-generation-'+suffix,expectedFingerprint:p.fingerprint});}
 async function migrate(){await stage();let r;do{r=await migration.resume(actor,{batchSize:1});}while(r.status==='staging');}
 return{actor,ref,migration,repo,service,req,call,farm,stage,migrate};
}
test('real Firestore migration twice gives 3 unique instances and keeps exact equipped weapon',async()=>{
 const f=await fixture();await f.migrate();await f.migrate();const list=(await f.call('listWeapons',{weaponId:'ironhammer'})).result;assert.equal(list.rows.length,3);assert.equal(new Set(list.rows.map(r=>r.instanceId)).size,3);assert.equal(list.rows.filter(r=>r.equipped).length,1);await f.migration.verify(f.actor);
});
test('real contention: parallel buys, response-loss replay and distinct-ID duplicate sale are atomic',async()=>{
 const f=await fixture();await f.migrate();const request=f.req('buyWeapon',{item:'mace',quantity:2});await Promise.all([f.service.handle(request),f.service.handle(request)]);assert.equal((await f.farm()).mace,2);
 await Promise.all([f.call('buyWeapon',{item:'shortbow',quantity:2}),f.call('buyWeapon',{item:'shortbow',quantity:2})]);assert.equal((await f.farm()).shortbow,4);
 const row=(await f.call('listWeapons',{weaponId:'mace'})).result.rows[0],payload={item:'mace',quantity:1,instanceIds:[row.instanceId],expectedWeaponRevision:row.ownerRevision};
 const results=await Promise.allSettled([f.call('sellItem',payload),f.call('sellItem',payload)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.farm()).mace,1);await f.migration.verify(f.actor);
});
test('real staging/resume blocks sale, keeps unrelated concurrent wallet update, validates all batches',async()=>{
 const f=await fixture(2001);await f.stage();await f.migration.resume(f.actor,{batchSize:1});await assert.rejects(f.call('sellItem',{item:'ironhammer',quantity:1}),{code:'failed-precondition'});await f.call('buyMedicine',{quantity:2});const coins=(await f.farm()).coins;
 await Promise.all([f.migration.resume(f.actor,{batchSize:1}),f.migration.resume(f.actor,{batchSize:1})]);assert.equal((await f.farm()).coins,coins);assert.equal((await f.farm()).medicines,2);assert.equal((await f.migration.verify(f.actor)).counts.ironhammer,2001);
});
test('real cross-owner ID access fails and transaction state remains unchanged',async()=>{
 const a=await fixture(),b=await fixture();await a.migrate();await b.migrate();const row=(await a.call('listWeapons',{weaponId:'ironhammer'})).result.rows[1],balance=(await b.farm()).coins;
 await assert.rejects(b.call('getWeapon',{instanceId:row.instanceId}),{code:'permission-denied'});await assert.rejects(b.call('sellItem',{item:'ironhammer',quantity:1,instanceIds:[row.instanceId],expectedWeaponRevision:0}),{code:'permission-denied'});assert.equal((await b.farm()).coins,balance);
});
test('candidate Rules deny client access to owners, allocations, migration and quarantine documents',async()=>{
 const {initializeTestEnvironment,assertFails}=sdk('@firebase/rules-unit-testing'),{doc,setDoc,getDoc}=sdk('firebase/firestore');
 const endpoint=new URL('http://'+host),hostname=endpoint.hostname.replace(/^\[|\]$/g,''),port=endpoint.port,env=await initializeTestEnvironment({projectId:project,firestore:{host:hostname,port:Number(port),rules:fs.readFileSync(path.resolve(__dirname,'../../rules/firestore.private-farm.candidate.rules'),'utf8')}});
 try{for(const client of [env.unauthenticatedContext().firestore(),env.authenticatedContext('random',{role:'admin'}).firestore()])for(const name of ['ops_weapon_owners/test','ops_weapon_owners/test/allocations/test','ops_refining_migrations/test','ops_weapon_quarantine/test']){await assertFails(setDoc(doc(client,name),{refineLevel:9}));await assertFails(getDoc(doc(client,name)));}}finally{await env.cleanup();}
});
