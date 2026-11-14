// 必須在 Emulator 執行，不可退回正式 Firebase。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('僅允許 Firestore Emulator');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=sdk('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,collection,getDocs}=sdk('firebase/firestore');
let env;
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-nexus-rules-review',firestore:{host:'127.0.0.1',port:8091,rules:fs.readFileSync(path.resolve(__dirname,'../../rules/firestore.ops-protection.candidate.rules'),'utf8')}});});
test.after(async()=>{await env?.cleanup();});
test('all ops namespaces deny browser reads, queries, writes and nested writes, including admin-claim browsers',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('player'),env.authenticatedContext('admin',{role:'admin'})]){
  const db=context.firestore();
  for(const name of ['ops_daily_days','ops_daily_grants','ops_verified_farm_events','ops_farm_report_events','ops_audit','ops_future_collection']){
   await assertFails(getDoc(doc(db,name,'test')));await assertFails(getDocs(collection(db,name)));await assertFails(setDoc(doc(db,name,'test'),{value:1}));await assertFails(setDoc(doc(db,name,'test','nested','test'),{value:1}));
  }
 }
});
test('transition intentionally preserves legacy access before the original expiry; this is NOT economic protection',async()=>{
 const db=env.unauthenticatedContext().firestore(),allowed=Date.now()<Date.UTC(2026,11,16);
 const expect=allowed?assertSucceeds:assertFails;
 for(const name of ['users','groups','messages','photos'])await expect(setDoc(doc(db,name,'fixture'),{name:'isolated test'}));
 // 明確證明 farm.coins 仍能由未登入者寫入，不能宣稱每日任務資料已可信任。
 await expect(setDoc(doc(db,'groups','fixture','users','player'),{farm:{coins:999999}}));
});
test('trusted backend bypass still writes the protected namespace',async()=>{
 await env.withSecurityRulesDisabled(async context=>{await setDoc(doc(context.firestore(),'ops_daily_grants','backend-only'),{amount:100});assert.equal((await getDoc(doc(context.firestore(),'ops_daily_grants','backend-only'))).exists(),true);});
});
