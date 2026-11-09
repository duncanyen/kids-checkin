// Mandatory integration suite. Invoke with Firebase emulators:exec; no production fallback.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createRequire}=require('node:module');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('Emulator required: run the documented emulators:exec command; production connections are forbidden');
const backend=createRequire(path.resolve(__dirname,'../functions/package.json'));
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json'));
const {initializeApp}=backend('firebase-admin/app'),{getFirestore}=backend('firebase-admin/firestore'),{getAuth}=backend('firebase-admin/auth');
const {initializeTestEnvironment,assertFails}=sdk('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc}=sdk('firebase/firestore');
const {fixture,scenarios}=require('./fixture.cjs');
const {createService}=require('../functions/service.cjs');
const projectId='demo-nexus-ops',app=initializeApp({projectId},'ops-integration'),db=getFirestore(app);
let env;
test.before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8085,rules:fs.readFileSync(path.resolve(__dirname,'../rules/firestore.test.rules'),'utf8')}});});
test.after(async()=>{await env?.cleanup();await db.terminate();});
test('Firestore emulator: end-to-end transactional gift and audit semantics',async()=>{await env.clearFirestore();await scenarios(await fixture(db));});
test('Firestore emulator: real concurrent transactions enforce one global redemption',async()=>{
    await env.clearFirestore();const f=await fixture(db),made=await f.admin('saveGift',f.gift({type:'limited',maxRedemptions:1}));
    const result=await Promise.allSettled(['alice','bob','charlie'].map(name=>f.service.redeem(f.request(name))));
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await db.doc('ops_gifts/'+made.id).get()).data().redeemedCount,1);
    assert.equal((await db.collection('ops_redemptions').where('result','==','success').get()).size,1);
});
test('Firestore emulator: award failure rolls back, then same receipt safely retries',async()=>{
    await env.clearFirestore();const f=await fixture(db),made=await f.admin('saveGift',f.gift());let fail=true;
    const faultDB=new Proxy(db,{get(target,key){if(key==='runTransaction')return callback=>db.runTransaction(t=>callback(new Proxy(t,{get(transaction,method){if(method==='update')return(ref,value)=>{if(fail&&ref.path.startsWith('groups/')){fail=false;throw Error('injected award failure');}return transaction.update(ref,value);};return typeof transaction[method]==='function'?transaction[method].bind(transaction):transaction[method];}})));return typeof target[key]==='function'?target[key].bind(target):target[key];}});
    const service=createService({db:faultDB,auth:{getUser:async()=>({customClaims:{role:'admin'}})},now:()=>f.now()}),request=f.request();
    await assert.rejects(service.redeem(request),/injected award failure/);
    assert.equal((await db.doc('ops_gifts/'+made.id).get()).data().redeemedCount,0);assert.equal((await db.doc('groups/A/users/alice').get()).data().farm.coins,100);
    await service.redeem(request);await service.redeem(request);assert.equal((await db.doc('groups/A/users/alice').get()).data().farm.coins,600);
});
test('Security Rules emulator: anonymous, player and admin clients cannot access privileged collections or increase farm assets',async()=>{
    await env.clearFirestore();await fixture(db);
    const protectedPaths=['ops_player_controls/alice','ops_game_config/guard-dogs','ops_settings/global','ops_events/e','ops_notifications/n','ops_announcements/a','ops_gifts/g','ops_code_index/h','ops_receipts/r','ops_redemptions/r','ops_audit/a','ops_admin_requests/r','ops_limits/l','ops_admins/admin'];
    for(const context of [env.unauthenticatedContext(),env.authenticatedContext('alice',{photoAccountId:'alice',photoGroupId:'A'}),env.authenticatedContext('admin',{role:'admin',firebase:{sign_in_second_factor:'totp'}})]){
        const client=context.firestore();
        for(const value of protectedPaths){await assertFails(getDoc(doc(client,value)));await assertFails(setDoc(doc(client,value),{forged:true}));}
        for(const patch of [{'farm.coins':99999},{'farm.inventoryEggs':999},{'farm.hens':999}])await assertFails(updateDoc(doc(client,'groups/A/users/alice'),patch));
    }
});
test('Auth emulator: native password sign-in has signed role claim; admin API accepts optional MFA',async()=>{
    const auth=getAuth(app);let user;
    try{user=await auth.createUser({email:'operator@example.test',password:'isolated-only-7f2a',emailVerified:true});await auth.setCustomUserClaims(user.uid,{role:'admin'});
        const {initializeApp:clientApp,deleteApp}=sdk('firebase/app'),{getAuth:clientAuth,connectAuthEmulator,signInWithEmailAndPassword,signOut}=sdk('firebase/auth');
        const a=clientApp({projectId,apiKey:'emulator-key'},'auth-integration'),c=clientAuth(a);connectAuthEmulator(c,'http://127.0.0.1:9099',{disableWarnings:true});
        const session=await signInWithEmailAndPassword(c,'operator@example.test','isolated-only-7f2a');const decoded=await auth.verifyIdToken(await session.user.getIdToken());assert.equal(decoded.role,'admin');
        const service=createService({db,auth});const result=await service.adminAPI({auth:{uid:user.uid,token:decoded},data:{action:'dashboard'}});assert.equal(typeof result.players,'number');
        await signOut(c);assert.equal(c.currentUser,null);await deleteApp(a);
    }finally{if(user)await auth.deleteUser(user.uid);}
});
