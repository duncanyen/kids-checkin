import { db } from '../firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef } from './constants.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
// 1. 在 palette 中擴充這隻母雞需要的新顏色
const palette = {
    '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
    '7': '#FFCA28', '8': '#BDBDBD', '9': '#7CB342', 'A': '#388E3C', 
    'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
    'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2',
    'K': '#FF9800', 'L': '#FFF9C4', 'M': '#FF4081', 'N': '#F48FB1',
    // 新增母雞專用色
    'a': '#E2E8F0', // 淺灰白 (羽毛陰影)
    'b': '#CBD5E1', // 深灰 (腹部陰影)
    'c': '#F87171', // 淺紅 (雞冠高光)
    'd': '#DC2626', // 深紅 (雞冠)
    'e': '#FDE047', // 亮黃 (嘴/腳)
    'f': '#D97706', // 深橘 (腳部陰影)
    'g': '#FCA5A5'  // 粉紅 (腳脛)
};

// 2. 替換 hen 的生成矩陣 (24x24 像素)
this.textures.generate('hen', { 
    data: [
        '........444.............',
        '.......4cdc4............',
        '.......41dc4............',
        '......411114............',
        '...4..414114............',
        '..4e4.411114........44..',
        '.4ee44111114.......414..',
        '.4ff4d411114......4114..',
        '..44d41111144444441114..',
        '...4d41111a11111111144..',
        '...44111a1111111111114..',
        '..41111a11a11111111144..',
        '..4111a11a1111111144b4..',
        '..411111a111111114bbb4..',
        '..4111111111111114bb4...',
        '...44111111111114bbb4...',
        '.....44444444444b444....',
        '....4bbbbbbbbbbbbb4.....',
        '....4bbbbbbbbbbbb4......',
        '.....444444444444.......',
        '.......4g4...4g4........',
        '.......4g4...4g4........',
        '.....44ef4..44ef4.......',
        '.....44444..44444.......'
    ], 
    pixelWidth: 3, // 可以調整這個數字來決定母雞在遊戲中的大小
    palette: palette 
});

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('coop', { data: ['......CCCC......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', 'DDDDDDDDDDDDDDDD', '..FGFGFGFGFGFG..', '..GFFGFGFGFFGF..', '..FGFGIIIIFGFG..', '..GFFGIIIIFFGF..', '..FGFGFFFFFGFG..', '..GFFGHHHHFFGF..', '..FGFGHHHHFGFG..', '..GFFHEEEEHFFG..', '..FGFHEEEEFGFG..', '..GFFGFGFGFFGF..'], pixelWidth: 10, palette: palette });
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '7L77K', '7777K', '777KK', '.7KK.'], pixelWidth: 5, palette: palette });
        this.textures.generate('cabbage', { data: ['..AA..', '.A99A.', 'A9A99A', 'A999AA', '.AAAA.'], pixelWidth: 5, palette: palette });
        this.textures.generate('worm', { data: ['9A9A'], pixelWidth: 5, palette: palette });
        this.textures.generate('earthworm', { data: ['N2N2'], pixelWidth: 5, palette: palette });
        this.textures.generate('heart', { data: ['.M.M.', 'MMMMM', 'MMMMM', '.MMM.', '..M..'], pixelWidth: 4, palette: palette });
        this.textures.generate('signboard', { data: ['..GGGGGG..', '.GFFFFFFG.', 'GFF4444FFG', 'GFF4444FFG', 'GFFFFFFFFG', '.GFFFFFFG.', '..GGGGGG..', '....GG....', '....GG....', '....GG....'], pixelWidth: 3, palette: palette });
        
        this.textures.generate('wolf', { 
            data: [
                '.44............44.',
                '4884..........4884',
                '48884........48884',
                '488844444444448884',
                '488888888888888884',
                '.4882288888822884.',
                '.4882288888822884.',
                '..48888444488884..',
                '..48884888848884..',
                '...488488884884...',
                '...488444444884...',
                '....4411111144....',
                '....4141111414....',
                '....4444444444....',
                '.....48888884.....',
                '......44..44......'
            ], pixelWidth: 6, palette: palette 
        });

        this.textures.generate('wolf_bump', { 
            data: [
                '......22..........',
                '.44..2222....44...',
                '4884..22....4884..',
                '48884444444448884.',
                '488888888888888884',
                '.4884888888884884.',
                '.4888488888848884.',
                '..48888444488884..',
                '..48884888848884..',
                '...488488884884...',
                '...488444444884...',
                '....4411111144....',
                '....4141111414....',
                '....4444444444....',
                '.....48888884.....',
                '......44..44......'
            ], pixelWidth: 6, palette: palette 
        });

        this.textures.generate('club', { data: ['..GG..', '.GFFG.', 'GFFFFG', 'GFFFFG', 'GFFFFG', '.GFFG.', '.GFFG.', '..GG..', '..GG..'], pixelWidth: 4, palette: palette });
        this.textures.generate('fang', { data: ['..44..', '.4114.', '.4114.', '..414.', '..44..'], pixelWidth: 4, palette: palette });

        // 🌟 核心優化：遊戲啟動時建立「唯一」的自己的農場監聽器
        if (!this.game.registry.has('isListeningFarm')) {
            this.game.registry.set('isListeningFarm', true);
            this.game.myFarmUnsubscribe = onSnapshot(myFarmRef, (docSnap) => {
                if (docSnap.exists() && docSnap.data().farm) {
                    // 每次 Firebase 有更新，就寫入全域變數，會自動觸發各場景的 changedata 事件
                    this.game.registry.set('myFarmData', docSnap.data().farm);
                }
            });
        }

        this.scene.start('MyFarmScene');
    }
}
