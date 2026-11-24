import {FARM_BACKEND_ENABLED,recordBattleHit} from './backend-client.js';
import {makeCombatSnapshot,hitDamage,maximumHealth} from './combat-damage.js';
import {farmView} from './viewport.js';
import {monsterHead,screenUnits} from './monster-head.js';
import {onSceneExit} from './scene-cleanup.js';

export function battleContext(scene,kind,id){
 if(FARM_BACKEND_ENABLED)return scene.backendChallenge;
 const stats=makeCombatSnapshot(scene.myFarmData||scene.farmData,kind,id);
 return {...stats,id,kind,health:stats.maxHealth,attacks:{melee:0,ranged:0}};
}
export function battleHit(scene,battle,mode,weapon){
 if(FARM_BACKEND_ENABLED)return recordBattleHit(battle.id,mode,battle,weapon,battle.kind);
 battle.localAttacks||={melee:0,ranged:0};return hitDamage(battle,mode,battle.localAttacks[mode]++,weapon,battle.kind);
}
/** One lightweight HUD per fight; at most eight reusable floating damage labels. */
export class BattleHealthHUD{
 constructor(scene,{battle,kind,sprite,onSync,status}){
  this.scene=scene;this.battle=battle;this.sprite=sprite;this.max=maximumHealth(battle,kind);this.health=battle.health;this.alive=true;this.finished=false;this.ordinal=0;this.pool=[];
  this.width=250/3;this.height=11/3;
  this.root=scene.add.container(0,0).setDepth(34);
  this.track=scene.add.rectangle(-this.width/2,0,this.width,this.height,0x45211b).setOrigin(0,.5).setStrokeStyle(1,0x392719);
  this.trail=scene.add.rectangle(-this.width/2,0,this.width,this.height,0xffd67a).setOrigin(0,.5);
  this.bar=scene.add.rectangle(-this.width/2,0,this.width,this.height,0xe76b43).setOrigin(0,.5);
  this.root.add([this.track,this.trail,this.bar]);
  if(status)status.setVisible(false);
  this.layout=()=>{
   if(!this.alive||!this.sprite?.active)return;
   const head=monsterHead(this.sprite),gap=screenUnits(scene,96/2.54*.3);
   this.root.setPosition(head.x,head.y-gap-this.height/2);
   for(const text of this.pool)if(text.visible&&text.anchorSprite?.active){
    const anchor=monsterHead(text.anchorSprite),view=farmView(scene);
    text.setPosition(Math.max(view.left+42,Math.min(view.left+view.width-42,anchor.x+text.floatX)),Math.max(view.top+screenUnits(scene,38),anchor.y-screenUnits(scene,1)+text.floatY));
   }
  };
  this.layout();scene.events.on('postupdate',this.layout);scene.events.on('farm-viewport-resize',this.layout);
  this.sync=event=>{if(this.alive&&event.detail?.battleId===battle.id){onSync?.(event.detail.health);this.setHealth(event.detail.health);}};
  window.addEventListener('nexus-farm-battle-health',this.sync);
  this.setHealth(this.health,true);onSceneExit(scene,()=>this.destroy());
 }
 setHealth(value,immediate=false){
  if(!this.alive||this.hasHealth&&value===this.health&&!immediate)return;this.hasHealth=true;this.health=Math.max(0,Math.min(this.max,value));const width=this.width*this.health/this.max;
  this.bar.width=width;
  this.scene.tweens.killTweensOf(this.trail);
  if(immediate||window.matchMedia('(prefers-reduced-motion: reduce)').matches)this.trail.width=width;
  else this.scene.tweens.add({targets:this.trail,width,delay:70,duration:230,ease:'Cubic.Out'});
 }
 damage(value,sprite){
  if(!this.alive||value<=0)return;
  const index=this.ordinal++,slot=index%8;let text=this.pool[slot];
  if(!text){text=this.scene.add.text(0,0,'',{fontStyle:'bold',color:'#fff0c4',stroke:'#6c2513',strokeThickness:4}).setOrigin(.5,1).setDepth(41);this.pool[slot]=text;}
  this.scene.tweens.killTweensOf(text);const head=monsterHead(sprite),view=farmView(this.scene);
  this.sprite=sprite;this.layout();
  const x=Math.max(view.left+42,Math.min(view.left+view.width-42,head.x+[-8,8,0,12,-4][index%5]));
  const y=Math.max(view.top+screenUnits(this.scene,38),head.y-screenUnits(this.scene,1));
  text.anchorSprite=sprite;text.floatX=[-8,8,0,12,-4][index%5];text.floatY=0;
  text.setText(`−${value}`).setFontSize([32,36,30][index%3]).setPosition(x,y).setAlpha(1).setScale(1.12).setVisible(true);
  text.setData('combatDamage',value);text.setData('battleId',this.battle.id);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  this.scene.tweens.add({targets:text,floatY:-screenUnits(this.scene,reduced?4:18),scale:1,duration:reduced?220:500,ease:'Cubic.Out'});
  this.scene.tweens.add({targets:text,alpha:0,delay:reduced?0:120,duration:reduced?220:380,ease:reduced?'Linear':'Quad.In',onComplete:()=>{if(text.active)text.setVisible(false);}});
 }
 stop(){this.finished=true;}
 hide(){if(this.alive)this.root.setVisible(false);}
 destroy(){if(!this.alive)return;this.alive=false;window.removeEventListener('nexus-farm-battle-health',this.sync);this.scene.events.off('postupdate',this.layout);this.scene.events.off('farm-viewport-resize',this.layout);this.scene.tweens.killTweensOf(this.trail);for(const text of this.pool){this.scene.tweens.killTweensOf(text);text.destroy();}this.root.destroy();}
}
