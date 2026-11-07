import { giantDue } from './giant-rules.js';
import { claimGiantEncounter } from './giant-store.js';
import { GiantEncounter } from './giant.js';
import { ensureAssets, bossAssets } from './assets.js';
import { farmLoading } from './loading-ui.js';
export const giantBlocksFarm=scene=>scene.preparingGiant||!!(scene.giantEncounter&&!scene.giantEncounter.destroyed&&!scene.giantEncounter.settled);
function occupied(scene){
    return scene.preparingCobra||scene.preparingMole||scene.preparingEncounter||
        ['moleEncounter','cobraEncounter','eagleEncounter','dragonEncounter','gorillaEncounter'].some(key=>scene[key]&&!scene[key].destroyed&&!scene[key].settled)||
        ['wolf','tiger'].some(key=>scene[key]?.active&&!scene[key].getData('resolved'));
}
export async function maybeStartGiant(scene){
    if(giantBlocksFarm(scene))return true;
    if(occupied(scene)||!giantDue(scene.myFarmData||scene.farmData))return false;
    const token=scene.farmSceneToken||scene.visitToken,active=()=>scene.sys.isActive()&&token===(scene.farmSceneToken||scene.visitToken);
    scene.preparingGiant=true;
    try{
        const keys=[...bossAssets('giant'),'ancient_stone','mace','battleaxe','ironhammer'];
        if(keys.some(key=>!scene.textures.exists(key)))farmLoading.begin('遠古巨人即將現身');
        await ensureAssets(scene,keys,n=>farmLoading.progress(n*95,'準備遠古巨人挑戰'));
        if(!active())return true;farmLoading.complete(true);
        if(occupied(scene))return false;
        const claim=await claimGiantEncounter(scene.targetAccountId,scene.targetGroupId);
        if(!active())return true;if(!claim)return false;
        if(claim.expired){scene.showFloatingText(`上一場遠古巨人挑戰已逾時，扣除 ${claim.result.coinsLost} 金幣`,'#F44336',16);return true;}
        scene.giantEncounter?.destroy();scene.giantEncounter=new GiantEncounter(scene,claim.challenge);return true;
    }catch(error){
        if(active())farmLoading.error('遠古巨人挑戰準備失敗，請重試。',()=>maybeStartGiant(scene));
        console.warn('遠古巨人挑戰未能開始',error);return true;
    }finally{if(active())scene.preparingGiant=false;}
}
