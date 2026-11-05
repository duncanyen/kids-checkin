const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('../game-admin/tests/memory-db.cjs');
const D=require('../functions/growth-domain.cjs');
const {createGrowthService}=require('../functions/growth-service.cjs');
require('../scripts/prepare-growth-forest.cjs');
async function setup(){
 const db=new MemoryDB();let now=Date.parse('2026-11-05T04:00:00Z');
 for(const [accountId,role]of [['parent','parent'],['alice','child'],['bob','child']])await db.doc('users/'+accountId).set({accountId,role,name:accountId==='alice'?'新的名字':accountId});
 await db.doc('groups/A').set({name:'森林家庭',members:['parent','alice']});await db.doc('groups/B').set({members:['bob']});
 const factory=process.env.GROWTH_TEST_DIRECT==='1'?(await import('../js/growth-forest/direct-service.js')).createGrowthService:createGrowthService;
 const service=factory({db,now:()=>now});
 const request=(who,action,payload={},requestId=crypto.randomUUID(),groupId=who==='bob'?'B':'A')=>({auth:{uid:who,token:{photoAccountId:who,photoGroupId:groupId}},data:{groupId,action,payload,requestId}});
 const call=(who,action,payload={},rid)=>service.handle(request(who,action,payload,rid));
 const wallet=async who=>(await db.doc(`groups/A/growthProfiles/${who}`).get()).data();
 return{db,service,request,call,wallet,tick:()=>now++,now:()=>now};
}
const exam=patch=>({type:'exam',eventDate:'2026-11-05',subject:'數學',examType:'小考',score:95,maxScore:100,note:'',...patch});
const reading=patch=>({type:'reading',eventDate:'2026-11-05',bookName:'森林裡的故事',readingMinutes:20,readingPages:15,chapter:'第三章',note:'',...patch});

test('migration preserves exact old balance, reservations, rewards and historical request transitions once',async()=>{
 const f=await setup();await f.db.doc('groups/A/settings/wishWall').set({examRules:[],choreRules:[],gifts:[{id:'book',name:'課外讀物',points:30}]});
 await f.db.doc('groups/A/scores/old').set({accountId:'alice',points:150,category:'chore',date:'2026-10-01'});
 await f.db.doc('groups/A/redeems/pending').set({accountId:'alice',cost:20,status:'執行中',date:'2026-10-01',item:'圖書'});
 await f.db.doc('groups/A/redeems/done').set({accountId:'alice',cost:10,status:'已完成',date:'2026-10-01'});
 const a=await f.call('alice','snapshot');assert.equal(a.wallet.pointsBalance,140);assert.equal(a.wallet.pointsReserved,20);assert.equal(a.wallet.waterBalance,0);assert.equal(a.rewards[0].cost,30);
 await f.call('alice','snapshot');assert.equal((await f.db.collection('groups/A/growthTransactions').get()).size,1);
 await f.call('parent','changeRewardRequest',{id:'legacy_pending',accountId:'alice',status:'rejected',reason:'改選其他獎勵'});
 assert.equal((await f.wallet('alice')).pointsReserved,0);assert.equal((await f.wallet('alice')).pointsBalance,140);
 await f.call('parent','changeRewardRequest',{id:'legacy_pending',accountId:'alice',status:'rejected',reason:'重試'});
 assert.equal((await f.wallet('alice')).pointsBalance,140);assert.equal((await f.db.doc('groups/A/redeems/pending').get()).data().status,'執行中');
 const records=await f.call('alice','legacyList',{kind:'requests'});assert.ok(records.rows.some(r=>r.id==='legacy_pending'&&r.status==='rejected'));
});

