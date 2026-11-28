const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,uid}=require('./fixture.cjs'),{createFarmTransactions}=require('../functions/farm-transactions.cjs'),D=require('../functions/domain.cjs'),E=require('../functions/encounters.cjs');
const save=(f,type,id,config,expectedRevision=0)=>f.admin('saveCombatConfig',{type,id,config,expectedRevision,reason:'戰鬥數值測試'});
test('balance defaults, permission, validation, revision, replay and audit protect configurable combat',async()=>{
 const f=await fixture(),base=(await f.admin('gameBalance')).combat;assert.equal(Object.keys(base.monsters).length,9);assert.equal(Object.keys(base.weapons).length,8);assert.ok(Object.values(base.weapons).every(w=>w.criticalRate===5&&w.chainCriticalRate===5));
 await assert.rejects(f.admin('saveCombatConfig',{}, {auth:null}),{code:'unauthenticated'});
 await assert.rejects(f.admin('saveCombatConfig',{}, {auth:{uid:'alice',token:{role:'member'}}}),{code:'permission-denied'});
 for(const hp of [0,-1,1.5,'300',Infinity,10000001])await assert.rejects(save(f,'monsters','wolf',{hp}),{code:'invalid-argument'});
 for(const config of [{attack:0,criticalRate:5},{attack:1.5,criticalRate:5},{attack:1000001,criticalRate:5},{attack:20,criticalRate:-1},{attack:20,criticalRate:101},{attack:20,criticalRate:'5'},{attack:20,criticalRate:NaN}])await assert.rejects(save(f,'weapons','club',config),{code:'invalid-argument'});
 await assert.rejects(save(f,'weapons','forged',{attack:100,criticalRate:5}),{code:'invalid-argument'});
 const request={auth:f.adminAuth,data:{action:'saveCombatConfig',requestId:uid(),payload:{type:'weapons',id:'club',config:{attack:120,criticalRate:7.5,chainCriticalRate:5},expectedRevision:0,reason:'調整測試'}}};
 await f.service.adminAPI(request);assert.equal((await f.service.adminAPI(request)).replayed,true);
 await assert.rejects(save(f,'monsters','wolf',{hp:900},0),{code:'failed-precondition'});
 await save(f,'monsters','wolf',{hp:900},1);const next=(await f.admin('gameBalance')).combat;
 assert.equal(next.monsters.wolf.hp,900);assert.deepEqual(next.weapons.club,{attack:120,criticalRate:7.5,chainCriticalRate:5});assert.equal(next.monsters.tiger.hp,400);
 const audits=(await f.db.collection('ops_audit').get()).docs.map(d=>d.data()).filter(d=>d.action==='saveCombatConfig'&&d.result==='success');assert.equal(audits.length,2);const weaponAudit=audits.find(a=>a.after.id==='club');assert.equal(weaponAudit.before.config.attack,20);assert.equal(weaponAudit.after.config.attack,120);assert.equal(weaponAudit.adminUid,'admin');
});
test('critical 0/100 boundaries, 5 percent distribution, integer 1.5x and deterministic batches',async()=>{
 const M=await import('../../js/farm/combat-damage.js');
 for(const rate of [0,5,100]){
  const b=M.makeCombatSnapshot({equippedWeapon:'club'},'wolf','crit-boundaries',{weapons:{club:{attack:100,criticalRate:rate,chainCriticalRate:0}}});
  const copy=structuredClone(b);let count=0;for(let i=0;i<20000;i++){const hit=M.hitResult(b,'melee',i);assert.ok(hit.normalDamage>=90&&hit.normalDamage<=110);assert.equal(Number.isInteger(hit.damage),true);if(hit.critical){count++;assert.ok(hit.damage===Math.round(hit.normalDamage*1.5));}else assert.equal(hit.damage,hit.normalDamage);assert.deepEqual(hit,M.hitResult(copy,'melee',i));}
  if(rate===0)assert.equal(count,0);if(rate===100)assert.equal(count,20000);if(rate===5)assert.ok(count>800&&count<1200,'5% over 20000 deterministic samples');
  assert.equal(M.batchDamage(b,'melee',0,20),Array.from({length:20},(_,i)=>M.hitResult(b,'melee',i).damage).reduce((a,v)=>a+v,0));
 }
 const tiny=M.makeCombatSnapshot({},'wolf','tiny',{weapons:{club:{attack:1,criticalRate:0}}});assert.ok(Array.from({length:100},(_,i)=>M.hitDamage(tiny,'melee',i)).every(n=>n>=1&&n<=11));
 const old={combatVersion:2,maxHealth:300,damageSeed:'old',baseDamage:{melee:20},criticalRate:{melee:100}};
 assert.ok(Array.from({length:100},(_,i)=>M.hitResult(old,'melee',i)).every(h=>!h.critical&&h.damage>=10&&h.damage<=30),'existing V2 sessions never acquire critical hits');
});
test('saved settings snapshot only new fights, cannot forge crits, no balance reads on hit/retry, rewards once',async()=>{
 const f=await fixture(),M=await import('../../js/farm/combat-damage.js');
 await save(f,'monsters','gorilla',{hp:1500});await save(f,'weapons','club',{attack:100,criticalRate:100},1);
 const farm=f.db.data.get('groups/A/users/alice').farm;farm.coopLevel=3;farm.readyEggs.onagadori=0;
 const monsters=structuredClone(E.DEFAULTS);for(const m of Object.values(monsters))m.enabled=false;monsters.gorilla.enabled=true;monsters.gorilla.home.rate=100;f.db.data.set('ops_game_config/encounters',{monsters});
 let now=f.now(),balanceReads=0;const snapshot=f.db.snapshot.bind(f.db);f.db.snapshot=path=>{if(path==='ops_game_config/combat')balanceReads++;return snapshot(path);};
 const api=createFarmTransactions({db:f.db,player:async()=>({uid:'alice',accountId:'alice',groupId:'A'}),enabled:()=>true,now:()=>now}),page=uid();
 const req=(action,p={})=>({data:{groupId:'A',battlePageId:page,action,requestId:uid(),...p}});
 await api.handle(req('beginBattlePage',{combatProtocol:4}));const b=(await api.handle(req('homeEncounter'))).result.challenge;
 assert.equal(b.maxHealth,1500);assert.equal(b.baseDamage.melee,100);assert.equal(b.criticalRate.melee,100);assert.equal(b.balanceRevision,2);assert.equal(balanceReads,1);
 await save(f,'weapons','club',{attack:1,criticalRate:0},2);await save(f,'monsters','gorilla',{hp:9000},3);
 now=b.approachEndsAt+5000;const attack=req('battleAttack',{battleId:b.id,combatVersion:2,damageVersion:4,mode:'melee',firstHit:0,count:1,damage:999999,critical:false});
 balanceReads=0;const first=await api.handle(attack),replay=await api.handle(attack);assert.equal(first.result.health,1500-M.hitDamage(b,'melee',0));assert.equal(replay.result.health,first.result.health);assert.equal(balanceReads,0);
 await assert.rejects(api.handle(req('battleAttack',{battleId:b.id,combatVersion:2,mode:'melee',firstHit:1,count:1})),/戰鬥已更新/);
 let n=1,sum=M.hitDamage(b,'melee',0);while(sum<1500)sum+=M.hitDamage(b,'melee',n++);
 await api.handle(req('battleAttack',{battleId:b.id,combatVersion:2,damageVersion:4,mode:'melee',firstHit:1,count:n-1}));
 const settlement=req('battleSettle',{battleId:b.id});assert.equal((await api.handle(settlement)).result.outcome,'win');await api.handle(settlement);assert.equal(f.db.data.get('groups/A/users/alice').farm.gorillaFangs,1);
 await api.handle(req('beginBattlePage',{combatProtocol:4}));const fresh=(await api.handle(req('homeEncounter'))).result.challenge;
 assert.equal(fresh.maxHealth,9000);assert.equal(fresh.baseDamage.melee,1);assert.equal(fresh.criticalRate.melee,0);assert.equal(fresh.balanceRevision,4);
});
test('chain crit is an additional conditional roll, never multiplies the damage multiplier or crosses battles/modes',async()=>{
 const M=await import('../../js/farm/combat-damage.js');
 const make=(rate,chain,seed='chain-cases')=>M.makeCombatSnapshot({equippedWeapon:'club',shortbow:1,equippedBow:'shortbow'},'giant',seed,{weapons:{club:{attack:194,criticalRate:rate,chainCriticalRate:chain},shortbow:{attack:80,criticalRate:0,chainCriticalRate:100}}});
 const example=make(100,0);const exact=Array.from({length:200},(_,i)=>M.hitResult(example,'melee',i)).find(h=>h.normalDamage===194);assert.equal(exact.damage,291);
 const never=make(0,100);assert.ok(Array.from({length:500},(_,i)=>M.hitResult(never,'melee',i)).every(h=>!h.critical),'chain 100 cannot spontaneously start without a base crit');
 const persistent=make(5,100);let first=-1;
 for(let i=0;i<200;i++){const h=M.hitResult(persistent,'melee',i);if(h.critical&&first<0)first=i;if(first>=0){assert.equal(h.critical,true);assert.equal(h.streak,i-first+1);assert.equal(h.multiplier,1.5);assert.equal(h.damage,Math.round(h.normalDamage*1.5));}}
 assert.ok(first>=0);assert.equal(M.hitResult(persistent,'ranged',0).critical,false,'different weapon does not inherit a melee crit');
 const ordinary=make(5,0),sample=Array.from({length:1000},(_,i)=>M.hitResult(ordinary,'melee',i));assert.ok(sample.some((h,i)=>i&&sample[i-1].critical&&!h.critical&&h.streak===0));
 const reset=make(0,100,'new-battle');assert.equal(M.hitResult(reset,'melee',0).streak,0);
 const regular=make(5,5,'conditional-5');let total=0,after=0,continued=0,previous=false;
 for(let i=0;i<100000;i++){const h=M.hitResult(regular,'melee',i);if(previous){after++;if(h.critical)continued++;}if(h.critical)total++;previous=h.critical;}
 assert.ok(continued/after>.08&&continued/after<.115,'conditional next-hit chance approaches 9.75%');assert.ok(total/100000>.048&&total/100000<.057,'overall is around 5.25%, not 9.75% on every hit');
 assert.equal(M.batchDamage(regular,'melee',0,20)+M.batchDamage(regular,'melee',20,80),M.batchDamage(regular,'melee',0,100));
 for(const chainCriticalRate of [-1,101,NaN,Infinity,'5']){const f=await fixture();await assert.rejects(save(f,'weapons','club',{attack:100,criticalRate:5,chainCriticalRate}),{code:'invalid-argument'});}
});
