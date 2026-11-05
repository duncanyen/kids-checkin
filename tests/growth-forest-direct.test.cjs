const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');

test('browser rules stay in sync with shared service and SHA-256 identifiers',async()=>{
 const paths=['js/growth-forest/direct-domain.js','js/growth-forest/direct-service.js'];
 const before=paths.map(p=>fs.readFileSync(p,'utf8'));require('../scripts/build-growth-direct.cjs');
 paths.forEach((p,i)=>assert.equal(fs.readFileSync(p,'utf8'),before[i],p+' must be regenerated'));
 const domain=await import('../js/growth-forest/direct-domain.js');
 for(const value of ['alice', {action:'water',payload:{slot:1}}])assert.equal(await domain.hash(value),crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex'));
});

test('Web Firestore adapter retries concurrent inserts and prevents duplicate awards',async()=>{
 const rows=new Map(),versions=new Map();let conflicts=0;
 global.window={__webDb:async operation=>{
  if(operation.op==='get'){await new Promise(resolve=>setImmediate(resolve));return{path:operation.path,data:structuredClone(rows.get(operation.path)??null),version:versions.get(operation.path)||0};}
  if(operation.op==='query')return [...rows].filter(([path])=>path.startsWith(operation.path+'/')&&path.split('/').length===operation.path.split('/').length+1).map(([path,data])=>({path,data:structuredClone(data)}));
  if(operation.op==='commit'){
   for(const [path,version]of operation.expected)if((versions.get(path)||0)!==version){conflicts++;throw Error('ABORTED');}
   for(const write of operation.writes){rows.set(write.path,write.merge?{...rows.get(write.path),...structuredClone(write.data)}:structuredClone(write.data));versions.set(write.path,(versions.get(write.path)||0)+1);}
  }
 }};
 try{
  const sdk=await import('./fixtures/growth-firestore-sdk.js'),{createFirestoreStore}=await import('../js/growth-forest/firestore-store.js');
  const store=createFirestoreStore(sdk,{},'A'),ledger=store.collection('groups/A/ledger'),wallet=store.doc('groups/A/wallet/alice');
  const award=()=>store.runTransaction(async t=>{
   const found=await t.get(ledger.where('accountId','==','alice')),balance=await t.get(wallet);
   if(found.size)return 'already-paid';
   t.create(ledger.doc(crypto.randomUUID()),{accountId:'alice',amount:10});t.set(wallet,{balance:(balance.data()?.balance||0)+10});return 'paid';
  });
  const result=await Promise.all([award(),award()]);
  assert.deepEqual(result.sort(),['already-paid','paid']);assert.equal(rows.get(wallet.path).balance,10);assert.ok(conflicts>0);
  await assert.rejects(store.runTransaction(async t=>t.create(wallet,{balance:999})),{code:'already-exists'});
  assert.equal(rows.get(wallet.path).balance,10);
  // The same request ID replayed concurrently returns its original result.
  const receipt=store.doc('groups/A/receipts/same-request');
  const replay=()=>store.runTransaction(async t=>{const old=await t.get(receipt);if(old.exists)return old.data().result;const balance=await t.get(wallet);t.set(wallet,{balance:balance.data().balance+5});t.create(receipt,{result:'awarded-once'});return 'awarded-once';});
  assert.deepEqual(await Promise.all([replay(),replay()]),['awarded-once','awarded-once']);assert.equal(rows.get(wallet.path).balance,15);
  const revision=structuredClone(rows.get('groups/A/growthSync/main'));
  await store.runTransaction(t=>t.get(wallet));assert.deepEqual(rows.get('groups/A/growthSync/main'),revision);
  // Filtering, ordering and pagination preserve the Admin-shaped query API.
  rows.set('groups/A/ledger/b',{accountId:'bob',amount:99});rows.set('groups/A/ledger/c',{accountId:'alice',amount:20});
  const first=await ledger.where('accountId','==','alice').orderBy('amount','desc').limit(1).get();assert.equal(first.docs[0].data().amount,20);
  const next=await ledger.where('accountId','==','alice').orderBy('amount','desc').startAfter(first.docs[0]).limit(1).get();assert.equal(next.docs[0].data().amount,10);
  for(let i=0;i<2001;i++)rows.set('groups/A/large/'+i,{accountId:'alice'});
  await assert.rejects(store.collection('groups/A/large').get(),{code:'resource-exhausted'});
 }finally{delete global.window;}
});
