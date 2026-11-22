const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs'),{createFarmRanking}=require('../functions/farm-ranking.cjs');
const score='stolenEggs20261123';
function fixture(count){
 const db=new MemoryDB(),members=[];for(let n=0;n<count;n++){const id='p'+String(n).padStart(4,'0');members.push(id);db.data.set('users/'+id,{accountId:id,name:'玩家'+n});db.data.set(`groups/A/users/${id}`,{farm:{[score]:count-n}});}
 db.data.set('groups/A',{members,name:'村落',farmVillageVisibility:'public'});
 let scanned=0;return{db,api:createFarmRanking({db,onMeasure:m=>scanned=m.scanned}),get scanned(){return scanned}};
}
test('score query stops early at 1000 players and returns exactly the original top ten',async()=>{
 const f=fixture(1000),result=await f.api.load({},'stolenEggs');
 assert.equal(f.scanned,25);assert.deepEqual(result.rows.map(r=>r.score),[1000,999,998,997,996,995,994,993,992,991]);
});
test('complete cutoff ties keep original locale ordering and separate group farms',async()=>{
 const f=fixture(80);for(const [path,data]of f.db.data)if(path.startsWith('groups/A/users/'))data.farm[score]=1;
 f.db.data.set('groups/B',{members:['p0000'],name:'第二村',farmVillageVisibility:'public'});f.db.data.set('groups/B/users/p0000',{farm:{[score]:1}});
 const result=await f.api.load({},'stolenEggs');assert.equal(f.scanned,81);assert.deepEqual(result.rows.slice(0,3).map(r=>[r.accountId,r.groupId]),[['p0000','A'],['p0000','B'],['p0001','A']]);
});
test('private groups, removed members/profiles, zero scores and root profiles do not enter ranking',async()=>{
 const f=fixture(3);f.db.data.get('groups/A').members=['p0001','p0002'];f.db.data.get('users/p0001').role='removed';f.db.data.get('groups/A/users/p0002').farm[score]=0;
 f.db.data.set('groups/B',{members:['p0000'],farmVillageVisibility:'closed'});f.db.data.set('groups/B/users/p0000',{farm:{[score]:10000}});f.db.data.get('users/p0000').farm={[score]:999999};
 assert.deepEqual((await f.api.load({},'stolenEggs')).rows,[]);
 await assert.rejects(f.api.load({},'fake'),{code:'invalid-argument'});
});
test('privacy changes during profile reads continue scanning to fill the next valid ten',async()=>{
 const f=fixture(60);f.db.data.set('groups/B',{members:['p0000'],farmVillageVisibility:'public'});f.db.data.set('groups/B/users/p0000',{farm:{[score]:9999}});
 const collection=f.db.collection.bind(f.db);f.db.collection=(...args)=>{f.db.data.get('groups/B').farmVillageVisibility='closed';return collection(...args)};
 const result=await f.api.load({},'stolenEggs');assert.equal(result.rows.length,10);assert.ok(result.rows.every(r=>r.groupId==='A'));
});

test('monster Top10 queries only the new monster field and retains farm-scoped ranking/privacy rules',async()=>{
 const f=fixture(40);
 for(const [path,value]of f.db.data)if(path.startsWith('groups/A/users/'))value.farm.monsterKills20261123=41-value.farm[score];
 f.db.data.set('groups/Private',{members:['p0000'],farmVillageVisibility:'closed'});f.db.data.set('groups/Private/users/p0000',{farm:{monsterKills20261123:9999}});
 const result=await f.api.load({},'monsterKills');assert.equal(result.ranking,'monsterKills');assert.equal(f.scanned,25);assert.deepEqual(result.rows.map(r=>r.score),[40,39,38,37,36,35,34,33,32,31]);assert.equal(result.rows[0].accountId,'p0039');
});
