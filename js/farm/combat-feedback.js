import {BattleCountdown} from './battle-countdown.js';
import {FARM_BACKEND_ENABLED,recordBattleHit,farmNow} from './backend-client.js';
import {makeCombatSnapshot,hitResult,maximumHealth} from './combat-damage.js';
import {farmView} from './viewport.js';
import {monsterHead,screenUnits} from './monster-head.js';
import {onSceneExit} from './scene-cleanup.js';

export function battleContext(scene,kind,id){
 if(FARM_BACKEND_ENABLED)return scene.backendChallenge;
 const stats=makeCombatSnapshot(scene.myFarmData||scene.farmData,kind,id);
 return {...stats,id,kind,health:stats.maxHealth,attacks:{melee:0,ranged:0}};
}
export function battleHit(scene,battle,mode,weapon){
 if(FARM_BACKEND_ENABLED)return recordBattleHit(battle.id,mode,battle,weapon,battle.kind,hit=>battle.lastHit=hit);
 battle.localAttacks||={melee:0,ranged:0};battle.lastHit=hitResult(battle,mode,battle.localAttacks[mode]++,weapon,battle.kind);return battle.lastHit.damage;
}
/** One lightweight HUD per fight; at most eight reusable floating damage labels. */
export class BattleHealthHUD{
 constructor(scene,{battle,kind,sprite,onSync,status,durationMs}){
  this.scene=scene;this.battle=battle;this.sprite=sprite;this.max=maximumHealth(battle,kind);this.health=battle.health;this.alive=true;this.finished=false;this.ordinal=0;this.pool=[];
  this.countdown=new BattleCountdown(scene,{battle,kind,durationMs,now:FARM_BACKEND_ENABLED?farmNow:Date.now});
  this.width=250/3;this.height=11/3;
  this.root=scene.add.container(0,0).setDepth(34);
  this.track=scene.add.rectangle(-this.width/2,0,this.width,this.height,0x45211b).setOrigin(0,.5).setStrokeStyle(1,0x392719);
  this.trail=scene.add.rectangle(-this.width/2,0,this.width,this.height,0xffd67a).setOrigin(0,.5);
  this.bar=scene.add.rectangle(-this.width/2,0,this.width,this.height,0xe76b43).setOrigin(0,.5);
  this.root.add([this.track,this.trail,this.bar]);
  if(status)status.setVisible(false);
  this.layout=()=>{
   this.countdown.tick();
   if(!this.alive||!this.sprite?.active)return;
   const head=monsterHead(this.sprite),gap=screenUnits(scene,96/2.54*.3);
   this.root.setPosition(head.x,head.y-gap-this.height/2);
   for(const text of this.pool)if(text.visible&&text.anchorSprite?.active){
    const anchor=monsterHead(text.anchorSprite),view=farmView(scene),margin=Math.min(view.width/2-4,Math.max(42,text.displayWidth/2+18));
    text.setPosition(Math.max(view.left+margin,Math.min(view.left+view.width-margin,anchor.x+text.floatX)),Math.max(view.top+screenUnits(scene,38),anchor.y-screenUnits(scene,1)+text.floatY));
    if(text.burst)text.burst.setPosition(text.x,text.y-text.displayHeight/2).setScale(text.scaleX).setAlpha(text.alpha).setVisible(text.getData('combatCritical')===true);
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
  const hit=this.battle.lastHit,critical=hit?.critical===true;
  text.setData('combatCritical',critical);text.setData('combatCriticalStreak',hit?.streak||0);text.setData('combatMultiplier',critical?hit.multiplier:1);
  text.setColor(critical?'#fff6af':'#fff0c4').setStroke(critical?'#6b160a':'#6c2513',critical?6:4);
  text.setText(`−${value}`).setFontSize(critical?[40,44,42][index%3]:[32,36,30][index%3]).setPosition(x,y).setAlpha(1).setScale(1.12).setVisible(true);
  text.setData('combatDamage',value);text.setData('battleId',this.battle.id);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(critical){
   text.burst||=this.scene.add.graphics().setDepth(40);
   const g=text.burst,w=text.width/2+17,h=text.height/2+10,points=[];
   for(let i=0;i<24;i++){const a=i*Math.PI/12,r=i%2?.75:1;points.push({x:Math.cos(a)*w*r,y:Math.sin(a)*h*r});}
   g.clear().fillStyle(hit?.streak>1?0xb52312:0xd74612,.95).lineStyle(3,0xffd44a,1).fillPoints(points,true).strokePoints(points,true);
   g.lineStyle(2,0xfff1b0,.95);
   for(let i=0;i<6;i++){const a=i*Math.PI/3;g.lineBetween(Math.cos(a)*w*1.05,Math.sin(a)*h*1.05,Math.cos(a)*(w+7),Math.sin(a)*(h+6));}
  }else text.burst?.setVisible(false);
  if(reduced)text.setScale(1);else if(critical)text.setScale(hit?.streak>1?1.3:1.24);
  this.layout();
  this.scene.tweens.add({targets:text,floatY:-screenUnits(this.scene,reduced?4:18),scale:1,duration:reduced?220:500,ease:'Cubic.Out'});
  this.scene.tweens.add({targets:text,alpha:0,delay:reduced?0:120,duration:reduced?220:380,ease:reduced?'Linear':'Quad.In',onComplete:()=>{if(text.active)text.setVisible(false);text.burst?.setVisible(false);}});
 }
 stop(){this.finished=true;this.countdown.stop();}
 hide(){this.countdown.destroy();if(this.alive)this.root.setVisible(false);}
 destroy(){if(!this.alive)return;this.alive=false;this.countdown.destroy();window.removeEventListener('nexus-farm-battle-health',this.sync);this.scene.events.off('postupdate',this.layout);this.scene.events.off('farm-viewport-resize',this.layout);this.scene.tweens.killTweensOf(this.trail);for(const text of this.pool){this.scene.tweens.killTweensOf(text);text.burst?.destroy();text.destroy();}this.root.destroy();}
}
