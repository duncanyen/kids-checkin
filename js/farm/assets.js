import { registerPoultryAnimations } from './poultry-art.js';
import { registerPredatorAnimations } from './predators.js';
import { registerDragonAnimations } from './dragon.js';
import { registerGorillaAnimations } from './gorilla.js';
import { registerEagleAnimations } from './eagle.js';
import { registerGiantAnimations } from './giant.js';
import { registerCobraAnimations } from './cobra.js';
import { farmLoading } from './loading-ui.js';
import { ASSET_MANIFEST as manifest, CORE_ASSETS, ALL_ASSETS } from './asset-manifest.js';
export { CORE_ASSETS, ALL_ASSETS } from './asset-manifest.js';
const bundles = {LobbyScene:['farm_background','coop','ui_wood','ui_wood_selected','ui_parchment','ui_page'],ShopScene:ALL_ASSETS,WarehouseScene:ALL_ASSETS,VisitScene:ALL_ASSETS};
export function bossAssets(kind) { return kind === 'gorilla' ? ['gorilla'] : [kind,'shortbow','huntingbow','paladinbow','arrow','ui_wood']; }
export function queueAssets(scene, keys) {
    const missing = [...new Set(keys)].filter(key => !scene.textures.exists(key));
    for (const key of missing) {
        const spec = manifest[key];
        if (!spec) throw Error('Unknown farm asset');
        const url = `assets/farm/${spec.image}`, xhr = {timeout:20000};
        if (spec.type === 'atlas') scene.load.atlas(key,url,`assets/farm/${spec.json}`,xhr,xhr);
        else if (spec.type === 'sheet') scene.load.spritesheet(key,url,{frameWidth:256,frameHeight:256},xhr);
        else scene.load.image(key,url,xhr);
    }
    return missing;
}
export function registerAvailableAnimations(scene) {
    for (const [key,spec] of Object.entries(manifest)) {
        if (spec.crop && scene.textures.exists(key)) scene.textures.get(key).get().setSize(spec.crop[2],spec.crop[3],spec.crop[0],spec.crop[1]);
    }
    if (scene.textures.exists('mole')) {
        for (const [action,frames,repeat] of [['walk',[9,8,1,2,0],0],['idle',[0,3],-1],['hit',[4,5,0],0],['dead',[10,11],0],['burrow',[0,8,9],0],['angry',[6,7],0]]) {
            if (!scene.anims.exists('mole_'+action)) scene.anims.create({key:'mole_'+action,frames:frames.map(frame=>({key:'mole',frame:String(frame)})),frameRate:10,repeat});
        }
    }
    for (const key of ['hen','silkie','bresse','onagadori','wolf','tiger','dragon','gorilla','cobra','mole','giant'])
        if (scene.textures.exists(key)) scene.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
    registerPoultryAnimations(scene); registerPredatorAnimations(scene);
    registerDragonAnimations(scene); registerGorillaAnimations(scene); registerEagleAnimations(scene);
    registerCobraAnimations(scene); registerGiantAnimations(scene);
}
export class FarmAssetScene extends Phaser.Scene {
    constructor() { super({key:'FarmAssetScene'}); this.jobs=[]; this.runningJob=false; this.closed=false; }
    create() {
        this.sys.setVisible(false);
        this.game.events.once('destroy',()=>{
            this.closed=true;
            this.jobs.splice(0).forEach(job=>job.reject(Error('Game destroyed')));
        });
        this.pump();
    }
    ensure(keys, progress) {
        if (this.closed) return Promise.reject(Error('Game destroyed'));
        if (keys.every(key=>this.textures.exists(key))) { registerAvailableAnimations(this); return Promise.resolve(); }
        // 固定載入器依序處理工作，後續需求重查紋理快取，重疊請求不重複下載。
        return new Promise((resolve,reject)=>{this.jobs.push({keys:[...new Set(keys)],progress,resolve,reject});this.pump();});
    }
    pump() {
        if (this.closed || this.runningJob || !this.sys.isActive() || !this.jobs.length) return;
        const job=this.jobs[0];
        if(job.keys.every(key=>this.textures.exists(key))){this.jobs.shift();registerAvailableAnimations(this);job.progress?.(1);job.resolve();this.pump();return;}
        this.runningJob=true;
        const failed=new Set();
        const progress=value=>job.progress?.(value), error=file=>failed.add(file.key);
        const complete=()=>{
            this.load.off('progress',progress);this.load.off('loaderror',error);
            this.jobs.shift();this.runningJob=false;
            if (failed.size || job.keys.some(key=>!this.textures.exists(key))) job.reject(Error('Farm assets failed'));
            else {registerAvailableAnimations(this);job.resolve();}
            this.pump();
        };
        this.load.on('progress',progress);this.load.on('loaderror',error);this.load.once('complete',complete);
        queueAssets(this,job.keys);
        this.load.start();
    }
}
/**
 * 透過持續存在的 FarmAssetScene 排隊載入素材，共用已完成的紋理。
 * @param {Object} scene - 需要素材的 Phaser Scene。
 * @param {Array<string>} keys - ASSET_MANIFEST 素材鍵。
 * @param {Function} [progress] - 接收目前載入進度。
 * @returns {Promise<void>} 素材與對應動畫可使用；載入失敗拒絕並交由頁面重試。
 */
export function ensureAssets(scene, keys, progress) {
    return scene.game.scene.getScene('FarmAssetScene').ensure(keys,progress);
}
// 自訂 Loader File 等待共用素材；仍由 Phaser 控制 preload→create，直接切場景或重試也走同一閘門。
export function preloadSceneAssets(scene) {
    const keys=bundles[scene.sys.settings.key] || CORE_ASSETS;
    const token=scene.farmAssetToken=Symbol();scene.farmAssetError=false;
    if (keys.every(key=>scene.textures.exists(key))) return;
    farmLoading.begin('準備功能素材');
    class BundleFile extends Phaser.Loader.File {
        load() {
            ensureAssets(scene,keys,n=>farmLoading.progress(n*95,'載入功能素材')).then(()=>{
                if(this.loader.inflight?.contains(this))this.loader.nextFile(this,true);
            },()=>{
                if(scene.farmAssetToken===token)scene.farmAssetError=true;
                if(this.loader.inflight?.contains(this))this.loader.nextFile(this,false);
            });
        }
    }
    scene.load.addFile(new BundleFile(scene.load,{type:'farm-bundle',key:`bundle-${scene.sys.settings.key}`}));
}
export function finishSceneAssets(scene) {
    if (scene.farmAssetError) {
        farmLoading.error('素材載入失敗，存檔未變更。請重試。',()=>{
            if(scene.sys.isActive())scene.scene.restart(scene.sys.settings.data);
        });return false;
    }
    if(scene.game.registry.get('farmInitialReady'))farmLoading.complete(true);
    return true;
}
