// Run only through growth-forest/firebase.json emulators:exec. Never uses production.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const sdk=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeTestEnvironment,assertSucceeds,assertFails}=sdk('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,collection,query,where,getDocs}=sdk('firebase/firestore');
const {ref,uploadBytes,getBytes}=sdk('firebase/storage');
const projectId='demo-nexus-growth';
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_STORAGE_EMULATOR_HOST)throw Error('Growth integration requires Firestore and Storage Emulators; refusing production fallback');
let env;
test.before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.resolve(__dirname,'../growth-forest/firestore.rules'),'utf8')},storage:{rules:fs.readFileSync(path.resolve(__dirname,'../storage.rules'),'utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();for(const [id,role]of [['alice','child'],['parent','parent'],['bob','child']])await setDoc(doc(db,'users',id),{accountId:id,role});
  await setDoc(doc(db,'groups','A'),{members:['alice','parent']});await setDoc(doc(db,'groups','B'),{members:['bob']});
  await setDoc(doc(db,'groups/A/growthProfiles/alice'),{accountId:'alice',pointsBalance:50});
  await setDoc(doc(db,'groups/A/growthRecords/one'),{accountId:'alice',type:'exam'});
 });
});
test.after(async()=>{await env?.cleanup();});
const ctx=id=>env.authenticatedContext(id,{photoAccountId:id,photoGroupId:id==='bob'?'B':'A'});
test('real Rules allow own/parent reads but reject cross-group and client resource/role writes',async()=>{
 const own=ctx('alice').firestore(),parent=ctx('parent').firestore(),outside=ctx('bob').firestore(),anon=env.unauthenticatedContext().firestore();
 const p='groups/A/growthProfiles/alice';await assertSucceeds(getDoc(doc(own,p)));await assertSucceeds(getDoc(doc(parent,p)));await assertFails(getDoc(doc(outside,p)));await assertFails(getDoc(doc(anon,p)));
 await assertFails(updateDoc(doc(own,p),{pointsBalance:999}));await assertFails(updateDoc(doc(own,'users/alice'),{role:'parent'}));
 await assertFails(setDoc(doc(parent,'groups/A/growthRecords/fake'),{accountId:'alice',rewardPoints:999}));
 await assertSucceeds(getDocs(query(collection(own,'groups/A/growthRecords'),where('accountId','==','alice'))));await assertFails(getDocs(collection(own,'groups/A/growthRecords')));
});
test('real Storage rules protect child exam photos and validate size/type/ownership',async()=>{
 const child=ctx('alice').storage(),parent=ctx('parent').storage(),other=ctx('bob').storage();const photo='growth-exams/A/alice/test.jpg';
 await assertSucceeds(uploadBytes(ref(child,photo),new Uint8Array([255,216,255]),{contentType:'image/jpeg'}));
 await assertSucceeds(getBytes(ref(parent,photo)));await assertFails(getBytes(ref(other,photo)));
 await assertFails(uploadBytes(ref(child,'growth-exams/A/parent/test.jpg'),new Uint8Array([1]),{contentType:'image/jpeg'}));
 await assertFails(uploadBytes(ref(child,'growth-exams/A/alice/bad.jpg'),new Uint8Array([1]),{contentType:'text/html'}));
 await assertFails(uploadBytes(ref(child,'growth-exams/A/alice/large.jpg'),new Uint8Array(5*1024*1024+1),{contentType:'image/jpeg'}));
});
test('real Firestore transactions keep daily awards and concurrent reward reservations atomic',async()=>{
 require('../scripts/prepare-growth-forest.cjs');const {initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore');const app=initializeApp({projectId},'growth-integration'),db=getFirestore(app);
 try{
  const service=require('../functions/growth-service.cjs').createGrowthService({db}),rid=()=>require('node:crypto').randomUUID();
  const call=(who,action,payload={})=>service.handle({auth:{uid:who,token:{photoAccountId:who,photoGroupId:'A'}},data:{groupId:'A',action,payload,requestId:rid()}});
  await env.withSecurityRulesDisabled(async c=>{await sdk('firebase/firestore').deleteDoc(doc(c.firestore(),'groups/A/growthProfiles/alice'));});
  await call('alice','snapshot');const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'}).format(new Date());
  await Promise.all(['one','two'].map(bookName=>call('alice','createRecord',{type:'reading',eventDate:day,bookName,readingMinutes:20,readingPages:5})));
  const w=(await db.doc('groups/A/growthProfiles/alice').get()).data();assert.equal(w.pointsBalance,10);
  const gift=await call('parent','saveReward',{name:'獎品',description:'',cost:10,status:'active'});
  const attempts=await Promise.allSettled([call('alice','requestReward',{giftId:gift.id}),call('alice','requestReward',{giftId:gift.id})]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 }finally{await deleteApp(app);}
});