test('exam approval, normalized score, improvement and snapshot rules never pay twice',async()=>{
 const f=await setup(),first=await f.call('alice','createRecord',exam({score:40,maxScore:50,eventDate:'2026-11-04'}));
 assert.equal(first.status,'pending');assert.equal((await f.wallet('alice')).pointsBalance,0);
 await f.call('parent','reviewRecord',{id:first.id,accountId:'alice',status:'approved'});
 assert.equal((await f.wallet('alice')).pointsBalance,80);
 f.tick();const second=await f.call('alice','createRecord',exam());
 await f.call('parent','saveSettings',{settings:{...D.DEFAULT_SETTINGS,examBands:[{min:0,points:1,water:0,coins:0}]}});
 await Promise.all([f.call('parent','reviewRecord',{id:second.id,accountId:'alice',status:'approved'}),f.call('parent','reviewRecord',{id:second.id,accountId:'alice',status:'approved'})]);
 assert.equal((await f.wallet('alice')).pointsBalance,210);assert.equal((await f.wallet('alice')).waterBalance,45);
 const r=(await f.db.doc('groups/A/growthRecords/'+second.id).get()).data();assert.equal(r.previousPercent,80);assert.equal(r.improvementBonus,30);
 await assert.rejects(f.call('alice','createRecord',exam()),{code:'already-exists'});
 for(const input of [exam({score:-1}),exam({score:101}),exam({maxScore:0}),exam({eventDate:'2026-02-30'})])await assert.rejects(f.call('alice','createRecord',input),{code:'invalid-argument'});
});

test('reading auto approval, subthreshold history, duplicate keys and concurrent daily cap',async()=>{
 const f=await setup();await Promise.all([f.call('alice','createRecord',reading()),f.call('alice','createRecord',reading({bookName:'另一本書',readingMinutes:60}))]);
 const w=await f.wallet('alice');assert.equal(w.pointsBalance,10);assert.equal(w.waterBalance,15);assert.equal(w.coinBalance,5);
 const low=await f.call('alice','createRecord',reading({readingMinutes:5,bookName:'短篇'}));assert.deepEqual(low.rewards,{points:0,water:0,coins:0});
 await assert.rejects(f.call('alice','createRecord',reading()),{code:'already-exists'});
 const rows=await f.call('alice','list',{kind:'records',type:'reading'});assert.equal(rows.rows.length,3);
 const overview=await f.call('parent','overview',{accountId:'alice'});assert.equal(overview.readingMinutes,85);assert.equal(overview.readingPages,45);
});

test('initial seed, planting, catalog prices, water spending and maturity guard are atomic',async()=>{
 const f=await setup();await f.call('alice','snapshot');await f.call('alice','snapshot');
 const planted=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'});
 await assert.rejects(f.call('alice','plant',{positionIndex:1,plantType:'sunflower'}),{code:'failed-precondition'});
 await assert.rejects(f.call('alice','water',{id:planted.id}),{code:'failed-precondition'});
 await f.call('parent','saveSettings',{settings:{...D.DEFAULT_SETTINGS,reading:{minutes:1,points:10,water:110,coins:100,dailyLimit:1}}});
 await f.call('alice','createRecord',reading());
 await f.call('alice','buySeed',{plantType:'tulip',price:0,coins:9999});assert.equal((await f.wallet('alice')).coinBalance,20);
 for(let i=0;i<10;i++)await f.call('alice','water',{id:planted.id});
 assert.equal((await f.db.doc('groups/A/gardenPlants/'+planted.id).get()).data().growthStage,5);
 await assert.rejects(f.call('alice','water',{id:planted.id}),{code:'failed-precondition'});assert.equal((await f.wallet('alice')).waterBalance,10);
});

test('reward reservations, rejection, completion, replay and competing spending preserve points',async()=>{
 const f=await setup();await f.call('parent','manualReward',{accountId:'alice',points:100,reason:'努力完成任務'});
 const gift=await f.call('parent','saveReward',{name:'一起看電影',description:'',cost:80,status:'active'});
 const rid=crypto.randomUUID(),payload={giftId:gift.id};const requested=await f.call('alice','requestReward',payload,rid);
 assert.deepEqual(await f.call('alice','requestReward',payload,rid),requested);
 await assert.rejects(f.call('alice','requestReward',payload),{code:'already-exists'});
 await f.call('parent','changeRewardRequest',{id:requested.id,accountId:'alice',status:'rejected',reason:'改約下週'});assert.equal((await f.wallet('alice')).pointsBalance,100);
 const cancelled=await f.call('alice','requestReward',payload);await f.call('alice','changeRewardRequest',{id:cancelled.id,accountId:'alice',status:'cancelled',reason:'想再考慮'});assert.equal((await f.wallet('alice')).pointsReserved,0);
 const next=await f.call('alice','requestReward',payload);await f.call('parent','changeRewardRequest',{id:next.id,accountId:'alice',status:'completed'});
 await f.call('parent','changeRewardRequest',{id:next.id,accountId:'alice',status:'completed'});
 assert.equal((await f.wallet('alice')).pointsBalance,20);assert.equal((await f.wallet('alice')).pointsReserved,0);assert.equal((await f.wallet('alice')).redeemedPoints,80);
});

