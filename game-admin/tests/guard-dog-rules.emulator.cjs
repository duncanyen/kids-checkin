// Isolated security-rule checks. Never run against production.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore Emulator is required; production connections are forbidden');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json'));
const {initializeTestEnvironment,assertFails,assertSucceeds}=sdk('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,deleteField}=sdk('firebase/firestore');
const fragment=fs.readFileSync(path.resolve(__dirname,'../rules/firestore.guard-dogs.fragment.rules'),'utf8');
// The ownership allow below is a test fixture, not a replacement for Nexus rules.
const rules=`rules_version='2';service cloud.firestore {match /databases/{database}/documents {
${fragment}
match /groups/{groupId}/users/{accountId} {
 allow read: if request.auth!=null && request.auth.uid==accountId;
 allow create,update: if request.auth!=null && request.auth.uid==accountId && guardDogsPreserved();
}
match /ops_guard_requests/{path=**} {allow read,write:if false;}
}}`;
let env;
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-nexus-ops',firestore:{host:'127.0.0.1',port:8085,rules}});});
test.after(async()=>env?.cleanup());
test('direct client writes cannot create, replace, append, remove or extend guard leases; unrelated farm updates still work',async()=>{
 const client=env.authenticatedContext('alice').firestore(),ref=doc(client,'groups/A/users/alice');
 await assertSucceeds(setDoc(ref,{farm:{coins:100,hens:1}}));
 const collie={id:'forged',breedId:'collie',days:1,paid:0,startedAt:0,expiresAt:9999999999999};
 await assertFails(updateDoc(ref,{'farm.guardDogs':[collie]}));
 await assertFails(setDoc(ref,{farm:{coins:100,hens:1,guardDogs:[collie]}}));
 await assertFails(setDoc(doc(client,'groups/B/users/alice'),{farm:{coins:100,hens:1,guardDogs:[collie]}}));
 await env.withSecurityRulesDisabled(async context=>setDoc(doc(context.firestore(),'groups/A/users/alice'),{farm:{coins:100,hens:1,guardDogs:[{...collie,id:'existing',paid:200000}]}}));
 await assertFails(updateDoc(ref,{'farm.guardDogs':[]}));
 await assertFails(updateDoc(ref,{'farm.guardDogs':deleteField()}));
 await assertFails(updateDoc(ref,{'farm.guardDogs':[{...collie,id:'existing',paid:200000,expiresAt:9999999999998}]}));
 await assertFails(updateDoc(ref,{'farm.guardDogs':[{...collie,id:'existing',paid:200000},collie]}));
 await assertSucceeds(updateDoc(ref,{'farm.coins':90,'farm.hens':2}));
 assert.equal((await getDoc(ref)).data().farm.guardDogs[0].paid,200000);
});
test('players, anonymous clients and browser admin claims cannot forge trusted guard receipts',async()=>{
 for(const context of [env.unauthenticatedContext(),env.authenticatedContext('alice'),env.authenticatedContext('admin',{role:'admin'})]){
  const ref=doc(context.firestore(),'ops_guard_requests/forged');await assertFails(setDoc(ref,{paid:0}));await assertFails(getDoc(ref));
 }
});
