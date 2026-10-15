export default class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FFCA28', '8': '#BDBDBD', '9': '#7CB342', 'A': '#388E3C', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2',
            'K': '#FFA000', 'L': '#FFF9C4', 'M': '#FF4081', 'N': '#F48FB1'
        };

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('hen', { data: ['......1111..', '......1411..', '......1111..', '......111133', '....11111122', '....111111..', '..11118811..', '..11118811..', '....118811..', '....111111..', '......3..3..', '......3..3..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coop', { data: ['......CCCC......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', 'DDDDDDDDDDDDDDDD', '..FGFGFGFGFGFG..', '..GFFGFGFGFFGF..', '..FGFGIIIIFGFG..', '..GFFGIIIIFFGF..', '..FGFGFFFFFGFG..', '..GFFGHHHHFFGF..', '..FGFGHHHHFGFG..', '..GFFHEEEEHFFG..', '..FGFHEEEEFGFG..', '..GFFGFGFGFFGF..'], pixelWidth: 10, palette: palette });
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '7L77K', '7777K', '777KK', '.7KK.'], pixelWidth: 5, palette: palette });
        this.textures.generate('cabbage', { data: ['..AA..', '.A99A.', 'A9A99A', 'A999AA', '.AAAA.'], pixelWidth: 5, palette: palette });
        this.textures.generate('worm', { data: ['9A9A'], pixelWidth: 5, palette: palette });
        this.textures.generate('earthworm', { data: ['N2N2'], pixelWidth: 5, palette: palette });
        this.textures.generate('heart', { data: ['.M.M.', 'MMMMM', 'MMMMM', '.MMM.', '..M..'], pixelWidth: 4, palette: palette });
        this.textures.generate('signboard', { data: ['..GGGGGG..', '.GFFFFFFG.', 'GFF4444FFG', 'GFF4444FFG', 'GFFFFFFFFG', '.GFFFFFFG.', '..GGGGGG..', '....GG....', '....GG....', '....GG....'], pixelWidth: 3, palette: palette });
        
        // 🐺 全新設計：大野狼 (加入明顯的尖耳朵與凸出的長嘴巴及尖牙)
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

        // 🤕 戰敗大野狼 (頭上腫包，眼睛打叉昏迷，保留尖耳朵與長嘴巴)
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

        this.scene.start('MyFarmScene');
    }
}
