/** Pure authorization/plan validation. Loading this module never loads an SDK. */
const fs=require('node:fs'),path=require('node:path'),D=require('../../game-admin/functions/domain.cjs'),W=require('../../game-admin/functions/weapon-repository.cjs');
const SOURCE=['scripts/lib/weapon-migration-plan.cjs','scripts/lib/weapon-migration-job.cjs','scripts/weapon-migration-release.cjs','game-admin/functions/migrations/weapon-instances.cjs','game-admin/functions/weapon-repository.cjs','game-admin/functions/domain.cjs'];
const hash=v=>D.fingerprint(v),scope=a=>W.scope(a);
function sourceHash(root=path.resolve(__dirname,'../..')){return hash(Object.fromEntries(SOURCE.map(p=>[p,D.hash(fs.readFileSync(path.join(root,p),'utf8'))])));}
function actor(a){if(!a||Object.keys(a).sort().join(',')!=='accountId,groupId,uid')throw Error('scope需且僅含uid/groupId/accountId');Object.values(a).forEach(D.id);return{uid:a.uid,groupId:a.groupId,accountId:a.accountId};}
function validate(plan,{project,now=Date.now(),checkSource=true}={}){
 if(!plan||plan.schemaVersion!==1||plan.kind!=='weapon-migration-release'||plan.project!==project||plan.database!=='(default)'||!Array.isArray(plan.scopes)||!plan.scopes.length||plan.scopes.length>50)throw Error('移轉計畫格式、專案或scope數量不符');
 D.requestId(plan.runId);if(!Number.isSafeInteger(plan.expiresAt)||plan.expiresAt<=now||plan.expiresAt>now+7*86400000)throw Error('計畫已過期或超過7日，需重新審核');
 if(checkSource&&plan.sourceHash!==sourceHash())throw Error('工具原始碼已改變，請重新產生並審核計畫');
 const seen=new Set(),paths=new Set();for(const row of plan.scopes){const a=actor(row.actor),key=scope(a),p=W.farmPath(a);if(seen.has(key)||paths.has(p))throw Error('重複scope或同一farm對應多個profile');seen.add(key);paths.add(p);D.requestId(row.generation);if(!/^[a-f0-9]{64}$/.test(row.fingerprint||'')||row.generation!==generation(plan.runId,a))throw Error('來源指紋或穩定generation不符');D.integer(row.allocationCount,0,10000);if(!row.counts||Object.keys(row.counts).sort().join(',')!==W.WEAPON_IDS.slice().sort().join(','))throw Error('武器種類摘要缺失');for(const q of Object.values(row.counts))D.integer(q,0,Number.MAX_SAFE_INTEGER);if(Object.values(row.counts).reduce((n,q)=>n+Math.ceil(q/W.BATCH_SIZE),0)!==row.allocationCount)throw Error('分批摘要不符');}
 return plan;
}
function generation(runId,a){return'migrate-'+D.hash(JSON.stringify([runId,scope(a)]));}
function connection({project,mode='emulator',env=process.env,approval,planHash,operation='review',now=Date.now()}){
 if(mode==='emulator'){if(!/^demo-[a-z0-9-]+$/.test(project||'')||! /^(127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{0,4})$/.test(env.FIRESTORE_EMULATOR_HOST||''))throw Error('Emulator模式只接受demo-*與明確localhost');const port=Number(env.FIRESTORE_EMULATOR_HOST.split(':').at(-1));if(port>65535)throw Error('Emulator埠無效');}
 else if(mode==='production'){
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project||'')||project.startsWith('demo-')||env.FIRESTORE_EMULATOR_HOST)throw Error('正式模式專案不符或混入Emulator');
  const a=approval;if(!a||a.schemaVersion!==1||a.project!==project||a.database!=='(default)'||a.planHash!==planHash||!Array.isArray(a.operations)||!a.operations.includes(operation)||!Number.isSafeInteger(a.expiresAt)||a.expiresAt<=now||a.expiresAt>now+86400000||typeof a.operator!=='string'||!a.operator.trim()||!a.backup?.uri?.startsWith('gs://')||a.backup.restoredVerified!==true||!/^projects\//.test(a.backup.operation||'')||a.explicitApproval!=='APPROVE_REVIEWED_WEAPON_MIGRATION')throw Error('正式連線需綁定計畫、專案、操作、24小時內授權與已驗證還原的備份證據');
 }else throw Error('未知模式');
 for(const k of ['GOOGLE_CLOUD_PROJECT','GCLOUD_PROJECT'])if(env[k]&&env[k]!==project)throw Error('環境專案與計畫不同');
 if(env.FIRESTORE_DATABASE_ID&&env.FIRESTORE_DATABASE_ID!=='(default)')throw Error('資料庫環境不符');return{project,mode,database:'(default)'};
}
function renew(plan,{project,now=Date.now()}={}){validate(plan,{project,now:plan.createdAt,checkSource:false});const next={...structuredClone(plan),createdAt:now,expiresAt:now+86400000,sourceHash:sourceHash(),renewedFromHash:hash(plan)};return validate(next,{project,now});}
module.exports={SOURCE,sourceHash,actor,scope,validate,generation,hash,connection,renew};
