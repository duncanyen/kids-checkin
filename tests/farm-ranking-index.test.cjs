const test=require('node:test'),assert=require('node:assert/strict'),{ensure}=require('../scripts/ensure-farm-ranking-index.cjs');
const field='farm.stolenEggs20261116';
test('ranking index add preserves existing nested field indexes and only updates requested field',()=>{
 const calls=[],old={indexConfig:{indexes:[{queryScope:'COLLECTION',fields:[{fieldPath:field,order:'ASCENDING'}]},{queryScope:'COLLECTION',fields:[{fieldPath:field,order:'DESCENDING'}]}]}};
 ensure({project:'demo-p',apply:true,log:()=>{},run:args=>{calls.push(args);return JSON.stringify(old)}});
 assert.equal(calls.length,2);assert.ok(calls[1].includes('--index=order=ASCENDING,query-scope=COLLECTION'));assert.ok(calls[1].includes('--index=order=DESCENDING,query-scope=COLLECTION'));assert.ok(calls[1].includes('--index=order=DESCENDING,query-scope=COLLECTION_GROUP'));assert.equal(calls[1][4],field);assert.ok(!calls[1].includes('delete'));
});
test('ranking index dry-run and existing building index never mutate',()=>{
 for(const existing of [false,true]){const calls=[];ensure({project:'p',log:()=>{},run:args=>{calls.push(args);return JSON.stringify({indexConfig:{indexes:existing?[{queryScope:'COLLECTION_GROUP',state:'CREATING',fields:[{fieldPath:field,order:'DESCENDING'}]}]:[]}})}});assert.equal(calls.length,1);}
});
