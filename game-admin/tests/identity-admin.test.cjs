const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MemoryDB}=require('./memory-db.cjs'),I=require('../../functions/identity-domain.cjs'),{createIdentityAdmin}=require('../../functions/identity-admin.cjs');
function setup(){const db=new MemoryDB(),identify=async r=>({uid:r.auth.uid,accountId:r.auth.uid});db.data.set('groups/A',{members:['owner','child','outside'],name:'A',nexusRoles:{owner:'owner',child:'child',outside:'member'}});db.data.set('ops_group_role_sets/A',{roles:{owner:'owner',child:'child',outside:'member'}});db.data.set('ops_group_settings/A',{inviteCode:'OLD'});db.data.set('ops_group_invites/'+I.hash('OLD'),{groupId:'A',enabled:true});
 for(const [id,role]of Object.entries({owner:'owner',child:'child',outside:'member'})){db.data.set('users/'+id,{accountId:id,name:id,role:'member'});db.data.set('ops_identity_credentials/'+id,{sessionVersion:1,secrets:[],disabled:false,...(id==='child'?{managedByGroupId:'A'}:{})});db.data.set('ops_group_roles/'+I.hash('A:'+id),{role});}
 const api=createIdentityAdmin({db,now:()=>1000000000,identify,limit:async()=>{}}),req=(action,p={},uid='owner')=>({auth:{uid},data:{action,groupId:'A',operationId:crypto.randomUUID(),...p}});return{db,api,req};}
test('nickname/global role cannot authorize management; member removal rotates invitations and preserves the account',async()=>{
 const f=setup();f.db.data.get('users/outside').role='admin';f.db.data.get('users/outside').name='爸爸';
 await assert.rejects(f.api.handle(f.req('groupVisibility',{visibility:'public'},'outside')),{code:'permission-denied'});
 await f.api.handle(f.req('removeGroupUser',{profileId:'child'}));assert.equal(f.db.data.get('groups/A').members.includes('child'),false);assert.ok(f.db.data.has('users/child'));
 assert.equal(f.db.data.has('ops_group_invites/'+I.hash('OLD')),false);assert.notEqual(f.db.data.get('ops_group_settings/A').inviteCode,'OLD');
});
test('group manager cannot reset an independent account; managed child update stays private and invalidates old sessions',async()=>{
 const f=setup();await assert.rejects(f.api.handle(f.req('editGroupUser',{profileId:'outside',name:'new',pin:'1234',role:'member'})),{code:'permission-denied'});
 await f.api.handle(f.req('editGroupUser',{profileId:'child',name:'new child',pin:'1234',role:'child',menus:['chat']}));
 assert.equal(f.db.data.get('users/child').pin,undefined);assert.equal(f.db.data.get('ops_identity_credentials/child').sessionVersion,2);
 assert.equal(await I.verify('1234',f.db.data.get('ops_identity_credentials/child')),true);
 assert.equal(f.db.data.get('groups/A').nexusRoles.child,'child');
});
test('concurrent admin creation is idempotent, does not grant a global admin role or expose PIN in audit/response',async()=>{
 const f=setup(),request=f.req('addGroupUser',{accountId:'new_user',name:'New',pin:'3456',role:'admin',menus:['chat']});
 const replies=await Promise.all([f.api.handle(request),f.api.handle(request)]);
 assert.equal(replies[0].profile.docId,replies[1].profile.docId);assert.equal(replies[0].profile.role,'member');assert.equal(replies[0].profile.pin,undefined);
 assert.equal(f.db.data.get('groups/A').members.filter(id=>id==='new_user').length,1);
 assert.equal(JSON.stringify([...f.db.data.entries()].filter(([key])=>key.startsWith('ops_identity_audit/'))).includes('3456'),false);
 await assert.rejects(f.api.handle(f.req('removeGroupUser',{profileId:'owner'})),{code:'failed-precondition'});
});
test('owner transfer is scoped and atomic without taking over the independent account credentials',async()=>{
 const f=setup(),before=structuredClone(f.db.data.get('ops_identity_credentials/outside'));
 await f.api.handle(f.req('editGroupUser',{profileId:'outside',name:'outside',email:'',pin:'',role:'owner',menus:[]}));
 assert.equal(f.db.data.get('ops_group_roles/'+I.hash('A:outside')).role,'owner');assert.equal(f.db.data.get('ops_group_roles/'+I.hash('A:owner')).role,'admin');
 assert.equal(f.db.data.get('groups/A').nexusRoles.outside,'owner');assert.deepEqual(f.db.data.get('ops_identity_credentials/outside'),before);
 await assert.rejects(f.api.handle(f.req('editGroupUser',{profileId:'child',name:'child',role:'admin'})),{code:'permission-denied'});
});
