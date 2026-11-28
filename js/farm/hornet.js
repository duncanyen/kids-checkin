import {FARM_BACKEND_ENABLED,settleBackendBattle,farmNow} from './backend-client.js';
import {BossEncounter} from './dragon.js';
import {HORNET_CONFIG,HONEY_PRICE,hornetPosition} from './hornet-core.js';
import {farmView} from './viewport.js';
import {db} from '../firebase-config.js';
import {doc,runTransaction} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {CURRENT_GROUP_ID,myFarmRef,getUsedSpace} from './constants.js';
import {readVillageAccess} from './villages.js';
import {CURRENT_ACCOUNT_ID} from './constants.js';
export function registerHornetAnimations(scene){
 if(!scene.textures.exists('hornet'))return;
 for(const [row,name,repeat]of [[0,'hover',-1],[1,'fly',-1],[2,'left',-1],[3,'attack',-1],[4,'evade',0],[5,'hit',0],[6,'dead',0]]){
  const key='hornet_'+name;if(!scene.anims.exists(key))scene.anims.create({key,frames:Array.from({length:8},(_,i)=>({key:'hornet',frame:String(row*8+i)})),frameRate:name==='dead'?10:12,repeat});
 }
}
export function settleHornetEncounter(id,outcome,targetAccountId,targetGroupId=CURRENT_GROUP_ID){
 if(FARM_BACKEND_ENABLED)return settleBackendBattle(id);
 if(!['win','loss'].includes(outcome))throw Error('無效的戰鬥結果');
 return runTransaction(db,async t=>{
  await readVillageAccess(CURRENT_GROUP_ID,targetGroupId,CURRENT_ACCOUNT_ID,ref=>t.get(ref),targetAccountId);
  const farm=(await t.get(myFarmRef)).data()?.farm;if(!farm)throw Error('找不到玩家農場');
  const previous=(farm.hornetResults||[]).find(r=>r.id===id);if(previous)return previous;
  const result={id,outcome},patch={};
  if(outcome==='win'){patch['farm.honey']=(farm.honey||0)+1;result.overflow=getUsedSpace(farm)>=(farm.warehouseLimit||10);}
  else{result.coinsLost=Math.min(100,Math.max(0,farm.coins||0));patch['farm.coins']=Math.max(0,(farm.coins||0)-100);}
  patch['farm.hornetResults']=[...(farm.hornetResults||[]).slice(-31),result];t.update(myFarmRef,patch);return result;
 });
}
export class HornetEncounter extends BossEncounter{
 constructor(scene){
  const view=farmView(scene);
  super(scene,{key:'hornet',flying:true,name:'虎頭蜂',config:HORNET_CONFIG,size:HORNET_CONFIG.size,frameSize:200,travel:'fly',attack:'hover',attackPhase:'circle',movingLabel:'快速飛近雞舍',attackLabel:'盤旋俯衝中',reward:'蜂蜜',salePrice:HONEY_PRICE,settle:settleHornetEncounter,lossText:'虎頭蜂離開了！',spawnPoint:()=>({x:view.left+view.width-16,y:view.top+view.height-40}),destination:()=>({x:scene.coop.x,y:scene.coop.getBounds().top-30})});
  this.sprite.setOrigin(.5,.5);this.flight.stop();
  this.startedAt=FARM_BACKEND_ENABLED?scene.backendChallenge.startedAt:Date.now();
  this.motion=()=>this.animateHornet();scene.events.on('update',this.motion);this.animateHornet();
 }
 startFire(){if(this.destroyed||this.result)return;this.phase='circle';this.refresh();}
 refresh(){if(this.deadline&&(FARM_BACKEND_ENABLED?farmNow():Date.now())>=this.deadline&&!this.result){this.resolve('loss');return;}super.refresh();this.animateHornet();}
 animateHornet(){
        if(this.battle?.inputProtocol===1)return;
  if(this.destroyed||this.result||this.startedAt===undefined)return;
  if((FARM_BACKEND_ENABLED?farmNow():Date.now())>=this.deadline){this.resolve('loss');return;}
  const b=this.scene.coop.getBounds(),hens=Array.isArray(this.scene.hensGroup)?this.scene.hensGroup:[],hen=hens.find(h=>h.active);
  const p=hornetPosition((FARM_BACKEND_ENABLED?farmNow():Date.now())-this.startedAt,{coop:{x:this.scene.coop.x,top:b.top,bottom:b.bottom},view:farmView(this.scene),hen:hen&&{x:hen.x,y:hen.y}}),left=p.x<this.sprite.x;
  this.sprite.setPosition(p.x,p.y);
  if(!this.sprite.anims.currentAnim?.key.endsWith('_hit')){this.sprite.setFlipX(p.phase==='dive'&&left).play(p.phase==='dive'?'hornet_attack':left?'hornet_left':'hornet_fly',true);}
 }
 destroy(){this.scene.events.off('update',this.motion);super.destroy();}
}
