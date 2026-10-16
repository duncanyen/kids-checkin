import { db } from '../firebase-config.js';
import { onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef } from './constants.js';

export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
        const tigerPalette = {
            ".": "#00000000",
            "O": "#302521",
            "T": "#F5A33B",
            "W": "#FFF1D6",
            "B": "#211C1A",
            "P": "#E85B98"
        };

        const tigerData = [
            "........................",
            "........................",
            "....OOO..........OOO....",
            "...OPPPO........OPPPO...",
            "...OPPPO.OOOOOO.OPPPO...",
            "...OPPPTTOTTTOTTTPPPO...",
            "....TTTTTTOTOTOTTTTT....",
            ".....TTOTTTOTTTTOTT.....",
            ".....TTTOTTTTTTOTTT.....",
            "....OTOWWWWWWWWWWOTO....",
            ".....TWWBWWWWWWBWWT.....",
            ".....WWWBWWPPWWBWWTO....",
            "......WWWWWOOWWWWWT.O...",
            ".......WWWOTTTTTW..OT...",
            ".........OWWWWOTT...O...",
            ".........OWWWWTOTT.O....",
            ".........TOWWOTTTTO.....",
            "........TTWWWWTOTT......",
            ".........TWWOWTTTT......",
            ".......TTTTTTTTTTT......",
            ".......TTTTTTTTTTT......",
            ".......WWW....WWWW......",
            "........................",
            "........................"
        ];

       // 為了在測試畫面上看清楚，將 pixelWidth 稍微調大至 8
        this.textures.generate("hen", {
            data: tigerData,
            pixelWidth: 8,
            palette: tigerPalette
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
