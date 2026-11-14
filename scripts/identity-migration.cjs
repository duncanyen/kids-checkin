/** 預設唯讀盤點。stage 只寫私有影本，不清除公開密碼、不切換登入。 */
const fs=require('node:fs'),path=require('node:path');
const {planProfiles,stageProfiles}=require('../functions/migrations/private-identity.cjs');
async function main(){
 const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1];
 const allowed=new Set(['--project','--stage','--fingerprint']);
 for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('不支援的參數');if(args[i]!=='--stage')i++;}
 const project=args.includes('--project')?get('--project'):'';
 if(!/^[a-z][a-z0-9-]{4,60}$/.test(project))throw Error('請明確指定 --project；預設不連接任何專案');
 const admin=require('../functions/node_modules/firebase-admin/app'),{getFirestore}=require('../functions/node_modules/firebase-admin/firestore');
 const app=admin.initializeApp({projectId:project,credential:admin.applicationDefault()}),db=getFirestore(app);
 const snapshot=await db.collection('users').get(),rows=snapshot.docs.map(doc=>({id:doc.id,data:doc.data()})),plan=planProfiles(rows);
 console.log(JSON.stringify(plan,null,2));
 if(!args.includes('--stage'))return;
 if(!args.includes('--fingerprint'))throw Error('stage 必須帶入已審閱 dry-run 的 --fingerprint');
 const assertProtected=async()=>{
  const client=await admin.applicationDefault().getAccessToken();
  const read=async url=>{const response=await fetch(url,{headers:{Authorization:'Bearer '+client.access_token}});if(!response.ok)throw Error('無法確認已發布 Rules，拒絕遷移');return response.json();};
  const release=await read(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
  const ruleset=await read('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
  const expected=fs.readFileSync(path.join(__dirname,'../rules/firestore.ops-protection.candidate.rules'),'utf8');
  if(ruleset.source?.files?.length!==1||ruleset.source.files[0].content.trim()!==expected.trim())throw Error('正式 Rules 與已審閱 ops 保護版本不一致，拒絕 stage；不自動部署');
 };
 console.log(JSON.stringify(await stageProfiles({db,rows,expectedFingerprint:get('--fingerprint'),assertProtected}),null,2));
}
if(require.main===module)main().catch(()=>{console.error('憑證遷移未完成。請檢查參數、盤點項目、ADC 權限與正式 Rules；不輸出錯誤物件以免包含敏感資料。');process.exitCode=1;});
