// Create only the required player-feed index. Never delete or replace other indexes.
const {execFileSync}=require('node:child_process');
const required=require('../firestore.indexes.json').indexes.find(i=>i.collectionGroup==='ops_announcements'&&i.fields.some(f=>f.fieldPath==='audienceKeys'));
function matches(index,definition=required){
    return index.name?.includes(`/collectionGroups/${definition.collectionGroup}/indexes/`)&&index.queryScope===definition.queryScope&&definition.fields.every((f,n)=>index.fields[n]?.fieldPath===f.fieldPath&&(f.order?index.fields[n]?.order===f.order:index.fields[n]?.arrayConfig===f.arrayConfig));
}
function ensure({project='homebasedb',run=execFileSync,log=console.log,definitions=[required]}={}){
    const output=run('gcloud',['firestore','indexes','composite','list','--project',project,'--database=(default)','--format=json'],{encoding:'utf8'});
    const indexes=JSON.parse(output);
    for(const definition of definitions){
        const existing=indexes.find(index=>matches(index,definition));
        if(existing){log(`${definition.collectionGroup} 索引已存在：${existing.state}。`);if(existing.state!=='READY')log('請等索引顯示 READY 後再重新整理村落通知。');continue;}
        const fields=definition.fields.map(f=>'--field-config=field-path='+f.fieldPath+','+(f.order?'order='+f.order.toLowerCase():'array-config=contains'));
        run('gcloud',['firestore','indexes','composite','create','--project',project,'--database=(default)','--collection-group='+definition.collectionGroup,'--query-scope=COLLECTION',...fields,'--async'],{stdio:'inherit'});
        log(`${definition.collectionGroup} 索引已送出建立，未刪除或變更其他索引。請等 READY。`);
    }
}
function main(){const args=process.argv.slice(2),at=args.indexOf('--project'),project=at>=0?args[at+1]:'homebasedb';if(!project)throw Error('請提供 --project');const definitions=[required,...(args.includes('--notifications')?require('../firestore.indexes.json').indexes.filter(i=>i.collectionGroup==='ops_notifications'):[]),...(args.includes('--management')?require('../firestore.indexes.json').indexes.filter(i=>i.collectionGroup==='ops_events'):[])];ensure({project,definitions});}
module.exports={matches,required,ensure};
if(require.main===module){try{main();}catch(error){console.error(error.message);process.exitCode=1;}}
