import {art,PLANT_TYPES} from './art.js';
let engine;
function loadEngine(){
 if(window.Phaser)return Promise.resolve();
 if(!engine)engine=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/phaser@3.60.0/dist/phaser.min.js';const timeout=setTimeout(()=>{script.remove();engine=null;reject(Error('森林畫面載入逾時，請重新整理'));},30000);script.onload=()=>{clearTimeout(timeout);resolve();};script.onerror=()=>{clearTimeout(timeout);engine=null;reject(Error('森林畫面載入失敗，請檢查網路'));};document.head.append(script);});return engine;
}
export async function createForest(element,onPlot,lowPower=false){
 await loadEngine();let scene,latest,dead=false;
 const points=[{x:216,y:623},{x:564,y:603},{x:371,y:811}];
 class Forest extends Phaser.Scene{
  preload(){this.load.image('forest',art.background);for(const type of PLANT_TYPES)art.plants[type].forEach((path,i)=>this.load.image(type+'-'+(i+1),path));}
  create(){
   scene=this;this.add.image(390,500,'forest');this.sprites=[];
   points.forEach((p,i)=>{this.add.ellipse(p.x,p.y+10,150,49,0x5a6944,.14);this.add.ellipse(p.x,p.y,142,47,0xa27d57).setStrokeStyle(3,0xceb68d);this.add.ellipse(p.x,p.y-2,120,32,0x816441);const hit=this.add.zone(p.x,p.y-50,200,180).setInteractive({cursor:'pointer'}).setDepth(20);hit.on('pointerdown',()=>onPlot(i));});
   if(!lowPower){for(let i=0;i<7;i++){const mote=this.add.circle(85+i*97,280+(i%3)*130,3,0xfff6c9,.7);this.tweens.add({targets:mote,y:mote.y-60,alpha:.15,duration:3500+i*300,yoyo:true,repeat:-1});}}
   this.render(latest);
  }
  render(data){
   if(!data)return;latest=data;
   for(let i=0;i<3;i++){
    const plant=data.plants.find(p=>p.id===data.garden.slots[i]),old=this.sprites[i];
    if(!plant){if(old){this.tweens.killTweensOf(old);old.destroy();this.sprites[i]=null;}continue;}
    const key=plant.plantType+'-'+plant.growthStage;
    if(old?.texture.key===key)continue;
    if(old){this.tweens.killTweensOf(old);old.destroy();}
    const p=points[i],sprite=this.add.image(p.x,p.y,key).setOrigin(.5,.84).setDepth(5+i);this.sprites[i]=sprite;
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
 return{set(data){latest=data;scene?.render(data);},effect(i,kind){scene?.effect(i,kind);},pause(){game.loop.sleep();},resume(){if(!dead)game.loop.wake();},destroy(){dead=true;game.destroy(true);}};
}
