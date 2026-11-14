import {FARM_BACKEND_ENABLED,recordBattleHit,farmNow} from './backend-client.js';
import { BossEncounter } from './dragon.js';
import { GIANT_CONFIG, ANCIENT_STONE_PRICE } from './giant-rules.js';
import { settleGiantEncounter } from './giant-store.js';
import { farmView } from './viewport.js';
export function registerGiantAnimations(scene) {
    if(!scene.textures.exists('giant'))return;
    for(const [action,start,end,repeat]of [['idle',0,7,-1],['walk',8,15,-1],['smash',16,19,0],['throw',20,23,0],['hit',24,26,0],['dead',27,30,0]]){
        const key='giant_'+action;if(scene.anims.exists(key))continue;
        scene.anims.create({key,frames:Array.from({length:end-start+1},(_,i)=>({key:'giant',frame:String(start+i)})),frameRate:action==='dead'?5:action==='hit'?18:8,repeat});
    }
}
function arena(scene) {
    const coop=scene.coop.getBounds(),garden=scene.gardenBounds;
    return {x:(garden.left+garden.right)/2,y:(coop.bottom+garden.top)/2,radius:Math.min(55,(garden.right-garden.left)/4)};
}
export class GiantEncounter extends BossEncounter {
    constructor(scene,challenge) {
        if(FARM_BACKEND_ENABLED)scene.backendChallenge=challenge;
        const view=farmView(scene),area=arena(scene),now=(FARM_BACKEND_ENABLED?farmNow():Date.now());
        super(scene,{
            key:'giant',archery:true,name:'遠古巨人',size:GIANT_CONFIG.size,frameSize:224,
            config:{...GIANT_CONFIG,flightMs:Math.max(0,challenge.approachEndsAt-now),durationMs:Math.max(1,challenge.deadline-now)},
            travel:'walk',attack:'idle',attackPhase:'patrol',movingLabel:'從右上方重步逼近',attackLabel:'巡行威嚇母雞',
            reward:'遠古巨石',salePrice:ANCIENT_STONE_PRICE,settle:settleGiantEncounter,
            lossText:'遠古巨人離開了，挑戰失敗！',approachEase:'Linear',
            spawnPoint:()=>({x:view.left+view.width+110,y:view.top+110}),destination:()=>({x:area.x,y:area.y})
        });
        this.id=challenge.id;this.deadline=challenge.deadline;this.approachEndsAt=challenge.approachEndsAt;
        this.sprite.setFlipX(true);this.lastSmash=-1;this.lastThrow=-1;this.lastThreat=0;
        this.motion=()=>this.patrol();scene.events.on('update',this.motion);
    }
    startFire() {
        if(this.destroyed||this.result)return;
        this.flight.stop();this.phase='patrol';this.sprite.play('giant_idle');this.refresh();
    }
    refresh() {
        if(this.deadline&&(FARM_BACKEND_ENABLED?farmNow():Date.now())>=this.deadline&&!this.result){this.resolve('loss');return;}
        super.refresh();
    }
    patrol() {
        if(this.destroyed||this.result)return;
        if(this.expired()){this.resolve('loss');return;}
        if(this.phase!=='patrol')return;
        const now=(FARM_BACKEND_ENABLED?farmNow():Date.now()),area=arena(this.scene),t=Math.max(0,(now-this.approachEndsAt)/1000),phase=t%8,cycle=Math.floor(t/8);
        const walking=phase<4,smash=phase>=4.8&&phase<5.8,throwing=phase>=6.3&&phase<7.3,dodge=phase>=7.3;
        const x=area.x+Math.sin(t*.8)*area.radius+(dodge?Math.sin((phase-7.3)/.7*Math.PI)*18:0);
        let hen=null,distance=Infinity;
        if(!walking)for(const candidate of this.scene.hensGroup||[]){
            if(!candidate.active)continue;
            const d=(candidate.x-x)**2+(candidate.y-area.y)**2;
            if(d<distance){hen=candidate;distance=d;}
        }
        const left=!walking&&hen?hen.x<x:Math.cos(t*.8)<0;
        this.sprite.setPosition(x,area.y).setFlipX(left);
        this.flame.clear().setVisible(true);
        if(phase>=4&&phase<4.8){this.flame.lineStyle(3,0x79f7e0,.7).strokeEllipse(x,area.y-48,50,20);}
        if(smash){
            const pulse=(phase-4.8);this.flame.lineStyle(3,0xc2a56e,1-pulse).strokeEllipse(x,area.y,35+pulse*90,8+pulse*25);
            if(this.lastSmash!==cycle){this.lastSmash=cycle;if(!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches)this.scene.cameras.main.shake(120,.0015);}
        }
        if(throwing){
            if(this.lastThrow!==cycle){this.lastThrow=cycle;this.throwTarget={x:hen?.x??x+(left?-90:90),y:hen?hen.y-12:area.y};}
            const p=phase-6.3,end=this.throwTarget;
            // A visual feint near the hen; no additional animal/egg damage.
            this.flame.fillStyle(0x807866,.9).fillCircle(x+(end.x-x)*p,area.y-65+(end.y-area.y+65)*p-Math.sin(p*Math.PI)*40,7);
        }
        if(now-this.lastThreat>800){this.lastThreat=now;this.scene.avoidPredators();}
        if(this.sprite.anims.currentAnim?.key==='giant_hit'&&this.sprite.anims.isPlaying)return;
        this.sprite.play('giant_'+(walking?'walk':smash?'smash':throwing?'throw':'idle'),true);
    }
    destroy() {this.scene.events.off('update',this.motion);super.destroy();}
}
