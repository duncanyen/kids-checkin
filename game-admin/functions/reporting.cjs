const D=require('./domain.cjs');
const MONSTERS=Object.freeze({wolf:'野狼',tiger:'老虎',eagle:'巨飛鷹',dragon:'飛龍',gorilla:'大猩猩',cobra:'眼鏡蛇',mole:'地鼠',giant:'遠古巨人'});
const valid=n=>Number.isSafeInteger(n)&&n>=0;
const empty=()=>({collectedEggs:0,stolenEggs:0,coinsAdded:0,coinsSpent:0,coinsNet:0,monsters:Object.fromEntries(Object.keys(MONSTERS).map(key=>[key,0]))});
/** 只供 Firestore 觸發器呼叫：保存已提交存檔的變化，不將前端存檔當作防作弊驗證。 */
function createReporting({db,now=Date.now}){
 async function capture({id,groupId,accountId,before,after,occurredAt}){
  if(!before||!after)return{ignored:true};
  D.id(groupId);D.id(accountId);D.integer(occurredAt,0,Number.MAX_SAFE_INTEGER);
  if(typeof id!=='string'||!id)throw Error('缺少 Firestore 事件識別碼');
  const metrics=empty(),warnings=[];
  const increase=(old,next,key)=>{if(old===next)return 0;if(next===undefined){if(old!==undefined)warnings.push(key+'：累計欄位遺失');return 0;}if(!valid(next)||(old!==undefined&&!valid(old))||next<(old??0)){warnings.push(key+'：累計欄位無效或重設');return 0;}return next-(old??0);};
  metrics.collectedEggs=increase(before.reportHarvestedEggs,after.reportHarvestedEggs,'收蛋');
  metrics.stolenEggs=increase(before.reportStolenEggs,after.reportStolenEggs,'偷蛋');
  for(const key of ['wolf','tiger'])metrics.monsters[key]=increase(before.combatKills?.[key],after.combatKills?.[key],key);
  for(const key of ['eagle','dragon','gorilla','cobra','mole','giant']){
   const list=farm=>{const value=farm[key+'Results'];if(value!==undefined&&!Array.isArray(value)&&JSON.stringify(before[key+'Results'])!==JSON.stringify(after[key+'Results']))warnings.push(key+'：戰鬥紀錄格式無效');return Array.isArray(value)?value:[];};
   const previous=new Set(list(before).map(row=>row?.id));
   metrics.monsters[key]=new Set(list(after).filter(row=>row?.id&&row.outcome==='win'&&!previous.has(row.id)).map(row=>row.id)).size;
  }
  if(valid(before.coins)&&valid(after.coins)){metrics.coinsNet=after.coins-before.coins;metrics.coinsAdded=Math.max(0,metrics.coinsNet);metrics.coinsSpent=Math.max(0,-metrics.coinsNet);}
  else if(before.coins!==after.coins)warnings.push('金幣：餘額無效，未計入變化');
  if(!warnings.length&&!metrics.collectedEggs&&!metrics.stolenEggs&&!metrics.coinsAdded&&!metrics.coinsSpent&&!Object.values(metrics.monsters).some(Boolean))return{ignored:true};
  const ref=db.doc('ops_farm_report_events/'+D.hash(JSON.stringify([groupId,accountId,id]))),meta=db.doc('ops_report_meta/farm');
  return db.runTransaction(async t=>{
   const [prior,start]=await Promise.all([t.get(ref),t.get(meta)]);if(prior.exists)return{replayed:true};
   const row={groupId,accountId,occurredAt,recordedAt:now(),metrics,warnings,source:'committed-farm-change-v1'};
   t.create(ref,row);if(!start.exists||occurredAt<start.data().firstObservedAt)t.set(meta,{version:1,firstObservedAt:occurredAt});return{recorded:true};
  });
 }
 /** 管理員 API 已先驗證 admin claim；查詢不寫入或補造任何歷史。 */
 async function report(payload){
  if(!payload||typeof payload!=='object')D.fail('invalid-argument','查詢條件格式不正確');
  const startAt=D.integer(payload.startAt,0,Number.MAX_SAFE_INTEGER),endAt=D.integer(payload.endAt,0,Number.MAX_SAFE_INTEGER);
  if(startAt>=endAt||endAt-startAt>366*86400000)D.fail('invalid-argument','開始時間必須早於結束時間，單次最多查詢 366 天');
  if(endAt>now())D.fail('invalid-argument','結束時間不可晚於現在');
  const [groups,profiles,events,meta]=await Promise.all([db.collection('groups').limit(501).get(),db.collection('users').limit(5001).get(),db.collection('ops_farm_report_events').where('occurredAt','>=',startAt).where('occurredAt','<',endAt).limit(10001).get(),db.doc('ops_report_meta/farm').get()]);
  if(groups.size>500||profiles.size>5000||events.size>10000)D.fail('resource-exhausted','資料超過第一版報表安全上限，請縮短區間或改用分批報表，未回傳截斷資料');
  const people=new Map();for(const doc of profiles.docs){const row=doc.data();if(typeof row.accountId==='string'){const list=people.get(row.accountId)||[];list.push({uid:doc.id,name:typeof row.name==='string'&&row.name?row.name:row.accountId});people.set(row.accountId,list);}}
  const totals=new Map(),issues=new Map(),key=(group,account)=>JSON.stringify([group,account]);
  for(const doc of events.docs){const event=doc.data(),id=key(event.groupId,event.accountId),sum=totals.get(id)||empty();for(const metric of ['collectedEggs','stolenEggs','coinsAdded','coinsSpent','coinsNet']){sum[metric]+=event.metrics[metric];if(!Number.isSafeInteger(sum[metric]))D.fail('failed-precondition','報表加總超出安全數值範圍');}for(const kind of Object.keys(MONSTERS)){sum.monsters[kind]+=event.metrics.monsters[kind]||0;if(!Number.isSafeInteger(sum.monsters[kind]))D.fail('failed-precondition','怪物數量超出安全數值範圍');}totals.set(id,sum);if(event.warnings?.length)issues.set(id,[...(issues.get(id)||[]),...event.warnings]);}
  let invalidGroups=0;const memberships=[];for(const group of groups.docs){const members=group.data().members;if(!Array.isArray(members)){invalidGroups++;continue;}for(const accountId of new Set(members)){if(typeof accountId!=='string'||!accountId||accountId.includes('/'))continue;memberships.push({groupId:group.id,groupName:typeof group.data().name==='string'&&group.data().name?group.data().name:group.id,accountId});}}
  if(memberships.length>2000)D.fail('resource-exhausted','目前成員超過 2,000 筆，需改用分頁報表');
  const rows=[]; // 限制並行讀取，不在小規模報表一次發出數千個請求。
  for(let i=0;i<memberships.length;i+=8)rows.push(...await Promise.all(memberships.slice(i,i+8).map(async member=>{
   const owner=await db.doc(`groups/${member.groupId}/users/${member.accountId}`).get(),rawFarm=owner.data()?.farm,farm=rawFarm&&typeof rawFarm==='object'&&!Array.isArray(rawFarm)?rawFarm:null,accounts=people.get(member.accountId)||[],warnings=[...(issues.get(key(member.groupId,member.accountId))||[])];
   if(rawFarm&&!farm)warnings.push('農場資料格式無效');
   if(accounts.length!==1)warnings.push(accounts.length?'accountId 對應多個個人檔案':'缺少個人檔案');
   if(farm&&!valid(farm.coins))warnings.push('目前金幣餘額無效');
   const hens=farm?(farm.hens===undefined?1:valid(farm.hens)?farm.hens:null):null;if(farm&&hens===null)warnings.push('目前雞數無效');
   return{...member,name:accounts.length===1?accounts[0].name:member.accountId,hasFarm:!!farm,currentCoins:farm&&valid(farm.coins)?farm.coins:null,currentHens:hens,harvestCounterAvailable:valid(farm?.reportHarvestedEggs),theftCounterAvailable:valid(farm?.reportStolenEggs),metrics:totals.get(key(member.groupId,member.accountId))||empty(),warnings:[...new Set(warnings)]};
  })));
  rows.sort((a,b)=>a.groupName.localeCompare(b.groupName,'zh-Hant')||a.accountId.localeCompare(b.accountId));
  const firstObservedAt=meta.data()?.firstObservedAt??null;
  return{startAt,endAt,asOf:now(),firstObservedAt,coverage:firstObservedAt===null?'not-started':endAt<=firstObservedAt?'unavailable':startAt<firstObservedAt?'partial':'observed',rows,groupCount:groups.size,monsters:MONSTERS,eventCount:events.size,
   notes:[...(invalidGroups?[`${invalidGroups} 個群組的 members 格式無效，無法列出，請先檢查群組資料。`]:[]),'區間採開始含、結束不含；使用存檔提交的伺服器時間。','資料收集開始前無法還原歷史；收蛋及偷蛋需先確認正式 Rules，開啟新版累計開關後才會收集；未開啟或舊版玩家可能缺漏。','金幣增加／減少為每筆餘額淨變化的正負部分，含禮包及管理調整，不是逐項毛收入／消費流水。','雞數與金幣餘額為目前數值，並非所選區間結束時的存檔。','此報表是後端觀測的遊戲存檔變化，原始遊戲動作仍有前端寫入，非防作弊驗證；觸發器可能延遲，勿作為即時結算依據。']};
 }
 return{capture,report};
}
module.exports={createReporting,MONSTERS};