test('corrections and revocations produce compensating transactions; spent resources cannot go negative',async()=>{
 const f=await setup();const r=await f.call('alice','createRecord',exam());await f.call('parent','reviewRecord',{id:r.id,accountId:'alice',status:'approved'});
 await f.call('parent','correctRecord',{id:r.id,accountId:'alice',fields:{score:75},reason:'核對考卷後更正'});assert.equal((await f.wallet('alice')).pointsBalance,60);
 await f.call('parent','correctRecord',{id:r.id,accountId:'alice',revoke:true,reason:'重複考卷'});assert.equal((await f.wallet('alice')).pointsBalance,0);
 assert.equal((await f.db.collection('groups/A/growthRecordHistory').get()).size,2);
 const next=await f.call('alice','createRecord',exam({subject:'英文'}));await f.call('parent','reviewRecord',{id:next.id,accountId:'alice',status:'approved'});
 const plant=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'});await f.call('alice','water',{id:plant.id});
 await assert.rejects(f.call('parent','correctRecord',{id:next.id,accountId:'alice',revoke:true,reason:'撤銷'}),{code:'failed-precondition'});
});

test('missing identity, spoofing, cross-group access and parent impersonation fail closed',async()=>{
 const f=await setup();await assert.rejects(f.service.handle({data:{groupId:'A',action:'snapshot'}}),{code:'unauthenticated'});
 await assert.rejects(f.service.handle(f.request('bob','snapshot',{accountId:'alice'},undefined,'A')),{code:'permission-denied'});
 await assert.rejects(f.call('alice','saveSettings',{settings:D.DEFAULT_SETTINGS,role:'parent'}),{code:'permission-denied'});
 await assert.rejects(f.call('alice','snapshot',{accountId:'parent'}),{code:'permission-denied'});
 const r=await f.call('alice','createRecord',exam({accountId:'parent',rewardPoints:999999}));assert.equal((await f.db.doc('groups/A/growthRecords/'+r.id).get()).data().accountId,'alice');
 await assert.rejects(f.call('alice','reviewRecord',{id:r.id,accountId:'alice',status:'approved'}),{code:'permission-denied'});
 await f.db.doc('groups/A').set({members:['parent']});await assert.rejects(f.call('alice','snapshot'),{code:'permission-denied'});
});

test('rejected records never pay, approval-required reading waits, failed transactions can retry same receipt',async()=>{
 const f=await setup();await f.call('parent','saveSettings',{settings:{...D.DEFAULT_SETTINGS,readingApproval:true}});
 const r=await f.call('alice','createRecord',reading());assert.equal(r.status,'pending');
 await f.call('parent','reviewRecord',{id:r.id,accountId:'alice',status:'rejected',reason:'請補充閱讀內容'});assert.equal((await f.wallet('alice')).pointsBalance,0);
 const examRecord=await f.call('alice','createRecord',exam()),rid=crypto.randomUUID(),payload={id:examRecord.id,accountId:'alice',status:'approved'};
 f.db.failAward=true;await assert.rejects(f.call('parent','reviewRecord',payload,rid));assert.equal((await f.wallet('alice')).pointsBalance,0);
 await f.call('parent','reviewRecord',payload,rid);assert.equal((await f.wallet('alice')).pointsBalance,100);
 await assert.rejects(f.call('parent','reviewRecord',{...payload,status:'rejected'},rid),{code:'already-exists'});
});

test('pending/rejected records can be edited and resubmitted without duplicate awards',async()=>{
 const f=await setup(),r=await f.call('alice','createRecord',exam());
 await f.call('parent','reviewRecord',{id:r.id,accountId:'alice',status:'rejected',reason:'請補充說明'});
 await f.call('alice','editRecord',{id:r.id,fields:{note:'已核對考卷'}});
 await f.call('parent','reviewRecord',{id:r.id,accountId:'alice',status:'approved'});
 assert.equal((await f.wallet('alice')).pointsBalance,100);
 await assert.rejects(f.call('alice','editRecord',{id:r.id,fields:{score:100}}),{code:'failed-precondition'});
});

