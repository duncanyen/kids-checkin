import { FarmAssetScene } from './assets.js';
import { farmLoading } from './loading-ui.js';
import BootScene from './BootScene.js';
import MyFarmScene from './MyFarmScene.js';
import LobbyScene from './LobbyScene.js';
import VisitScene from './VisitScene.js';
import ShopScene from './ShopScene.js';
import WarehouseScene from './WarehouseScene.js';
import { mountFarmMail } from './mail-ui.js';
import { mountFarmRankings } from './ranking-ui.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID } from './constants.js';

// ==========================================
// 啟動 Phaser 遊戲引擎 (手機滿版設定)
// ==========================================
const config = {
    type: Phaser.AUTO,
    backgroundColor: '#79994d',
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 390, 
        height: 844
    },
    parent: 'game-container', 
    // Smooth painted scenery; the hen texture opts into nearest filtering in BootScene.
    pixelArt: false,
    antialias: true,
    scene: [BootScene, MyFarmScene, LobbyScene, VisitScene, ShopScene, WarehouseScene, FarmAssetScene]
};

// 確保在 HTML 中 <script type="module" src="js/farm/main.js"></script>
const game = new Phaser.Game(config);
game.events.once('destroy',()=>farmLoading.dispose());
mountFarmMail(game, { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID });
mountFarmRankings(game, { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID });
