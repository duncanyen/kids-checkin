/** Server-only weapon allocations plus sparse refinement-state reads.
 * Each allocation assigns <=1000 stable instance IDs. Refinement state lives
 * in private per-instance state documents; catalog/combat values are never copied into each instance.
 */
const D=require('./domain.cjs'),Refinement=require('./refinement-core.cjs');
const WEAPON_IDS=Object.freeze(['mace','battleaxe','ironhammer','katana','shortbow','huntingbow','paladinbow']);
const RANGED=new Set(['shortbow','huntingbow','paladinbow']);
const BATCH_SIZE=1000;
const scope=actor=>D.hash(JSON.stringify([actor.uid,actor.groupId,actor.accountId]));
const ownerPath=actor=>'ops_weapon_owners/'+scope(actor);
const statePath=(actor,id)=>ownerPath(actor)+'/states/'+D.id(id);
const farmPath=actor=>`groups/${D.id(actor.groupId)}/users/${D.id(actor.accountId)}`;
const counts=farm=>Object.fromEntries(WEAPON_IDS.map(id=>[id,D.integer(farm[id]??0,0,Number.MAX_SAFE_INTEGER)]));
const signature=farm=>D.fingerprint({counts:counts(farm),melee:farm.equippedWeapon||'club',bow:farm.equippedBow||null});
const clubId=actor=>'club_'+scope(actor);
const isV2=farm=>farm?.weaponSchemaVersion===2;
const allocationId=(generation,source,weaponId,chunk,ownerId)=>D.hash(JSON.stringify([D.id(ownerId),generation,source,weaponId,chunk]));
const instanceId=(allocation,index)=>allocation+'_'+index;
function parseId(id){
 if(typeof id!=='string'||!/^([a-f0-9]{64})_(0|[1-9][0-9]{0,2})$/.test(id))D.fail('invalid-argument','武器個體編號不正確');
 const split=id.lastIndexOf('_');return{allocation:id.slice(0,split),index:Number(id.slice(split+1))};
}
function assertOwner(actor,owner){
 if(!owner||owner.ownerId!==scope(actor)||owner.profileId!==actor.uid||owner.groupId!==actor.groupId||owner.accountId!==actor.accountId)D.fail('permission-denied','武器不屬於目前農場');
}
function assertProjection(farm,owner){
 if(D.fingerprint(counts(farm))!==D.fingerprint(owner.counts)||farm.equippedWeapon!==owner.equippedWeapon|| (farm.equippedBow||null)!==owner.equippedBow)D.fail('failed-precondition','武器投影不一致，停止變更');
}
function dto(actor,owner,allocation,index){
 const id=allocation?instanceId(allocation.id,index):clubId(actor),weaponId=allocation?.weaponId||'club';
 return{instanceId:id,weaponId,ownerId:scope(actor),refineLevel:0,refineBonus:{attack:0,criticalRate:0,chainCriticalRate:0},refineBonusUnit:'basis-points',refineStatsVersion:null,stateRevision:0,refineFailCount:0,successfulRefineCost:{coins:0,stones:0},equipped:id===owner.equippedMeleeInstanceId||id===owner.equippedBowInstanceId,bound:weaponId==='club',createdAt:allocation?.createdAt??owner.createdAt,updatedAt:allocation?.updatedAt??owner.updatedAt,schemaVersion:2,ownerRevision:owner.revision};
}
function allocations(actor,owner,source,weaponId,quantity,stamp){
 const rows=[];
 for(let start=0;start<quantity;start+=BATCH_SIZE){const chunk=start/BATCH_SIZE,id=allocationId(owner.generation,source,weaponId,chunk,scope(actor));rows.push({id,ownerId:scope(actor),generation:owner.generation,weaponId,quantity:Math.min(BATCH_SIZE,quantity-start),removed:[],schemaVersion:2,createdAt:stamp,updatedAt:stamp,source});}
 return rows;
}
function createWeaponRepository({db,enabled=()=>false,allowRefinedSales=()=>true}){
 async function owner(t,actor,farm){
  const value=(await t.get(db.doc(ownerPath(actor)))).data();assertOwner(actor,value);
  if(value.schemaVersion!==2)D.fail('failed-precondition','不支援的武器版本');
  if(value.status!=='active'||!isV2(farm)||farm.weaponGeneration!==value.generation)D.fail('failed-precondition','武器資料正在移轉');
  assertProjection(farm,value);D.integer(value.revision,0,Number.MAX_SAFE_INTEGER-1);return value;
 }
 async function enrich(t,actor,header,item){
  if(!header.hasRefinementStates)return item;
  const state=(await t.get(db.doc(statePath(actor,item.instanceId)))).data();return state?withState(item,Refinement.validateState(state,item,header.generation)):item;
 }
 const withState=(item,state)=>({...item,refineLevel:state.refineLevel,refineBonus:{...state.refineBonus},refineBonusUnit:state.refineBonusUnit,refineStatsVersion:state.refineStatsVersion,refineFailCount:state.refineFailCount,successfulRefineCost:{...state.successfulRefineCost},stateRevision:state.revision,updatedAt:state.updatedAt});
 async function get(t,actor,farm,id,current){
  const header=current||await owner(t,actor,farm);
  if(id===clubId(actor))return enrich(t,actor,header,dto(actor,header,null,0));
  const key=parseId(id),row=(await t.get(db.doc(ownerPath(actor)+'/allocations/'+key.allocation))).data();
  if(!row||row.id!==key.allocation||row.ownerId!==scope(actor)||row.generation!==header.generation)D.fail('permission-denied','武器不屬於目前農場');
  if(row.schemaVersion!==2||!WEAPON_IDS.includes(row.weaponId)||!Array.isArray(row.removed))D.fail('failed-precondition','武器批次資料異常');
  D.integer(row.quantity,1,BATCH_SIZE);
  if(key.index>=row.quantity||row.removed.includes(key.index))D.fail('not-found','這把武器已不在倉庫');
  return enrich(t,actor,header,dto(actor,header,row,key.index));
 }
 async function list(t,actor,farm,{cursor=null,weaponId=null,pageSize=20}={}){
  D.integer(pageSize,1,50);if(weaponId!==null)D.enumValue(weaponId,['club',...WEAPON_IDS]);
  if(!isV2(farm)){
   // Legacy view only: IDs are not accepted for instance mutations.
   const rows=['club',...WEAPON_IDS].filter(id=>!weaponId||id===weaponId).map(id=>({weaponId:id,quantity:id==='club'?1:counts(farm)[id],legacy:true})).filter(row=>row.quantity>0);
   return{schemaVersion:1,rows,nextCursor:null};
  }
  const header=await owner(t,actor,farm),rows=[];
  const page=async value=>{if(!header.hasRefinementStates||!value.rows.length)return value;const states=new Map();for(let i=0;i<value.rows.length;i+=30){const docs=(await t.get(db.collection(ownerPath(actor)+'/states').where('instanceId','in',value.rows.slice(i,i+30).map(row=>row.instanceId)))).docs;for(const doc of docs)states.set(doc.id,doc.data());}return{...value,rows:value.rows.map(item=>states.has(item.instanceId)?withState(item,Refinement.validateState(states.get(item.instanceId),item,header.generation)):item)};};
  let after=null,start=0,includeClub=!weaponId||weaponId==='club';
  if(cursor){
   if(cursor.generation!==header.generation||cursor.revision!==header.revision||cursor.weaponId!==(weaponId||null))D.fail('failed-precondition','武器清單已變更，請重新讀取');
   D.integer(cursor.index,0,BATCH_SIZE);D.id(cursor.allocation);const ref=db.doc(ownerPath(actor)+'/allocations/'+cursor.allocation);after=await t.get(ref);
   if(!after.exists||after.data().ownerId!==scope(actor)||after.data().generation!==header.generation)D.fail('invalid-argument','武器分頁無效');start=cursor.index;includeClub=false;
  }
  if(includeClub)rows.push(dto(actor,header,null,0));
  if(weaponId==='club')return page({schemaVersion:2,revision:header.revision,rows,nextCursor:null});
  let q=db.collection(ownerPath(actor)+'/allocations').orderBy('__name__');if(after)q=q.startAfter(after);
  // Bounded scans: an empty page may still have a continuation cursor.
  const docs=(await t.get(q.limit(4))).docs,scan=after?[after,...docs]:docs;
  for(let d=0;d<scan.length;d++){
   const snap=scan[d],row=snap.data();if(row.ownerId!==scope(actor))D.fail('permission-denied','武器歸屬異常');
   if(row.generation!==header.generation||weaponId&&row.weaponId!==weaponId)continue;
   for(let i=after&&d===0?start:0;i<row.quantity;i++){
    if(row.removed.includes(i))continue;
    if(rows.length>=pageSize)return page({schemaVersion:2,revision:header.revision,rows,nextCursor:{allocation:snap.id,index:i,generation:header.generation,revision:header.revision,weaponId:weaponId||null}});
    rows.push(dto(actor,header,{...row,id:snap.id},i));
   }
  }
  return page({schemaVersion:2,revision:header.revision,rows,nextCursor:docs.length===4?{allocation:docs.at(-1).id,index:docs.at(-1).data().quantity,generation:header.generation,revision:header.revision,weaponId:weaponId||null}:null});
 }
 async function prepareChange({t,actor,before,next,source,stamp,action,p={}}){
  if(!isV2(before)&&before.weaponMigrationState!=='staging')return()=>{};
  const oldCounts=counts(before),newCounts=counts(next),changed=WEAPON_IDS.some(id=>oldCounts[id]!==newCounts[id]),equip=action==='equipWeapon';
  if(!changed&&!equip)return()=>{};
  if(before.weaponMigrationState==='staging')D.fail('failed-precondition','武器移轉中，請稍後重試原交易');
  if(!isV2(before))return()=>{};
  // Existing V2 assets remain operable after new-feature admission is paused.
  const header=await owner(t,actor,before),updated={...header,counts:newCounts,revision:header.revision+1,updatedAt:stamp},writes=[];
  if(equip){
   if(p.expectedWeaponRevision!==header.revision)D.fail('failed-precondition','武器狀態已變更，請重新讀取');
   const selected=await get(t,actor,before,p.instanceId,header);
   if(selected.weaponId!==p.item)D.fail('invalid-argument','武器種類與個體不符');
   const ranged=RANGED.has(selected.weaponId),slot=ranged?'equippedBow':'equippedWeapon',idSlot=ranged?'equippedBowInstanceId':'equippedMeleeInstanceId',was=header[idSlot]===selected.instanceId;
   if(p.currentlyEquipped!==was)D.fail('failed-precondition','裝備狀態已變更');
   updated[idSlot]=was?(ranged?null:clubId(actor)):selected.instanceId;updated[slot]=was?(ranged?null:'club'):selected.weaponId;next[slot]=updated[slot];
  }
  const removed=WEAPON_IDS.reduce((n,id)=>n+Math.max(0,oldCounts[id]-newCounts[id]),0);
  if(removed){
   const ids=action==='discardItem'?[p.instanceId]:p.instanceIds;
   if(!Array.isArray(ids)||ids.length!==removed||new Set(ids).size!==ids.length)D.fail('invalid-argument','請明確選擇要移除的武器個體');
   if(p.expectedWeaponRevision!==header.revision)D.fail('failed-precondition','武器狀態已變更，請重新讀取');
   const groups=new Map(),byType={};
   for(const id of ids){const item=await get(t,actor,before,id,header);if(item.refineLevel>0&&(action!=='sellItem'||!await allowRefinedSales(actor)||p.acknowledgeRefinementLoss!==true||ids.length!==1||p.expectedStateRevision!==item.stateRevision))D.fail('failed-precondition','精煉武器需確認原售價、永久失去能力且不退精煉成本；不可丟棄');if(item.equipped||item.bound)D.fail('failed-precondition','請先卸下武器，初始木棒不可移除');if(item.refineLevel>0){const state=await t.get(db.doc(statePath(actor,id)));writes.push(()=>t.update(db.doc(statePath(actor,id)),{...state.data(),soldAt:stamp,soldTransactionId:source,updatedAt:stamp}));}
    const key=parseId(id);if(!groups.has(key.allocation))groups.set(key.allocation,[]);groups.get(key.allocation).push(key.index);byType[item.weaponId]=(byType[item.weaponId]||0)+1;}
   for(const id of WEAPON_IDS)if((byType[id]||0)!==Math.max(0,oldCounts[id]-newCounts[id]))D.fail('invalid-argument','移除的武器種類不符');
   for(const [id,indexes]of groups){const ref=db.doc(ownerPath(actor)+'/allocations/'+id),row=(await t.get(ref)).data();writes.push(()=>t.update(ref,{removed:[...row.removed,...indexes].sort((a,b)=>a-b),updatedAt:stamp}));}
  }
  for(const id of WEAPON_IDS){const added=newCounts[id]-oldCounts[id];if(added>0)for(const row of allocations(actor,header,source,id,added,stamp))writes.push(()=>t.create(db.doc(ownerPath(actor)+'/allocations/'+row.id),row));}
  // Defensive write budget, well above existing 20-box x 7 x 1000 rewards.
  if(writes.length>200)D.fail('resource-exhausted','單次武器交易過大，尚未變更資產');
  next.equippedWeapon=updated.equippedWeapon;next.equippedBow=updated.equippedBow;next.weaponInstanceRevision=updated.revision;
  return()=>{for(const write of writes)write();t.set(db.doc(ownerPath(actor)),updated);};
 }
 return{owner,get,list,prepareChange};
}
module.exports={statePath,WEAPON_IDS,RANGED,BATCH_SIZE,scope,ownerPath,farmPath,counts,signature,clubId,isV2,allocationId,instanceId,parseId,assertOwner,assertProjection,dto,allocations,createWeaponRepository};
