const {test}=require('node:test'),assert=require('node:assert/strict');
const {MemoryDB}=require('./memory-db.cjs');
const {createIdentityGroups}=require('../../functions/identity-groups.cjs');
function fixture(){const db=new MemoryDB();const identify=async r=>{if(!r.auth)throw Object.assign(Error(),{code:'unauthenticated'});return{uid:r.auth.uid,accountId:r.auth.uid};};const api=createIdentityGroups({db,identify,now:()=>1000,limit:async()=>{}});const req=(uid,action,p={})=>({auth:{uid},data:{action,...p}});return{db,api,req};}
test('group invitation stays private and concurrent join does not lose existing membership',async()=>{
 const f=fixture(),request=f.req('alice','createGroup',{name:'Home',icon:'',requestId:'create-123'});
 const group=(await f.api.handle(request)).group;
 assert.equal((await f.api.handle(request)).group.id,group.id);
 assert.equal(f.db.data.get('groups/'+group.id).inviteCode,undefined);
 await assert.rejects(f.api.handle(f.req('bob','groupInvite',{groupId:group.id})),{code:'permission-denied'});
 const {code}=await f.api.handle(f.req('alice','groupInvite',{groupId:group.id}));
 await Promise.all(['bob','carol'].map(uid=>f.api.handle(f.req(uid,'joinGroup',{code}))));
 assert.deepEqual(f.db.data.get('groups/'+group.id).members,['alice','bob','carol']);
 await assert.rejects(f.api.handle(f.req('outsider','joinGroup',{code:'fake'})),{code:'not-found'});
 assert.equal((await f.db.collection('users').get()).size,0,'creating group does not grant global admin role');
});
