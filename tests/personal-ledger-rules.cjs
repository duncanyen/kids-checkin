// Never contact production. Uses the exact fragment shipped with this change.
const test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('FIRESTORE_EMULATOR_HOST is required; production access is forbidden');
const requireSDK=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=requireSDK('@firebase/rules-unit-testing');
const {collection,doc,setDoc,getDoc,getDocs,updateDoc,deleteDoc,query,where,getAggregateFromServer,sum,serverTimestamp}=requireSDK('firebase/firestore');
const fragment=fs.readFileSync(path.resolve(__dirname,'../rules/personal-ledger.rules.fragment'),'utf8');
const rules=`rules_version='2';service cloud.firestore { match /databases/{database}/documents {
${fragment}
match /{path=**} { allow read,write: if false; }
}}`;
let env;
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-personal-ledger',firestore:{rules}});
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async context=>{
  for(const [uid,accountId,role] of [['uid-alice','alice','member'],['uid-bob','bob','parent'],['uid-removed','removed','removed']]){
   await setDoc(doc(context.firestore(),'users',uid),{accountId,role});
  }
 });
});
test.after(async()=>env?.cleanup());
const client=(uid,accountId)=>env.authenticatedContext(uid,{photoAccountId:accountId,photoGroupId:'A'}).firestore();
const entry=()=>({accountId:'alice',date:'2026-11-11',type:'expense',amount:20.5,category:'早餐',note:'',operator:'Alice',timestamp:serverTimestamp()});
test('account ownership, private categories, CRUD, aggregate queries and immutable identity',async()=>{
 const db=client('uid-alice','alice'),ref=doc(db,'personalLedgers/alice/expenses/private');
 await assertSucceeds(setDoc(ref,entry()));
 await assertSucceeds(getDoc(ref));
 await assertSucceeds(getDocs(query(collection(db,'personalLedgers/alice/expenses'),where('date','>=','2026-11-01'))));
 await assertSucceeds(getAggregateFromServer(collection(db,'personalLedgers/alice/expenses'),{amount:sum('amount')}));
 await assertSucceeds(updateDoc(ref,{amount:30,note:'補記',type:'income'}));
 await assertFails(updateDoc(ref,{accountId:'bob'}));
 await assertFails(updateDoc(ref,{groupId:'A'}));
 await assertFails(updateDoc(ref,{timestamp:serverTimestamp()}));
 await assertFails(updateDoc(ref,{amount:-1}));
 await assertFails(updateDoc(ref,{note:'x'.repeat(101)}));
 const category=doc(db,'personalLedgers/alice/customCategories/one');
 await assertSucceeds(setDoc(category,{accountId:'alice',type:'expense',name:'私人',icon:'cart',imgBase64:null,color:'#e53935'}));
 await assertSucceeds(updateDoc(category,{name:'更新'}));
 await assertFails(updateDoc(category,{accountId:'bob'}));
 await assertSucceeds(deleteDoc(category));
 await assertSucceeds(setDoc(doc(db,'personalLedgers/alice'),{defaultMode:'personal',homepageSource:'group'}));
 await assertFails(updateDoc(doc(db,'personalLedgers/alice'),{homepageSource:'unknown'}));
 await assertFails(updateDoc(doc(db,'personalLedgers/alice'),{admin:true}));
 await assertSucceeds(deleteDoc(ref));
});
test('same-group members, anonymous and untrusted identity claims cannot access another account',async()=>{
 for(const db of [client('uid-bob','bob'),env.unauthenticatedContext().firestore(),client('uid-bob','alice'),client('missing-user','alice'),client('uid-removed','removed')]){
  const account='alice';
  await assertFails(getDoc(doc(db,`personalLedgers/${account}`)));
  await assertFails(getDocs(collection(db,`personalLedgers/${account}/expenses`)));
  await assertFails(setDoc(doc(db,`personalLedgers/${account}/expenses/forged`),entry()));
  await assertFails(getDocs(collection(db,`personalLedgers/${account}/customCategories`)));
  await assertFails(setDoc(doc(db,`personalLedgers/${account}`),{defaultMode:'personal',homepageSource:'personal'}));
 }
 // Disabled status must be enforced even when the token accountId matches the path.
 const removed=client('uid-removed','removed');
 await assertFails(getDoc(doc(removed,'personalLedgers/removed')));
 await assertFails(setDoc(doc(removed,'personalLedgers/removed/expenses/forged'),{...entry(),accountId:'removed'}));
});
test('a group switch does not change ownership; parent role grants no access to another personal ledger',async()=>{
 const aliceOther=env.authenticatedContext('uid-alice',{photoAccountId:'alice',photoGroupId:'B'}).firestore();
 await assertSucceeds(getDoc(doc(aliceOther,'personalLedgers/alice')));
 await assertFails(getDoc(doc(client('uid-bob','bob'),'personalLedgers/alice')));
});
