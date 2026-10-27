import { registerEagleAnimations } from './eagle.js';
import { watchFarm } from '../live-reads.js';
import { registerPoultryAnimations } from './poultry-art.js';
import { registerGorillaAnimations } from './gorilla.js';
import { registerDragonAnimations } from './dragon.js';
import { registerPredatorAnimations } from './predators.js';
import { db } from '../firebase-config.js';
import { ensureFarmSave, startFarmSaveSession } from './save-store.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef } from './constants.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    preload() {
        for (const breed of ['hen', 'silkie', 'bresse']) this.load.atlas(breed, `assets/farm/${breed}-sheet.png`, `assets/farm/${breed}-sheet.json`);
        this.load.image('farm_background', 'assets/farm/background.webp');
        this.load.image('farm_map', 'assets/farm/farm-map.jpg');
        this.load.image('farm_panorama', 'assets/farm/farm-panorama.webp');
        for (const name of ['wood', 'wood-selected', 'parchment', 'page']) {
            this.load.image('ui_' + name.replaceAll('-', '_'), `assets/farm/ui-${name}.webp`);
        }
        this.load.atlas('eagle', 'assets/farm/eagle-sheet.png', 'assets/farm/eagle-sheet.json');
        for (const key of ['shortbow', 'huntingbow', 'eagle-feather', 'arrow']) this.load.image(key, `assets/farm/${key}.png`);
        this.load.image('mace', 'assets/farm/mace.png');
        this.load.image('battleaxe', 'assets/farm/battleaxe.png');
        this.load.image('coop', 'assets/farm/coop.webp');
        this.load.spritesheet('dragon', 'assets/farm/dragon-sheet.webp', { frameWidth: 256, frameHeight: 256 });
        this.load.image('dragon_scale', 'assets/farm/dragon-scale.webp');
        this.load.atlas('gorilla', 'assets/farm/gorilla-sheet.png', 'assets/farm/gorilla-sheet.json');
        this.load.image('gorilla_fang', 'assets/farm/gorilla-fang.png');
        this.load.image('signboard', 'assets/farm/signboard.webp');
        for (const kind of ['wolf', 'tiger']) {
            this.load.spritesheet(kind, `assets/farm/${kind}-sheet.webp`, { frameWidth: 256, frameHeight: 256 });
        }
    }

    create() {
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FFCA28', '8': '#BDBDBD', '9': '#7CB342', 'A': '#388E3C', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2',
            'K': '#FF9800', 'L': '#FFF9C4', 'M': '#FF4081', 'N': '#F48FB1',
            'a': '#E2E8F0', 'b': '#CBD5E1', 'c': '#F87171', 'd': '#DC2626',
            'e': '#FDE047', 'f': '#D97706', 'g': '#FCA5A5', 'P': '#8BC34A'
        };

        // 所有角色採用一致的清晰像素邊緣。
        for (const kind of ['wolf', 'tiger', 'dragon', 'gorilla', 'hen', 'silkie', 'bresse']) {
            this.textures.get(kind).setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('silkie_egg', { data: ['..LL..', '.LLLL.', 'LLLLLL', 'LLLLLF', '.LLLF.', '..FF..'], pixelWidth: 6, palette });
        this.textures.generate('bresse_egg', { data: ['..11..', '.1111.', '111111', '11111I', '.111I.', '..II..'], pixelWidth: 6, palette });
        this.textures.generate('coin', { data: ['.777.', '7L77K', '7777K', '777KK', '.7KK.'], pixelWidth: 5, palette: palette });
        this.textures.generate('worm', { data: ['9A9A'], pixelWidth: 5, palette: palette });
        this.textures.generate('earthworm', { data: ['N2N2'], pixelWidth: 5, palette: palette });
        
        this.textures.generate('rubbish', { data: ['..FGFG..', '.GFFFFG.', 'FGHHHHGF', 'G444444G', 'FH4444HF', '.GFFFFG.', '..FGFG..'], pixelWidth: 3, palette: palette });
        this.textures.generate('sick_pelt', { data: ['..PP..', '.P99P.', 'P9PP9P', '.P99P.', '..PP..'], pixelWidth: 3, palette: palette });
        this.textures.generate('skull', { data: ['.1111.', '141411', '111111', '.1414.', '..11..'], pixelWidth: 3, palette: palette });
        this.textures.generate('medicine', { data: ['..2222..', '.211112.', '21222212', '21222212', '.211112.', '..2222..'], pixelWidth: 4, palette: palette });
        
        this.textures.generate('tiger_pelt', { data: ['......4K4K4.......', '.....4KKKKK4......', '...444K444K444....', '..4KKKKKKKKKKK4...', '.4KK4KK444KK4KK4..', '.4KKKKKKKKKKKKK4..', '..44KK44444KK44...', '...4KKKKKKKKK4....', '..4KK4444444KK4...', '.4KKKKKKKKKKKKK4..', '.4K44K4...4K44K4..', '..4444.....4444...'], pixelWidth: 4, palette: palette });
        this.textures.generate('club', { data: ['..GG..', '.GFFG.', 'GFFFFG', 'GFFFFG', 'GFFFFG', '.GFFG.', '.GFFG.', '..GG..', '..GG..'], pixelWidth: 4, palette: palette });
        this.textures.generate('fang', { data: ['..44..', '.4114.', '.4114.', '..414.', '..44..'], pixelWidth: 4, palette: palette });
        this.textures.generate('star', { data: ['.E.', 'EEE', '.E.'], pixelWidth: 4, palette: palette });

        registerPoultryAnimations(this);
        registerPredatorAnimations(this);
        registerDragonAnimations(this);
        registerEagleAnimations(this);
        registerGorillaAnimations(this);

        // 全域監聽設定
        if (!this.game.registry.has('isListeningFarm')) {
            this.game.registry.set('isListeningFarm', true);
            const session = startFarmSaveSession({
                watch: (next, error) => watchFarm(myFarmRef, next, error),
                verify: options => ensureFarmSave(db, { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID }, options),
                receive: farm => this.game.registry.set('myFarmData', farm),
                status: state => this.game.registry.set('farmLoadState', state)
            });
            this.game.retryFarmSave = session.retry;
            this.game.myFarmUnsubscribe = session.stop;
            window.addEventListener('online', session.retry);
            this.game.events.once('destroy', () => {
                session.stop();
                window.removeEventListener('online', session.retry);
            });
        }

        this.scene.start('MyFarmScene');
    }
}
