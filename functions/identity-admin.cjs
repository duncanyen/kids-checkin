/** 群組管理權取自私有 scoped role，不信任名字、瀏覽器角色或全域 users.role。 */
const crypto=require('node:crypto'),I=require('./identity-domain.cjs');
function createIdentityAdmin({db,now,identify,limit}){
 const roleRef=(groupId,accountId)=>db.doc('ops_group_roles/'+I.hash(groupId+':'+accountId));
 const idRef=accountId=>db.doc('ops_identity_accounts/'+I.hash(I.normalize(accountId)));
 async function manager(request,t){
  const actor=await identify(request,t),groupId=I.id(request.data?.groupId),read=ref=>t?t.get(ref):ref.get();
  const [group,role]=await Promise.all([read(db.doc('groups/'+groupId)),read(roleRef(groupId,actor.accountId))]);
  if(!group.data()?.members?.includes(actor.accountId)||!['owner','admin','parent'].includes(role.data()?.role))I.fail('permission-denied','沒有目前群組的管理權');
  return{...actor,groupId,group,role:role.data().role};
 }
 async function handle(request){
  const p=request.data||{},action=p.action;const actor=await manager(request);await limit('group-admin:'+actor.uid,30,60000);
  if(action==='groupAdminContext'){
   const roles={};for(const accountId of actor.group.data().members||[])roles[accountId]=(await roleRef(actor.groupId,accountId).get()).data()?.role||'member';
   return{roles,role:actor.role};
  }
  const newId=crypto.randomUUID(),code=crypto.randomBytes(12).toString('hex').toUpperCase();
  const pin=p.pin?I.text(p.pin,1000):null;
  if(pin&&!/^\d{4}$/.test(pin)&&pin.length<6)I.fail('invalid-argument','密碼需為四位 PIN 或至少六碼');
  const secret=pin?await I.hashSecret(pin):null;
  return db.runTransaction(async t=>{
   const current=await manager(request,t),receiptRef=db.doc('ops_identity_receipts/'+I.hash(current.uid+':'+I.id(p.operationId))),prior=await t.get(receiptRef),fingerprint=I.hash(JSON.stringify(Object.fromEntries(Object.keys(p).sort().map(k=>[k,p[k]]))));
   if(prior.exists){if(prior.data().fingerprint!==fingerprint)I.fail('already-exists','操作編號已用於其他資料');return{...prior.data().response,replayed:true};}
   const roleSetRef=db.doc('ops_group_role_sets/'+current.groupId),roleSet=(await t.get(roleSetRef)).data()?.roles||{};
   const group=current.group.data(),groupRef=db.doc('groups/'+current.groupId),stamp=now();
   const audit=db.doc('ops_identity_audit/'+crypto.randomUUID()),writes=[];
   let response={success:true};
   if(action==='groupVisibility'&&!['public','closed'].includes(p.visibility))I.fail('invalid-argument','村落類型無效');
   if(action==='groupVisibility')writes.push(()=>t.update(groupRef,{farmVillageVisibility:I.text(p.visibility)==='public'?'public':'closed'}));
   else if(action==='groupName'){
    const name=I.publicLabel(p.name,100);if(group.lastNameChange&&stamp-(group.lastNameChange.toMillis?.()||group.lastNameChange)<86400000)I.fail('failed-precondition','群組名稱一天只能修改一次');
    writes.push(()=>t.update(groupRef,{name,lastNameChange:stamp}));
   }else if(action==='reviewGroupRequest'){
    const requestRef=db.doc('group_requests/'+I.id(p.requestId)),row=(await t.get(requestRef)).data(),status=I.text(p.status);
    if(!['approved','rejected'].includes(status)||!row||row.groupId!==current.groupId||row.status!=='pending')I.fail('failed-precondition','申請已處理或不屬於目前群組');
    if(status==='approved'){
     const index=(await t.get(idRef(I.id(row.accountId)))).data(),profile=index?(await t.get(db.doc('users/'+I.id(index.profileId)))).data():null;
     if(!profile||profile.role==='removed'||row.userId!==index.profileId)I.fail('failed-precondition','申請帳號對應不符，請重新申請');
     writes.push(()=>t.update(groupRef,{members:[...new Set([...(group.members||[]),profile.accountId])]}));
    }
    writes.push(()=>t.update(requestRef,{status,processedTime:stamp}));
   }else if(action==='addGroupUser'){
    const accountId=I.normalize(I.text(p.accountId)),name=I.publicLabel(p.name,100),email=I.text(p.email||'',200,false);
    if(!/^[a-z0-9_]{1,80}$/.test(accountId)||!secret||email&&!/^\S+@\S+[.]\S+$/.test(email))I.fail('invalid-argument','帳號或密碼格式無效');
    const index=idRef(accountId),nameRef=db.doc('ops_identity_names/'+I.hash(name)),[old,alias,existing]=await Promise.all([t.get(index),t.get(nameRef),t.get(db.collection('users').where('name','==',name).limit(1))]);
    if(old.exists||alias.exists||!existing.empty)I.fail('already-exists','帳號或稱呼已存在');
    const role=I.text(p.role||'member');if(!['member','child','parent','admin'].includes(role)||['admin','parent'].includes(role)&&current.role!=='owner')I.fail('permission-denied','只有群組擁有者能授予管理權');
    const menus=Array.isArray(p.menus)&&p.menus.length<=100?p.menus.map(v=>I.text(v,80)):[];
    const profile={accountId,name,email:email||null,role:role==='child'?'child':'member',menus,groupId:current.groupId,avatar:`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,createdAt:stamp};
    writes.push(()=>{t.set(roleSetRef,{roles:{...roleSet,[accountId]:role}});t.create(db.doc('users/'+newId),profile);t.create(db.doc('ops_identity_credentials/'+newId),{version:1,authUid:I.profileUid(newId),accountId,sessionVersion:1,secrets:[secret],disabled:false,managedByGroupId:current.groupId,updatedAt:stamp});t.create(index,{profileId:newId});t.create(nameRef,{profileId:newId});t.create(roleRef(current.groupId,accountId),{groupId:current.groupId,accountId,role,createdAt:stamp});t.update(groupRef,{members:[...new Set([...(group.members||[]),accountId])],nexusRoles:{...roleSet,[accountId]:role}});});response={profile:I.safeProfile(newId,profile)};
   }else if(['editGroupUser','removeGroupUser'].includes(action)){
    const profileId=I.id(p.profileId),profileRef=db.doc('users/'+profileId),credentialRef=db.doc('ops_identity_credentials/'+profileId);
    const [profileSnap,credentialSnap]=await Promise.all([t.get(profileRef),t.get(credentialRef)]),profile=profileSnap.data(),credential=credentialSnap.data();
    if(!profile||!group.members.includes(profile.accountId))I.fail('permission-denied','此成員已離開群組');
    const role=await t.get(roleRef(current.groupId,profile.accountId));
    if(role.data()?.role==='owner')I.fail('failed-precondition','群組擁有者請使用個人設定修改資料，移除前須先移轉管理權');
    if(action==='removeGroupUser'){
     if(profile.accountId===current.accountId)I.fail('failed-precondition','不能將自己退出群組');
     // 移除成員時旋轉邀請碼，避免拿舊邀請碼自行加回；帳號與歷史資料保留。
     const settingsRef=db.doc('ops_group_settings/'+current.groupId),settings=(await t.get(settingsRef)).data();
     writes.push(()=>{const remainingRoles={...roleSet};delete remainingRoles[profile.accountId];t.set(roleSetRef,{roles:remainingRoles});t.update(groupRef,{members:group.members.filter(id=>id!==profile.accountId),nexusRoles:remainingRoles});t.delete(roleRef(current.groupId,profile.accountId));if(settings?.inviteCode)t.delete(db.doc('ops_group_invites/'+I.hash(settings.inviteCode)));t.set(settingsRef,{inviteCode:code});t.create(db.doc('ops_group_invites/'+I.hash(code)),{groupId:current.groupId,enabled:true,createdAt:stamp});});
    }else{
     // 群組管理員不得重設外部自行註冊／其他群組託管帳號的全站登入憑證。
     const canEditIdentity=profileId===current.uid||credential?.managedByGroupId===current.groupId;
     if(!canEditIdentity&&(secret||p.name!==profile.name||(p.email||'')!==(profile.email||'')))I.fail('permission-denied','此為獨立帳號，個人資料及密碼須由本人修改');
     const name=I.publicLabel(p.name,100),nameRef=db.doc('ops_identity_names/'+I.hash(name)),[alias,duplicates]=await Promise.all([t.get(nameRef),t.get(db.collection('users').where('name','==',name).limit(2))]);
     if(alias.exists&&alias.data().profileId!==profileId||duplicates.docs.some(d=>d.id!==profileId))I.fail('already-exists','名稱已被使用');
     const nextRole=I.text(p.role||'member');if(!['owner','admin','parent','member','child'].includes(nextRole)||nextRole!==(role.data()?.role||'member')&&current.role!=='owner')I.fail('permission-denied','只有群組擁有者能修改管理權');
     const transfer=nextRole==='owner';if(transfer&&(current.role!=='owner'||profile.accountId===current.accountId))I.fail('permission-denied','只有擁有者能移轉給其他成員');
     const nextRoles={...roleSet,[profile.accountId]:nextRole,...(transfer?{[current.accountId]:'admin'}:{})};
     response={success:true,personalFieldsApplied:canEditIdentity,transferred:transfer};
     const email=I.text(p.email||'',200,false),menus=Array.isArray(p.menus)&&p.menus.length<=100?p.menus.map(v=>I.text(v,80)):[];
     writes.push(()=>{if(canEditIdentity&&name!==profile.name){if(profile.name)t.delete(db.doc('ops_identity_names/'+I.hash(profile.name)));t.set(nameRef,{profileId});}if(canEditIdentity)t.update(profileRef,{name,email:email||null,menus,nameHistory:[...new Set([...(profile.nameHistory||[]),profile.name].filter(Boolean))]});t.set(roleSetRef,{roles:nextRoles});t.update(groupRef,{nexusRoles:nextRoles});if(transfer)t.set(roleRef(current.groupId,current.accountId),{groupId:current.groupId,accountId:current.accountId,role:'admin',updatedAt:stamp});t.set(roleRef(current.groupId,profile.accountId),{groupId:current.groupId,accountId:profile.accountId,role:nextRole,updatedAt:stamp});if(secret)t.update(credentialRef,{secrets:[secret],sessionVersion:credential.sessionVersion+1,updatedAt:stamp});});
    }
   }else I.fail('invalid-argument','不支援的群組管理操作');
   for(const write of writes)write();t.create(receiptRef,{fingerprint,response,createdAt:stamp});t.create(audit,{actorId:current.uid,groupId:current.groupId,action,targetId:p.profileId||null,createdAt:stamp});return response;
  });
 }
 return{handle};
}
module.exports={createIdentityAdmin};
