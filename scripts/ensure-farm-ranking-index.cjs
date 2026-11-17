// Add only the ranking field index, preserving the field's existing indexes.
const {execFileSync}=require('node:child_process');
function ensure({project,apply=false,run=(args)=>execFileSync('gcloud',args,{encoding:'utf8'}),log=console.log}){
 const field='farm.stolenEggs20261116',base=['--project',project,'--database','(default)','--collection-group','users'];
 let current;try{current=JSON.parse(run(['firestore','indexes','fields','describe',field,...base,'--format=json']));}catch(error){throw Error('無法唯讀取得欄位索引；停止更新，請檢查 gcloud 登入及專案權限');}
 const configured=(current.indexConfig?.indexes||[]).map(index=>{const entry=index.fields?.find(f=>f.fieldPath===field)||index;return{queryScope:index.queryScope,order:entry.order,arrayConfig:entry.arrayConfig,state:index.state};});
 if(configured.some(i=>!i.queryScope||!i.order&&!i.arrayConfig))throw Error('發現無法辨識的既有索引，停止更新以免移除設定');
 const found=configured.find(i=>i.queryScope==='COLLECTION_GROUP'&&i.order==='DESCENDING');
 if(found){log('排行榜 collection-group 索引：'+(found.state||'已設定')+'；請確認 READY 後再啟用新版後端');return;}
 const indexes=configured.length?configured:[{queryScope:'COLLECTION',order:'ASCENDING'},{queryScope:'COLLECTION',order:'DESCENDING'}];
 const all=[...indexes,{queryScope:'COLLECTION_GROUP',order:'DESCENDING'}];
 const args=['firestore','indexes','fields','update',field,...base,...all.map(i=>'--index='+[i.order?'order='+i.order:'array-config='+i.arrayConfig,'query-scope='+i.queryScope].join(',')),'--quiet'];
 if(!apply){log('唯讀檢查：需新增排行榜索引；加 --apply 執行，原欄位索引會保留');return;}
 run(args);log('已提交建立排行榜索引；再次執行唯讀檢查，等待 READY');
}
module.exports={ensure};
if(require.main===module){const args=process.argv.slice(2),project=args[args.indexOf('--project')+1];if(!args.includes('--project')||!project||project.startsWith('--'))throw Error('請指定 --project');ensure({project,apply:args.includes('--apply')});}
