// Standalone deployment tool: preserve existing indexes and add only the ranking index.
const {execFileSync}=require('node:child_process');
const defaultRun=args=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
async function patchField({name,indexes,run,fetchImpl}){
 let token;
 try{token=run(['auth','print-access-token']).trim();}catch{throw Error('無法取得 gcloud 登入憑證；請確認登入狀態');}
 if(!token)throw Error('gcloud 未提供登入憑證');
 let response;
 try{
  response=await fetchImpl('https://firestore.googleapis.com/v1/'+name+'?updateMask=indexConfig',{
   method:'PATCH',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   body:JSON.stringify({name,indexConfig:{indexes}}),signal:AbortSignal.timeout(45000)
  });
 }catch{throw Error('索引 API 連線失敗或逾時；請先唯讀檢查狀態，再決定是否重試');}
 if(!response.ok)throw Error('索引 API 更新失敗（HTTP '+response.status+'）；請檢查 Firestore 索引管理權限並唯讀確認狀態');
 let result;try{result=await response.json();}catch{throw Error('索引 API 回應無法解析；請唯讀確認狀態');}
 if(result.error)throw Error('索引 API 回報作業失敗；請唯讀確認狀態');
 return result;
}
async function ensure({project,apply=false,run=defaultRun,fetchImpl=globalThis.fetch,log=console.log}){
 if(!/^[a-z][a-z0-9-]*$/.test(project||''))throw Error('請指定有效的 --project 專案 ID');
 const field='farm.stolenEggs20261116',base=['--project',project,'--database','(default)','--collection-group','users'];
 let current;try{current=JSON.parse(run(['firestore','indexes','fields','describe',field,...base,'--format=json']));}catch{throw Error('無法唯讀取得欄位索引；停止更新，請檢查 gcloud 登入及專案權限');}
 if(!Array.isArray(current.indexConfig?.indexes))throw Error('缺少既有索引設定；停止更新以免移除設定');
 const configured=current.indexConfig.indexes.map(index=>{
  const entries=index.fields||[index],entry=entries.find(f=>f.fieldPath===field)||(!index.fields?index:null);
  if(!entry||entries.some(f=>f.fieldPath&&f.fieldPath!==field&&f.fieldPath!=='__name__')||
     !['COLLECTION','COLLECTION_GROUP'].includes(index.queryScope)||
     !(['ASCENDING','DESCENDING'].includes(entry.order)&&!entry.arrayConfig||entry.arrayConfig==='CONTAINS'&&!entry.order)){
   throw Error('發現無法辨識的既有索引，停止更新以免移除設定');
  }
  return {queryScope:index.queryScope,fields:[{fieldPath:field,...(entry.order?{order:entry.order}:{arrayConfig:entry.arrayConfig})}],state:index.state};
 });
 const found=configured.find(i=>i.queryScope==='COLLECTION_GROUP'&&i.fields[0].order==='DESCENDING');
 if(found){log('排行榜 collection-group 索引：'+(found.state||'已設定')+'；請確認 READY 後再啟用新版後端');return;}
 if(!apply){log('唯讀檢查：需新增排行榜索引；加 --apply 執行，原欄位索引會保留');return;}
 const indexes=[...configured.map(({state,...index})=>index),{queryScope:'COLLECTION_GROUP',fields:[{fieldPath:field,order:'DESCENDING'}]}];
 const name='projects/'+project+'/databases/(default)/collectionGroups/users/fields/'+field;
 const operation=await patchField({name,indexes,run,fetchImpl});
 if(typeof operation.name==='string'&&/^projects\/[a-z0-9-]+\/databases\//.test(operation.name))log('索引建立作業：'+operation.name);
 log('已提交建立排行榜索引；再次執行唯讀檢查，等待 READY');
}
module.exports={ensure};
if(require.main===module){
 const args=process.argv.slice(2),position=args.indexOf('--project');
 ensure({project:position<0?undefined:args[position+1],apply:args.includes('--apply')}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
