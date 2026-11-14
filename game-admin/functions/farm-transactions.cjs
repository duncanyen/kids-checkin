/** 共用交易核心。只接受操作意圖；價格、時間、身分與結果均由伺服器決定。 */
const crypto=require('node:crypto');
const D=require('./domain.cjs');
const {reuseTransactionReads}=require('./transaction-reads.cjs');
function createFarmTransactions({db,player,now=Date.now,random=Math.random,enabled=()=>false,prepareProgress=null}){
 let models;
 const load=()=>models||=Promise.all([import('./game/poultry.js'),import('./game/inventory-core.js'),import('./game/combat-rules.js'),import('./game/poultry-housing.js'),import('./game/gorilla-rules.js'),import('./game/giant-rules.js'),import('./game/cobra-rules.js'),import('./game/mole-rules.js'),import('./game/combat-progress.js'),import('./game/garden-core.js'),import('./game/guard-dog-core.js'),import('./game/ranking-core.js'),import('./game/save-core.js')]);
 const positive=value=>D.integer(value,1,1000);
 const requireFarm=farm=>{if(!farm||typeof farm!=='object'||!Number.isSafeInteger(farm.coins)||farm.coins<0)D.fail('failed-precondition','農場存檔未確認');return farm;};
 async function handle(request){
  if(!await enabled())D.fail('failed-precondition','共用交易尚未完成安全切換');
  const p=request.data||{},action=D.enumValue(p.action,['collectEggs','settlePoultry','cleanOwn','helpClean','tradePoultry','buyWeapon','buyMedicine','sellItem','upgradeCoop','expandWarehouse','feedPoultry','treatHen','setHousing','equipWeapon','discardItem','ensureFarm','settleTarget','searchGarden','stealEgg','homeEncounter','visitEncounter','claimEncounter','battleAttack','battleSettle','ensureWelcome','claimWelcome','readMail','deleteMail']);
  if(action==='homeEncounter'&&p.collectWhenClear!==undefined&&typeof p.collectWhenClear!=='boolean')D.fail('invalid-argument','收蛋模式格式不正確');
  const requestId=D.requestId(p.requestId),models=await load(),[P,inventory,combat,housing,,,,,,garden,dogs,ranking,save]=models;
  const qty=['tradePoultry','buyWeapon','buyMedicine','sellItem','expandWarehouse'].includes(action)?positive(p.quantity):null;
  // 交易重試沿用相同雞隻 ID／疾病亂數，避免 Firestore 重試重新抽獎。
  const ids=qty&&qty<=20?Array.from({length:qty},()=>crypto.randomUUID()):[];
  const rolls=Array.from({length:20},()=>random());
  return db.runTransaction(async transaction=>{
   const t=reuseTransactionReads(transaction);
   if(!await enabled(t))D.fail('failed-precondition','共用交易正在維護');
   const actor=await player(request,t),stamp=now();let combatRollIndex=0;
   const receiptRef=db.doc('ops_farm_transactions/'+D.hash(actor.uid+':'+requestId));
   const fingerprint=D.hash(JSON.stringify(Object.fromEntries(Object.keys(p).filter(key=>key!=='requestId').sort().map(key=>[key,p[key]]))));
   const receipt=await t.get(receiptRef);
   if(receipt.exists){if(receipt.data().fingerprint!==fingerprint)D.fail('already-exists','交易編號已用於其他操作');return{...receipt.data().response,serverNow:stamp,replayed:true};}
   const farmRef=db.doc(`groups/${actor.groupId}/users/${actor.accountId}`),owner=await t.get(farmRef);
   if(action==='ensureFarm'){
    if(owner.exists){if(!save.isFarmSave(owner.data()?.farm))D.fail('failed-precondition','存檔資料不完整，停止自動初始化');const response={result:owner.data().farm,serverNow:stamp};t.create(receiptRef,{fingerprint,response,createdAt:stamp});return response;}
    const creation=db.doc(farmRef.path+'/farm_meta/creation');if(p.canCreate===false||(await t.get(creation)).exists)D.fail('failed-precondition','原有存檔遺失，禁止重建');
    const fresh=save.initialFarm(stamp),response={result:fresh,serverNow:stamp};t.create(farmRef,{farm:fresh});t.create(creation,{groupId:actor.groupId,accountId:actor.accountId,createdAt:stamp});t.create(receiptRef,{fingerprint,response,createdAt:stamp});return response;
   }
   const farm=requireFarm(owner.data()?.farm),sessionRef=db.doc('ops_farm_active/'+D.hash(actor.uid+':'+actor.groupId)),session=(await t.get(sessionRef)).data()||null;
   if(!save.isFarmSave(farm))D.fail('failed-precondition','存檔資料不完整，停止交易');
   let patch={},result={},event=null,targetRef=null,targetPatch=null,targetFarm=null,nextSession=session;
   const mailWrites=[];
   const apply=(old,changes)=>{const value=structuredClone(old);for(const [path,next]of Object.entries(changes)){const keys=path.split('.').slice(1);let at=value;for(const key of keys.slice(0,-1))at=at[key]||=( {} );at[keys.at(-1)]=next;}return value;};
   const combatActions=['homeEncounter','visitEncounter','claimEncounter','battleAttack','battleSettle'];
   if(session&&!session.result&&!combatActions.includes(action)&&!['settlePoultry','settleTarget','readMail','deleteMail'].includes(action))D.fail('failed-precondition','請先完成怪物戰鬥結算');
   const readTarget=async(groupId,accountId,battle=false)=>{
    D.id(groupId);D.id(accountId);const group=(await t.get(db.doc('groups/'+groupId))).data(),own=groupId===actor.groupId?group:(await t.get(db.doc('groups/'+actor.groupId))).data();
    const allowed=!!group?.members?.includes(accountId)&&!!own?.members?.includes(actor.accountId)&&(groupId===actor.groupId||group.farmVillageVisibility==='public'&&own.farmVillageVisibility==='public');
    if(!allowed&&!battle)D.fail('permission-denied','無法拜訪此村落');
    const ref=db.doc(`groups/${groupId}/users/${accountId}`),data=ref.path===farmRef.path?owner:await t.get(ref);
    // 自家目標名稱已由 player 驗證取得，不需要再做 accountId 查詢。
    let name=actor.name||accountId;
    if(accountId!==actor.accountId){const profiles=await t.get(db.collection('users').where('accountId','==',accountId).limit(2));name=profiles.size===1?profiles.docs[0].data().name:accountId;}
    const targetFarm=battle&&!allowed?null:requireFarm(data.data()?.farm);if(targetFarm&&!save.isFarmSave(targetFarm))D.fail('failed-precondition','目標存檔資料不完整');
    return{groupId,accountId,name,group,ref,allowed,farm:targetFarm};
   };
   const spend=amount=>{if(!Number.isSafeInteger(amount)||amount<0||farm.coins<amount)D.fail('failed-precondition','金幣不足');patch['farm.coins']=farm.coins-amount;};
   const capacity=n=>{if(inventory.getUsedSpace(farm)+n>(farm.warehouseLimit||10))D.fail('failed-precondition','倉庫容量不足');};
   const collect=()=>{
    if(!nextSession||nextSession.harvested||nextSession.targetGroupId!==actor.groupId||nextSession.targetAccountId!==actor.accountId||!nextSession.harvestPermit&&nextSession.result?.outcome!=='win')D.fail('failed-precondition','請先確認雞舍狀態及完成怪物結算');
    const collected=P.collectPoultry(farm,stamp);if(!collected.total)D.fail('failed-precondition',collected.remaining?'倉庫空間不足':'沒有可收取的雞蛋');
    Object.assign(patch,collected.patch,{'farm.reportHarvestedEggs':(farm.reportHarvestedEggs||0)+collected.total});
    if(nextSession.result)nextSession={...nextSession,harvested:true};
    event={type:'COLLECT_EGG_ACTION',collected:collected.total};return collected;
   };
   if(combatActions.includes(action)){
    const target=action==='homeEncounter'&&p.collectWhenClear===true?await readTarget(actor.groupId,actor.accountId):session&&!session.result&&!['homeEncounter','visitEncounter','claimEncounter'].includes(action)?await readTarget(session.targetGroupId,session.targetAccountId,true):await readTarget(p.targetGroupId||actor.groupId,p.targetAccountId||actor.accountId);
    const response=await require('./farm-combat.cjs').combatCommand({action,p,actor,farm,target,stamp,session,random:()=>rolls[combatRollIndex++%rolls.length],models,id:receiptRef.id});
    patch=response.patch;result=response.result;event=response.event;nextSession=response.session;
    if(response.targetFarm){if(target.ref.path===farmRef.path)Object.assign(patch,{'farm.readyEggs':response.targetFarm.readyEggs,'farm.eggsReady':response.targetFarm.eggsReady,'farm.hensState':response.targetFarm.hensState,'farm.hens':response.targetFarm.hens,'farm.poultryVersion':response.targetFarm.poultryVersion,'farm.lastLayTime':response.targetFarm.lastLayTime,'farm.cleanliness':response.targetFarm.cleanliness});else{targetRef=target.ref;targetFarm=response.targetFarm;targetPatch={};}}
    // 僅將原本可直接收蛋的分支合併。未結束的怪物仍回傳 challenge；逾時／勝利補結算保留原流程及獨立事件。
    if(action==='homeEncounter'&&p.collectWhenClear===true&&result===null)result={kind:null,harvest:collect()};
   }else if(action==='settleTarget'){
    const target=await readTarget(p.targetGroupId,p.targetAccountId);targetRef=target.ref;targetFarm=target.farm;targetPatch=P.poultryPatch(P.settlePoultry(target.farm,stamp));
   }else if(action==='searchGarden'){
    if(p.targetAccountId)await readTarget(p.targetGroupId,p.targetAccountId);
    if(farm.moleChallenge)D.fail('failed-precondition','請先擊退地鼠');
    const found=garden.gardenFindForRoll(1+Math.floor(rolls[0]*garden.GARDEN_ROLL_SIZE));result={caught:false,foundType:found};
    if(found&&inventory.getUsedSpace(farm)<(farm.warehouseLimit||10)){patch['farm.'+found]=(farm[found]||0)+1;patch['farm.gardenCatchCount']=(farm.gardenCatchCount||0)+1;result.caught=true;}
   }else if(action==='stealEgg'){
    const target=await readTarget(p.targetGroupId,p.targetAccountId);if(!session||session.targetGroupId!==target.groupId||session.targetAccountId!==target.accountId||!session.visitPermit&&!session.kind)D.fail('failed-precondition','請先進入此村落並完成怪物事件');if(target.accountId===actor.accountId)D.fail('invalid-argument','不能偷自己的蛋');
    const key=encodeURIComponent(JSON.stringify([target.groupId,target.accountId])).replaceAll('.', '%2E');
    if(stamp<dogs.stealBlockedUntil(farm,key,target.groupId===actor.groupId?target.accountId:null))D.fail('failed-precondition','這座雞舍仍在禁偷時間內');
    if(!(target.farm.eggsReady>0))D.fail('failed-precondition','手腳太慢，蛋不見了');capacity(1);
    const interception=dogs.guardDogInterception(target.farm,rolls[0],stamp),blockMs=interception?.breed.blockMs||3600000;
    patch={'farm.villageStealCooldowns':{...farm.villageStealCooldowns,[key]:stamp},'farm.villageStealBlockedUntil':{...farm.villageStealBlockedUntil,[key]:stamp+blockMs},'farm.moral':Math.max(0,(farm.moral??100)-5)};
    result={success:!interception,blockMs:interception?blockMs:0};
    const notice=db.doc(target.ref.path+'/farm_notifications/'+(interception?'guard-':'visit-')+receiptRef.id);
    if(!interception){
     const egg=P.takePoultryEgg(target.farm,rolls[1],stamp),breed=P.BREEDS[egg.breed];targetRef=target.ref;targetFarm=target.farm;targetPatch=egg.patch;
     patch['farm.'+breed.eggKey]=(farm[breed.eggKey]||0)+1;Object.assign(patch,ranking.theftRankingPatch(farm,{now:stamp,publicVillage:(await t.get(db.doc('groups/'+actor.groupId))).data()?.farmVillageVisibility==='public'}));
     patch['farm.reportStolenEggs']=(farm.reportStolenEggs||0)+1;
     result.eggName=breed.eggName;mailWrites.push(()=>t.create(notice,{type:'visitor',title:'訪客來訪',note:'訪客來偷蛋',createdAt:stamp,readAt:null}));
    }else{
     const body=`${target.name||target.accountId}的${interception.breed.name}成功攔截${actor.name||actor.accountId}偷蛋，保護了雞蛋！對方 ${blockMs/3600000} 小時內無法再偷這座雞舍。`;
     const config=(await t.get(db.doc('groups/'+target.groupId+'/settings/gameConfig'))).data(),roomRef=typeof config?.targetRoomId==='string'&&!config.targetRoomId.includes('/')?db.doc('rooms/'+config.targetRoomId):null,room=roomRef?await t.get(roomRef):null;
     mailWrites.push(()=>{t.create(notice,{type:'system',title:'護衛犬成功保護雞蛋',body,createdAt:stamp,readAt:null});if(room?.data()?.groupId===target.groupId){t.set(db.doc('messages/guard-'+receiptRef.id),{groupId:target.groupId,roomId:roomRef.id,sender:'村落廣播',text:body,timestamp:new Date(stamp),isSystem:true,time:new Intl.DateTimeFormat('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'}).format(stamp)});t.update(roomRef,{lastMessage:'村落廣播: '+body,lastMessageTime:new Date(stamp)});}});
    }
   }else if(['ensureWelcome','claimWelcome','readMail','deleteMail'].includes(action)){
    const welcomeId='welcome-v1',reward={coins:1000,worms:8,earthworms:4},mail=owner.data().farmMail||{};
    if(action==='ensureWelcome'){
     if(!mail.welcomeCreatedAt&&!mail.welcomeClaimedAt)mailWrites.push(()=>{t.set(db.doc(farmRef.path+'/farm_notifications/'+welcomeId),{type:'system',title:'系統通知',body:'歡迎加入咕咕村落，若您有任何疑問，歡迎隨時與我們連絡，感謝您的支持，祝您遊戲愉快',reward,createdAt:stamp,claimedAt:null,readAt:null});t.update(farmRef,{farmMail:{...mail,welcomeCreatedAt:stamp}});});
    }else if(action==='claimWelcome'){
     const ref=db.doc(farmRef.path+'/farm_notifications/'+welcomeId),notice=(await t.get(ref)).data();if(!notice)D.fail('not-found','通知已刪除，無法領取');result=false;
     if(!mail.welcomeClaimedAt&&!notice.claimedAt){for(const [key,value]of Object.entries(reward))patch['farm.'+key]=(farm[key]||0)+value;mailWrites.push(()=>{t.update(ref,{claimedAt:stamp});t.update(farmRef,{farmMail:{...mail,welcomeClaimedAt:stamp}});});result=true;}
    }else{
     if(!Array.isArray(p.ids)||p.ids.length>100)D.fail('invalid-argument','一次最多處理 100 則通知');
     const refs=[...new Set(p.ids)].map(id=>db.doc(farmRef.path+'/farm_notifications/'+D.id(id))),snaps=await Promise.all(refs.map(ref=>t.get(ref)));
     mailWrites.push(()=>refs.forEach((ref,i)=>{if(action==='deleteMail')t.delete(ref);else if(snaps[i].exists&&!snaps[i].data().readAt)t.update(ref,{readAt:stamp});}));result=stamp;
    }
   }else if(action==='collectEggs'){
    result=collect();
   }else if(action==='settlePoultry'){
    const state=P.settlePoultry(farm,stamp),added=Object.values(state.ready).reduce((a,b)=>a+b,0)-(farm.eggsReady||0);
    const risk=state.cleanliness>80?.5:state.cleanliness>50?.2:0;
    if(added>0)state.hens.forEach((hen,i)=>{if(!hen.isSick&&rolls[i]<risk){hen.isSick=true;hen.sickTimestamp=stamp;}});
    patch=P.poultryPatch(state);
   }else if(action==='cleanOwn'){
    if(!(farm.cleanliness>0))D.fail('failed-precondition','雞舍已經乾淨');patch={'farm.cleanliness':0};
   }else if(action==='helpClean'){
    const targetGroupId=D.id(p.targetGroupId),targetAccountId=D.id(p.targetAccountId);
    if(targetAccountId===actor.accountId)D.fail('invalid-argument','必須協助其他玩家');
    const group=(await t.get(db.doc('groups/'+targetGroupId))).data();
    const ownGroup=targetGroupId===actor.groupId?group:(await t.get(db.doc('groups/'+actor.groupId))).data();
    if(!group?.members?.includes(targetAccountId)||(targetGroupId!==actor.groupId&&(group.farmVillageVisibility!=='public'||ownGroup?.farmVillageVisibility!=='public')))D.fail('permission-denied','無法拜訪此村落');
    targetRef=db.doc(`groups/${targetGroupId}/users/${targetAccountId}`);
    const target=requireFarm((await t.get(targetRef)).data()?.farm);targetFarm=target;
    if(!(target.cleanliness>0))D.fail('failed-precondition','對方雞舍已經乾淨');
    targetPatch={'farm.cleanliness':Math.max(0,target.cleanliness-30)};
    patch={'farm.moral':Math.min(100,(farm.moral??100)+3)};event={type:'HELP_CLEAN_OTHER',targetGroupId,targetAccountId};
   }else if(action==='tradePoultry'){
    if(qty>20)D.fail('invalid-argument','雞隻交易數量不正確');
    patch=P.tradePoultry(farm,D.enumValue(p.breed,Object.keys(P.BREEDS)),qty,D.enumValue(p.direction,['buy','sell']),stamp,ids);
   }else if(action==='buyWeapon'||action==='buyMedicine'){
    const item=action==='buyMedicine'?'medicines':D.id(p.item),price=action==='buyMedicine'?10:(Object.hasOwn(combat.WEAPONS_CONFIG,item)?combat.WEAPONS_CONFIG[item].buyPrice:null);
    if(!price)D.fail('invalid-argument','此商品不可購買');capacity(qty);spend(price*qty);patch['farm.'+item]=(farm[item]||0)+qty;
   }else if(action==='sellItem'){
    const item=D.id(p.item),weapon=Object.hasOwn(combat.WEAPONS_CONFIG,item)?combat.WEAPONS_CONFIG[item]:null,egg=Object.values(P.BREEDS).find(b=>b.eggKey===item);
    // 價格依現有 ShopScene／constants／boss rules，不接受客戶端 unitPrice。
    const otherPrices={ancientStones:600,sweetPotatoes:300,cobraFangs:600,eagleFeathers:300,worms:1,earthworms:3,wolfFangs:20,tigerPelts:50,dragonScales:200,gorillaFangs:300};
    const price=weapon?.sellPrice??egg?.eggPrice??(Object.hasOwn(otherPrices,item)?otherPrices[item]:null);
    if(!price)D.fail('invalid-argument','此商品尚未接上後端出售');
    if(weapon&&(farm.equippedWeapon===item||farm.equippedBow===item))D.fail('failed-precondition','請先卸下武器');
    if((farm[item]||0)<qty)D.fail('failed-precondition','物品不足');patch={'farm.coins':farm.coins+price*qty,['farm.'+item]:farm[item]-qty};
   }else if(action==='upgradeCoop'){
    const level=D.integer(p.level,2,3);if((farm.coopLevel||1)>=level)D.fail('failed-precondition','已有更高級雞舍');spend(level===2?3000:10000);patch['farm.coopLevel']=level;
   }else if(action==='expandWarehouse'){spend(qty*100);patch['farm.warehouseLimit']=(farm.warehouseLimit||10)+qty*10;
   }else if(action==='feedPoultry'){
    patch=P.feedPoultry(farm,D.enumValue(p.item,['worms','earthworms']),D.enumValue(p.breed,Object.keys(P.BREEDS)),stamp);
   }else if(action==='treatHen'){
    patch=housing.treatmentPatch(farm,{...(p.henId?{id:D.id(p.henId)}:{}),roll:rolls[0],now:stamp});
   }else if(action==='setHousing'){
    const breed=D.enumValue(p.breed,Object.keys(P.BREEDS)),count=D.integer(p.outdoorCount,0,20);
    patch=housing.housingPatch(farm,{...housing.outdoorCounts(farm),[breed]:count});
   }else if(action==='equipWeapon'){
    const item=D.enumValue(p.item,Object.keys(combat.WEAPONS_CONFIG));
    if(!(farm[item]>0))D.fail('failed-precondition','倉庫已沒有這把武器');
    const slot=combat.WEAPONS_CONFIG[item].ranged?'equippedBow':'equippedWeapon',equipped=farm[slot]===item;
    if(typeof p.currentlyEquipped!=='boolean'||p.currentlyEquipped!==equipped)D.fail('failed-precondition','裝備狀態已變更');
    patch['farm.'+slot]=equipped?(slot==='equippedBow'?null:'club'):item;
   }else if(action==='discardItem'){
    const item=D.enumValue(p.item,inventory.INVENTORY_KEYS);
    if(!(farm[item]>0))D.fail('failed-precondition','物品不足');patch['farm.'+item]=farm[item]-1;
    if(farm[item]===1){if(farm.equippedWeapon===item)patch['farm.equippedWeapon']='club';if(farm.equippedBow===item)patch['farm.equippedBow']=null;}
   }
   const response={transactionId:receiptRef.id,action,serverNow:stamp,result};
   const progressWrite=event&&prepareProgress?await prepareProgress(t,actor,{...event,id:receiptRef.id,producer:'farm-transactions-v1',occurredAt:stamp},stamp):null;
   if(Object.keys(patch).length){const next=apply(farm,patch);if(!Number.isSafeInteger(next.coins)||next.coins<0||inventory.INVENTORY_KEYS.some(key=>key in next&&(!Number.isSafeInteger(next[key])||next[key]<0)))D.fail('failed-precondition','存檔數值不正確，未變更資源');t.update(farmRef,{farm:next});}if(targetRef)t.update(targetRef,{farm:apply(targetFarm,targetPatch)});
   if(nextSession!==session)t.set(sessionRef,nextSession);for(const write of mailWrites)write();progressWrite?.();
   t.create(receiptRef,{uid:actor.uid,accountId:actor.accountId,groupId:actor.groupId,fingerprint,createdAt:stamp,response});
   // 此流水與經濟變更原子提交，但在所有經濟欄位完成 Rules 保護前不啟用每日任務 consumer。
   if(event)t.create(db.doc('ops_verified_farm_events/'+receiptRef.id),{...event,uid:actor.uid,accountId:actor.accountId,groupId:actor.groupId,success:true,producer:'farm-transactions-v1',occurredAt:stamp});
   return response;
  });
 }
 return{handle};
}
module.exports={createFarmTransactions};
