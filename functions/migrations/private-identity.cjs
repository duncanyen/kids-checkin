/** 只供 Admin SDK 維護工具使用；不匯出 callable，不自動開啟 ready 或刪除公開憑證。 */
const I=require('../identity-domain.cjs');
function planProfiles(rows){
 const accounts=new Map(),names=new Map(),issues=[];
 for(const {id,data} of rows){
  if(!id||id.includes('/'))issues.push({profileId:id,reason:'invalid-profile-id'});
  const account=I.normalize(data.accountId);
  if(!account||account.includes('/'))issues.push({profileId:id,reason:'invalid-account-id'});
  // 舊前端以 accountId 當文件 ID；不可在遷移時擅自改成小寫。
  if(typeof data.accountId!=='string'||data.accountId.trim()!==data.accountId)issues.push({profileId:id,reason:'account-id-needs-owner-review'});
  if(accounts.has(account))issues.push({profileId:id,reason:'duplicate-account-id'});else accounts.set(account,id);
  const name=typeof data.name==='string'?data.name.trim():'';
  if(/[<>]/.test(name))issues.push({profileId:id,reason:'unsafe-display-name-needs-review'});
  if(name){if(names.has(name))issues.push({profileId:id,reason:'duplicate-login-name'});else names.set(name,id);}
  for(const field of ['password','pin'])if(data[field]!==undefined&&data[field]!==null&&data[field]!==''){
   if(typeof data[field]!=='string'||data[field].trim().length<4||data[field].length>1000)issues.push({profileId:id,reason:'credential-format-needs-review'});
  }
 }
 // 摘要不包含明文、可單獨猜解的憑證摘要、姓名或電子郵件。
 return{version:1,total:rows.length,credentialProfiles:rows.filter(r=>r.data.password||r.data.pin).length,issues,
  fingerprint:I.hash(JSON.stringify(rows.map(({id,data})=>({id,accountId:data.accountId,name:data.name,role:data.role??null})).sort((a,b)=>a.id.localeCompare(b.id))))};
}
async function stageProfiles({db,rows,expectedFingerprint,assertProtected,now=Date.now}){
 const plan=planProfiles(rows);
 if(plan.issues.length)I.fail('failed-precondition','帳號盤點有待人工確認項目，未寫入任何憑證');
 if(plan.fingerprint!==expectedFingerprint)I.fail('failed-precondition','盤點版本不符，請重新 dry-run');
 // 呼叫端必須實際比對已發布 Rules 的來源；不可用 --skip-rules 或單一布林值略過。
 await assertProtected();
 let staged=0,unchanged=0;
 for(const row of rows){
  const plain=[...new Set([row.data.password,row.data.pin].filter(v=>typeof v==='string'&&v.trim()).map(v=>v.trim()))];
  const credential={version:1,authUid:I.profileUid(row.id),accountId:row.data.accountId,sessionVersion:1,secrets:await Promise.all(plain.map(I.hashSecret)),disabled:row.data.role==='removed'||!plain.length,updatedAt:now()};
  const created=await db.runTransaction(async t=>{
   const publicRef=db.doc('users/'+row.id),privateRef=db.doc('ops_identity_credentials/'+row.id),accountRef=db.doc('ops_identity_accounts/'+I.hash(I.normalize(row.data.accountId)));
   const name=typeof row.data.name==='string'?row.data.name.trim():'';
   const nameRef=name?db.doc('ops_identity_names/'+I.hash(name)):null;
   const [current,existing,index,alias]=await Promise.all([t.get(publicRef),t.get(privateRef),t.get(accountRef),nameRef?t.get(nameRef):null]);
   if(!current.exists||planProfiles([{id:row.id,data:current.data()}]).fingerprint!==planProfiles([row]).fingerprint||['password','pin'].some(field=>current.data()[field]!==row.data[field]))I.fail('aborted','盤點後帳號已變更；請重新 dry-run，不覆寫');
   if(index.exists&&index.data().profileId!==row.id||alias?.exists&&alias.data().profileId!==row.id)I.fail('already-exists','私有索引有衝突');
   if(existing.exists){
    // 可重跑但不重設 sessionVersion；已切換後禁止以舊公開密碼蓋回新密碼。
    if(existing.data().migrationFingerprint!==planProfiles([row]).fingerprint||existing.data().secrets.length!==plain.length||!(await Promise.all(plain.map(secret=>I.verify(secret,existing.data())))).every(Boolean))I.fail('failed-precondition','已存在不同版本的私有憑證，需人工處理');
    return false;
   }
   t.create(privateRef,{...credential,migrationFingerprint:planProfiles([row]).fingerprint});
   t.set(accountRef,{profileId:row.id});if(nameRef)t.set(nameRef,{profileId:row.id});return true;
  });
  if(created)staged++;else unchanged++;
 }
 return{staged,unchanged,total:rows.length,ready:false};
}
module.exports={planProfiles,stageProfiles};
