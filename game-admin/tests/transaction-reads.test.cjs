const test=require('node:test'),assert=require('node:assert/strict');
const {reuseTransactionReads}=require('../functions/transaction-reads.cjs');
test('coalesces concurrent document reads and binds write methods to the real transaction',async()=>{
 let count=0;const transaction={get:async ref=>{assert.equal(transaction,ref.owner);count++;return{version:count};},update(){assert.equal(this,transaction);}};
 const t=reuseTransactionReads(transaction),ref={path:'users/alice',collection(){},owner:transaction};
 const [a,b]=await Promise.all([t.get(ref),t.get({...ref})]);assert.equal(count,1);assert.equal(a,b);t.update(ref,{});
});
test('query reads are distinct, transaction retries get new snapshots, and cached reads never bypass write ordering',async()=>{
 let count=0,writing=false;const transaction={get:async()=>{if(writing)throw Error('Read after write');return ++count;},set(){writing=true;}};
 const ref={path:'users/alice',collection(){}},t=reuseTransactionReads(transaction);
 await t.get({path:'users',where(){}});await t.get({path:'users',where(){}});assert.equal(count,2);
 assert.equal(await t.get(ref),3);assert.equal(await reuseTransactionReads(transaction).get(ref),4);
 t.set(ref,{});await assert.rejects(t.get(ref),/Read after write/);
});
