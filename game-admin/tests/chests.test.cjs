const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const C=require('../functions/chests.cjs'),D=require('../functions/domain.cjs'),{MemoryDB}=require('./memory-db.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),{fixture}=require('./fixture.cjs');
const setting=(patch={})=>({dropRate:100,coins:{enabled:true,min:17,max:17},items:[],...patch});
function setup(){
 const db=new MemoryDB();let stamp=Date.parse('2026-11-18T10:00:00+08:00'),roll=0;
 const farm={coins:100,hens:1,hensState:[{id:'h',breed:'hen',laidAt:stamp,isSick:false}],poultryVersion:2,readyEggs:{hen:0,silkie:0,bresse:0,onagadori:0},eggsReady:0,warehouseLimit:100,coopLevel:3,cleanliness:0};
 db.data.set('groups/A',{members:['alice','bob'],farmVillageVisibility:'public'});for(const who of ['alice','bob'])db.data.set('groups/A/users/'+who,{farm:structuredClone(farm)});
 const actor={uid:'profile',accountId:'alice',groupId:'A'},player=async req=>({...actor,...(req.auth.uid==='other'?{uid:'other',accountId:'bob'}:{}),groupId:req.data.groupId});
 const api=createFarmTransactions({db,player,now:()=>stamp,random:()=>roll,enabled:()=>true});
 const req=(action,p={})=>({auth:{uid:'profile'},data:{action,groupId:'A',requestId:crypto.randomUUID(),...p}});
 let serial=0;
 const win=async(kind='eagle')=>{
  const id='battle-'+kind+'-'+(++serial),challenge={id,kind,groupId:'A',targetGroupId:'A',targetAccountId:'alice',startedAt:stamp-1000,deadline:stamp+60000,health:0,lastAttackAt:stamp-1,attacks:{melee:1,ranged:0},milestone:50};
  if(['mole','cobra','giant'].includes(kind))db.data.get('groups/A/users/alice').farm[kind+'Challenge']=challenge;
  db.data.set('ops_farm_active/'+D.hash('profile:A'),challenge);
  return{request:req('battleSettle',{battleId:id}),id};
 };
 const execute=async(kind='eagle')=>{const battle=await win(kind);const response=await api.handle(battle.request);return{...battle,response,chest:response.result.chest};};
 const configure=(kind,value)=>db.data.set('ops_game_config/chests',{monsters:{[kind]:value},revision:1});
 return{db,api,actor,req,win,execute,configure,farm:()=>db.data.get('groups/A/users/alice').farm,roll:v=>roll=v};
}
test('three default tiers map all eight canonical monster IDs; drop thresholds and inclusive integer coins',()=>{
 for(const kind of ['wolf','tiger','gorilla'])assert.deepEqual(C.DEFAULTS[kind],{dropRate:20,coins:{enabled:true,min:1,max:100},items:[]});
 for(const kind of ['mole','dragon','eagle'])assert.deepEqual(C.DEFAULTS[kind],{dropRate:50,coins:{enabled:true,min:100,max:200},items:[]});
 for(const kind of ['cobra','giant'])assert.deepEqual(C.DEFAULTS[kind],{dropRate:80,coins:{enabled:true,min:500,max:1000},items:[]});
 assert.equal(C.drops(0,0),false);assert.equal(C.drops(100,1-Number.EPSILON),true);
 for(const rate of [20,50,80]){assert.equal(C.drops(rate,rate/100-1e-9),true);assert.equal(C.drops(rate,rate/100),false);assert.equal(C.drops(rate,rate/100+1e-9),false);}
 for(const coins of [C.DEFAULTS.wolf.coins,C.DEFAULTS.eagle.coins,C.DEFAULTS.giant.coins]){assert.equal(C.coinAmount(coins,0),coins.min);assert.equal(C.coinAmount(coins,1-Number.EPSILON),coins.max);}
 assert.equal(C.coinAmount({enabled:true,min:7,max:7},.53),7);assert.equal(C.coinAmount({enabled:false,min:1,max:100},.99),0);
 const counts=Array(4).fill(0);for(let i=0;i<400;i++)counts[C.coinAmount({enabled:true,min:0,max:3},(i+.5)/400)]++;assert.deepEqual(counts,[100,100,100,100]);
});
test('settings reject invalid rates, amounts, empty payouts and unsupported products; all existing bird breeds can be delivered',async()=>{
 for(const value of [setting({dropRate:-1}),setting({dropRate:101}),setting({coins:{enabled:true,min:5,max:4}}),setting({coins:{enabled:true,min:0,max:0}}),setting({coins:{enabled:true,min:1,max:Number.MAX_SAFE_INTEGER+1}}),setting({items:[{itemId:'guard:corgi',quantity:1}]}),setting({items:[{itemId:'scene:fuji',quantity:1}]}),setting({items:[{itemId:'medicine',quantity:0}]}),setting({items:[{itemId:'hen',quantity:20},{itemId:'silkie',quantity:1}]})])await assert.rejects(C.validate(value));
 assert.equal((await C.validate(setting({dropRate:0,coins:{enabled:false,min:0,max:0}}))).dropRate,0);
 for(const id of ['hen','silkie','bresse','onagadori','medicine','ironhammer','ancientStones'])assert.ok((await C.catalog()).find(i=>i.id===id).enabled);
});
test('admin saves each monster independently, preserves earlier settings, audits before/after and rejects players/stale revisions',async()=>{
 const f=await fixture(),config=setting();
 await assert.rejects(f.admin('saveChestConfig',{monster:'eagle',config,expectedRevision:0,reason:'test'},{auth:f.request().auth}),{code:'permission-denied'});
 await f.admin('saveChestConfig',{monster:'eagle',config,expectedRevision:0,reason:'巨鷹獨立設定'});
 await f.admin('saveChestConfig',{monster:'wolf',config:setting({dropRate:0}),expectedRevision:1,reason:'暫停狼寶箱'});
 const balance=await f.admin('gameBalance');assert.equal(balance.chests.monsters.eagle.coins.min,17);assert.equal(balance.chests.monsters.wolf.dropRate,0);assert.equal(balance.chests.monsters.tiger.dropRate,20);
 await assert.rejects(f.admin('saveChestConfig',{monster:'wolf',config,expectedRevision:0,reason:'過期'}),{code:'failed-precondition'});
 const audit=(await f.admin('list',{kind:'audit'})).rows.find(r=>r.action==='saveChestConfig'&&r.result==='success'&&r.after.monster==='eagle');assert.equal(audit.after.config.coins.min,17);assert.equal(audit.before.config.coins.min,100);assert.ok(audit.adminUid);assert.ok(audit.createdAt);
});
test('battle grants original loot plus one unopened chest atomically, without coins; all retries return the original box',async()=>{
 const f=setup(),b=await f.execute();assert.equal(f.farm().coins,100);assert.equal(f.farm().eagleFeathers,1);assert.equal(f.farm().chestCount,1);assert.deepEqual(f.db.data.get('ops_game_config/chests').monsters,C.DEFAULTS);
 assert.deepEqual(b.response.result.rewards.map(r=>r.itemId),['eagleFeathers','unopenedChest']);
 assert.equal((await f.api.handle(b.request)).result.chest.id,b.chest.id);
 assert.equal((await f.api.handle(f.req('battleSettle',{battleId:b.id}))).result.chest.id,b.chest.id);
 const list=await f.api.handle(f.req('listChests'));assert.equal(list.result.rows.length,1);assert.ok(C.ownerPath(f.actor).startsWith('ops_'));assert.equal(f.farm().chestCount,1);
});
test('0% and missed rolls retain original loot; every monster gets the configured locked tier',async()=>{
 for(const [kind,defaultConfig]of Object.entries(C.DEFAULTS)){
  const f=setup(),b=await f.execute(kind);if(kind==='hornet'){assert.equal(b.chest,undefined);assert.equal(f.farm().honey,1);continue;}assert.ok(b.chest);const chest=f.db.data.get(C.ownerPath(f.actor)+'/'+b.chest.id);assert.deepEqual(chest.snapshot,defaultConfig);
 }
 for(const rate of [0,20]){const f=setup();f.configure('eagle',setting({dropRate:rate}));f.roll(.9);const b=await f.execute();assert.equal(b.chest,undefined);assert.equal(f.farm().eagleFeathers,1);assert.equal(f.farm().coins,100);}
});
test('old box uses its locked snapshot after configuration changes, opens once across devices, and replay does not restore an old balance',async()=>{
 const f=setup();f.configure('eagle',setting());const b=await f.execute();f.configure('eagle',setting({coins:{enabled:true,min:999,max:999}}));
 f.db.data.get('ops_farm_active/'+D.hash('profile:A')).ownerPageId='page-device-bbbb';
 const a=f.req('openChest',{chestId:b.chest.id,battlePageId:'page-device-aaaa',coins:999999}),z=f.req('openChest',{chestId:b.chest.id,battlePageId:'page-device-bbbb'});
 const results=await Promise.all([f.api.handle(a),f.api.handle(z)]);assert.equal(results[0].result.coins,17);assert.equal(results[1].result.coins,17);assert.equal(f.farm().coins,117);assert.equal(f.farm().chestCount,0);
 f.farm().coins=500;f.db.data.get('ops_farm_active/'+D.hash('profile:A')).result=null;assert.equal((await f.api.handle(f.req('openChest',{chestId:b.chest.id}))).result.farm.coins,500);assert.equal((await f.api.handle(a)).result.farm.coins,500);assert.equal(f.farm().coins,500);
 const history=(await f.api.handle(f.req('listChests',{status:'opened'}))).result.rows;assert.equal(history.length,1);assert.equal(history[0].result.coins,17);assert.equal(history[0].result.farm,undefined);
});
test('items-only and coin-plus-multiple-item boxes deliver all contents with existing inventory fields',async()=>{
 for(const enabled of [false,true]){const f=setup();f.configure('eagle',setting({coins:{enabled,min:10,max:10},items:[{itemId:'medicine',quantity:2},{itemId:'ironhammer',quantity:1},{itemId:'ancientStones',quantity:3}]}));const b=await f.execute();const r=(await f.api.handle(f.req('openChest',{chestId:b.chest.id}))).result;assert.equal(r.items.length,3);assert.equal(f.farm().coins,enabled?110:100);assert.equal(f.farm().medicines,2);assert.equal(f.farm().ironhammer,1);assert.equal(f.farm().ancientStones,3);}
});
test('failed item delivery rolls back coins, chest consumption and receipt; same request can retry after making room',async()=>{
 const f=setup();f.configure('eagle',setting({items:[{itemId:'ironhammer',quantity:2}]}));const b=await f.execute();f.farm().warehouseLimit=1;const request=f.req('openChest',{chestId:b.chest.id});
 await assert.rejects(f.api.handle(request),{code:'resource-exhausted'});assert.equal(f.farm().coins,100);assert.equal(f.farm().chestCount,1);assert.equal(f.db.data.get(C.ownerPath(f.actor)+'/'+b.chest.id).status,'unopened');
 f.farm().warehouseLimit=10;await f.api.handle(request);assert.equal(f.farm().coins,117);assert.equal(f.farm().ironhammer,2);
});
test('chicken rewards reuse shop breed/capacity delivery without charging coins and remain retryable on a full coop',async()=>{
 const f=setup();f.configure('eagle',setting({coins:{enabled:false,min:0,max:0},items:[{itemId:'silkie',quantity:3}]}));const b=await f.execute();f.farm().coopLevel=1;const request=f.req('openChest',{chestId:b.chest.id});
 await assert.rejects(f.api.handle(request),{code:'failed-precondition'});assert.equal(f.farm().hens,1);assert.equal(f.farm().chestCount,1);
 f.farm().coopLevel=2;await f.api.handle(request);assert.equal(f.farm().hens,4);assert.equal(f.farm().hensState.filter(h=>h.breed==='silkie').length,3);assert.equal(new Set(f.farm().hensState.map(h=>h.id)).size,4);assert.equal(f.farm().coins,100);
});
test('storage failure is atomic for both battle drop and opening; another player cannot open or list the box',async()=>{
 const f=setup(),battle=await f.win();f.db.failAward=true;await assert.rejects(f.api.handle(battle.request),/simulated/);assert.equal(f.farm().chestCount,undefined);assert.equal(f.farm().eagleFeathers,undefined);
 const b=await f.api.handle(battle.request),id=b.result.chest.id,request=f.req('openChest',{chestId:id});f.db.failAward=true;await assert.rejects(f.api.handle(request),/simulated/);assert.equal(f.farm().chestCount,1);assert.equal(f.farm().coins,100);await f.api.handle(request);assert.equal(f.farm().chestCount,0);
 await assert.rejects(f.api.handle({...f.req('openChest',{chestId:id}),auth:{uid:'other'}}),{code:'not-found'});assert.equal((await f.api.handle({...f.req('listChests'),auth:{uid:'other'}})).result.rows.length,0);
});

test('a pending battle cannot open an unopened box, while an already completed box remains readable',async()=>{
 const f=setup(),b=await f.execute();f.db.data.get('ops_farm_active/'+D.hash('profile:A')).result=null;
 await assert.rejects(f.api.handle(f.req('openChest',{chestId:b.chest.id})),{code:'failed-precondition'});assert.equal(f.farm().chestCount,1);assert.equal(f.farm().coins,100);
});