test('historical valid exams are used as comparison without re-awarding old resources',async()=>{
 const f=await setup();await f.db.doc('groups/A/scores/old-exam').set({accountId:'alice',category:'exam',subject:'數學',examType:'小考',score:87,date:'2026-11-04'});
 const r=await f.call('alice','createRecord',exam());await f.call('parent','reviewRecord',{id:r.id,accountId:'alice',status:'approved'});
 assert.equal((await f.wallet('alice')).pointsBalance,120);assert.equal((await f.wallet('alice')).waterBalance,25);
});

test('records paginate and filter without leaking another child, migration aborts negative legacy balances',async()=>{
 const f=await setup();await f.call('alice','snapshot');
 for(let i=0;i<25;i++)await f.db.doc('groups/A/growthRecords/test'+i).set({id:'test'+i,accountId:'alice',createdAt:i,eventDate:'2026-11-05',type:i%2?'reading':'exam'});
 await f.db.doc('groups/A/growthRecords/private').set({accountId:'parent',createdAt:999,type:'exam'});
 const a=await f.call('alice','list',{kind:'records'}),b=await f.call('alice','list',{kind:'records',cursor:a.cursor});assert.equal(a.rows.length,20);assert.equal(b.rows.length,5);assert.equal(new Set([...a.rows,...b.rows].map(r=>r.id)).size,25);
 assert.ok(!(await f.call('alice','list',{kind:'records',type:'exam'})).rows.some(r=>r.accountId!=='alice'));
 const bad=await setup();await bad.db.doc('groups/A/redeems/bad').set({accountId:'alice',status:'已完成',cost:100});await assert.rejects(bad.call('alice','snapshot'),{code:'failed-precondition'});assert.equal((await bad.db.doc('groups/A/growthProfiles/alice').get()).exists,false);
});

test('reading metadata correction preserves earned units after a later increase in daily cap',async()=>{
 const f=await setup(),first=await f.call('alice','createRecord',reading());
 await f.call('parent','saveSettings',{settings:{...D.DEFAULT_SETTINGS,reading:{...D.DEFAULT_SETTINGS.reading,dailyLimit:3}}});
 await f.call('alice','createRecord',reading({bookName:'新的閱讀',readingMinutes:40}));
 assert.equal((await f.wallet('alice')).pointsBalance,30);
 await f.call('parent','correctRecord',{id:first.id,accountId:'alice',fields:{chapter:'補記第三章'},reason:'僅補章節'});
 assert.equal((await f.wallet('alice')).pointsBalance,30);
});

test('two different simultaneous requests for the same affordable gift hold points only once',async()=>{
 const f=await setup();await f.call('parent','manualReward',{accountId:'alice',points:100,reason:'測試原子保留'});const gift=await f.call('parent','saveReward',{name:'圖書',description:'',cost:10,status:'active'});
 const results=await Promise.allSettled([f.call('alice','requestReward',{giftId:gift.id}),f.call('alice','requestReward',{giftId:gift.id})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await f.wallet('alice')).pointsReserved,10);
});

test('malformed requests and foreign or nested exam-photo paths are rejected',async()=>{
 const f=await setup();await assert.rejects(f.service.handle({auth:{uid:'alice'},data:null}),{code:'invalid-argument'});
 for(const photoPath of ['growth-exams/B/alice/file.jpg','growth-exams/A/parent/file.jpg','growth-exams/A/alice/nested/file.jpg','growth-exams/A/alice/script.svg'])await assert.rejects(f.call('alice','createRecord',exam({photoPath})),{code:'permission-denied'});
});

