const D=require('./domain.cjs');
// Query the existing authoritative score: no new balance, scoring or projection store.
function createFarmRanking({db,now=Date.now,onMeasure=()=>{}}){
 async function load(identity,key){
  const {FARM_RANKINGS,rankFarmPlayers}=await import('./game/ranking-core.js');
  const config=FARM_RANKINGS[D.enumValue(key||'stolenEggs',Object.keys(FARM_RANKINGS))],field='farm.'+config.field;
  const base=db.collectionGroup('users').where(field,'>',0).orderBy(field,'desc');
  const groups=new Map(),profiles=new Map(),entries=[];
  const group=id=>{if(!groups.has(id))groups.set(id,db.doc('groups/'+id).get().then(s=>s.data()));return groups.get(id);};
  let cursor=null,scanned=0,visible=[];
  while(true){
   let query=base.limit(25);if(cursor)query=query.startAfter(cursor);
   const page=await query.get();if(page.empty)break;
   scanned+=page.size;if(scanned>5000)D.fail('resource-exhausted','同分候選資料較多，請稍後重新整理');
   const candidates=[];
   for(const doc of page.docs){
    const path=doc.ref.path.split('/');if(path.length!==4||path[0]!=='groups'||path[2]!=='users')continue;
    const [,groupId,,accountId]=path,g=await group(groupId);
    if(g?.farmVillageVisibility==='public'&&g.members?.includes(accountId))candidates.push({groupId,accountId,farm:doc.data().farm});
   }
   const unknown=[...new Set(candidates.map(c=>c.accountId))].filter(id=>!profiles.has(id));
   for(let i=0;i<unknown.length;i+=10){
    const ids=unknown.slice(i,i+10),result=await db.collection('users').where('accountId','in',ids).get();
    ids.forEach(id=>profiles.set(id,null));
    for(const doc of result.docs){const p=doc.data();if(p.role!=='removed')profiles.set(p.accountId,p);}
   }
   for(const row of candidates){const p=profiles.get(row.accountId);if(p)entries.push({...row,name:p.name||p.accountId,groupName:(await group(row.groupId)).name||'未命名群組'});}
   const latest=new Map();for(const id of new Set(entries.map(e=>e.groupId)))latest.set(id,(await db.doc('groups/'+id).get()).data());
   visible=entries.filter(e=>{const g=latest.get(e.groupId);return g?.farmVillageVisibility==='public'&&g.members?.includes(e.accountId);}).map(e=>({...e,groupName:latest.get(e.groupId).name||'未命名群組'}));
   const top=rankFarmPlayers(visible,config.field),last=page.docs.at(-1),lastScore=Math.floor(Number(last.data().farm?.[config.field])||0);
   // Read the complete score tie before applying the original localeCompare rule.
   if(page.size<25||top.length===10&&lastScore<top[9].score)break;
   cursor=last;
  }
  const rows=rankFarmPlayers(visible,config.field);onMeasure({scanned,returned:rows.length});
  return{ranking:key||'stolenEggs',scoreField:config.field,rows,asOf:now()};
 }
 return{load};
}
module.exports={createFarmRanking};
