import { FarmAssetScene } from './assets.js';
import { farmLoading } from './loading-ui.js';
import BootScene from './BootScene.js';
import MyFarmScene from './MyFarmScene.js';
import LobbyScene from './LobbyScene.js';
import VisitScene from './VisitScene.js';
import ShopScene from './ShopScene.js';
import WarehouseScene from './WarehouseScene.js';
import { mountFarmRankings } from './ranking-ui.js';
import { mountFarmMail } from './mail-ui.js';
import { mountFarmDaily } from './daily-ui.js';
import { mountFarmHud } from './hud-ui.js';
import { hasPendingBackendBattle } from './backend-client.js';
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
function initializePart(part, initialize) {
    try { return initialize(); }
    catch (error) {
        // Phaser 的版本橫幅只是啟動訊息；另外記錄實際失敗的初始化元件。
        console.error('farm-initialization-failure', JSON.stringify({ part, name:error?.name||'Error', code:error?.code||null, message:error?.message||'Unknown initialization error' }));
        throw error;
    }
}
const game = initializePart('phaser-game', () => new Phaser.Game(config));
game.events.once('destroy',()=>farmLoading.dispose());
initializePart('mail', () => mountFarmMail(game, { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID }));

initializePart('rankings', () => mountFarmRankings(game, { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID }));
const dailyChallenges=initializePart('daily-challenges', () => mountFarmDaily(game,{groupId:CURRENT_GROUP_ID,accountId:CURRENT_ACCOUNT_ID}));
initializePart('hud', () => mountFarmHud(game,{dailyChallenges,hasPendingBattle:hasPendingBackendBattle}));
