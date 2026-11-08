// Create only the required player-feed index. Never delete or replace other indexes.
const {execFileSync}=require('node:child_process');
const required=require('../firestore.indexes.json').indexes.find(i=>i.collectionGroup==='ops_announcements'&&i.fields.some(f=>f.fieldPath==='audienceKeys'));
function matches(index){
    return index.name?.includes('/collectionGroups/ops_announcements/indexes/')&&index.queryScope===required.queryScope&&required.fields.every((f,n)=>index.fields[n]?.fieldPath===f.fieldPath&&(f.order?index.fields[n]?.order===f.order:index.fields[n]?.arrayConfig===f.arrayConfig));
}
function ensure({project='homebasedb',run=execFileSync,log=console.log}={}){
    const output=run('gcloud',['firestore','indexes','composite','list','--project',project,'--database=(default)','--format=json'],{encoding:'utf8'});
    const existing=JSON.parse(output).find(matches);
    if(existing){log(`公告索引已存在：${existing.state}。`);if(existing.state!=='READY')log('請等索引顯示 READY 後再重新整理村落公告。');return;}
    const fields=required.fields.map(f=>'--field-config=field-path='+f.fieldPath+','+(f.order?'order='+f.order.toLowerCase():'array-config=contains'));
    run('gcloud',['firestore','indexes','composite','create','--project',project,'--database=(default)','--collection-group=ops_announcements','--query-scope=COLLECTION',...fields,'--async'],{stdio:'inherit'});
    log('已送出公告索引建立，未刪除或變更其他索引。請等 READY 後重新整理村落。');
}
function main(){const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:'homebasedb';if(!project)throw Error('請提供 --project');ensure({project});}
module.exports={matches,required,ensure};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