test('land expands atomically without a fixed cap; page reads preserve old plants and bounded garden size',async()=>{
 const f=await setup();await f.call('alice','snapshot');const first=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'});
 const walletRef=f.db.doc('groups/A/growthProfiles/alice'),gardenRef=f.db.doc('groups/A/gardens/alice');
 await walletRef.set({...await f.wallet('alice'),pointsBalance:123,coinBalance:1000,waterBalance:1000});
 const bought=await Promise.all([f.call('alice','buyPlot',{coins:0,water:0}),f.call('alice','buyPlot',{})]);
 assert.deepEqual(bought.map(r=>r.positionIndex).sort(),[3,4]);assert.equal((await f.wallet('alice')).coinBalance,800);assert.equal((await f.wallet('alice')).waterBalance,960);assert.equal((await f.wallet('alice')).pointsBalance,123);
 const rid=crypto.randomUUID(),third=await f.call('alice','buyPlot',{},rid);assert.deepEqual(await f.call('alice','buyPlot',{},rid),third);
 assert.equal((await gardenRef.get()).data().plotCount,6);assert.equal((await gardenRef.get()).data().slots.length,3);
 await f.call('alice','buySeed',{plantType:'tulip'});const planted=await f.call('alice','plant',{positionIndex:5,plantType:'tulip'});
 await f.call('alice','water',{id:planted.id});
 const page=await f.service.handle(f.request('alice','snapshot',{page:1}));assert.equal(page.gardenPage.totalPages,1);assert.equal(page.gardenPage.pageSize,9);assert.deepEqual(page.gardenPage.plots.map(p=>p.positionIndex),[0,1,2,3,4,5]);assert.equal(page.plants.find(p=>p.id===planted.id).growthValue,10);
 const old=await f.call('alice','snapshot');assert.equal(old.plants[0].id,first.id);
 await assert.rejects(f.call('alice','plant',{positionIndex:6,plantType:'sunflower'}),{code:'invalid-argument'});
 await f.call('alice','buySeed',{plantType:'tulip'});await assert.rejects(f.call('alice','plant',{positionIndex:5,plantType:'tulip'}),{code:'failed-precondition'});
 await gardenRef.set({...((await gardenRef.get()).data()),plotCount:2501});
 const far=await f.service.handle(f.request('alice','snapshot',{page:277}));assert.equal(far.garden.plotCount,2501);assert.equal(far.gardenPage.plots.length,8);assert.equal(far.plants.length,0);
 const beyond=await f.service.handle(f.request('alice','snapshot',{page:9999}));assert.equal(beyond.gardenPage.page,277);
 await assert.rejects(f.service.handle(f.request('alice','snapshot',{page:-1})),{code:'invalid-argument'});
 // A failed purchase cannot partially consume either resource or change land.
 const before=await f.wallet('alice');await walletRef.set({...before,coinBalance:99});
 await assert.rejects(f.call('alice','buyPlot',{}),{code:'failed-precondition'});assert.equal((await f.wallet('alice')).waterBalance,before.waterBalance);assert.equal((await gardenRef.get()).data().plotCount,2501);
 await walletRef.set({...before,waterBalance:19});await assert.rejects(f.call('alice','buyPlot',{}),{code:'failed-precondition'});assert.equal((await f.wallet('alice')).coinBalance,before.coinBalance);
});

test('legacy three-slot gardens remain usable without resetting plants or resources',async()=>{
 const f=await setup();await f.call('alice','snapshot');const planted=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'});
 // Model a garden created before indexed plots and plotCount existed.
 f.db.data.delete('groups/A/gardenPlots/alice_0');const garden=(await f.db.doc('groups/A/gardens/alice').get()).data();delete garden.plotCount;await f.db.doc('groups/A/gardens/alice').set(garden);
 const wallet=await f.wallet('alice');await f.db.doc('groups/A/growthProfiles/alice').set({...wallet,waterBalance:30,coinBalance:100});
 assert.equal((await f.call('alice','snapshot')).garden.plotCount,3);
 await f.call('alice','water',{id:planted.id});await f.call('alice','buyPlot',{});
 assert.equal((await f.call('alice','snapshot')).plants[0].id,planted.id);assert.equal((await f.call('alice','snapshot')).garden.plotCount,4);
});

