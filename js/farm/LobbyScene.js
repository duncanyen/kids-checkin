import { addFarmBackground } from './scenery.js';
import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID } from './constants.js';

export default class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        addFarmBackground(this);
        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(195, 50, '🏘️ 咕咕村落', { fontSize: '24px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnHome = this.add.rectangle(55, 50, 70, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 50, '🏡 返回', { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnHome.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.loadingText = this.add.text(195, 320, '正在尋找鄰居...', { fontSize: '18px', color: '#fff' }).setOrigin(0.5);
        this.loadNeighbors();
    }

    async loadNeighbors() {
        try {
            const q = query(collection(db, "users"), where("groupId", "==", CURRENT_GROUP_ID));
            const querySnapshot = await getDocs(q);
            
            this.loadingText.destroy();
            let index = 0;
            const startX = 80, startY = 150, spacingX = 115, spacingY = 130;

            querySnapshot.forEach((docSnap) => {
                const userData = docSnap.data();
                const memberAccountId = userData.accountId; 
                const memberName = userData.name || "未知";
                
                if (!memberAccountId || memberAccountId === CURRENT_ACCOUNT_ID) return;

                const col = index % 3;
                const row = Math.floor(index / 3);
                const x = startX + col * spacingX;
                const y = startY + row * spacingY;

                const house = this.add.image(x, y, 'coop').setOrigin(0.5)
                    .setDisplaySize(96, 90).setInteractive({ cursor: 'pointer' });
                this.add.rectangle(x, y + 56, 96, 24, 0x000000, 0.5).setOrigin(0.5);
                this.add.text(x, y + 56, memberName, { fontSize: '13px', color: '#fff' }).setOrigin(0.5);

                house.on('pointerdown', async () => {
                    house.setTint(0xcccccc);
                    this.time.delayedCall(100, () => house.clearTint());
                    
                    const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", memberAccountId);
                    const targetSnap = await getDoc(targetRef);
                    if (targetSnap.exists() && targetSnap.data().farm) {
                        this.scene.start('VisitScene', { targetAccountId: memberAccountId, targetName: memberName });
                    } else {
                        this.showFloatingText(x, y, '尚未啟用！', '#FFCDD2');
                    }
                });
                index++;
            });
            if (index === 0) this.add.text(195, 320, '群組內還沒有其他鄰居喔！', { fontSize: '16px', color: '#fff' }).setOrigin(0.5);
        } catch (e) {
            this.loadingText.setText('載入失敗，請檢查網路');
        }
    }

    showFloatingText(x, y, msg, color) {
        const floatTxt = this.add.text(x, y - 40, msg, { fontSize: '14px', color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}
