const crypto=require('node:crypto');
const I=require('./identity-domain.cjs');
const {assertIdentity}=require('./identity-access.cjs');
/** 私有登入服務。伺服器開關與遷移 ready 同時成立才接管，不接受客戶端自行宣告切換。 */
function createIdentityService({db,auth,now=Date.now,enabled=()=>false}){
 const groups=require('./identity-groups.cjs').createIdentityGroups({db,now,identify:(request,t)=>assertIdentity(request,db,t),limit});
 const admin=require('./identity-admin.cjs').createIdentityAdmin({db,now,identify:(request,t)=>assertIdentity(request,db,t),limit});
 const keyRef=account=>db.doc('ops_identity_accounts/'+I.hash(I.normalize(account)));
 async function active(){return !!enabled()&&(await db.doc('ops_identity_state/global').get()).data()?.ready===true;}
 async function requireActive(){if(!await active())I.fail('failed-precondition','私有登入尚未完成切換，請稍後重試');}
 async function limit(key,max,window){
  const ref=db.doc('ops_identity_limits/'+I.hash(key)),stamp=now();
  await db.runTransaction(async t=>{const old=(await t.get(ref)).data(),row=old&&stamp-old.start<window?old:{start:stamp,count:0};if(row.count>=max)I.fail('resource-exhausted','嘗試次數過多，請稍後再試');t.set(ref,{start:row.start,count:row.count+1});});
 }
 async function tokenFor(identity,claims={}){
  const uid=I.profileUid(identity.profileId);
  try{if((await auth.getUser(uid)).disabled)I.fail('unauthenticated','此帳號暫停使用');}catch(error){if(error.code!=='auth/user-not-found')throw error;}
  return auth.createCustomToken(uid,{nexusProfileId:identity.profileId,nexusAccountId:identity.profile.accountId,nexusSessionVersion:identity.credential.sessionVersion,...claims});
 }
 async function login(request){
  const p=request.data||{},identifier=I.text(p.identifier),secret=I.text(p.secret,1000),ip=request.rawRequest?.ip||'unknown';
  await limit('login-ip:'+ip,100,300000);await limit('login-id:'+I.normalize(identifier),10,600000);
  const indexed=await keyRef(identifier).get();let profileId=indexed.data()?.profileId;
  if(!profileId){const names=await db.collection('users').where('name','==',identifier).limit(2).get();if(names.size===1)profileId=names.docs[0].id;}
  if(!profileId){await I.matches(secret,{algorithm:'scrypt-v1',salt:'0'.repeat(32),hash:'0'.repeat(128)});I.fail('unauthenticated','帳號或密碼不正確');}
  await limit('login-profile:'+profileId,10,600000);
  const [profile,credential]=await Promise.all([db.doc('users/'+profileId).get(),db.doc('ops_identity_credentials/'+profileId).get()]);
  const user=profile.data(),stored=credential.data();
  const valid=await I.verify(secret,stored);
  if(!user||user.role==='removed'||stored?.authUid!==I.profileUid(profileId)||stored?.accountId!==user.accountId||stored?.disabled||!valid)I.fail('unauthenticated','帳號或密碼不正確');
  return{profile:I.safeProfile(profileId,user),token:await tokenFor({profileId,profile:user,credential:stored})};
 }
 async function register(request){
  await limit('register-ip:'+(request.rawRequest?.ip||'unknown'),5,3600000);
  const p=request.data||{},accountId=I.normalize(I.text(p.accountId)),name=I.publicLabel(p.name,100),email=I.text(p.email,200),secret=I.text(p.secret,1000);
  if(!/^[a-z0-9_]{1,80}$/.test(accountId)||!/^\S+@\S+[.]\S+$/.test(email)||secret.length<6)I.fail('invalid-argument','請確認帳號、電子郵件與至少六碼密碼');
  const profileId=crypto.randomUUID(),user={accountId,name,email,role:'member',avatar:`https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=10b981&color=fff`,createdAt:now()},credentials={version:1,authUid:I.profileUid(profileId),accountId,sessionVersion:1,secrets:[await I.hashSecret(secret)],disabled:false,updatedAt:now()};
  await db.runTransaction(async t=>{
   const nameRef=db.doc('ops_identity_names/'+I.hash(name)),[key,existingName,profiles]=await Promise.all([t.get(keyRef(accountId)),t.get(nameRef),t.get(db.collection('users').where('name','==',name).limit(1))]);
   if(key.exists||existingName.exists||!profiles.empty)I.fail('already-exists','帳號 ID 或稱呼已被使用');
   t.create(db.doc('users/'+profileId),user);t.create(db.doc('ops_identity_credentials/'+profileId),credentials);t.create(keyRef(accountId),{profileId});t.create(nameRef,{profileId});
  });
  return{profile:I.safeProfile(profileId,user),token:await tokenFor({profileId,profile:user,credential:credentials})};
 }
 async function changePassword(request){
  const actor=await assertIdentity(request,db),p=request.data||{};
  await limit('change-password:'+actor.uid,5,600000);
  if(!await I.verify(I.text(p.currentSecret,1000),actor.credential))I.fail('unauthenticated','目前密碼不正確');
  const secret=I.text(p.newSecret,1000);if(secret.length<6)I.fail('invalid-argument','新密碼至少六碼');const hashed=await I.hashSecret(secret);
  let next;
  await db.runTransaction(async t=>{const current=await assertIdentity(request,db,t);next={...current.credential,secrets:[hashed],sessionVersion:current.credential.sessionVersion+1,updatedAt:now()};t.set(db.doc('ops_identity_credentials/'+actor.uid),next);});
  await auth.revokeRefreshTokens(actor.authUid);
  return{profile:I.safeProfile(actor.uid,actor.profile),token:await tokenFor({...actor,credential:next})};
 }
 async function updateProfile(request){
  const actor=await assertIdentity(request,db),p=request.data||{},name=I.publicLabel(p.name,100),currentSecret=I.text(p.currentSecret,1000);
  await limit('profile-change:'+actor.uid,5,600000);
  if(!await I.verify(currentSecret,actor.credential))I.fail('unauthenticated','目前密碼不正確');
  const secret=p.newSecret?I.text(p.newSecret,1000):null;
  if(secret&&secret.length<6)I.fail('invalid-argument','新密碼至少六碼');
  const hashed=secret?await I.hashSecret(secret):null;let updated,next;
  await db.runTransaction(async t=>{
   const current=await assertIdentity(request,db,t),nameRef=db.doc('ops_identity_names/'+I.hash(name));
   const [reserved,duplicate]=await Promise.all([t.get(nameRef),t.get(db.collection('users').where('name','==',name).limit(2))]);
   if(reserved.exists&&reserved.data().profileId!==actor.uid||duplicate.docs.some(doc=>doc.id!==actor.uid))I.fail('already-exists','此名稱已被使用');
   updated={...current.profile,name};next=current.credential;
   const changes={name};
   if(name!==current.profile.name){
    changes.nameHistory=[...new Set([...(current.profile.nameHistory||[]),current.profile.name].filter(Boolean))];
    const oldName=current.profile.name;if(oldName)t.delete(db.doc('ops_identity_names/'+I.hash(oldName)));
    t.set(nameRef,{profileId:actor.uid});
   }
   if(hashed){next={...current.credential,secrets:[hashed],sessionVersion:current.credential.sessionVersion+1,updatedAt:now()};t.set(db.doc('ops_identity_credentials/'+actor.uid),next);}
   t.update(db.doc('users/'+actor.uid),changes);
  });
  if(hashed)await auth.revokeRefreshTokens(actor.authUid);
  return{profile:I.safeProfile(actor.uid,updated),token:hashed?await tokenFor({...actor,profile:updated,credential:next}):null};
 }
 async function deleteAccount(request){
  const actor=await assertIdentity(request,db);await limit('delete-account:'+actor.uid,1,60000);
  await db.runTransaction(async t=>{
   const current=await assertIdentity(request,db,t),groups=await t.get(db.collection('groups').where('members','array-contains',current.accountId));
   for(const group of groups.docs){const role=(await t.get(db.doc('ops_group_roles/'+I.hash(group.id+':'+current.accountId)))).data();if(role?.role==='owner')I.fail('failed-precondition','請先移轉群組管理權，再刪除帳號');}
   t.update(db.doc('ops_identity_credentials/'+actor.uid),{disabled:true,sessionVersion:current.credential.sessionVersion+1,deletedAt:now()});
   t.delete(db.doc('users/'+actor.uid));t.create(db.doc('ops_identity_audit/'+crypto.randomUUID()),{actorId:actor.uid,action:'deleteAccount',createdAt:now()});
  });
  await auth.revokeRefreshTokens(actor.authUid);return{deleted:true};
 }
 async function groupIdentity(request){
  await requireActive();const actor=await assertIdentity(request,db),groupId=I.id(request.data?.groupId),group=await db.doc('groups/'+groupId).get();
  if(!group.data()?.members?.includes(actor.accountId))I.fail('permission-denied','你已不在此群組');return{...actor,groupId,group};
 }
 async function handle(request){
  if(request.data?.action==='capabilities')return{configured:!!enabled(),ready:await active(),version:'private-identity-v1'};
  await requireActive();
  if(!['login','register'].includes(request.data?.action)&&request.auth?.uid&&(await auth.getUser(request.auth.uid)).disabled)I.fail('unauthenticated','此帳號暫停使用');
  if(['groupAdminContext','groupVisibility','groupName','reviewGroupRequest','addGroupUser','editGroupUser','removeGroupUser'].includes(request.data?.action))return admin.handle(request);
  if(['createGroup','joinGroup','groupInvite'].includes(request.data?.action))return groups.handle(request);
  if(request.data?.action==='login')return login(request);
  if(request.data?.action==='register')return register(request);
  if(request.data?.action==='deleteAccount')return deleteAccount(request);
  if(request.data?.action==='updateProfile')return updateProfile(request);
  if(request.data?.action==='changePassword')return changePassword(request);
  if(request.data?.action==='profile'){const actor=await assertIdentity(request,db);return{profile:I.safeProfile(actor.uid,actor.profile)};}
  if(request.data?.action==='groupContext'){const actor=await groupIdentity(request),roles=(await db.doc('ops_group_role_sets/'+actor.groupId).get()).data()?.roles;return{profile:{...I.safeProfile(actor.uid,actor.profile),groupId:actor.groupId,groupRole:roles?.[actor.accountId]||'member',role:roles?.[actor.accountId]==='owner'?'admin':roles?.[actor.accountId]||'member'}};}
  if(request.data?.action==='groupToken'){const actor=await groupIdentity(request);return{token:await tokenFor(actor,{photoAccountId:actor.accountId,photoGroupId:actor.groupId})};}
  I.fail('invalid-argument','不支援的身分操作');
 }
 return{handle,active,configured:()=>!!enabled(),groupIdentity,tokenFor,limit};
}
module.exports={createIdentityService};
