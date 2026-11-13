// Real Firestore integration only; an emulator is mandatory and production is forbidden.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Emulators are required; production access is forbidden');
const backend=createRequire(path.resolve(__dirname,'../functions/package.json')),clientSDK=createRequire(path.resolve(__dirname,'../../functions/package.json'));
const {initializeApp}=backend('firebase-admin/app'),{getFirestore}=backend('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails}=clientSDK('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,deleteDoc}=clientSDK('firebase/firestore');
const {fixture}=require('./fixture.cjs');
const app=initializeApp({projectId:'demo-daily-challenges'},'daily-integration'),db=getFirestore(app);
const fragment=fs.readFileSync(path.resolve(__dirname,'../rules/firestore.daily.fragment.rules'),'utf8');
let env;
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-daily-challenges',firestore:{host:'127.0.0.1',port:8085,rules:`rules_version='2';service cloud.firestore {match /databases/{database}/documents {${fragment}}}`}});});
test.after(async()=>{await env?.cleanup();await db.terminate();});
test('concurrent Firestore transactions create exactly one daily grant and one increment',async()=>{
 await env.clearFirestore();const f=await fixture(db);f.clock(Date.parse('2026-11-13T04:00:00Z'));
 const request=f.request();request.data.action='status';const s=await f.service.dailyChallenges(request),c=s.challenges.checkin;
 const claim={...request,data:{...request.data,action:'claim',type:'checkin',dateKey:s.dateKey,cycleId:c.cycleId,day:c.day}};
 const results=await Promise.all(Array.from({length:6},()=>f.service.dailyChallenges(claim)));
 assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal((await db.collection('ops_daily_grants').get()).size,1);
 assert.equal((await db.doc('groups/A/users/alice').get()).data().farm.coins,300);
});
test('private state, grants, config and source events cannot be read, forged or deleted by anonymous, player or admin browser clients',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('alice',{photoAccountId:'alice',photoGroupId:'A'}),env.authenticatedContext('admin',{role:'admin'})]){
  const client=context.firestore();
  for(const collection of ['ops_daily_configs','ops_daily_states','ops_daily_days','ops_daily_grants','ops_daily_events','ops_verified_farm_events']){
   const ref=doc(client,collection,'forged');await assertFails(getDoc(ref));await assertFails(setDoc(ref,{coins:999999,progress:{DEFEAT_MONSTER:3}}));await assertFails(deleteDoc(ref));
  }
 }
});
