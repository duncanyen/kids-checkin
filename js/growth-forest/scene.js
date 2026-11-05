import {art,PLANT_TYPES} from './art.js';
import {PLOT_POSITIONS,PLANT_SCALE} from './layout.js';
let engine;
function loadEngine(){
 if(window.Phaser)return Promise.resolve();
 if(!engine)engine=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js';const timeout=setTimeout(()=>{script.remove();engine=null;reject(Error('森林畫面載入逾時，請重新整理'));},30000);script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);engine=null;reject(Error('森林畫面載入失敗，請檢查網路'));};document.head.append(script);});return engine;
}
export async function createForest(element,onPlot,lowPower=false){
 await loadEngine();let scene,latest,dead=false;
 const points=PLOT_POSITIONS;
 const activate=(index,pointer)=>{if(pointer.getDistance()>12)return;const slot=latest?.gardenPage.plots[index];if(slot)onPlot(slot.positionIndex);};
 class Forest extends Phaser.Scene{
  preload(){this.load.image('forest',art.background);for(const type of PLANT_TYPES)art.plants[type].forEach((path,i)=>this.load.image(type+'-'+(i+1),path));}
  create(){
   scene=this;this.add.image(390,500,'forest');this.sprites=[];this.hits=[];this.soils=[];
   points.forEach((p,i)=>{const soil=this.add.container(0,0,[this.add.ellipse(p.x,p.y+10,150,49,0x5a6944,.14),this.add.ellipse(p.x,p.y,142,47,0xa27d57).setStrokeStyle(3,0xceb68d),this.add.ellipse(p.x,p.y-2,120,32,0x816441)]);this.soils.push(soil);const hit=this.add.zone(p.x,p.y,160,62).setInteractive({cursor:'pointer'}).setDepth(2);this.hits.push(hit);hit.on('pointerup',pointer=>activate(i,pointer));});
   if(!lowPower){for(let i=0;i<7;i++){const mote=this.add.circle(85+i*97,280+(i%3)*130,3,0xfff6c9,.7);this.tweens.add({targets:mote,y:mote.y-60,alpha:.15,duration:3500+i*300,yoyo:true,repeat:-1});}}
   this.render(latest);
  }
  render(data){
   if(!data)return;latest=data;
   for(let i=0;i<points.length;i++){
    const slot=data.gardenPage.plots[i],plant=data.plants.find(p=>p.id===slot?.plantId),old=this.sprites[i];
    this.soils[i].setVisible(Boolean(slot));this.hits[i].input.enabled=Boolean(slot);
    if(!plant){if(old){this.tweens.killTweensOf(old);old.destroy();this.sprites[i]=null;}continue;}
    const key=plant.plantType+'-'+plant.growthStage;
    if(old?.texture.key===key&&old.forestPlantId===plant.id)continue;
    if(old){this.tweens.killTweensOf(old);old.destroy();}
    const p=points[i],sprite=this.add.image(p.x,p.y,key).setOrigin(.5,.84).setScale(PLANT_SCALE).setDepth(5+i).setInteractive({cursor:'pointer',pixelPerfect:true,alphaTolerance:40});sprite.on('pointerup',pointer=>activate(i,pointer));sprite.forestPlantId=plant.id;this.sprites[i]=sprite;
    if(!lowPower)this.tweens.add({targets:sprite,angle:2,duration:1700+i*200,yoyo:true,repeat:-1});
    if(old)this.effect(i,'growth');
   }
  }
  effect(index,kind){
   const p=points[index];if(!p)return;
   for(let i=0;i<(lowPower?4:12);i++){
    const water=kind==='water',x=p.x+(Math.random()-.5)*130,y=water?p.y-170:p.y-50;
    const drop=this.add.ellipse(x,y,water?8:7,water?15:7,water?0x80c6d7:0xffedb4).setDepth(30);
    this.tweens.add({targets:drop,y:water?p.y-5:y-70,x:water?x:x+(Math.random()-.5)*130,alpha:0,duration:700+Math.random()*300,delay:i*20,onComplete:()=>drop.destroy()});
   }
  }
 }
 const game=new Phaser.Game({type:Phaser.AUTO,parent:element,backgroundColor:'#c4d7ae',width:780,height:1000,scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH},transparent:false,antialias:true,fps:{target:lowPower?30:60},scene:Forest,audio:{noAudio:true}});
 return{set(data){latest=data;scene?.render(data);},effect(i,kind){scene?.effect(i-(latest?.gardenPage.start||0),kind);},setInputEnabled(enabled){game.input.enabled=enabled;if(scene)scene.input.enabled=enabled;},pause(){game.loop.sleep();},resume(){if(!dead)game.loop.wake();},destroy(){dead=true;game.destroy(true);}};
}
