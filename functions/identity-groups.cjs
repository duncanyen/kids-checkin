const crypto=require('node:crypto'),I=require('./identity-domain.cjs');
/** 群組邀請碼只留於 ops 私有文件；公開群組不再帶有可直接加入的祕密。 */
function createIdentityGroups({db,now,identify,limit}){
 const roleRef=(groupId,accountId)=>db.doc('ops_group_roles/'+I.hash(groupId+':'+accountId));
 const safeGroup=(id,data)=>({id,name:data.name,icon:data.icon||'',members:data.members||[],farmVillageVisibility:data.farmVillageVisibility||'closed'});
 async function handle(request){
  const p=request.data||{},action=p.action,actor=await identify(request);
  await limit('group:'+actor.uid,30,60000);
  if(action==='createGroup'){
   const name=I.publicLabel(p.name,100),icon=I.text(p.icon||'',100,false),requestId=I.id(p.requestId);
   const groupId=I.hash(actor.uid+':create:'+requestId).slice(0,28),ref=db.doc('groups/'+groupId),code=crypto.randomBytes(12).toString('hex').toUpperCase();
   return db.runTransaction(async t=>{
    const current=await identify(request,t),existing=await t.get(ref);
    if(existing.exists){if(!existing.data().members.includes(current.accountId))I.fail('permission-denied','建立群組失敗');return{group:safeGroup(groupId,existing.data())};}
    const data={name,icon,members:[current.accountId],createdAt:now(),farmVillageVisibility:'closed',nexusRoles:{[current.accountId]:'owner'}};
    t.create(ref,data);t.create(db.doc('ops_group_role_sets/'+groupId),{roles:{[current.accountId]:'owner'}});t.create(roleRef(groupId,current.accountId),{groupId,accountId:current.accountId,role:'owner',createdAt:now()});
    t.create(db.doc('ops_group_invites/'+I.hash(code)),{groupId,enabled:true,createdAt:now()});t.create(db.doc('ops_group_settings/'+groupId),{inviteCode:code});
    return{group:safeGroup(groupId,data)};
   });
  }
  if(action==='joinGroup'){
   const code=I.text(p.code,100).toUpperCase();
   await limit('invite:'+actor.uid,10,600000);
   return db.runTransaction(async t=>{
    const current=await identify(request,t),invite=(await t.get(db.doc('ops_group_invites/'+I.hash(code)))).data();
    if(!invite?.enabled)I.fail('not-found','邀請碼無效');
    const groupId=I.id(invite.groupId),ref=db.doc('groups/'+groupId),snapshot=await t.get(ref),group=snapshot.data();
    if(!group||group.disabled===true)I.fail('permission-denied','群組目前無法加入');
    const members=[...new Set([...(group.members||[]),current.accountId])];
    if(members.length!==(group.members||[]).length)t.update(ref,{members});
    return{group:safeGroup(groupId,{...group,members})};
   });
  }
  if(action==='groupInvite')return db.runTransaction(async t=>{
   const current=await identify(request,t),groupId=I.id(p.groupId),group=(await t.get(db.doc('groups/'+groupId))).data();
   if(!group?.members?.includes(current.accountId))I.fail('permission-denied','你已不在此群組');
   const code=(await t.get(db.doc('ops_group_settings/'+groupId))).data()?.inviteCode;
   if(!code)I.fail('failed-precondition','群組邀請碼尚未完成遷移');return{code};
  });
  I.fail('invalid-argument','不支援的群組操作');
 }
 return{handle};
}
module.exports={createIdentityGroups};
