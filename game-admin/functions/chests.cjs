/** Chest configuration and fulfilment. No client outcomes, prices or random values are accepted. */
const crypto=require('node:crypto'),D=require('./domain.cjs');
const MONSTERS=Object.freeze({wolf:'大野狼',tiger:'老虎',gorilla:'金剛',mole:'地鼠',dragon:'烈火龍',eagle:'巨飛鷹',cobra:'眼鏡蛇王',giant:'遠古巨人',hornet:'虎頭蜂'});
const MAX_COINS=1000000000;
const DEFAULTS=Object.freeze(Object.fromEntries(Object.keys(MONSTERS).map(kind=>{
 const tier=['wolf','tiger','gorilla'].includes(kind)?[20,1,100]:['mole','dragon','eagle'].includes(kind)?[50,100,200]:[80,500,1000];
 if(kind==='hornet')return[kind,{dropRate:0,coins:{enabled:false,min:0,max:0},items:[]}];
 return[kind,{dropRate:tier[0],coins:{enabled:true,min:tier[1],max:tier[2]},items:[]}];
})));
// All nested documents inherit the existing ops_* client-deny rules.
const ownerPath=actor=>'ops_farm_chests/'+D.hash(JSON.stringify([actor.uid,actor.groupId,actor.accountId]))+'/boxes';
let models;
const load=()=>models||=Promise.all(['poultry','combat-rules','inventory-core','guard-dog-core','farm-scenes-core'].map(name=>import('./game/'+name+'.js')));
async function catalog(){
 const [P,C,I,G,S]=await load();
 const items=Object.entries(P.BREEDS).map(([id,b])=>({id,name:b.name,kind:'chicken',breed:id,icon:b.texture,enabled:b.purchasable!==false,reason:b.purchasable===false?'此雞種尚未開放交付':'',maxQuantity:20}));
 for(const [id,w]of Object.entries(C.WEAPONS_CONFIG))items.push({id,name:w.name,kind:'stock',icon:w.icon,enabled:!!w.buyPrice,reason:w.buyPrice?'':'初始武器不是可交付的商店商品',maxQuantity:1000});
 const eggs=Object.fromEntries(Object.values(P.BREEDS).map(b=>[b.eggKey,{name:b.eggName,icon:b.eggIcon}]));
 const other={honey:['蜂蜜','honey'],ancientStones:['遠古巨石','ancient_stone'],sweetPotatoes:['地瓜','sweet_potato'],medicines:['咕咕活力散','medicine'],worms:['菜蟲','worm'],earthworms:['蚯蚓','earthworm'],wolfFangs:['狼牙','fang'],tigerPelts:['虎皮','tiger_pelt'],dragonScales:['龍麟','dragon_scale'],gorillaFangs:['猩猩尖牙','gorilla_fang'],cobraFangs:['眼鏡蛇王毒牙','cobra_fang'],eagleFeathers:['巨鷹羽毛','eagle-feather']};
 for(const id of I.INVENTORY_KEYS){
  if(items.some(item=>item.id===id))continue;
  const value=eggs[id]||other[id]&&{name:other[id][0],icon:other[id][1]};
  if(value)items.push({id:id==='medicines'?'medicine':id,inventoryKey:id,...value,kind:'stock',enabled:true,reason:'',maxQuantity:1000});
 }
 for(const [id,b]of Object.entries(G.GUARD_DOG_BREEDS))items.push({id:'guard:'+id,name:b.name,enabled:false,reason:'限時租約需要租期、暫停剩餘時間與啟用流程，尚無寶箱租約兌換交付',maxQuantity:1});
 for(const item of Object.values(S.FARM_SCENES))items.push({id:'scene:'+item.id,name:item.name,enabled:false,reason:item.id==='default'?'初始場景已內建':item.purchasable===false?'場景尚未開賣，不能從寶箱取得':'永久場景尚無寶箱所有權交付流程',maxQuantity:1});
 for(const [id,name]of [['coop2','中級雞舍'],['coop3','高級雞舍'],['coop4','特級雞舍（即將推出）'],['coop5','頂級雞舍（即將推出）'],['expand','倉庫擴充']])items.push({id,name,enabled:false,reason:'即時生效的升級服務，尚無可入庫的升級兌換憑證',maxQuantity:1});
 return items;
}
async function validate(value){
 if(!value||typeof value.dropRate!=='number'||!Number.isFinite(value.dropRate)||value.dropRate<0||value.dropRate>100)D.fail('invalid-argument','寶箱掉落率須為 0–100%');
 if(typeof value.coins?.enabled!=='boolean')D.fail('invalid-argument','金幣獎勵開關無效');
 const coins={enabled:value.coins.enabled,min:D.integer(value.coins.min,0,MAX_COINS),max:D.integer(value.coins.max,0,MAX_COINS)};
 if(coins.min>coins.max)D.fail('invalid-argument','最小金額不可大於最大金額');
 if(!Array.isArray(value.items)||value.items.length>20)D.fail('invalid-argument','最多設定 20 項寶箱物品');
 const products=await catalog(),seen=new Set();
 const items=value.items.map(row=>{
  const item=products.find(p=>p.id===row?.itemId);
  if(!item?.enabled)D.fail('invalid-argument',item?.reason||'未知或無法安全交付的商品');
  if(seen.has(item.id))D.fail('invalid-argument','相同商品請合併數量');seen.add(item.id);
  return{itemId:item.id,quantity:D.integer(row.quantity,1,item.maxQuantity)};
 });
 if(items.reduce((n,row)=>n+(products.find(item=>item.id===row.itemId).kind==='chicken'?row.quantity:0),0)>20)D.fail('invalid-argument','單箱雞隻總數不可超過最高雞舍容量 20 隻');
 if(value.dropRate>0&&!(coins.enabled&&coins.max>0)&&!items.length)D.fail('invalid-argument','掉落率大於零時，至少設定一項可實際發放的獎勵');
 return{dropRate:value.dropRate,coins,items};
}
async function config(db,t){
 const snap=await(t?t.get(db.doc('ops_game_config/chests')):db.doc('ops_game_config/chests').get()),raw=snap.data()||{};
 const monsters={};for(const kind of Object.keys(MONSTERS))monsters[kind]=await validate(raw.monsters?.[kind]??DEFAULTS[kind]);
 return{monsters,revision:raw.revision||0,updatedAt:raw.updatedAt||null,initialized:snap.exists};
}
const unit=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>=1)D.fail('internal','寶箱亂數來源無效');return value;};
const drops=(rate,roll)=>rate===100||rate!==0&&unit(roll)*100<rate;
const coinAmount=(coins,roll)=>coins.enabled?coins.min+Math.floor(unit(roll)*(coins.max-coins.min+1)):0;
async function drop({db,t,actor,farm,patch,session,event,stamp,roll}){
 if(event?.type!=='DEFEAT_MONSTER'||session?.result?.outcome!=='win')return null;
 const settings=await config(db,t),kind=D.enumValue(event.monster,Object.keys(MONSTERS)),snapshot=settings.monsters[kind];
 // Materialize defaults only if absent. This read/create shares the battle transaction,
 // so a concurrent operator save wins through normal Firestore retry, never overwrite.
 const initialize=settings.initialized?null:()=>t.create(db.doc('ops_game_config/chests'),{monsters:structuredClone(DEFAULTS),revision:0,schemaVersion:1,createdAt:stamp,updatedAt:stamp,updatedBy:'system-defaults-v1'});
 if(!drops(snapshot.dropRate,roll))return initialize;
 const id=D.hash('chest:'+actor.uid+':'+actor.groupId+':'+event.battleId),ref=db.doc(ownerPath(actor)+'/'+id),previous=await t.get(ref);
 if(previous.exists)D.fail('failed-precondition','寶箱來源戰鬥已結算，請重新讀取原紀錄');
 const chest={id,uid:actor.uid,accountId:actor.accountId,groupId:actor.groupId,monster:kind,battleId:event.battleId,droppedAt:stamp,status:'unopened',configRevision:settings.revision,snapshot:structuredClone(snapshot)};
 const count=farm.chestCount??0;D.integer(count,0,Number.MAX_SAFE_INTEGER-1);patch['farm.chestCount']=count+1;
 // Same settlement object is persisted in the active session and original battle history.
 const result=session.result;result.chest={id,monster:kind,configRevision:settings.revision};
 result.rewards=[...(result.rewards||[]),{itemId:'unopenedChest',itemName:'寶箱',quantity:1,chestId:id}];result.inventoryUpdated=true;
 return()=>{initialize?.();t.create(ref,chest);};
}
async function open({db,t,actor,farm,id,stamp,roll,blocked=false}){
 D.id(id);const ref=db.doc(ownerPath(actor)+'/'+id),snap=await t.get(ref),chest=snap.data();
 if(!chest)D.fail('not-found','找不到這個寶箱');
 if(chest.uid!==actor.uid||chest.accountId!==actor.accountId||chest.groupId!==actor.groupId)D.fail('permission-denied','這個寶箱不屬於目前玩家');
 if(chest.status==='opened'){if(!chest.result)D.fail('failed-precondition','寶箱結果紀錄異常');return{patch:{},result:{...chest.result,replayed:true},commit:()=>{}};}
 if(blocked)D.fail('failed-precondition','請先完成怪物戰鬥結算');
 if(chest.status!=='unopened')D.fail('failed-precondition','寶箱狀態無法開啟');
 const snapshot=await validate(chest.snapshot),coins=coinAmount(snapshot.coins,roll),[P,,I]=await load(),products=await catalog();
 let next=structuredClone(farm);
 if(!Number.isSafeInteger(next.coins+coins))D.fail('failed-precondition','金幣超出安全上限，寶箱尚未消耗');next.coins+=coins;
 const awarded=[];
 for(const row of snapshot.items){
  const item=products.find(p=>p.id===row.itemId);
  if(item.kind==='chicken'){
   // Reuse the shop's exact chicken delivery/capacity/production logic without
   // charging the real wallet. The temporary delivery allowance is never persisted.
   const realCoins=next.coins,allowance=P.BREEDS[item.breed].buy*row.quantity;
   let delivered;try{delivered=P.tradePoultry({...next,coins:allowance},item.breed,row.quantity,'buy',stamp,Array.from({length:row.quantity},()=>crypto.randomUUID()));}catch(error){D.fail('failed-precondition',error.message);}
   next={...next,...Object.fromEntries(Object.entries(delivered).filter(([k])=>k!=='farm.coins').map(([k,v])=>[k.slice(5),v])),coins:realCoins};
  }else{
   const key=item.inventoryKey||item.id,previous=next[key]||0;if(!Number.isSafeInteger(previous)||previous<0||!Number.isSafeInteger(previous+row.quantity))D.fail('failed-precondition','道具數值超出安全範圍');next[key]=previous+row.quantity;
  }
  awarded.push({itemId:item.id,name:item.name,quantity:row.quantity,kind:item.kind,icon:item.icon});
 }
 if(snapshot.items.some(row=>products.find(p=>p.id===row.itemId).kind==='stock')&&I.getUsedSpace(next)>(next.warehouseLimit||10))D.fail('resource-exhausted','倉庫容量不足，請先整理或擴充；寶箱尚未消耗');
 const count=farm.chestCount??0;D.integer(count,1,Number.MAX_SAFE_INTEGER);next.chestCount=count-1;
 const patch=Object.fromEntries(Object.entries(next).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(farm[key])).map(([key,value])=>['farm.'+key,value]));
 const result={chestId:id,monster:chest.monster,coins,items:awarded,openedAt:stamp,configRevision:chest.configRevision};
 return{patch,result,commit:()=>t.update(ref,{...chest,status:'opened',openedAt:stamp,result})};
}
async function list({db,t,actor,status='unopened',cursor}){
 D.enumValue(status,['unopened','opened']);const path=ownerPath(actor);
 let q=db.collection(path).where('status','==',status);
 if(cursor){D.id(cursor);const snap=await t.get(db.doc(path+'/'+cursor));if(!snap.exists||snap.data().status!==status)D.fail('failed-precondition','寶箱清單已變更，請重新讀取');q=q.startAfter(snap);}
 const snapshots=await t.get(q.limit(21)),rows=snapshots.docs.slice(0,20).map(doc=>{const value=doc.data();if(value.uid!==actor.uid||value.groupId!==actor.groupId||value.accountId!==actor.accountId)D.fail('permission-denied','寶箱歸屬異常');return{id:doc.id,monster:value.monster,droppedAt:value.droppedAt,status:value.status,configRevision:value.configRevision,...(status==='opened'?{result:value.result}:{})};});
 return{rows,nextCursor:snapshots.size>20?snapshots.docs[19].id:null};
}
module.exports={ownerPath,MONSTERS,DEFAULTS,MAX_COINS,catalog,validate,config,drops,coinAmount,drop,open,list};
