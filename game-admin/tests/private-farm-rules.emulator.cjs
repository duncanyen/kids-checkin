// 只可使用 Firestore Emulator；不連線正式 Firebase。
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),I=require('../../functions/identity-domain.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('需要 Firestore Emulator，不允許正式測試');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeTestEnvironment,assertFails,assertSucceeds}=sdk('@firebase/rules-unit-testing'),{doc,setDoc,updateDoc,getDoc,getDocs,collection,deleteDoc,query,where}=sdk('firebase/firestore');
let env;const token=(id,version=1)=>({nexusProfileId:id,nexusAccountId:id,nexusSessionVersion:version});
const client=(id,version=1)=>env.authenticatedContext(I.profileUid(id),token(id,version)).firestore();
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-nexus-private-farm',firestore:{host:'127.0.0.1',port:8092,rules:fs.readFileSync(path.resolve(__dirname,'../../rules/firestore.private-farm.candidate.rules'),'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'ops_identity_state','global'),{ready:true,farmReady:true});for(const id of ['alice','bob']){await setDoc(doc(db,'users',id),{accountId:id,name:id,role:'member'});await setDoc(doc(db,'ops_identity_credentials',id),{authUid:I.profileUid(id),accountId:id,disabled:false,sessionVersion:1});}await setDoc(doc(db,'groups','A'),{members:['alice'],farmVillageVisibility:'closed'});await setDoc(doc(db,'groups','B'),{members:['bob'],farmVillageVisibility:'closed'});await setDoc(doc(db,'groups','A','users','alice'),{farm:{coins:100,guardDogs:[]},farmMail:{welcomeClaimedAt:1}});await setDoc(doc(db,'groups','B','users','bob'),{farm:{coins:200}});});
});
test.after(async()=>env?.cleanup());
test('anonymous, forged UID, revoked version and ordinary Firebase admin claims cannot act as Nexus player',async()=>{
 for(const db of [env.unauthenticatedContext().firestore(),env.authenticatedContext('alice',token('alice')).firestore(),client('alice',0),env.authenticatedContext('admin',{role:'admin'}).firestore()])await assertFails(getDoc(doc(db,'users','alice')));
 await assertSucceeds(getDoc(doc(client('alice'),'users','alice')));
});
test('all client routes to coins, chicken, inventory, lease, welcome receipt and creation receipt are denied',async()=>{
 const db=client('alice'),owner=doc(db,'groups','A','users','alice');
 for(const changes of [{'farm.coins':999999},{'farm.hens':100},{'farm.inventoryEggs':99},{'farm.guardDogs':[{expiresAt:9999999999999}]},{'farmMail.welcomeClaimedAt':null}])await assertFails(updateDoc(owner,changes));
 await assertFails(deleteDoc(owner));await assertFails(setDoc(doc(db,'groups','A','users','new'),{farm:{coins:999}}));await assertFails(setDoc(doc(db,'groups','A','users','alice','farm_meta','creation'),{}));await assertFails(setDoc(doc(db,'groups','A','users','alice','farm_notifications','welcome-v1'),{reward:{coins:999}}));
});
test('membership, credential and ops namespace have no broad allow bypass',async()=>{
 const db=client('alice');await assertFails(updateDoc(doc(db,'groups','A'),{members:['alice','bob']}));await assertFails(updateDoc(doc(db,'users','alice'),{pin:'1234',role:'admin'}));await assertSucceeds(updateDoc(doc(db,'users','alice'),{avatar:'https://example.test/a.png'}));await assertFails(updateDoc(doc(db,'users','alice'),{avatar:'https://example.test/\" onerror=alert(1)'}));
 for(const name of ['ops_daily_days','ops_daily_grants','ops_farm_transactions','ops_verified_farm_events','ops_identity_credentials','ops_group_roles','ops_future_collection']){await assertFails(getDocs(collection(db,name)));await assertFails(setDoc(doc(db,name,'x'),{}));await assertFails(setDoc(doc(db,name,'x','nested','y'),{}));}
});
test('own/private/public farm reads and real profile queries retain intended access',async()=>{
 const db=client('alice');await assertSucceeds(getDoc(doc(db,'groups','A','users','alice')));await assertFails(getDoc(doc(db,'groups','B','users','bob')));
 await assertSucceeds(getDocs(query(collection(db,'users'),where('accountId','in',['alice','bob']))));await assertSucceeds(getDocs(collection(db,'groups')));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'groups','B'),{farmVillageVisibility:'public'}));await assertSucceeds(getDoc(doc(db,'groups','B','users','bob')));
});
