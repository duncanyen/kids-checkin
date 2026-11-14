// 預設只列唯讀盤點。正式寫入需要明確 phase、已部署 Rules 比對與人工角色設定。
const fs=require('node:fs'),path=require('node:path'),I=require('../functions/identity-domain.cjs'),M=require('../functions/migrations/private-cutover.cjs');
async function main(){
 const argv=process.argv.slice(2),options={};for(let i=0;i<argv.length;i+=2){if(!['--project','--phase','--roles','--attestation','--backup-reference','--storage-bucket','--database-url'].includes(argv[i])||!argv[i+1])throw Error('參數無效');options[argv[i].slice(2)]=argv[i+1];}
 if(!/^[a-z][a-z0-9-]{4,60}$/.test(options.project||''))throw Error('需明確指定 --project');
 const A=require('../functions/node_modules/firebase-admin/app'),{getFirestore}=require('../functions/node_modules/firebase-admin/firestore');const app=A.initializeApp({projectId:options.project,credential:A.applicationDefault()}),db=getFirestore(app);
 const profiles=(await db.collection('users').get()).docs.map(d=>({id:d.id,data:d.data()})),groups=(await db.collection('groups').get()).docs.map(d=>({id:d.id,data:d.data()}));
 const finalRules=fs.readFileSync(path.join(__dirname,'../rules/firestore.private-farm.candidate.rules'),'utf8'),ruleHash=I.hash(finalRules);
 const assertSource=async expected=>{
  const token=(await A.applicationDefault().getAccessToken()).access_token;
  const read=async url=>{const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Rules 讀取失敗');return r.json();};
  const release=await read(`https://firebaserules.googleapis.com/v1/projects/${options.project}/releases/cloud.firestore`),rules=await read('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
  if(rules.source?.files?.length!==1||rules.source.files[0].content.trim()!==expected.trim())throw Error('正式 Rules 與已審閱版本不符');
 };
 const assertAllRules=async()=>{
  await assertSource(finalRules);
  const bucket=options['storage-bucket'];if(!bucket||!/^[a-z0-9][a-z0-9._-]+$/.test(bucket)||!bucket.endsWith('.firebasestorage.app')&&!bucket.endsWith('.appspot.com'))throw Error('需指定 Storage bucket');
  const url=new URL(options['database-url']);if(url.protocol!=='https:'||!url.hostname.endsWith('.firebasedatabase.app')&&!url.hostname.endsWith('.firebaseio.com')||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Database URL 無效');
  const token=(await A.applicationDefault().getAccessToken()).access_token;
  const read=async endpoint=>{const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw Error('無法確認 Rules');return response.json();};
  const release=await read(`https://firebaserules.googleapis.com/v1/projects/${options.project}/releases/firebase.storage/${bucket}`),rules=await read('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
  const expected=fs.readFileSync(path.join(__dirname,'../rules/storage.private-farm.candidate.rules'),'utf8');
  if(rules.source?.files?.length!==1||rules.source.files[0].content.trim()!==expected.trim())throw Error('Storage Rules 不符');
  const actual=await read(new URL('/.settings/rules.json',url)),databaseRules=JSON.parse(fs.readFileSync(path.join(__dirname,'../rules/database.private-farm.candidate.json'),'utf8'));
  const canonical=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(canonical):Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  if(JSON.stringify(canonical(actual))!==JSON.stringify(canonical(databaseRules)))throw Error('Database Rules 不符');
 };
 const phase=options.phase||'review';
 if(phase==='review'){
  console.log(JSON.stringify({version:1,groups:groups.map(row=>({groupId:row.id,members:row.data.members,roles:Object.fromEntries((row.data.members||[]).map(id=>[id,'REVIEW_REQUIRED'])),managedProfileIds:[]})),rulesSha256:ruleHash},null,2));return;
 }
 if(phase==='stage-groups')console.log(JSON.stringify(await M.stageGroups({db,groups,profiles,assignments:JSON.parse(fs.readFileSync(options.roles,'utf8')),assertProtected:()=>assertSource(fs.readFileSync(path.join(__dirname,'../rules/firestore.ops-protection.candidate.rules'),'utf8'))})));
 else if(phase==='purge')console.log(JSON.stringify(await M.purgePublicSecrets({db,assertFinalRules:assertAllRules})));
 else if(phase==='activate'){const proof=JSON.parse(fs.readFileSync(options.attestation,'utf8'));if(proof.storageRulesSha256!==I.hash(fs.readFileSync(path.join(__dirname,'../rules/storage.private-farm.candidate.rules'),'utf8'))||proof.databaseRulesSha256!==I.hash(fs.readFileSync(path.join(__dirname,'../rules/database.private-farm.candidate.json'),'utf8')))throw Error('測試報告 Rules 版本不符');console.log(JSON.stringify(await M.activate({db,assertFinalRules:assertAllRules,ruleHash,codeHash:require('./private-code-hash.cjs')(),backupReference:options['backup-reference'],attestation:proof})));}
 else if(phase==='freeze'){await M.freeze({db});console.log('登入及農場後端已暫停，不回復公開密碼或公開 Rules');}
 else throw Error('不支援 phase');
}
main().catch(()=>{console.error('切換未完成：請檢查 ADC、Rules 來源、角色盤點、備份及測試報告。未輸出憑證或原始例外。');process.exitCode=1;});