test('new flower seeds charge exact prices and grow through all five stages in legacy gardens',async()=>{
 const f=await setup();await f.call('alice','snapshot');
 const catalog={rose:{name:'玫瑰花',price:100,required:200},daffodil:{name:'水仙花',price:150,required:300},lavender:{name:'薰衣草',price:200,required:400}};
 const snapshot=await f.call('alice','snapshot');for(const [type,expected]of Object.entries(catalog))assert.deepEqual(snapshot.plantCatalog[type],expected);
 const gardenRef=f.db.doc('groups/A/gardens/alice'),walletRef=f.db.doc('groups/A/growthProfiles/alice');
 await gardenRef.set({...snapshot.garden,seeds:{sunflower:1,tulip:2,sakura:0}});await walletRef.set({...snapshot.wallet,coinBalance:1000,waterBalance:1000});
 let position=0,spent=0;
 for(const [type,item]of Object.entries(catalog)){
  const rid=crypto.randomUUID();await f.call('alice','buySeed',{plantType:type,price:0},rid);spent+=item.price;
  await f.call('alice','buySeed',{plantType:type,price:0},rid);assert.equal((await f.wallet('alice')).coinBalance,1000-spent);
  const planted=await f.call('alice','plant',{plantType:type,positionIndex:position++}),stages=new Set([1]);
  for(let amount=0;amount<item.required;amount+=10){const result=await f.call('alice','water',{id:planted.id});stages.add(result.stage);}
  assert.deepEqual([...stages],[1,2,3,4,5]);
  const plant=(await f.db.doc('groups/A/gardenPlants/'+planted.id).get()).data();assert.equal(plant.plantType,type);assert.equal(plant.growthValue,item.required);assert.equal(plant.growthStage,5);
  await assert.rejects(f.call('alice','water',{id:plant.id}),{code:'failed-precondition'});
 }
 const seeds=(await gardenRef.get()).data().seeds;assert.equal(seeds.sunflower,1);assert.equal(seeds.tulip,2);assert.equal((await f.wallet('alice')).coinBalance,550);assert.equal((await f.wallet('alice')).waterBalance,100);
});

test('nine-plot pages preserve global positions across the ninth and tenth plots',async()=>{
 const f=await setup(),initial=await f.call('alice','snapshot');assert.equal(initial.garden.plotCount,3);assert.equal(initial.gardenPage.plots.length,3);
 await f.db.doc('groups/A/gardens/alice').set({...initial.garden,plotCount:10,seeds:{sunflower:3}});
 const first=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'}),ninth=await f.call('alice','plant',{positionIndex:8,plantType:'sunflower'}),tenth=await f.call('alice','plant',{positionIndex:9,plantType:'sunflower'});
 const page0=await f.call('alice','snapshot',{page:0}),page1=await f.call('alice','snapshot',{page:1});
 assert.equal(page0.gardenPage.totalPages,2);assert.equal(page0.gardenPage.plots.length,9);assert.deepEqual(page0.plants.map(p=>p.id),[first.id,ninth.id]);
 assert.equal(page1.gardenPage.start,9);assert.equal(page1.gardenPage.plots.length,1);assert.equal(page1.plants[0].id,tenth.id);
 assert.equal((await f.call('alice','snapshot',{page:999})).gardenPage.page,1);
});

test('bulk watering validates ten-drop units and tails, is atomic and cannot overfill or double spend',async()=>{
 const f=await setup(),initial=await f.call('alice','snapshot'),plant=await f.call('alice','plant',{positionIndex:0,plantType:'sunflower'});
 const walletRef=f.db.doc('groups/A/growthProfiles/alice'),plantRef=f.db.doc('groups/A/gardenPlants/'+plant.id);
 await walletRef.set({...initial.wallet,waterBalance:250});
 for(const amount of [0,-10,1.5,15,'20',NaN])await assert.rejects(f.call('alice','water',{id:plant.id,amount}),{code:'invalid-argument'});
 await assert.rejects(f.call('alice','water',{id:plant.id,amount:110}),{code:'failed-precondition'});
 const rid=crypto.randomUUID(),payload={id:plant.id,amount:40},award=await f.call('alice','water',payload,rid);
 assert.equal(award.watered,40);assert.equal(award.stage,3);assert.deepEqual(await f.call('alice','water',payload,rid),award);assert.equal((await f.wallet('alice')).waterBalance,210);
 await f.call('alice','water',{id:plant.id,amount:60});assert.equal((await plantRef.get()).data().growthStage,5);assert.equal((await f.wallet('alice')).waterBalance,150);
 await assert.rejects(f.call('alice','water',{id:plant.id,amount:10}),{code:'failed-precondition'});
 const logs=await f.db.collection('groups/A/growthTransactions').where('kind','==','plant-watered').get();assert.equal(logs.size,2);
 // The available balance can be an odd tail, and MAX can spend that exact tail.
 await plantRef.set({...((await plantRef.get()).data()),growthValue:0,growthStage:1});await walletRef.set({...await f.wallet('alice'),waterBalance:35});
 await f.call('alice','water',{id:plant.id,amount:35});assert.equal((await plantRef.get()).data().growthValue,35);assert.equal((await f.wallet('alice')).waterBalance,0);
 await assert.rejects(f.call('alice','water',{id:plant.id,amount:10}),{code:'failed-precondition'});
 await plantRef.set({...((await plantRef.get()).data()),growthValue:95,growthStage:4});await walletRef.set({...await f.wallet('alice'),waterBalance:20});
 await f.call('alice','water',{id:plant.id,amount:5});assert.equal((await plantRef.get()).data().growthValue,100);assert.equal((await f.wallet('alice')).waterBalance,15);
 // Competing requests must revalidate against the latest remaining growth.
 await plantRef.set({...((await plantRef.get()).data()),growthValue:0,growthStage:1});await walletRef.set({...await f.wallet('alice'),waterBalance:100});
 const raced=await Promise.allSettled([f.call('alice','water',{id:plant.id,amount:60}),f.call('alice','water',{id:plant.id,amount:60})]);assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal((await plantRef.get()).data().growthValue,60);assert.equal((await f.wallet('alice')).waterBalance,40);
});

