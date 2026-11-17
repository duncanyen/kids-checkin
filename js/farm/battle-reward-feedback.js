let module;
const load=()=>module||=import('./battle-reward-ui.js').catch(error=>{module=null;throw error;});
export function warmBattleReward(){void load().then(ui=>ui.prepareBattleRewardAssets()).catch(()=>{});}
// UI failure must never retry a committed settlement or change its outcome.
export async function showBattleReward(scene,result,kind,options){
    const token=scene.farmSceneToken||scene.visitToken;
    const current=()=>scene.sys.isActive()&&(scene.farmSceneToken||scene.visitToken)===token;
    try{
        const ui=await load();
        if(!current())return true;
        const dialog=await ui.openBattleReward(scene,result,kind,options);
        return !current()||!!dialog;
    }catch(error){console.warn('farm-battle-reward-ui-failure',error?.message||'unknown');return !current();}
}
