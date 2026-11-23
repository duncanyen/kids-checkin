/** Group/farm-scoped identity and read-only compatibility with legacy UID-only days. */
const D=require('./domain.cjs');
const VERSION=2;
const scopeKey=identity=>JSON.stringify([D.id(identity.uid),D.id(identity.accountId),D.id(identity.groupId)]);
const scopeOf=identity=>({scopeVersion:VERSION,accountId:identity.accountId,groupId:identity.groupId});
const scopedRef=(db,collection,identity,type,date)=>db.doc(`${collection}/${D.hash(JSON.stringify([VERSION,identity.uid,identity.accountId,identity.groupId,type,date||null]))}`);
const legacyRef=(db,collection,uid,type,date)=>db.doc(`${collection}/${D.hash([uid,type,date].filter(Boolean).join(':'))}`);
const owns=(grant,identity)=>grant?.uid===identity.uid&&grant?.accountId===identity.accountId&&grant?.groupId===identity.groupId;
async function legacyDay({db,t,identity,type,today,yesterday,policy}){
 const [day,paid,previous]=await Promise.all([
  t.get(legacyRef(db,'ops_daily_days',identity.uid,type,today)),
  t.get(legacyRef(db,'ops_daily_grants',identity.uid,type,today)),
  t.get(legacyRef(db,'ops_daily_grants',identity.uid,type,yesterday))
 ]);
 const paidData=paid.data(),previousData=previous.data();
 let grant=owns(paidData,identity)?paidData:owns(previousData,identity)?previousData:null;
 if(!grant&&policy==='continue'){
  // Existing uid/createdAt index; only first-time migration for the continue policy.
  let cursor;
  for(let page=0;page<40&&!grant;page++){
   let query=db.collection('ops_daily_grants').where('uid','==',identity.uid).orderBy('createdAt','desc').limit(25);
   if(cursor)query=query.startAfter(cursor);
   const rows=await t.get(query);
   grant=rows.docs.map(row=>row.data()).find(value=>value.type===type&&!value.scopeVersion&&owns(value,identity))||null;
   if(rows.size<25)break;cursor=rows.docs.at(-1);
  }
 }
 const state=grant?{day:grant.response.day,cycleId:grant.response.cycleId,lastClaimDate:grant.dateKey}:{};
 return{snapshot:day.data()||null,grant:owns(paidData,identity)?{id:paid.id,...paidData}:null,state};
}
async function legacyProgress({db,t,identity,today,tasks}){
 const progress={};
 // Equality-only queries reuse Firestore single-field indexes. At most target
 // matching receipts are read per task; no all-account/event-history scan.
 for(const task of tasks.filter(task=>task.enabled)){
  const rows=await t.get(db.collection('ops_daily_events').where('uid','==',identity.uid)
   .where('groupId','==',identity.groupId).where('dateKey','==',today)
   .where('type','==',task.type).where('result','==','counted').limit(task.target));
  const count=rows.docs.filter(row=>row.data().accountId===identity.accountId).length;
  if(count)progress[task.type]=count;
 }
 return progress;
}
module.exports={VERSION,scopeKey,scopeOf,scopedRef,legacyRef,owns,legacyDay,legacyProgress};
