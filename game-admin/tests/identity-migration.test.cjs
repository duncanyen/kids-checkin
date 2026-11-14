const {test}=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs');
const {planProfiles,stageProfiles}=require('../../functions/migrations/private-identity.cjs');
const I=require('../../functions/identity-domain.cjs');
const rows=[{id:'old-doc',data:{accountId:'alice',name:'Alice',password:'secret123',pin:'1234'}}];
test('dry-run reports collisions and contains no credentials or per-user secret hash',()=>{
 const result=planProfiles(rows);assert.equal(result.issues.length,0);
 assert.equal(JSON.stringify(result).includes('secret123'),false);assert.equal(JSON.stringify(result).includes('1234'),false);
 assert.ok(planProfiles([...rows,{id:'second',data:rows[0].data}]).issues.some(i=>i.reason==='duplicate-account-id'));
});
test('stage requires verified rules and reviewed unchanged snapshot, leaves public profile intact',async()=>{
 const db=new MemoryDB();db.data.set('users/old-doc',structuredClone(rows[0].data));const before=structuredClone(rows[0].data),expectedFingerprint=planProfiles(rows).fingerprint;
 const run=assertProtected=>stageProfiles({db,rows,expectedFingerprint,assertProtected});
 await assert.rejects(run(async()=>{throw Error('rules unverified');}),/rules unverified/);assert.equal(db.data.size,1);
 assert.equal((await run(async()=>{})).staged,1);
 assert.deepEqual(db.data.get('users/old-doc'),before);
 const credential=db.data.get('ops_identity_credentials/old-doc');assert.equal(await I.verify('secret123',credential),true);assert.equal(await I.verify('1234',credential),true);
 assert.equal((await run(async()=>{})).unchanged,1);
 db.data.get('users/old-doc').password='changed';await assert.rejects(run(async()=>{}),{code:'aborted'});
 assert.equal(db.data.get('ops_identity_state/global'),undefined);
});
