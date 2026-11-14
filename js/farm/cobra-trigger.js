import {routeBackendChallenge} from './backend-client.js';
import { cobraDue } from './cobra-rules.js';
import { claimCobraEncounter } from './cobra-store.js';
import { CobraEncounter } from './cobra.js';
import { ensureAssets, bossAssets } from './assets.js';
import { farmLoading } from './loading-ui.js';

// Load art before reserving a milestone, so failed downloads consume no time.
export async function maybeStartCobra(scene) {
    if(scene.preparingGiant || (scene.myFarmData||scene.farmData)?.giantChallenge || (scene.giantEncounter&&!scene.giantEncounter.destroyed&&!scene.giantEncounter.settled))return true;
    if (scene.preparingMole || (scene.myFarmData || scene.farmData)?.moleChallenge || (scene.moleEncounter && !scene.moleEncounter.destroyed && !scene.moleEncounter.settled)) return true;
    if (scene.cobraEncounter && !scene.cobraEncounter.destroyed && !scene.cobraEncounter.settled) return true;
    if (scene.preparingCobra) return true;
    if (!cobraDue(scene.myFarmData || scene.farmData)) return false;
    const token = scene.farmSceneToken || scene.visitToken;
    const active = () => scene.sys.isActive() && token === (scene.farmSceneToken || scene.visitToken);
    scene.preparingCobra = true;
    try {
        const keys = bossAssets('cobra');
        if (keys.some(key => !scene.textures.exists(key))) farmLoading.begin('毒牙眼鏡蛇王即將現身');
        await ensureAssets(scene, keys, n => farmLoading.progress(n * 95, '準備蛇王挑戰'));
        if (!active()) return true;
        farmLoading.complete(true);
        const claim = await claimCobraEncounter(scene.targetAccountId, scene.targetGroupId);
        if (!active()) return true;
        if (!claim) return false;
        if (claim.expired) {
            scene.showFloatingText(`上一場蛇王挑戰已逾時，扣除 ${claim.result.coinsLost} 金幣`, '#F44336', 16);
            return true;
        }
        if(!routeBackendChallenge(scene,claim))return true;
        scene.cobraEncounter?.destroy();
        scene.cobraEncounter = new CobraEncounter(scene, claim.challenge);
        return true;
    } catch (error) {
        if (active()) farmLoading.error('蛇王挑戰準備失敗，請重試以確認挑戰狀態。', () => maybeStartCobra(scene));
        console.warn('蛇王挑戰未能開始', error);
        return true;
    } finally {
        if (active()) scene.preparingCobra = false;
    }
}
