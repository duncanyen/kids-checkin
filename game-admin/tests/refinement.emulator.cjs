// Explicit localhost demo only: real Firestore transactions, no deployment.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const project='demo-nexus-private-farm',host=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^((127\.0\.0\.1)|(localhost)|(\[::1\])):[0-9]+$/.test(host||'')||process.env.GOOGLE_CLOUD_PROJECT&&process.env.GOOGLE_CLOUD_PROJECT!==project)throw Error('Only localhost demo Firestore permitted');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore'),{fixture}=require('./helpers/refinement-fixture.cjs'),W=require('../functions/weapon-repository.cjs');let app,db;
test.before(()=>{app=initializeApp({projectId:project},'refinement-phase03');db=getFirestore(app);});test.after(()=>deleteApp(app));
const make=()=>{const id=crypto.randomBytes(8).toString('hex');return fixture({db,actor:{uid:'refine-profile-'+id,groupId:'refine-group-'+id,accountId:'test-player'}});};
test('real Firestore repeated/concurrent request commits one sparse state, one debit and one receipt',async()=>{
 const f=await make(),q=await f.quote(),id=crypto.randomUUID(),results=await Promise.all([f.execute(q,id),f.execute(q,id),f.execute(q,id)]);assert.ok(results.every(r=>r.result.refineLevel===1));assert.equal((await f.farm()).coins,999000);assert.equal((await f.farm()).refinementStones,999);assert.equal((await f.state()).revision,1);await f.migration.verify(f.actor);
});
test('real contention from two device quotes permits one refinement only',async()=>{
 const f=await make(),q1=await f.quote(),q2=await f.quote(),results=await Promise.allSettled([f.execute(q1),f.execute(q2)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.farm()).coins,999000);assert.equal((await f.state()).refineLevel,1);
});
test('real sale between durable intent and settlement cannot lose extra coins/stones',async()=>{
 const f=await make(),q=await f.quote();let sold=false;f.hook(async()=>{if(sold)return;sold=true;await f.transactions.handle(f.request('sellItem',{item:'ironhammer',quantity:1,instanceIds:[f.item.instanceId],expectedWeaponRevision:(await f.owner()).revision}));});await assert.rejects(f.execute(q),{code:'not-found'});assert.equal((await f.farm()).coins,1007500);assert.equal((await f.farm()).refinementStones,1000);
});
test('real durable intent recovers a lost process with original RNG and result query',async()=>{
 const f=await make();await f.execute(await f.quote());f.roll(8999);const q=await f.quote(),id=crypto.randomUUID();f.hook(()=>{throw Error('test process interruption');});await assert.rejects(f.execute(q,id),/interruption/);assert.equal((await f.call('getRefinementResult',{transactionId:id})).status,'pending');f.hook(null);f.roll(9999);assert.equal((await f.execute(q,id)).result.refineLevel,2);assert.equal((await f.call('getRefinementResult',{transactionId:id})).status,'completed');assert.equal((await f.farm()).coins,997000);
});
test('valid Nexus member cannot write refinement state, settings, receipts or wallet using client SDK',async()=>{
 const {initializeTestEnvironment,assertFails,assertSucceeds}=sdk('@firebase/rules-unit-testing'),{doc,setDoc,getDoc,updateDoc}=sdk('firebase/firestore'),I=require('../../functions/identity-domain.cjs'),endpoint=new URL('http://'+host),env=await initializeTestEnvironment({projectId:project,firestore:{host:endpoint.hostname.replace(/^\[|\]$/g,''),port:Number(endpoint.port),rules:fs.readFileSync(path.resolve(__dirname,'../../rules/firestore.private-farm.candidate.rules'),'utf8')}}),id='refinement-rules-player';
 try{
  await env.withSecurityRulesDisabled(async context=>{const store=context.firestore();await setDoc(doc(store,'ops_identity_state/global'),{ready:true,farmReady:true});await setDoc(doc(store,'users/'+id),{accountId:id,role:'member'});await setDoc(doc(store,'ops_identity_credentials/'+id),{accountId:id,authUid:I.profileUid(id),disabled:false,sessionVersion:1});await setDoc(doc(store,'groups/refinement-rules'),{members:[id],farmVillageVisibility:'closed'});await setDoc(doc(store,'groups/refinement-rules/users/'+id),{farm:{coins:100,refinementStones:3}});});
  const store=env.authenticatedContext(I.profileUid(id),{nexusProfileId:id,nexusAccountId:id,nexusSessionVersion:1}).firestore();await assertSucceeds(getDoc(doc(store,'groups/refinement-rules/users/'+id)));
  for(const name of ['ops_weapon_owners/owner/states/weapon','ops_refinement_intents/intent','ops_refinement_transactions/tx','ops_refinement_quotes/quote','ops_refinement_versions/v1','ops_game_config/refining']){await assertFails(setDoc(doc(store,name),{refineLevel:9,success:true}));await assertFails(getDoc(doc(store,name)));}
  await assertFails(updateDoc(doc(store,'groups/refinement-rules/users/'+id),{'farm.coins':99999,'farm.refinementStones':99999}));
 }finally{await env.cleanup();}
});
