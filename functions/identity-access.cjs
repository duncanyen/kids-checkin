const I=require('./identity-domain.cjs');
/** 只信任命名空間 UID＋伺服器私有版本；使用 profile ID 維持既有每日獎勵去重。 */
async function assertIdentity(request,db,t){
 if(!request.auth?.uid||typeof request.auth.token?.nexusProfileId!=='string')I.fail('unauthenticated','請重新登入 Nexus');
 const profileId=I.id(request.auth.token?.nexusProfileId);
 if(request.auth.uid!==I.profileUid(profileId))I.fail('permission-denied','登入身分不符');
 const read=ref=>t?t.get(ref):ref.get();
 const [user,credential]=await Promise.all([read(db.doc('users/'+profileId)),read(db.doc('ops_identity_credentials/'+profileId))]);
 const data=user.data(),privateData=credential.data();
 if(!data||data.role==='removed'||!privateData||privateData.authUid!==request.auth.uid||privateData.accountId!==data.accountId||privateData.disabled||request.auth.token.nexusSessionVersion!==privateData.sessionVersion||request.auth.token.nexusAccountId!==data.accountId)I.fail('unauthenticated','登入已失效，請重新登入');
 return{profileId,uid:profileId,authUid:request.auth.uid,accountId:data.accountId,profile:data,credential:privateData};
}
module.exports={assertIdentity};
