// 真實 Auth／Functions／Firestore Emulator 合約測試；固定 demo 專案與 localhost。
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module'),I=require('../../functions/identity-domain.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('需要 Auth 與 Firestore Emulator；禁止正式測試');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore');
const project='demo-nexus-private-farm',base=`http://127.0.0.1:5008/${project}/asia-southeast1`,authBase='http://127.0.0.1:9098';let app,db;
async function post(url,data,token){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return{status:response.status,data:await response.json()};}
const call=(name,data,token)=>post(base+'/'+name,{data},token);
const signIn=token=>post(authBase+'/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{token,returnSecureToken:true});
test.before(async()=>{
 app=initializeApp({projectId:project},'private-callable-contract');db=getFirestore(app);
 const id='emulator-profile',accountId='emulator_player',stamp=Date.now();
 await db.doc('users/'+id).set({accountId,name:'Emulator Player',role:'member'});
 await db.doc('ops_identity_credentials/'+id).set({authUid:I.profileUid(id),accountId,sessionVersion:1,secrets:[await I.hashSecret('old-secret')],disabled:false});await db.doc('ops_identity_accounts/'+I.hash(accountId)).set({profileId:id});await db.doc('ops_identity_state/global').set({ready:true,farmReady:true});
 await db.doc('groups/emulator-group').set({members:[accountId],farmVillageVisibility:'closed'});
 await db.doc('groups/emulator-group/users/'+accountId).set({farm:{coins:100,hens:1,hensState:[{id:'hen',breed:'hen',laidAt:stamp}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:100,coopLevel:1}});
});test.after(async()=>deleteApp(app));
test('actual custom-token refresh, scoped callable transaction, daily grant and credential revocation work together',async()=>{
 const login=await call('nexusIdentity',{action:'login',identifier:'emulator_player',secret:'old-secret'});assert.equal(login.status,200,'private Functions parameters must be true');assert.equal(login.data.result.profile.pin,undefined);
 const signed=await signIn(login.data.result.token);assert.equal(signed.status,200);assert.equal(signed.data.localId,I.profileUid('emulator-profile'));
 const group=await call('nexusIdentity',{action:'groupToken',groupId:'emulator-group'},signed.data.idToken);assert.equal(group.status,200);
 const player=await signIn(group.data.result.token);assert.equal(player.status,200);
 const refresh=await fetch(authBase+'/securetoken.googleapis.com/v1/token?key=demo-key',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:player.data.refreshToken})});assert.equal(refresh.status,200);const refreshed=await refresh.json();
 const token=refreshed.id_token,payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());assert.equal(payload.nexusSessionVersion,1);assert.equal(payload.photoGroupId,'emulator-group');
 const trade={groupId:'emulator-group',action:'buyMedicine',quantity:2,price:0,requestId:'emulator-trade-001'};
 const first=await call('gameOpsFarmTransaction',trade,token),second=await call('gameOpsFarmTransaction',trade,token);assert.equal(first.status,200);assert.equal(second.data.result.replayed,true);assert.equal((await db.doc('groups/emulator-group/users/emulator_player').get()).data().farm.coins,80);
 const status=await call('gameOpsDailyChallenges',{groupId:'emulator-group',action:'status'},token);assert.equal(status.status,200);assert.ok(status.data.result.challenges.mission.tasks.every(t=>t.verified));
 const day=status.data.result.challenges.checkin,claim={groupId:'emulator-group',action:'claim',type:'checkin',dateKey:day.dateKey,cycleId:day.cycleId,day:day.day,requestId:'emulator-checkin-001'};
 await call('gameOpsDailyChallenges',claim,token);const replay=await call('gameOpsDailyChallenges',claim,token);assert.equal(replay.data.result.replayed,true);
 const changed=await call('nexusIdentity',{action:'changePassword',currentSecret:'old-secret',newSecret:'new-secret'},signed.data.idToken);assert.equal(changed.status,200);
 const stale=await call('gameOpsFarmTransaction',{...trade,requestId:'emulator-trade-002'},token);assert.equal(stale.status,401);
 const newLogin=await call('nexusIdentity',{action:'login',identifier:'emulator_player',secret:'new-secret'});assert.equal(newLogin.status,200);assert.equal((await signIn(newLogin.data.result.token)).status,200);
});
