// Permanent cosmetic ownership shares the existing group farm and coin balance.
export const FARM_SCENES = Object.freeze({
    default: Object.freeze({ id:'default', name:'初始場景', price:0, thumbnail:'assets/farm/scenes/default-thumb.webp', thumbTexture:'scene_default_thumb', portrait:'farm_map', landscape:'farm_panorama' }),
    fuji: Object.freeze({ id:'fuji', name:'富士山農莊', price:500000, purchasable:false, thumbnail:'assets/farm/scenes/fuji-thumb.webp', thumbTexture:'scene_fuji_thumb', portrait:'scene_fuji_portrait', landscape:'scene_fuji_landscape' })
});
export function ownedSceneIds(farm) {
    return ['default', ...Object.keys(FARM_SCENES).filter(id=>id!=='default' && Array.isArray(farm?.ownedSceneIds) && farm.ownedSceneIds.includes(id))];
}
export function activeSceneId(farm) {
    return ownedSceneIds(farm).includes(farm?.activeSceneId) ? farm.activeSceneId : 'default';
}
export function scenePurchasePatch(farm, id) {
    const scene=FARM_SCENES[id];
    if(!scene || id==='default') throw Error('此場景無法購買');
    if(scene.purchasable===false) throw Error(`${scene.name}尚未開賣`);
    if(ownedSceneIds(farm).includes(id)) throw Error('已擁有此場景，無須再次購買');
    if(!Number.isSafeInteger(farm.coins) || farm.coins < scene.price) throw Error('金幣不足');
    return {'farm.coins':farm.coins-scene.price,'farm.ownedSceneIds':[...new Set([...(farm.ownedSceneIds||[]),id])]};
}
export function sceneSelectionPatch(farm,id) {
    if(!FARM_SCENES[id] || !ownedSceneIds(farm).includes(id)) throw Error('尚未擁有此場景');
    return {'farm.activeSceneId':id};
}
