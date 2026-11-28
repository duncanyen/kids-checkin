const crypto=require('node:crypto'),{MemoryDB}=require('../memory-db.cjs'),D=require('../../functions/domain.cjs'),S=require('../../functions/refinement-stone-rewards.cjs'),{createFarmTransactions}=require('../../functions/farm-transactions.cjs'),{createDailyChallenges,DEFAULT_CONFIG}=require('../../functions/daily-challenges.cjs');
async function fixture({enabled=true,random=()=>0}={}){
 const db=new MemoryDB(),clock={stamp:Date.parse('2026-11-23T00:01:00+08:00')},flags={enabled,trusted:true},actor={uid:'profile',accountId:'alice',groupId:'A'};let serial=0,roll=0,draws=0;
 for(const group of ['A','B']){db.data.set('groups/'+group,{members:['alice','bob'],farmVillageVisibility:'public'});for(const id of ['alice','bob'])db.data.set(`groups/${group}/users/${id}`,{farm:{coins:100,hens:1,hensState:[{id:'h',breed:'hen',laidAt:clock.stamp,isSick:false}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:100,coopLevel:3,cleanliness:0}});}
 const stone=createStoneRewardService();
 function createStoneRewardService(){return S.createStoneRewardService({db,now:()=>clock.stamp,enabled:()=>flags.enabled,trustedReady:()=>flags.trusted,testEnvironment:true,testRandomInt:upper=>{draws++;return random(upper);}});}
 const player=async req=>({...actor,groupId:req.data.groupId,...(req.auth?.uid==='other'?{uid:'other',accountId:'bob'}:{})}),request=(action,payload={},groupId='A')=>({auth:{uid:'profile'},data:{action,groupId,requestId:crypto.randomUUID(),...payload}});
 const publish=(config,expectedRevision=0)=>stone.publishConfiguration('operator',{config,expectedRevision},crypto.randomUUID());
 if(enabled)await publish(S.defaults());
 const api=createFarmTransactions({db,player,now:()=>clock.stamp,random:()=>roll,enabled:()=>true,stoneRewards:stone});
 const daily=createDailyChallenges({db,now:()=>clock.stamp,player,playerSession:player,throttle:async()=>{},verifiedProducers:Object.fromEntries(DEFAULT_CONFIG.mission.tasks.map(t=>[t.type,'test-trusted-server'])),stoneRewards:stone});
 const status=(group='A')=>daily.handle(request('status',{},group));
 const claim=async(type='checkin',state=null,group='A')=>{state||=await status(group);const c=state.challenges[type];return daily.handle(request('claim',{type,dateKey:state.dateKey,cycleId:c.cycleId,day:c.day},group));};
 const complete=async(group='A')=>{for(const task of DEFAULT_CONFIG.mission.tasks)for(let i=0;i<task.target;i++){const id='event-'+(++serial);db.data.set('ops_verified_farm_events/'+id,{uid:'profile',accountId:'alice',groupId:group,type:task.type,success:true,producer:'test-trusted-server',occurredAt:clock.stamp,collected:1,targetAccountId:'bob'});await daily.consumeVerifiedEvent(id);}};
 const win=async(kind='eagle')=>{const id='battle-'+(++serial),challenge={id,kind,groupId:'A',targetGroupId:'A',targetAccountId:'alice',startedAt:clock.stamp-1000,deadline:clock.stamp+60000,health:0,lastAttackAt:clock.stamp-1,attacks:{melee:1,ranged:0},milestone:50};if(['mole','cobra','giant'].includes(kind))farm()[kind+'Challenge']=challenge;db.data.set('ops_farm_active/'+D.hash('profile:A'),challenge);return api.handle(request('battleSettle',{battleId:id}));};
 const farm=(group='A')=>db.data.get(`groups/${group}/users/alice`).farm;
 return{db,clock,flags,actor,stone,api,daily,request,publish,status,claim,complete,win,farm,draws:()=>draws,roll:n=>roll=n};
}
module.exports={fixture};
