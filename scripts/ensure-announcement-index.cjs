// 只補上選定功能需要的索引，不刪除或取代正式專案的其他索引。
const {execFileSync}=require('node:child_process');
const indexes=require('../firestore.indexes.json').indexes;
const required=indexes.find(i=>i.collectionGroup==='ops_announcements'&&i.fields.some(f=>f.fieldPath==='audienceKeys'));
const dashboardIndexes=indexes.filter(i=>['ops_announcements','ops_gifts'].includes(i.collectionGroup)&&i.fields.map(f=>f.fieldPath).join(',')==='status,startAt,endAt');
function definitionsFor(args=[]){
    return [required,...(args.includes('--notifications')?indexes.filter(i=>i.collectionGroup==='ops_notifications'):[]),...(args.includes('--management')?indexes.filter(i=>i.collectionGroup==='ops_events'):[]),...(args.includes('--dashboard')?dashboardIndexes:[])];
}
function matches(index,definition=required){
    return index.name?.includes(`/collectionGroups/${definition.collectionGroup}/indexes/`)&&index.queryScope===definition.queryScope&&definition.fields.every((f,n)=>index.fields[n]?.fieldPath===f.fieldPath&&(f.order?index.fields[n]?.order===f.order:index.fields[n]?.arrayConfig===f.arrayConfig));
}
function ensure({project='homebasedb',run=execFileSync,log=console.log,definitions=[required]}={}){
    const output=run('gcloud',['firestore','indexes','composite','list','--project',project,'--database=(default)','--format=json'],{encoding:'utf8'});
    const indexes=JSON.parse(output);
    for(const definition of definitions){
        const existing=indexes.find(index=>matches(index,definition));
        if(existing){log(`${definition.collectionGroup} 索引已存在：${existing.state}。`);if(existing.state!=='READY')log('請等索引顯示 READY 後再重新整理對應頁面。');continue;}
        const fields=definition.fields.map(f=>'--field-config=field-path='+f.fieldPath+','+(f.order?'order='+f.order.toLowerCase():'array-config=contains'));
        run('gcloud',['firestore','indexes','composite','create','--project',project,'--database=(default)','--collection-group='+definition.collectionGroup,'--query-scope=COLLECTION',...fields,'--async'],{stdio:'inherit'});
        log(`${definition.collectionGroup} 索引已送出建立，未刪除或變更其他索引。請等 READY。`);
    }
}
function main(){const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:'homebasedb';if(!project)throw Error('請提供 --project');ensure({project,definitions:definitionsFor(args)});}
module.exports={matches,required,ensure,dashboardIndexes,definitionsFor};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
