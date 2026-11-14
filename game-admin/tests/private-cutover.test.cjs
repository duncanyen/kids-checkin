const test=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs'),I=require('../../functions/identity-domain.cjs'),M=require('../../functions/migrations/private-cutover.cjs');
test('cutover requires owner-reviewed group roles, exact rules and passing matching test evidence',async()=>{
 const db=new MemoryDB(),profiles=[{id:'p1',data:{accountId:'alice',name:'Alice',role:'member',password:'secret123',pin:'1234'}}],groups=[{id:'A',data:{members:['alice'],inviteCode:'EXPOSED'}}];
 db.data.set('users/p1',profiles[0].data);db.data.set('groups/A',groups[0].data);db.data.set('ops_identity_accounts/'+I.hash('alice'),{profileId:'p1'});
 db.data.set('ops_identity_credentials/p1',{authUid:I.profileUid('p1'),accountId:'alice',sessionVersion:1,secrets:[await I.hashSecret('secret123'),await I.hashSecret('1234')],disabled:false});
 await assert.rejects(M.stageGroups({db,groups,profiles,assignments:{version:1,groups:[{groupId:'A',roles:{alice:'member'}}]},assertProtected:async()=>{}}),{code:'failed-precondition'});
 await M.stageGroups({db,groups,profiles,assignments:{version:1,groups:[{groupId:'A',roles:{alice:'owner'},managedProfileIds:[]}]},assertProtected:async()=>{}});
 await assert.rejects(M.purgePublicSecrets({db,assertFinalRules:async()=>{throw Error('unverified rules');}}),/unverified/);
 assert.equal(db.data.get('users/p1').password,'secret123');
 await M.purgePublicSecrets({db,assertFinalRules:async()=>{}});
 assert.equal(db.data.get('users/p1').password,undefined);assert.equal(db.data.get('groups/A').inviteCode,undefined);assert.equal(db.data.get('groups/A').nexusRoles.alice,'owner');
 await assert.rejects(M.activate({db,assertFinalRules:async()=>{},attestation:{emulatorPassed:false},ruleHash:'hash',backupReference:'backup'}),{code:'failed-precondition'});
 const evidence={schema:1,unitPassed:true,emulatorPassed:true,browserPassed:true,rulesSha256:'hash',codeSha256:'code'};
 await M.activate({db,assertFinalRules:async()=>{},attestation:evidence,ruleHash:'hash',codeHash:'code',backupReference:'backup'});
 assert.equal(db.data.get('ops_identity_state/global').farmReady,true);await M.freeze({db});assert.equal(db.data.get('ops_identity_state/global').ready,false);assert.equal(db.data.get('ops_identity_state/global').backupReference,'backup');assert.equal((await db.doc('users/p1').get()).data().accountId,'alice');
});
