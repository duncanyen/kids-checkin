const test=require('node:test'),assert=require('node:assert/strict'),{ensure}=require('../scripts/ensure-farm-ranking-index.cjs');
const field='farm.stolenEggs20261116';
const indexes=['ASCENDING','DESCENDING','CONTAINS'].map(value=>({queryScope:'COLLECTION',state:'READY',fields:[{fieldPath:field,...(value==='CONTAINS'?{arrayConfig:value}:{order:value})}]}));
test('ranking index PATCH preserves all existing indexes, including array indexes, and uses explicit scope',async()=>{
 const calls=[],logs=[];let request;
 await ensure({project:'demo-p',apply:true,log:value=>logs.push(value),run:args=>{calls.push(args);return args[0]==='auth'?'secret-token\n':JSON.stringify({indexConfig:{indexes}})},fetchImpl:async(url,options)=>{request={url,options};return{ok:true,json:async()=>({name:'projects/demo-p/databases/(default)/operations/test'})}}});
 assert.equal(calls.length,2);assert.equal(calls[0][4],field);assert.deepEqual(calls[1],['auth','print-access-token']);
 assert.equal(request.url,'https://firestore.googleapis.com/v1/projects/demo-p/databases/(default)/collectionGroups/users/fields/'+field+'?updateMask=indexConfig');
 assert.equal(request.options.method,'PATCH');assert.equal(request.options.headers.Authorization,'Bearer secret-token');
 const body=JSON.parse(request.options.body);
 assert.deepEqual(body.indexConfig.indexes,[...indexes.map(({state,...index})=>index),{queryScope:'COLLECTION_GROUP',fields:[{fieldPath:field,order:'DESCENDING'}]}]);
 assert.equal(body.name,'projects/demo-p/databases/(default)/collectionGroups/users/fields/'+field);
 assert.ok(!logs.join('').includes('secret-token'));assert.ok(!calls.flat().some(arg=>arg.includes('query-scope')));
});
test('dry-run and existing READY or CREATING indexes never request credentials or mutate',async()=>{
 for(const state of [null,'READY','CREATING']){const calls=[];await ensure({project:'demo-p',apply:!!state,log:()=>{},run:args=>{calls.push(args);return JSON.stringify({indexConfig:{indexes:state?[{queryScope:'COLLECTION_GROUP',state,fields:[{fieldPath:field,order:'DESCENDING'}]}]:indexes}})},fetchImpl:()=>assert.fail('must not mutate')});assert.equal(calls.length,1);}
});
test('unknown or missing index configuration stops before obtaining credentials',async()=>{
 for(const current of [{},{indexConfig:{indexes:[{queryScope:'UNKNOWN',fields:[{fieldPath:field,order:'ASCENDING'}]}]}}]){
  let calls=0;await assert.rejects(ensure({project:'demo-p',apply:true,run:()=>{calls++;return JSON.stringify(current)},fetchImpl:()=>assert.fail('must not mutate')}));assert.equal(calls,1);
 }
});
test('API and credential errors do not disclose tokens or raw response bodies',async()=>{
 for(const kind of ['http','network','auth']){
  await assert.rejects(ensure({project:'demo-p',apply:true,run:args=>{if(args[0]!=='auth')return JSON.stringify({indexConfig:{indexes}});if(kind==='auth')throw Error('secret-token');return 'secret-token'},fetchImpl:async()=>{if(kind==='network')throw Error('secret-token');return{ok:false,status:403,json:async()=>({message:'secret-token'})}}}),error=>!error.message.includes('secret-token'));
 }
});
