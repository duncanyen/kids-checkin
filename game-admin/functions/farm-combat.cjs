/** 後端怪物會話與結算。客戶端只送攻擊命令，不接受 damage／outcome／reward。 */
const D=require('./domain.cjs'),Encounters=require('./encounters.cjs');
const CONFIG={hornet:{health:2400,durationMs:50000,flightMs:10000,item:'honey',penalty:100},wolf:{health:300,durationMs:60000,flightMs:0,item:'wolfFangs'},tiger:{health:400,durationMs:50000,flightMs:0,item:'tigerPelts',penalty:5},dragon:{health:1600,durationMs:60000,flightMs:10000,item:'dragonScales',penalty:100,clearEggs:true},gorilla:{health:4000,durationMs:40000,flightMs:10000,item:'gorillaFangs',penalty:100,clearEggs:true},eagle:{health:800,durationMs:60000,flightMs:10000,item:'eagleFeathers',penalty:100},cobra:{health:6400,durationMs:50000,flightMs:8000,item:'cobraFangs',penalty:200},giant:{health:12000,durationMs:70000,flightMs:7000,item:'ancientStones',penalty:300},mole:{health:4000,durationMs:60000,flightMs:0,item:'sweetPotatoes',penalty:100}};
const apply=(farm,patch)=>({...farm,...Object.fromEntries(Object.entries(patch).map(([key,value])=>[key.slice(5),value]))});
async function combatCommand({action,p,actor,farm,target,stamp,session,random,models,id,damageSeed=id,combatSettings=()=>require('./combat-balance.cjs').merge(),encounterSettings=async()=>({monsters:Encounters.DEFAULTS,revision:0}),weaponAbilities=async()=>null}){
 const [P,inventory,C,,G,giant,cobra,mole,progress]=models,damageModel=models[14];
 const inputModel=session?.inputProtocol===1?await import('./game/verified-combat.js'):null;
 const patch={},result={};let next=session,event=null,targetChanged=false,targetFarm=target?.farm||null;
 const start=async(kind,milestone)=>{
  const config=CONFIG[kind];
  if(session?.combatProtocol!==undefined&&(session.combatProtocol===0||session.damageProtocol!==4))D.fail('failed-precondition','戰鬥已更新，請重新載入遊戲');
  const balance=await combatSettings(),snapshot=require('./weapon-abilities.cjs').applyAbilities(damageModel.makeCombatSnapshot(farm,kind,damageSeed,balance),await weaponAbilities(balance));
  if(snapshot.damageVersion===5&&session?.refinementDamageProtocol!==5)D.fail('failed-precondition','已裝備精煉武器，請更新遊戲以支援戰鬥能力快照');
  next={id,kind,groupId:actor.groupId,targetGroupId:target.groupId,targetAccountId:target.accountId,targetName:target.name||target.accountId,...(p.battlePageId?{ownerPageId:p.battlePageId}:{}),startedAt:stamp,approachEndsAt:stamp+config.flightMs,deadline:stamp+config.durationMs,...snapshot,health:snapshot.maxHealth,attacks:{melee:0,ranged:0},milestone:milestone??null};
  if(inputModel)next=inputModel.inputSnapshot(next,(target?.farm?.hensState?.length||target?.farm?.hens||0)>0);
  if(milestone!==undefined){next.previousMilestone=farm[kind+'LastMilestone']||0;patch['farm.'+kind+'LastMilestone']=milestone;patch['farm.'+kind+'Challenge']={id,milestone,startedAt:stamp,approachEndsAt:next.approachEndsAt,deadline:next.deadline};}
  return{challenge:{...next},kind};
 };
 const resolve=()=>{
  if(!next||next.result)D.fail('failed-precondition','沒有待結算戰鬥');
  const kind=next.kind,config=CONFIG[kind],won=next.health===0&&next.lastAttackAt<next.deadline;
  const settlement={id:next.id,outcome:won?'win':'loss',coinsLost:0};
  if(!won&&stamp<next.deadline)D.fail('failed-precondition','戰鬥尚未結束');
  if(['giant','cobra','mole'].includes(kind)){
   const fn=kind==='giant'?giant.giantSettlement:kind==='cobra'?cobra.cobraSettlement:mole.moleSettlement;
   const settled=fn(farm,farm[kind+'Challenge'],won?'win':'loss',won?next.lastAttackAt:stamp);Object.assign(patch,settled.patch);Object.assign(settlement,settled.result);
  }else{
   if(won){
    if(['wolf','tiger','eagle'].includes(kind))Object.assign(patch,progress.killProgressPatch(farm,kind,next.id));
    if(!['wolf','tiger'].includes(kind)||inventory.getUsedSpace(farm)<(farm.warehouseLimit||10))patch['farm.'+config.item]=(farm[config.item]||0)+1;
   }else{
    settlement.coinsLost=Math.min(config.penalty||0,farm.coins);if(config.penalty)patch['farm.coins']=farm.coins-settlement.coinsLost;
    if(config.clearEggs&&targetFarm){targetFarm=apply(targetFarm,P.clearPoultryEggs(targetFarm,stamp));targetChanged=true;}
    if(kind==='wolf'&&targetFarm&&(targetFarm.eggsReady||0)>0){targetFarm=apply(targetFarm,P.takePoultryEgg(targetFarm,random(),stamp).patch);targetChanged=true;}
   }
   patch['farm.'+kind+'Results']=[...(farm[kind+'Results']||[]).slice(-31),settlement];
  }
  if(won){settlement.overflow=inventory.getUsedSpace(farm)>=(farm.warehouseLimit||10);event={type:'DEFEAT_MONSTER',monster:kind,battleId:next.id};}
  settlement.hasSpace=!!patch['farm.'+config.item];
  // Display-only receipt fields reflect the actual inventory delta of this settlement.
  const quantity=won?Math.max(0,(patch['farm.'+config.item]??farm[config.item]??0)-(farm[config.item]||0)):0;
  settlement.monster=kind;settlement.inventoryUpdated=quantity>0;
  settlement.rewards=quantity>0?[{itemId:config.item,quantity}]:[];
  next={...next,result:settlement,resolvedAt:stamp,...(next.damageVersion===5?{chainState:{mode:null,critical:false,streak:0}}:{})};return settlement;
 };
 if(['homeEncounter','visitEncounter','claimEncounter'].includes(action)){
  if(action==='claimEncounter'&&next&&!next.result&&next.kind!==p.monster)return{patch,result:null,session:next};
  if(next&&!next.result){if(next.health===0||stamp>=next.deadline)return{patch,result:{expired:next.health!==0,result:resolve()},session:next,event,targetFarm:targetChanged?targetFarm:null};return{patch,result:{challenge:{...next},kind:next.kind},session:next};}
  // 操作只確認已清場的進場結果，絕不在收蛋／偷蛋時重新抽怪。
  if(p.verifyOnly===true){
   const same=next&&next.targetGroupId===target.groupId&&next.targetAccountId===target.accountId;
   const cleared=same&&(next.visitPermit||next.harvestPermit||next.result?.outcome==='win'||next.result?.outcome==='loss');
   if(!cleared)D.fail('failed-precondition','進場確認已失效，請重新進入村落；此次操作未執行');
   if(action==='homeEncounter')next={...next,harvestPermit:true,harvested:false};
   return{patch,result:null,session:next};
  }
  // 偷蛋前可以重新確認目前拜訪。相同目標的已清場／已結算許可直接重用，不能因重試重新抽怪。
  if(action==='visitEncounter'&&p.reusePermit===true&&next&&next.targetGroupId===target.groupId&&next.targetAccountId===target.accountId&&(next.visitPermit||next.kind))return{patch,result:null,session:next};
  let requested=action==='claimEncounter'?D.enumValue(p.monster,['giant','cobra','mole']):null;
  // Resume outstanding challenges even if an operator has disabled new spawns.
  if(!requested&&!next)requested=['giant','mole','cobra'].find(kind=>farm[kind+'Challenge'])||null;
  let kind=requested,milestone;
  if(requested&&farm[requested+'Challenge']&&!next){const old=farm[requested+'Challenge'];next={...old,...(p.battlePageId?{ownerPageId:p.battlePageId}:{}),kind:requested,groupId:actor.groupId,targetGroupId:target.groupId,targetAccountId:target.accountId,health:C.LEGACY_ENEMY_HEALTH[requested],attacks:{melee:0,ranged:0}};if(stamp>=old.deadline)return{patch,result:{expired:true,result:resolve()},session:next,event,targetFarm:targetChanged?targetFarm:null};return{patch,result:{challenge:{...next},kind:requested},session:next};}
  // A previously cleared home keeps its random-boss permit, but newly earned
  // milestones must still be considered on entry (as the old client precheck did).
  // verifyOnly returned above, so harvest/theft never perform this check.
  const clearedHome=action==='homeEncounter'&&next&&!next.harvested&&next.targetGroupId===actor.groupId&&next.targetAccountId===actor.accountId&&(next.result?.outcome==='win'||next.harvestPermit);
  if(clearedHome&&p.collectWhenClear===true)return{patch,result:null,session:next};
  const settings=await encounterSettings(),place=action==='homeEncounter'||target.groupId===actor.groupId&&target.accountId===actor.accountId?'home':'visit';
  const due=Encounters.rollMilestone(settings,farm,place,random,requested);
  if(requested&&!due)return{patch,result:null,session:next};
  if(due){kind=due.kind;milestone=due.milestone;}
  else if(clearedHome)return{patch,result:null,session:next};
  else kind=Encounters.rollRandom(settings,place,action==='homeEncounter'?farm.coopLevel:targetFarm?.coopLevel||1,random);
  if(!kind){if(action==='visitEncounter')next={id,...(p.battlePageId?{ownerPageId:p.battlePageId}:{}),kind:null,targetGroupId:target.groupId,targetAccountId:target.accountId,visitPermit:true,result:{outcome:'clear'}};if(action==='homeEncounter')next={id,...(p.battlePageId?{ownerPageId:p.battlePageId}:{}),kind:null,groupId:actor.groupId,targetGroupId:actor.groupId,targetAccountId:actor.accountId,harvestPermit:true,harvested:false,result:{outcome:'clear'}};return{patch,result:null,session:next};}
  return{patch,result:await start(kind,milestone),session:next};
 }
 if(!next||!next.id||p.battleId!==next.id)D.fail('failed-precondition','戰鬥會話已變更');
 if(next.result)return{patch,result:next.result,session:next};
 if(action==='battleSettle'){if(next.inputProtocol===1&&next.inputState.upToAt<Math.min(stamp,next.deadline-1)){try{const endAt=Math.min(stamp,next.deadline-1);next=inputModel.evaluateInputs(next,{firstInputSeq:next.inputState.nextSeq,events:[],endAt},endAt).battle;}catch(e){D.fail('failed-precondition',e.reason||'戰鬥物理狀態不一致');}}return{patch,result:resolve(),session:next,event,targetFarm:targetChanged?targetFarm:null};}
 if(stamp>=next.deadline)D.fail('deadline-exceeded','戰鬥時間已到，請結算');
 if(!damageModel.battleAttackAvailable(next,stamp))D.fail('failed-precondition','怪物進場中，抵達後才能攻擊；此次攻擊未計入');
 if(next.inputProtocol===1){
  const fields=['action','requestId','groupId','battlePageId','battleId','combatVersion','damageVersion','inputProtocol','firstInputSeq','events','endAt'];
  if(Object.keys(p).some(k=>!fields.includes(k))||p.inputProtocol!==1||p.combatVersion!==2||p.damageVersion!==next.damageVersion)D.fail('invalid-argument','新版戰鬥只接受輸入事件，不接受命中次數或傷害');
  if(next.health===0)D.fail('failed-precondition','怪物已擊退，請確認原結算');
  let outcome;try{outcome=inputModel.evaluateInputs(next,{firstInputSeq:p.firstInputSeq,events:p.events,endAt:p.endAt},stamp);}catch(e){D.fail(e.code||'invalid-argument',e.reason||'輸入驗算失敗');}
  next=outcome.battle;return{patch,result:{id:next.id,health:next.health,attacks:next.attacks,chainState:next.chainState,actionCount:next.actionCount||0,inputProtocol:1,inputState:next.inputState,hits:outcome.hits,damage:outcome.damage,deadline:next.deadline},session:next};
 }
 if(next.damageVersion===5){
  if(next.health===0)D.fail('failed-precondition','怪物已擊退，請確認原結算');
  const allowed=['action','requestId','groupId','battlePageId','battleId','combatVersion','damageVersion','firstAction','attackRuns'];
  if(Object.keys(p).some(key=>!allowed.includes(key)))D.fail('invalid-argument','戰鬥只接受有序攻擊意圖，不接受傷害或能力');
  if(p.combatVersion!==2||p.damageVersion!==5||p.firstAction!==(next.actionCount||0))D.fail('failed-precondition','戰鬥順序或版本已更新，請確認原批次');
  if(!Array.isArray(p.attackRuns)||!p.attackRuns.length||p.attackRuns.length>64)D.fail('invalid-argument','有序攻擊批次無效');
  let count=0;const runs=p.attackRuns.map(run=>{if(run?.type==='switch'){if(Object.keys(run).some(k=>!['type','mode'].includes(k)))D.fail('invalid-argument','切換欄位無效');const mode=D.enumValue(run.mode,['melee','ranged']);if(mode==='ranged'&&!C.equippedBow(farm))D.fail('failed-precondition','尚未裝備弓箭');return{type:'switch',mode};}if(!run||Object.keys(run).some(k=>!['mode','count'].includes(k)))D.fail('invalid-argument','攻擊欄位無效');const mode=D.enumValue(run.mode,['melee','ranged']),quantity=D.integer(run.count,1,1000);count+=quantity;const weapon=mode==='ranged'?C.equippedBow(farm):C.equippedWeapon(farm);if(!weapon||damageModel.weaponKey(weapon)!==next.weapons[mode]||!next.baseDamage[mode])D.fail('failed-precondition','此武器無法攻擊怪物或裝備已變更');return{mode,count:quantity};});
  if(count>1000)D.fail('invalid-argument','批次攻擊數量過多');
  const proposed={...next.attacks};for(const run of runs)if(run.type!=='switch')proposed[run.mode]+=run.count;
  for(const mode of ['melee','ranged'])if(proposed[mode]>Math.floor((stamp-next.startedAt)/1000*(mode==='ranged'?10:20))+4)D.fail('resource-exhausted','攻擊過於密集，請稍候重試');
  const outcome=damageModel.chronologicalDamage(next,runs);
  for(const mode of ['melee','ranged'])if(outcome.attacks[mode]>Math.floor((stamp-next.startedAt)/1000*(mode==='ranged'?10:20))+4)D.fail('resource-exhausted','攻擊過於密集，請稍候重試');
  next={...next,...outcome,health:Math.max(0,next.health-outcome.damage),lastAttackAt:stamp};delete next.damage;
  return{patch,result:{id:next.id,health:next.health,attacks:next.attacks,chainState:next.chainState,actionCount:next.actionCount,damage:outcome.damage,deadline:next.deadline},session:next};
 }
 const mode=D.enumValue(p.mode,['melee','ranged']),count=D.integer(p.count,1,1000),weapon=mode==='ranged'?C.equippedBow(farm):C.equippedWeapon(farm);
 if(!weapon||mode==='ranged'&&!['dragon','eagle','cobra','giant','hornet'].includes(next.kind)||mode==='melee'&&['dragon','eagle','hornet'].includes(next.kind))D.fail('failed-precondition','此武器無法攻擊怪物');
 let damage=next.combatVersion===2?(next.baseDamage?.[mode]||0):C.weaponDamage(C.LEGACY_WEAPONS_CONFIG[damageModel.weaponKey(weapon)],next.kind);if(!damage)D.fail('failed-precondition','此武器無法造成傷害');
 // 每個會話累計速率與小幅 burst；重送由外層收據去重，不能跨裝備／跨裝置重設額度。
 const attacks={...next.attacks},cap=Math.floor((stamp-next.startedAt)/1000*(mode==='ranged'?10:20))+4;
 if((attacks[mode]||0)+count>cap)D.fail('resource-exhausted','攻擊過於密集，請稍候重試');
 const first=attacks[mode]||0;
 if(next.combatVersion===2){
  if(p.combatVersion!==2||next.damageVersion>=3&&p.damageVersion!==next.damageVersion)D.fail('failed-precondition','戰鬥已更新，請重新載入遊戲');
  if(p.firstHit!==first)D.fail('failed-precondition','戰鬥進度已更新，請重新確認原攻擊');
  if(damageModel.weaponKey(weapon)!==next.weapons?.[mode])D.fail('failed-precondition','戰鬥裝備已變更，請重新進入');
  damage=damageModel.batchDamage(next,mode,first,count);
 }else damage*=count;
 attacks[mode]=first+count;next={...next,attacks,health:Math.max(0,next.health-damage),lastAttackAt:stamp};
 return{patch,result:{id:next.id,health:next.health,attacks:next.attacks,damage,deadline:next.deadline},session:next};
}
module.exports={combatCommand,CONFIG};
