// 真實 Auth／Functions／Firestore Emulator 合約測試；固定 demo 專案與 localhost。
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),{createRequire}=require('node:module'),I=require('../../functions/identity-domain.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)throw Error('需要 Auth 與 Firestore Emulator；禁止正式測試');
const sdk=createRequire(path.resolve(__dirname,'../../functions/package.json')),{initializeApp,deleteApp}=sdk('firebase-admin/app'),{getFirestore}=sdk('firebase-admin/firestore');
const project='demo-nexus-private-farm',accountId='emulator_player',base=`http://127.0.0.1:5008/${project}/asia-southeast1`,authBase='http://127.0.0.1:9098';let app,db;
async function post(url,data,token){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});return{status:response.status,data:await response.json()};}
const call=(name,data,token)=>post(base+'/'+name,{data},token);
const signIn=token=>post(authBase+'/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key',{token,returnSecureToken:true});
test.before(async()=>{
 app=initializeApp({projectId:project},'private-callable-contract');db=getFirestore(app);
 const id='emulator-profile',stamp=Date.now();
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
 // Chest replay uses real concurrent Functions/Firestore transactions, with no frontend-supplied rewards.
 const chestActor={uid:'emulator-profile',groupId:'emulator-group',accountId:'emulator_player'},C=require('../functions/chests.cjs'),chestId='emulator-chest-concurrent',chestRef=db.doc(C.ownerPath(chestActor)+'/'+chestId),ownerRef=db.doc('groups/emulator-group/users/emulator_player');
 const beforeChest=(await ownerRef.get()).data().farm;
 await ownerRef.update({'farm.chestCount':1});
 await chestRef.set({...chestActor,id:chestId,monster:'eagle',battleId:'emulator-chest-source',status:'unopened',droppedAt:Date.now(),configRevision:17,snapshot:{dropRate:100,coins:{enabled:true,min:23,max:23},items:[{itemId:'medicine',quantity:1}]}});
 const opens=await Promise.all(['a','b'].map(suffix=>call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'openChest',chestId,coins:999999,requestId:'emulator-chest-open-'+suffix},token)));
 for(const opened of opens){assert.equal(opened.status,200,JSON.stringify(opened.data.error||{}));assert.equal(opened.data.result.result.coins,23);}
 const afterChest=(await ownerRef.get()).data().farm;assert.equal(afterChest.coins,beforeChest.coins+23);assert.equal(afterChest.medicines,(beforeChest.medicines||0)+1);assert.equal(afterChest.chestCount,0);
 const recorded=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'listChests',status:'opened',requestId:'emulator-chest-history'},token);assert.equal(recorded.status,200,JSON.stringify(recorded.data.error||{}));assert.equal(recorded.data.result.result.rows.find(row=>row.id===chestId).result.coins,23);
 // Real Firestore/Functions must use the saved policy, below legacy client thresholds.
 const E=require('../functions/encounters.cjs'),encounters=structuredClone(E.DEFAULTS);
 for(const value of Object.values(encounters))value.enabled=false;
 encounters.mole={...encounters.mole,enabled:true,interval:2};
 await db.doc('ops_game_config/encounters').set({monsters:encounters,revision:1});
 await activeRef.delete();await ownerRef.update({'farm.coopLevel':2,'farm.gardenCatchCount':2,'farm.moleLastMilestone':0,'farm.moleChallenge':null});
 const customEntry=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'homeEncounter',requestId:'emulator-custom-mole'},token);
 assert.equal(customEntry.status,200,JSON.stringify(customEntry.data.error||{}));assert.equal(customEntry.data.result.result.kind,'mole');assert.equal(customEntry.data.result.result.challenge.milestone,2);
 encounters.mole.enabled=false;await db.doc('ops_game_config/encounters').set({monsters:encounters,revision:2});
 const stillActive=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'homeEncounter',requestId:'emulator-custom-mole-active'},token);assert.equal(stillActive.status,200);assert.equal(stillActive.data.result.result.challenge.id,customEntry.data.result.result.challenge.id);
 await activeRef.delete();await ownerRef.update({'farm.moleChallenge':null,'farm.moleLastMilestone':0});
 const disabledEntry=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'homeEncounter',requestId:'emulator-disabled-mole'},token);assert.equal(disabledEntry.status,200,JSON.stringify(disabledEntry.data.error||{}));assert.equal(disabledEntry.data.result.result,null);
 // New weapon is priced, equipped and applied by the actual callable backend.
 await ownerRef.update({'farm.coins':500000,'farm.katana':0});
 const swordBuy={groupId:'emulator-group',action:'buyWeapon',item:'katana',quantity:1,price:1,requestId:'emulator-katana-buy'};
 const boughtSword=await call('gameOpsFarmTransaction',swordBuy,token);assert.equal(boughtSword.status,400,JSON.stringify(boughtSword.data));assert.match(boughtSword.data.error.message,/尚未開賣/);assert.equal((await ownerRef.get()).data().farm.coins,500000);assert.equal((await ownerRef.get()).data().farm.katana,0);
 assert.equal((await call('gameOpsFarmTransaction',swordBuy,token)).status,400);assert.equal((await ownerRef.get()).data().farm.katana,0);
 await ownerRef.update({'farm.katana':1}); // An existing owner's sword remains usable.
 const equippedSword=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'equipWeapon',item:'katana',currentlyEquipped:false,requestId:'emulator-katana-equip'},token);assert.equal(equippedSword.status,200,JSON.stringify(equippedSword.data.error||{}));
 await activeRef.set({id:'emulator-katana-wolf',kind:'wolf',groupId:'emulator-group',targetGroupId:'emulator-group',targetAccountId:accountId,startedAt:Date.now()-4000,deadline:Date.now()+60000,health:200,attacks:{melee:0,ranged:0}});
 const swordHit=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'battleAttack',battleId:'emulator-katana-wolf',mode:'melee',count:1,requestId:'emulator-katana-hit'},token);assert.equal(swordHit.status,200,JSON.stringify(swordHit.data.error||{}));assert.equal(swordHit.data.result.result.health,0);
 const swordWin=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'battleSettle',battleId:'emulator-katana-wolf',requestId:'emulator-katana-settle'},token);assert.equal(swordWin.status,200,JSON.stringify(swordWin.data.error||{}));assert.equal(swordWin.data.result.result.outcome,'win');
 const swordUnequip=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'equipWeapon',item:'katana',currentlyEquipped:true,requestId:'emulator-katana-unequip'},token);assert.equal(swordUnequip.status,200);
 const swordSale={groupId:'emulator-group',action:'sellItem',item:'katana',quantity:1,price:1,requestId:'emulator-katana-sale'};const coinsBeforeSale=(await ownerRef.get()).data().farm.coins;
 const soldSword=await call('gameOpsFarmTransaction',swordSale,token);assert.equal(soldSword.status,200,JSON.stringify(soldSword.data.error||{}));assert.equal((await ownerRef.get()).data().farm.coins,coinsBeforeSale+30000);assert.equal((await ownerRef.get()).data().farm.katana,0);
 assert.equal((await call('gameOpsFarmTransaction',swordSale,token)).status,200);assert.equal((await ownerRef.get()).data().farm.coins,coinsBeforeSale+30000);
 // Hornet uses actual callable validation and concurrent Firestore settlement.
 const hornetPolicy=structuredClone(E.DEFAULTS);for(const value of Object.values(hornetPolicy))value.enabled=false;
 hornetPolicy.hornet.enabled=true;hornetPolicy.hornet.home.rate=100;
 await db.doc('ops_game_config/encounters').set({monsters:hornetPolicy,revision:3});
 await activeRef.delete();await ownerRef.update({'farm.coopLevel':2,'farm.paladinbow':1,'farm.equippedBow':'paladinbow','farm.honey':0});
 await db.doc('groups/emulator-group').update({farmVillageVisibility:'public'});
 const beforeHornetRank=(await ownerRef.get()).data().farm.monsterKills20261123||0;
 const hornetEntry=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'homeEncounter',requestId:'emulator-hornet-entry'},token);
 assert.equal(hornetEntry.status,200,JSON.stringify(hornetEntry.data.error||{}));const hornetBattle=hornetEntry.data.result.result.challenge;
 assert.equal(hornetBattle.kind,'hornet');assert.equal(hornetBattle.deadline-hornetBattle.startedAt,50000);
 await activeRef.update({startedAt:Date.now()-5000});
 const hornetMelee=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'battleAttack',battleId:hornetBattle.id,mode:'melee',count:1,requestId:'emulator-hornet-melee'},token);assert.equal(hornetMelee.status,400);
 const hornetHit=await call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'battleAttack',battleId:hornetBattle.id,mode:'ranged',count:10,requestId:'emulator-hornet-bow'},token);assert.equal(hornetHit.status,200,JSON.stringify(hornetHit.data.error||{}));assert.equal(hornetHit.data.result.result.health,0);
 const hornetWins=await Promise.all(['a','b'].map(suffix=>call('gameOpsFarmTransaction',{groupId:'emulator-group',action:'battleSettle',battleId:hornetBattle.id,requestId:'emulator-hornet-settle-'+suffix},token)));
 for(const win of hornetWins){assert.equal(win.status,200,JSON.stringify(win.data.error||{}));assert.equal(win.data.result.result.outcome,'win');}
 assert.equal((await ownerRef.get()).data().farm.honey,1);
 const rankingCore=await import('../functions/game/ranking-core.js'),settledAt=hornetWins[0].data.result.serverNow;
 const hornetRank=beforeHornetRank+(settledAt>=rankingCore.THEFT_RANKING_START&&settledAt<rankingCore.THEFT_RANKING_END?1:0);
 assert.equal((await ownerRef.get()).data().farm.monsterKills20261123||0,hornetRank);
 const monsterRank=await call('gameOpsAnnouncements',{groupId:'emulator-group',action:'ranking',ranking:'monsterKills'},token);assert.equal(monsterRank.status,200,JSON.stringify(monsterRank.data.error||{}));assert.equal(monsterRank.data.result.ranking,'monsterKills');assert.equal(monsterRank.data.result.rows.find(r=>r.accountId===accountId)?.score||0,hornetRank);
 const honeySale={groupId:'emulator-group',action:'sellItem',item:'honey',quantity:1,price:999999,requestId:'emulator-honey-sale'},beforeHoneySale=(await ownerRef.get()).data().farm.coins;
 assert.equal((await call('gameOpsFarmTransaction',honeySale,token)).status,200);assert.equal((await call('gameOpsFarmTransaction',honeySale,token)).status,200);
 assert.equal((await ownerRef.get()).data().farm.coins,beforeHoneySale+300);assert.equal((await ownerRef.get()).data().farm.honey,0);
 const changed=await call('nexusIdentity',{action:'changePassword',currentSecret:'old-secret',newSecret:'new-secret'},signed.data.idToken);assert.equal(changed.status,200);
 const stale=await call('gameOpsFarmTransaction',{...trade,requestId:'emulator-trade-002'},token);assert.equal(stale.status,401);
 const newLogin=await call('nexusIdentity',{action:'login',identifier:'emulator_player',secret:'new-secret'});assert.equal(newLogin.status,200);assert.equal((await signIn(newLogin.data.result.token)).status,200);
});
