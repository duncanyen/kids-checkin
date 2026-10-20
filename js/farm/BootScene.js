import { db } from '../firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef } from './constants.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    preload() {
        this.load.spritesheet('hen', 'hen.png', { frameWidth: 32, frameHeight: 32 });
        
        // 🏠 載入 4x6 雞舍圖集 (請依實際圖片總寬高除以 4 與 6 來設定 frameWidth/Height)
        this.load.spritesheet('coop_sprite', 'henshouse.png', { frameWidth: 32,frameHeight: 32});
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

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '7L77K', '7777K', '777KK', '.7KK.'], pixelWidth: 5, palette: palette });
        this.textures.generate('cabbage', { data: ['..AA..', '.A99A.', 'A9A99A', 'A999AA', '.AAAA.'], pixelWidth: 5, palette: palette });
        this.textures.generate('worm', { data: ['9A9A'], pixelWidth: 5, palette: palette });
        this.textures.generate('earthworm', { data: ['N2N2'], pixelWidth: 5, palette: palette });
        this.textures.generate('signboard', { data: ['..GGGGGG..', '.GFFFFFFG.', 'GFF4444FFG', 'GFF4444FFG', 'GFFFFFFFFG', '.GFFFFFFG.', '..GGGGGG..', '....GG....', '....GG....', '....GG....'], pixelWidth: 3, palette: palette });
        this.textures.generate('rubbish', { data: ['..FGFG..', '.GFFFFG.', 'FGHHHHGF', 'G444444G', 'FH4444HF', '.GFFFFG.', '..FGFG..'], pixelWidth: 3, palette: palette });
        this.textures.generate('sick_pelt', { data: ['..PP..', '.P99P.', 'P9PP9P', '.P99P.', '..PP..'], pixelWidth: 3, palette: palette });
        this.textures.generate('skull', { data: ['.1111.', '141411', '111111', '.1414.', '..11..'], pixelWidth: 3, palette: palette });
        this.textures.generate('medicine', { data: ['..2222..', '.211112.', '21222212', '21222212', '.211112.', '..2222..'], pixelWidth: 4, palette: palette });
        
        this.textures.generate('wolf', { data: ['.44............44.', '4884..........4884', '48884........48884', '488844444444448884', '488888888888888884', '.4882288888822884.', '.4882288888822884.', '..48888444488884..', '..48884888848884..', '...488488884884...', '...488444444884...', '....4411111144....', '....4141111414....', '....4444444444....', '.....48888884.....', '......44..44......'], pixelWidth: 6, palette: palette });
        this.textures.generate('wolf_bump', { data: ['......22..........', '.44..2222....44...', '4884..22....4884..', '48884444444448884.', '488888888888888884', '.4884888888884884.', '.4888488888848884.', '..48888444488884..', '..48884888848884..', '...488488884884...', '...488444444884...', '....4411111144....', '....4141111414....', '....4444444444....', '.....48888884.....', '......44..44......'], pixelWidth: 6, palette: palette });
        this.textures.generate('tiger', { data: ['..444..............444..', '.4KKK4............4KKK4.', '4KK11K4..........4K11KK4', '4K111KK4444444444KK111K4', '4KK1KKKKKKKKKKKKKKKK1KK4', '.4KKKKKK444444KKKKKKKK4.', '..4KKKKK444444KKKKKKK4..', '..4K44KKKK44KKKK44KKK4..', '.4KK44KKK4444KKK44KKKK4.', '.4KKKKKKK4444KKKKKKKKK4.', '.4KK44194KKKK49144KKKK4.', '.4KKK4144KKKK4441KKKKK4.', '.4KK44111KKKK11144KKKK4.', '..4KKKKK114411KKKKKKK4..', '..44KKKK11M111KKKKK44..', '...4KKK11111111KKKK4...', '....4KK11411411KK4....', '....4KKK111111KKK4....', '.....44KKKKKKKK44.....', '.......44444444.......'], pixelWidth: 5, palette: palette });
        this.textures.generate('tiger_bump', { data: ['.........2222...........', '..444...22CC22...444....', '.4KKK4...2222...4KKK4...', '4KK11K4444444444K11KK4..', '4K111KKKKKKKKKKKK111K4..', '4KK1KKKKKKKKKKKKKK1KK4..', '.4KKKKKK444444KKKKKK4...', '..4KKKKK444444KKKKKK4...', '..4K44KKKK44KKKK44KK4...', '.4KK44K44K44K44K44KK4...', '.4KKKKK44K44K44KKKKK4...', '.4KK441444KKKK4444KK4...', '.4KKK41444KKKK4441KK4...', '.4KK44111KKKK11144KK4...', '..4KKKKK114411KKKKKK4...', '..44KKKK11M111KKKKK4....', '...4KKK11111111KKKK4...', '....4KK11411411KK4....', '....4KKK111111KKK4....', '.....44KKKKKKKK44.....'], pixelWidth: 5, palette: palette });
        this.textures.generate('tiger_pelt', { data: ['......4K4K4.......', '.....4KKKKK4......', '...444K444K444....', '..4KKKKKKKKKKK4...', '.4KK4KK444KK4KK4..', '.4KKKKKKKKKKKKK4..', '..44KK44444KK44...', '...4KKKKKKKKK4....', '..4KK4444444KK4...', '.4KKKKKKKKKKKKK4..', '.4K44K4...4K44K4..', '..4444.....4444...'], pixelWidth: 4, palette: palette });
        this.textures.generate('club', { data: ['..GG..', '.GFFG.', 'GFFFFG', 'GFFFFG', 'GFFFFG', '.GFFG.', '.GFFG.', '..GG..', '..GG..'], pixelWidth: 4, palette: palette });
        this.textures.generate('fang', { data: ['..44..', '.4114.', '.4114.', '..414.', '..44..'], pixelWidth: 4, palette: palette });
        this.textures.generate('mace', { data: ['..88..', '.8448.', '848848', '848848', '.8448.', '..GG..', '..GG..', '..GG..', '..GG..'], pixelWidth: 4, palette: palette });
        this.textures.generate('star', { data: ['.E.', 'EEE', '.E.'], pixelWidth: 4, palette: palette });

        this.anims.create({ key: 'hen_idle', frames: this.anims.generateFrameNumbers('hen', { start: 0, end: 1 }), frameRate: 3, repeat: -1 });
        this.anims.create({ key: 'hen_walk', frames: this.anims.generateFrameNumbers('hen', { start: 6, end: 11 }), frameRate: 8, repeat: -1 });
        this.anims.create({ key: 'hen_sleep', frames: this.anims.generateFrameNumbers('hen', { start: 42, end: 45 }), frameRate: 3, repeat: -1 });

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
