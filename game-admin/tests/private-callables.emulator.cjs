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
 const login=await call('nexusIdentity',{action:'login',identifier:'emulator_player',secret:'old-secret'});assert.equal(login.status,200,JSON.stringify(login.data.error||{}));assert.equal(login.data.result.profile.pin,undefined);
 const signed=await signIn(login.data.result.token);assert.equal(signed.status,200,JSON.stringify(signed.data.error||{}));
 // signInWithCustomToken 的 REST 回覆不保證提供 localId；從 ID Token 核對 UID，後續 callable 再由 Auth 驗證此 Token。
 const signedClaims=JSON.parse(Buffer.from(signed.data.idToken.split('.')[1],'base64url').toString());
 assert.equal(signedClaims.sub,I.profileUid('emulator-profile'));assert.equal(signedClaims.nexusProfileId,'emulator-profile');
 const group=await call('nexusIdentity',{action:'groupToken',groupId:'emulator-group'},signed.data.idToken);assert.equal(group.status,200);
 const player=await signIn(group.data.result.token);assert.equal(player.status,200);
 const refresh=await fetch(authBase+'/securetoken.googleapis.com/v1/token?key=demo-key',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:player.data.refreshToken})});assert.equal(refresh.status,200);const refreshed=await refresh.json();
 const token=refreshed.id_token,payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());assert.equal(payload.nexusSessionVersion,1);assert.equal(payload.photoGroupId,'emulator-group');
 const trade={groupId:'emulator-group',action:'buyMedicine',quantity:2,price:0,requestId:'emulator-trade-001'};
 const first=await call('gameOpsFarmTransaction',trade,token),second=await call('gameOpsFarmTransaction',trade,token);assert.equal(first.status,200);assert.equal(second.data.result.replayed,true);assert.equal((await db.doc('groups/emulator-group/users/emulator_player').get()).data().farm.coins,80);
 const activeRef=db.doc('ops_farm_active/'+I.hash('emulator-profile:emulator-group'));
 await activeRef.set({id:'emulator-pending-welcome',kind:'gorilla',groupId:'emulator-group',targetGroupId:'emulator-group',targetAccountId:'emulator_player',startedAt:Date.now(),approachEndsAt:Date.now(),deadline:Date.now()+40000,health:1000,attacks:{melee:0,ranged:0}});
 const welcome=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'ensureWelcome',requestId:'emulator-welcome-001'},token);
 assert.equal(welcome.status,200,JSON.stringify(welcome.data.error||{}));assert.equal(welcome.data.result.result.pendingBattle.id,'emulator-pending-welcome');
 assert.equal((await db.doc('groups/emulator-group/users/emulator_player').get()).data().farm.coins,80,'通知準備不自動發放歡迎獎勵');
 const blockedClaim=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'claimWelcome',requestId:'emulator-welcome-claim-blocked'},token);assert.equal(blockedClaim.status,400);
 // 固定無怪物的已驗證自家會話，避免合約測試依賴正式亂數；仍走真實 callable 與交易。
 await db.doc('groups/emulator-group/users/emulator_player').update({'farm.readyEggs.hen':3,'farm.eggsReady':3});
 await db.doc('ops_farm_active/'+I.hash('emulator-profile:emulator-group')).set({id:'emulator-harvest-clear',groupId:'emulator-group',targetGroupId:'emulator-group',targetAccountId:'emulator_player',harvestPermit:true,harvested:false,result:{outcome:'clear'}});
 const harvest={groupId:'emulator-group',action:'homeEncounter',collectWhenClear:true,requestId:'emulator-harvest-001'};
 const collected=await call('gameOpsFarmTransaction',harvest,token);assert.equal(collected.status,200,JSON.stringify(collected.data.error||{}));assert.equal(collected.data.result.result.harvest.total,3);
 const harvestedAgain=await call('gameOpsFarmTransaction',harvest,token);assert.equal(harvestedAgain.data.result.replayed,true);assert.equal((await db.doc('groups/emulator-group/users/emulator_player').get()).data().farm.inventoryEggs,3);
 const status=await call('gameOpsDailyChallenges',{groupId:'emulator-group',action:'status'},token);assert.equal(status.status,200);assert.ok(status.data.result.challenges.mission.tasks.every(t=>t.verified));
 assert.equal(status.data.result.challenges.mission.tasks.find(task=>task.type==='COLLECT_EGG_ACTION').count,1);
 const day=status.data.result.challenges.checkin,claim={groupId:'emulator-group',action:'claim',type:'checkin',dateKey:day.dateKey,cycleId:day.cycleId,day:day.day,requestId:'emulator-checkin-001'};
 await call('gameOpsDailyChallenges',claim,token);const replay=await call('gameOpsDailyChallenges',claim,token);assert.equal(replay.data.result.replayed,true);
 const changed=await call('nexusIdentity',{action:'changePassword',currentSecret:'old-secret',newSecret:'new-secret'},signed.data.idToken);assert.equal(changed.status,200);
 const stale=await call('gameOpsFarmTransaction',{...trade,requestId:'emulator-trade-002'},token);assert.equal(stale.status,401);
 const newLogin=await call('nexusIdentity',{action:'login',identifier:'emulator_player',secret:'new-secret'});assert.equal(newLogin.status,200);assert.equal((await signIn(newLogin.data.result.token)).status,200);
});
