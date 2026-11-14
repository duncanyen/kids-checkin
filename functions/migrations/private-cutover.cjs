/** 維護用 Admin SDK 遷移。必須先人工審閱 scoped roles；不根據公開角色或暱稱自動授權。 */
const crypto=require('node:crypto'),I=require('../identity-domain.cjs');
const membershipHash=data=>I.hash(JSON.stringify([...(data.members||[])].sort()));
function reviewGroups(groups,assignments,profiles){
 if(!assignments||assignments.version!==1||!Array.isArray(assignments.groups))I.fail('invalid-argument','需要已審閱的群組角色設定');
 const profileByAccount=new Map(profiles.map(row=>[row.data.accountId,row]));
 if(assignments.groups.length!==groups.length)I.fail('failed-precondition','群組盤點數量不符');
 const seen=new Set();
 return groups.map(group=>{
  const review=assignments.groups.find(row=>row.groupId===group.id);
  if(!review||seen.has(review.groupId)||!review.roles||typeof review.roles!=='object')I.fail('failed-precondition','缺少群組角色核對');seen.add(review.groupId);
  const members=[...new Set(group.data.members||[])];
  if(Object.keys(review.roles).length!==members.length||Object.values(review.roles).filter(role=>role==='owner').length!==1)I.fail('failed-precondition','每個群組需核對所有成員，並指定至少一位擁有者');
  for(const accountId of members)if(!profileByAccount.has(accountId)||!['owner','admin','parent','child','member'].includes(review.roles[accountId]))I.fail('failed-precondition','成員或角色有待確認');
  const managedProfiles=review.managedProfileIds||[];
  if(managedProfiles.some(id=>!profiles.some(row=>row.id===id&&members.includes(row.data.accountId))))I.fail('failed-precondition','託管帳號不在此群組');
  return{group,review,membershipHash:membershipHash(group.data)};
 });
}
async function stageGroups({db,groups,profiles,assignments,assertProtected,now=Date.now}){
 const reviews=reviewGroups(groups,assignments,profiles);await assertProtected();
 // 託管登入只能由單一群組管理，不能同時交給多個群組的管理員。
 const managed=reviews.flatMap(r=>(r.review.managedProfileIds||[]));if(new Set(managed).size!==managed.length)I.fail('failed-precondition','帳號重複託管');
 for(const row of reviews){
  const code=crypto.randomBytes(12).toString('hex').toUpperCase();
  await db.runTransaction(async t=>{
   const groupRef=db.doc('groups/'+row.group.id),settingsRef=db.doc('ops_group_settings/'+row.group.id);
   const [current,existing]=await Promise.all([t.get(groupRef),t.get(settingsRef)]);
   if(!current.exists||membershipHash(current.data())!==row.membershipHash)I.fail('aborted','群組成員已變更，請重新盤點');
   const credentialRows=[];
   for(const id of row.review.managedProfileIds||[]){const ref=db.doc('ops_identity_credentials/'+id),data=(await t.get(ref)).data();if(!data||data.managedByGroupId&&data.managedByGroupId!==row.group.id)I.fail('failed-precondition','託管帳號憑證尚未建立或歸屬不符');credentialRows.push({ref});}
   if(existing.exists&&existing.data().membershipHash!==row.membershipHash)I.fail('failed-precondition','已建立不同版本的群組私有設定');
   if(!existing.exists){t.create(settingsRef,{inviteCode:code,membershipHash:row.membershipHash,migrationVersion:1});t.create(db.doc('ops_group_invites/'+I.hash(code)),{groupId:row.group.id,enabled:true,createdAt:now()});}
   t.set(db.doc('ops_group_role_sets/'+row.group.id),{roles:row.review.roles});
   for(const [accountId,role]of Object.entries(row.review.roles))t.set(db.doc('ops_group_roles/'+I.hash(row.group.id+':'+accountId)),{groupId:row.group.id,accountId,role,reviewedAt:now()});
   for(const {ref}of credentialRows)t.update(ref,{managedByGroupId:row.group.id});
  });
 }
 return{groups:reviews.length,ready:false};
}
async function purgePublicSecrets({db,assertFinalRules,now=Date.now}){
 await assertFinalRules();const state=(await db.doc('ops_identity_state/global').get()).data();if(state?.ready)I.fail('failed-precondition','先進入維護狀態，禁止在線上直接清除憑證');
 const profiles=await db.collection('users').get(),groups=await db.collection('groups').get();
 // 先完整預檢，再逐文件交易；可重跑，不重新產生密碼，且沒有明文備份檔。
 for(const row of profiles.docs){const credential=(await db.doc('ops_identity_credentials/'+row.id).get()).data();if(!credential||credential.authUid!==I.profileUid(row.id)||credential.accountId!==row.data().accountId)I.fail('failed-precondition','私有憑證不完整');for(const key of ['password','pin'])if(row.data()[key]&&!await I.verify(String(row.data()[key]).trim(),credential))I.fail('aborted','公開憑證與私有影本不符，請重新盤點');}
 for(const row of groups.docs){const settings=(await db.doc('ops_group_settings/'+row.id).get()).data();if(!settings||settings.membershipHash!==membershipHash(row.data()))I.fail('failed-precondition','群組尚未完成私有盤點');}
 for(const row of profiles.docs)await db.runTransaction(async t=>{
  const ref=db.doc('users/'+row.id),current=(await t.get(ref)).data(),credential=(await t.get(db.doc('ops_identity_credentials/'+row.id))).data();
  if(!current||!credential||credential.authUid!==I.profileUid(row.id)||credential.accountId!==current.accountId)I.fail('aborted','帳號盤點已變更');
  for(const key of ['password','pin'])if(current[key]&&!await I.verify(String(current[key]).trim(),credential))I.fail('aborted','憑證盤點已變更');
  const {password,pin,secret,...publicProfile}=current;t.set(ref,publicProfile);
 });
 for(const row of groups.docs)await db.runTransaction(async t=>{const ref=db.doc('groups/'+row.id),current=(await t.get(ref)).data(),settings=(await t.get(db.doc('ops_group_settings/'+row.id))).data();if(!current||settings?.membershipHash!==membershipHash(current))I.fail('aborted','群組盤點已變更');const {inviteCode,...publicGroup}=current;const roles=(await t.get(db.doc('ops_group_role_sets/'+row.id))).data()?.roles;if(!roles)I.fail('failed-precondition','群組角色不完整');t.set(ref,{...publicGroup,nexusRoles:roles});});
 await db.doc('ops_identity_state/global').set({ready:false,farmReady:false,purgedAt:now(),migrationVersion:1});
 return{profiles:profiles.size,groups:groups.size,ready:false};
}
async function activate({db,assertFinalRules,attestation,ruleHash,codeHash,backupReference,now=Date.now}){
 if(attestation?.schema!==1||![attestation?.unitPassed,attestation?.browserPassed,attestation?.emulatorPassed].every(v=>v===true)||attestation.rulesSha256!==ruleHash||!codeHash||attestation.codeSha256!==codeHash||typeof backupReference!=='string'||!backupReference.trim())I.fail('failed-precondition','缺少相符的測試通過報告或備份識別');await assertFinalRules();
 await db.runTransaction(async t=>{
  const users=await t.get(db.collection('users')),groups=await t.get(db.collection('groups'));
  if(require('./private-identity.cjs').planProfiles(users.docs.map(row=>({id:row.id,data:row.data()}))).issues.length)I.fail('failed-precondition','帳號盤點有衝突');
  for(const row of users.docs){const index=(await t.get(db.doc('ops_identity_accounts/'+I.hash(I.normalize(row.data().accountId))))).data();if(index?.profileId!==row.id)I.fail('failed-precondition','帳號索引不符');if(['password','pin','secret'].some(key=>key in row.data()))I.fail('failed-precondition','仍有公開憑證');const credential=(await t.get(db.doc('ops_identity_credentials/'+row.id))).data();if(!credential||credential.authUid!==I.profileUid(row.id)||credential.accountId!==row.data().accountId)I.fail('failed-precondition','私有憑證不完整');}
  for(const row of groups.docs){if('inviteCode'in row.data())I.fail('failed-precondition','仍有公開邀請碼');const settings=(await t.get(db.doc('ops_group_settings/'+row.id))).data();if(settings?.membershipHash!==membershipHash(row.data()))I.fail('failed-precondition','群組成員已變更');let owners=0;for(const account of new Set(row.data().members)){const role=(await t.get(db.doc('ops_group_roles/'+I.hash(row.id+':'+account)))).data();if(role?.role==='owner')owners++;if(!role)I.fail('failed-precondition','群組角色不完整');}if(owners!==1)I.fail('failed-precondition','群組沒有擁有者');}
  t.set(db.doc('ops_identity_state/global'),{ready:true,farmReady:true,migrationVersion:1,activatedAt:now(),rulesSha256:ruleHash,codeSha256:codeHash,backupReference});
 });return{ready:true,farmReady:true};
}
async function freeze({db,now=Date.now}){await db.doc('ops_identity_state/global').set({ready:false,farmReady:false,maintenanceAt:now()},{merge:true});return{ready:false,farmReady:false};}
module.exports={freeze,membershipHash,reviewGroups,stageGroups,purgePublicSecrets,activate};
