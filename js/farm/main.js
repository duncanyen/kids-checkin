import BootScene from './BootScene.js';
import MyFarmScene from './MyFarmScene.js';
import LobbyScene from './LobbyScene.js';
import VisitScene from './VisitScene.js';
import ShopScene from './ShopScene.js';
import WarehouseScene from './WarehouseScene.js';

// ==========================================
// 啟動 Phaser 遊戲引擎 (手機滿版設定)
// ==========================================
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 390, 
        height: 844
    },
    parent: 'game-container', 
    pixelArt: true, 
    scene: [BootScene, MyFarmScene, LobbyScene, VisitScene, ShopScene, WarehouseScene] 
};

// 確保在 HTML 中 <script type="module" src="js/farm/main.js"></script>
const game = new Phaser.Game(config);
