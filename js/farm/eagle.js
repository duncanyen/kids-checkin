import { BossEncounter } from './dragon.js';
import { ENEMY_HEALTH } from './combat-rules.js';
import { db } from '../firebase-config.js';
import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { readVillageAccess } from './villages.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, getUsedSpace } from './constants.js';

export const EAGLE_CONFIG=Object.freeze({health:ENEMY_HEALTH.eagle,flightMs:10000,durationMs:60000,coinPenalty:100});
export function registerEagleAnimations(scene){
    if (!scene.textures.exists('eagle')) return;
    for(const [action,frames,repeat] of [['fly',[0,1,2,3],-1],['dive',[4,5],-1],['hit',[6],0],['dead',[7],0]]) {
        if(!scene.anims.exists(`eagle_${action}`))scene.anims.create({key:`eagle_${action}`,frames:frames.map(frame=>({key:'eagle',frame})),frameRate:action==='hit'?5:8,repeat});
    }
}
export function settleEagleEncounter(id,outcome,targetAccountId,targetGroupId=CURRENT_GROUP_ID){
    if(!['win','loss'].includes(outcome))throw new Error('無效的戰鬥結果');
    return runTransaction(db,async transaction=>{
        await readVillageAccess(CURRENT_GROUP_ID,targetGroupId,CURRENT_ACCOUNT_ID,ref=>transaction.get(ref),targetAccountId);
        const snap=await transaction.get(myFarmRef),farm=snap.data()?.farm;
        if(!farm)throw new Error('找不到玩家農場');
        const history=farm.eagleResults||[],previous=history.find(r=>r.id===id);if(previous)return previous;
        const result={id,outcome},updates={};
        if(outcome==='win'){
            updates['farm.eagleFeathers']=(farm.eagleFeathers||0)+1;
            result.overflow=getUsedSpace(farm)>=(farm.warehouseLimit||10);
        }else{
            result.coinsLost=Math.min(100,Math.max(0,farm.coins||0));
            updates['farm.coins']=Math.max(0,(farm.coins||0)-100);
        }
        updates['farm.eagleResults']=[...history.slice(-31),result];
        transaction.update(myFarmRef,updates);return result;
    });
}
export class EagleEncounter extends BossEncounter {
    constructor(scene){
        super(scene,{key:'eagle',flying:true,name:'巨飛鷹',config:EAGLE_CONFIG,size:160,frameSize:352,spawnX:335,
            travel:'fly',attack:'fly',attackPhase:'circle',movingLabel:'飛近雞舍中',attackLabel:'盤旋俯衝中',reward:'巨鷹羽毛',salePrice:300,settle:settleEagleEncounter,
            destination:()=>({x:scene.coop.x+75,y:scene.coop.getBounds().top+70})});
        this.motion=()=>this.animateCircle();
        scene.events.on('update',this.motion);
    }
    startFire(){
        if(this.destroyed||this.result)return;
        this.phase='circle';this.flight.stop();this.sprite.play('eagle_fly');this.refresh();
    }
    destroy(){
        this.scene.events.off('update',this.motion);
        super.destroy();
    }
    refresh(){
        super.refresh();
        this.animateCircle();
    }
    animateCircle(){
        if(this.destroyed||this.result||this.phase!=='circle')return;
        const t=(this.config.durationMs-this.deadlineTimer.getRemaining()-this.config.flightMs)/1000;
        const center=this.scene.coop, bounds=center.getBounds();
        const phase=(t%5+5)%5, dive=phase>=4;
        // Every fifth second: a smooth feint toward the hen clearing, then rise.
        const drop=dive?Math.sin((phase-4)*Math.PI)*135:0;
        const x=center.x+Math.cos(t*1.2)*75,y=bounds.top+70+Math.sin(t*1.8)*12+drop;
        this.sprite.setFlipX(-Math.sin(t*1.2)>0).setPosition(x,y);
        if(!this.sprite.anims.currentAnim?.key.endsWith('_hit'))this.sprite.play(dive?'eagle_dive':'eagle_fly',true);
    }
}