test('group forest listing uses current account profiles and exposes only read-only forest visuals',async()=>{
 const f=await setup();await f.db.doc('users/parent').set({accountId:'parent',role:'parent',name:'最新家長名稱',avatar:'data:image/jpeg;base64,example',email:'private@example.invalid',password:'never-return'});
 const planted=await f.call('parent','plant',{positionIndex:0,plantType:'sunflower'});
 const members=await f.call('alice','members');assert.deepEqual(members.members.map(row=>row.accountId),['parent','alice']);assert.equal(members.members[0].name,'最新家長名稱');assert.equal(members.members[0].avatar,'data:image/jpeg;base64,example');assert.deepEqual(Object.keys(members.members[0]).sort(),['accountId','avatar','name']);
 const before=JSON.stringify([...f.db.data]),forest=await f.call('alice','memberForest',{accountId:'parent'});assert.equal(JSON.stringify([...f.db.data]),before);
 assert.equal(forest.owner.name,'最新家長名稱');assert.equal(forest.plants[0].id,planted.id);assert.deepEqual(Object.keys(forest.plants[0]).sort(),['growthStage','id','plantType','positionIndex']);assert.deepEqual(Object.keys(forest.garden),['plotCount']);
 for(const key of ['wallet','settings','rewards','migration','members','actor'])assert.equal(forest[key],undefined);
 await assert.rejects(f.call('alice','snapshot',{accountId:'parent'}),{code:'permission-denied'});await assert.rejects(f.call('alice','list',{accountId:'parent',kind:'records'}),{code:'permission-denied'});
 await assert.rejects(f.call('alice','water',{id:planted.id,amount:10,accountId:'parent'}),{code:'permission-denied'});
 await assert.rejects(f.call('alice','memberForest',{accountId:'bob'}),{code:'permission-denied'});
});

test('visiting empty, removed, ambiguous or departed forests never migrates or awards resources',async()=>{
 const f=await setup();await f.db.doc('users/newbie').set({accountId:'newbie',name:'新成員',role:'member',photoURL:'https://example.invalid/current.jpg'});await f.db.doc('groups/A').set({members:['parent','alice','newbie']});
 const before=JSON.stringify([...f.db.data]),empty=await f.call('alice','memberForest',{accountId:'newbie'});assert.equal(empty.hasForest,false);assert.equal(empty.plants.length,0);assert.equal(empty.gardenPage.plots.length,3);assert.equal(JSON.stringify([...f.db.data]),before);
 const members=await f.call('alice','members');assert.equal(members.members.find(row=>row.accountId==='newbie').avatar,'https://example.invalid/current.jpg');
 await f.db.doc('users/newbie').set({accountId:'newbie',role:'removed'});await assert.rejects(f.call('alice','memberForest',{accountId:'newbie'}),{code:'permission-denied'});assert.ok(!(await f.call('alice','members')).members.some(row=>row.accountId==='newbie'));
 await f.db.doc('users/newbie').set({accountId:'newbie',role:'member'});await f.db.doc('users/duplicate').set({accountId:'newbie',role:'member'});await assert.rejects(f.call('alice','memberForest',{accountId:'newbie'}),{code:'permission-denied'});
 await f.db.doc('groups/A').set({members:['alice','parent']});await assert.rejects(f.call('alice','memberForest',{accountId:'newbie'}),{code:'permission-denied'});
 await f.db.doc('groups/A').set({members:['parent']});await assert.rejects(f.call('alice','members'),{code:'permission-denied'});
});
