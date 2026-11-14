/** 後端怪物會話與結算。客戶端只送攻擊命令，不接受 damage／outcome／reward。 */
const D=require('./domain.cjs');
const CONFIG={wolf:{health:200,durationMs:60000,flightMs:0,item:'wolfFangs'},tiger:{health:200,durationMs:50000,flightMs:0,item:'tigerPelts',penalty:5},dragon:{health:600,durationMs:60000,flightMs:10000,item:'dragonScales',penalty:100,clearEggs:true},gorilla:{health:1000,durationMs:40000,flightMs:10000,item:'gorillaFangs',penalty:100,clearEggs:true},eagle:{health:200,durationMs:60000,flightMs:10000,item:'eagleFeathers',penalty:100},cobra:{health:6000,durationMs:50000,flightMs:8000,item:'cobraFangs',penalty:200},giant:{health:36000,durationMs:70000,flightMs:7000,item:'ancientStones',penalty:300},mole:{health:600,durationMs:60000,flightMs:0,item:'sweetPotatoes',penalty:100}};
const apply=(farm,patch)=>({...farm,...Object.fromEntries(Object.entries(patch).map(([key,value])=>[key.slice(5),value]))});
async function combatCommand({action,p,actor,farm,target,stamp,session,random,models,id}){
 const [P,inventory,C,,G,giant,cobra,mole,progress]=models;
 const patch={},result={};let next=session,event=null,targetChanged=false,targetFarm=target?.farm||null;
 const start=(kind,milestone)=>{
  const config=CONFIG[kind];
  next={id,kind,groupId:actor.groupId,targetGroupId:target.groupId,targetAccountId:target.accountId,targetName:target.name||target.accountId,startedAt:stamp,approachEndsAt:stamp+config.flightMs,deadline:stamp+config.durationMs,health:config.health,attacks:{melee:0,ranged:0},milestone:milestone??null};
  if(milestone!==undefined){patch['farm.'+kind+'LastMilestone']=milestone;patch['farm.'+kind+'Challenge']={id,milestone,startedAt:stamp,approachEndsAt:next.approachEndsAt,deadline:next.deadline};}
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
  settlement.hasSpace=!!patch['farm.'+config.item];next={...next,result:settlement,resolvedAt:stamp};return settlement;
 };
 if(['homeEncounter','visitEncounter','claimEncounter'].includes(action)){
  if(action==='claimEncounter'&&next&&!next.result&&next.kind!==p.monster)return{patch,result:null,session:next};
  if(next&&!next.result){if(next.health===0||stamp>=next.deadline)return{patch,result:{expired:next.health!==0,result:resolve()},session:next,event,targetFarm:targetChanged?targetFarm:null};return{patch,result:{challenge:{...next},kind:next.kind},session:next};}
  const requested=action==='claimEncounter'?D.enumValue(p.monster,['giant','cobra','mole']):null;
  let kind=requested,milestone;
  if(requested&&farm[requested+'Challenge']&&!next){const old=farm[requested+'Challenge'];next={...old,kind:requested,groupId:actor.groupId,targetGroupId:target.groupId,targetAccountId:target.accountId,health:CONFIG[requested].health,attacks:{melee:0,ranged:0}};if(stamp>=old.deadline)return{patch,result:{expired:true,result:resolve()},session:next,event,targetFarm:targetChanged?targetFarm:null};return{patch,result:{challenge:{...next},kind:requested},session:next};}
  if(requested){milestone=requested==='giant'?giant.nextGiantMilestone(farm):requested==='cobra'?cobra.nextCobraMilestone(farm):mole.nextMoleMilestone(farm);if(milestone===null)return{patch,result:null,session:next};}
  else{
   const roll=(min,max)=>min+Math.floor(random()*(max-min+1));
   if(action==='homeEncounter'){
    if(next&&!next.harvested&&next.targetGroupId===actor.groupId&&next.targetAccountId===actor.accountId&&(next.result?.outcome==='win'||next.harvestPermit))return{patch,result:null,session:next};
    if(!Object.values(P.settlePoultry(farm,stamp).ready).some(n=>n>0)||inventory.getUsedSpace(farm)>=(farm.warehouseLimit||10))return{patch,result:null,session:next};
    kind=G.rollHomeBossEncounter(farm.coopLevel,roll);
   }else{kind=G.rollVisitBossEncounter(targetFarm?.coopLevel,roll,30);if(!kind&&roll(1,30)===1)kind='tiger';if(!kind&&roll(1,10)===1)kind='wolf';}
   if(!kind){if(action==='visitEncounter')next={id,kind:null,targetGroupId:target.groupId,targetAccountId:target.accountId,visitPermit:true,result:{outcome:'clear'}};if(action==='homeEncounter')next={id,kind:null,groupId:actor.groupId,targetGroupId:actor.groupId,targetAccountId:actor.accountId,harvestPermit:true,harvested:false,result:{outcome:'clear'}};return{patch,result:null,session:next};}
  }
  return{patch,result:start(kind,milestone),session:next};
 }
 if(!next||p.battleId!==next.id)D.fail('failed-precondition','戰鬥會話已變更');
 if(next.result)return{patch,result:next.result,session:next};
 if(action==='battleSettle')return{patch,result:resolve(),session:next,event,targetFarm:targetChanged?targetFarm:null};
 if(stamp>=next.deadline)D.fail('deadline-exceeded','戰鬥時間已到，請結算');
 const mode=D.enumValue(p.mode,['melee','ranged']),count=D.integer(p.count,1,1000),weapon=mode==='ranged'?C.equippedBow(farm):C.equippedWeapon(farm);
 if(!weapon||mode==='ranged'&&!['dragon','eagle','cobra','giant'].includes(next.kind)||mode==='melee'&&['dragon','eagle'].includes(next.kind))D.fail('failed-precondition','此武器無法攻擊怪物');
 const damage=C.weaponDamage(weapon,next.kind);if(!damage)D.fail('failed-precondition','此武器無法造成傷害');
 // 每個會話累計速率與小幅 burst；重送由外層收據去重，不能跨裝備／跨裝置重設額度。
 const attacks={...next.attacks},cap=Math.floor((stamp-next.startedAt)/1000*(mode==='ranged'?10:20))+4;
 if((attacks[mode]||0)+count>cap)D.fail('resource-exhausted','攻擊過於密集，請稍候重試');
 attacks[mode]=(attacks[mode]||0)+count;next={...next,attacks,health:Math.max(0,next.health-damage*count),lastAttackAt:stamp};
 return{patch,result:{id:next.id,health:next.health,deadline:next.deadline},session:next};
}
module.exports={combatCommand,CONFIG};
