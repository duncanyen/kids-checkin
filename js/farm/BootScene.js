import { registerGorillaAnimations } from './gorilla.js';
import { registerDragonAnimations } from './dragon.js';
import { registerPredatorAnimations } from './predators.js';
import { db } from '../firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef } from './constants.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    preload() {
        // ⚠️ 重要：請依照「下載.png」的實際總解析度，除以 6(欄) 與 8(列) 來設定 frameWidth 與 frameHeight
        // 這裡假設單格寬高為 32x32
        this.load.spritesheet('hen', 'hen.png', { frameWidth: 32, frameHeight: 32 });
        this.load.image('farm_background', 'assets/farm/background.webp');
        this.load.image('farm_map', 'assets/farm/farm-map.jpg');
        for (const name of ['wood', 'wood-selected', 'parchment', 'page']) {
            this.load.image('ui_' + name.replaceAll('-', '_'), `assets/farm/ui-${name}.webp`);
        }
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

        // 手繪場景由 preload 載入；母雞保留原有像素圖的銳利邊緣。
        this.textures.get('hen').setFilter(Phaser.Textures.FilterMode.NEAREST);
        for (const kind of ['wolf', 'tiger', 'dragon', 'gorilla']) {
            this.textures.get(kind).setFilter(Phaser.Textures.FilterMode.NEAREST);
        }
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
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

        // 註冊母雞動畫 (對應素材表的影格位置)
        this.anims.create({
            key: 'hen_idle',
            frames: this.anims.generateFrameNumbers('hen', { start: 0, end: 1 }),
            frameRate: 3,
            repeat: -1
        });
        
        this.anims.create({
            key: 'hen_walk',
            frames: this.anims.generateFrameNumbers('hen', { start: 6, end: 11 }), // 第二排為走動
            frameRate: 8,
            repeat: -1
        });
        /*
        this.anims.create({
            key: 'hen_sleep',
            frames: this.anims.generateFrameNumbers('hen', { start: 42, end: 45 }), // 最後一排為睡覺(生病使用)
            frameRate: 3,
            repeat: -1
        });
        */
        registerPredatorAnimations(this);
        registerDragonAnimations(this);
        registerGorillaAnimations(this);

        // 全域監聽設定
        if (!this.game.registry.has('isListeningFarm')) {
            this.game.registry.set('isListeningFarm', true);
            this.game.myFarmUnsubscribe = onSnapshot(myFarmRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().farm) {
                    this.game.registry.set('myFarmData', docSnap.data().farm);
                }
            });
        }

        this.scene.start('MyFarmScene');
    }
}
