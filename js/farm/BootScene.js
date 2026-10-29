import { watchFarm } from '../live-reads.js';
import { db } from '../firebase-config.js';
import { ensureFarmSave, startFarmSaveSession } from './save-store.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, membershipReady } from './constants.js';
import { CORE_ASSETS, queueAssets, registerAvailableAnimations } from './assets.js';
import { farmLoading } from './loading-ui.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }
    preload() {
        this.bootDisposed=false;
        this.game.events.once('destroy',()=>{this.bootDisposed=true;});
        this.assetProgress=0;this.memberDone=false;this.saveDone=false;this.assetFailed=false;
        const update=()=>farmLoading.progress(5+this.assetProgress*65+(this.memberDone?10:0)+(this.saveDone?10:0),
            this.game.registry.get('farmLoadState')?.phase==='error' ? undefined : this.assetProgress<1?'載入農莊素材':'確認群組與存檔');
        this.load.on('progress',progress=>{this.assetProgress=progress;update();});
        this.load.on('loaderror',()=>{this.assetFailed=true;});
        this.load.on('filecomplete',()=>{if(this.textures.exists('hen'))farmLoading.attachHen(this.textures.get('hen'));});
        queueAssets(this,CORE_ASSETS);
        // Public images load while membership is checked. Private save access
        // starts only once that membership promise has resolved successfully.
        membershipReady.then(()=>{
            if(this.bootDisposed || this.game.pendingDestroy || !this.game.scene) return;
            this.memberDone=true;update();
            if(this.game.registry.has('isListeningFarm'))return;
            this.game.registry.set('isListeningFarm',true);
            const session=startFarmSaveSession({
                watch:(next,error)=>watchFarm(myFarmRef,next,error),
                verify:options=>ensureFarmSave(db,{groupId:CURRENT_GROUP_ID,accountId:CURRENT_ACCOUNT_ID},options),
                receive:farm=>this.game.registry.set('myFarmData',farm),
                status:state=>{
                    this.game.registry.set('farmLoadState',state);
                    if(this.game.registry.get('farmInitialReady'))return;
                    this.saveDone=state.phase==='ready';
                    if(state.phase==='error')farmLoading.error('存檔尚未確認，請重試；不會重設農莊。',()=>this.game.retryFarmSave?.());
                    else update();
                }
            });
            this.game.retryFarmSave=session.retry;this.game.myFarmUnsubscribe=session.stop;
            window.addEventListener('online',session.retry);
            this.game.events.once('destroy',()=>{session.stop();window.removeEventListener('online',session.retry);});
        }).catch(()=>farmLoading.error('無法確認群組資格，請返回重試。'));
    }
    create() {
        if(this.assetFailed || CORE_ASSETS.some(key=>!this.textures.exists(key))){farmLoading.error('農莊素材載入失敗，請檢查連線後重試。');return;}
        farmLoading.attachHen(this.textures.get('hen'));
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FFCA28', '8': '#BDBDBD', '9': '#7CB342', 'A': '#388E3C', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2',
            'K': '#FF9800', 'L': '#FFF9C4', 'M': '#FF4081', 'N': '#F48FB1',
            'a': '#E2E8F0', 'b': '#CBD5E1', 'c': '#F87171', 'd': '#DC2626',
            'e': '#FDE047', 'f': '#D97706', 'g': '#FCA5A5', 'P': '#8BC34A'
        };

        
        this.textures.generate('rubbish', { data: ['..FGFG..', '.GFFFFG.', 'FGHHHHGF', 'G444444G', 'FH4444HF', '.GFFFFG.', '..FGFG..'], pixelWidth: 3, palette: palette });
        this.textures.generate('sick_pelt', { data: ['..PP..', '.P99P.', 'P9PP9P', '.P99P.', '..PP..'], pixelWidth: 3, palette: palette });
        this.textures.generate('skull', { data: ['.1111.', '141411', '111111', '.1414.', '..11..'], pixelWidth: 3, palette: palette });
        this.textures.generate('medicine', { data: ['..2222..', '.211112.', '21222212', '21222212', '.211112.', '..2222..'], pixelWidth: 4, palette: palette });
        
        this.textures.generate('club', { data: ['..GG..', '.GFFG.', 'GFFFFG', 'GFFFFG', 'GFFFFG', '.GFFG.', '.GFFG.', '..GG..', '..GG..'], pixelWidth: 4, palette: palette });
        this.textures.generate('star', { data: ['.E.', 'EEE', '.E.'], pixelWidth: 4, palette: palette });

        registerAvailableAnimations(this);
        this.scene.launch('FarmAssetScene');
        membershipReady.then(()=>{
            if(!this.bootDisposed && this.sys.isActive() && !this.game.pendingDestroy)this.scene.start('MyFarmScene');
        }).catch(()=>{});
    }
}
