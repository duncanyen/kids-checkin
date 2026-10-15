import { db } from '../firebase-config.js';
import { onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, LAY_EGG_TIME_MS } from './constants.js';

export default class WarehouseScene extends Phaser.Scene {
    constructor() { super({ key: 'WarehouseScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.hen = this.add.image(195, 180, 'hen').setScale(1.5).setOrigin(0.5);
        this.isFeeding = false;

        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🎒 倉庫', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '🔙 返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.capacityText = this.add.text(195, 110, '容量: 0/10', { fontSize: '16px', color: '#fff', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        this.itemsPanel = this.add.container(0, 260);
        this.itemSlots = {};
        
        const configItems = [
            { key: 'coins', name: '金幣', icon: 'coin' },
            { key: 'inventoryEggs', name: '雞蛋', icon: 'egg' },
            { key: 'worms', name: '菜蟲', icon: 'worm' },
            { key: 'earthworms', name: '蚯蚓', icon: 'earthworm' },
            { key: 'wolfFangs', name: '狼牙', icon: 'fang' } 
        ];

        let index = 0;
        configItems.forEach(item => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = 100 + col * 190;
            const y = row * 100;

            const bg = this.add.rectangle(x, y, 160, 80, 0x000000, 0.5).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
            const img = this.add.image(x - 40, y, item.icon).setScale(1.5);
            const txt = this.add.text(x + 10, y - 10, `${item.name}\nx 0`, { fontSize: '16px', color: '#fff', align: 'center' }).setOrigin(0.5);

            bg.on('pointerdown', () => this.handleItemClick(item.key, item.name));
            this.itemSlots[item.key] = txt;
            this.itemsPanel.add([bg, img, txt]);
            index++;
        });

        this.actionPanel = this.add.container(0, 530).setVisible(false);
        this.actionBg = this.add.rectangle(195, 0, 340, 100, 0x333333, 0.9).setOrigin(0.5);
        this.actionTitle = this.add.text(195, -25, '選擇動作', { fontSize: '18px', color: '#fff' }).setOrigin(0.5);
        
        this.btnFeed = this.add.rectangle(110, 20, 120, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(110, 20, '🍗 餵食', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        this.btnDiscard = this.add.rectangle(280, 20, 120, 40, 0xE53935, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(280, 20, '🗑️ 丟棄', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.actionPanel.add([this.actionBg, this.actionTitle, this.btnFeed, this.btnDiscard]);
        this.msgText = this.add.text(195, 650, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        this.initFirebase();
        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.farmData = docSnap.data().farm;
                const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
                this.capacityText.setText(`容量: ${usedSpace}/${this.farmData.warehouseLimit || 10}`);
                this.itemSlots['coins'].setText(`金幣\nx ${this.farmData.coins || 0}`);
                this.itemSlots['inventoryEggs'].setText(`雞蛋\nx ${this.farmData.inventoryEggs || 0}`);
                this.itemSlots['worms'].setText(`菜蟲\nx ${this.farmData.worms || 0}`);
                this.itemSlots['earthworms'].setText(`蚯蚓\nx ${this.farmData.earthworms || 0}`);
                this.itemSlots['wolfFangs'].setText(`狼牙\nx ${this.farmData.wolfFangs || 0}`);
            }
        });
    }

    handleItemClick(key, name) {
        if (!this.farmData) return;
        const count = this.farmData[key] || 0;
        
        if (key === 'coins' || key === 'inventoryEggs' || key === 'wolfFangs') {
            this.actionPanel.setVisible(false);
            this.showMsg('此物品請至商店販售！', '#FFD54F');
            return;
        }

        if (count <= 0) {
            this.actionPanel.setVisible(false);
            this.showMsg(`沒有${name}可以操作！`, '#F44336'); return;
        }

        this.actionTitle.setText(`對 ${name} 進行操作`);
        this.actionPanel.setVisible(true);
        this.btnFeed.removeAllListeners();
        this.btnDiscard.removeAllListeners();

        this.btnFeed.on('pointerdown', () => this.feedItem(key));
        this.btnDiscard.on('pointerdown', () => this.discardItem(key));
    }

    async feedItem(key) {
        if (this.isFeeding || !this.farmData || (this.farmData[key] || 0) <= 0) return;
        this.actionPanel.setVisible(false);
        this.isFeeding = true; 

        const reduceMins = key === 'worms' ? 30 : 60;
        const reduceMs = reduceMins * 60 * 1000;

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[key] > 0) {
                    let newLastLayTime = farm.lastLayTime - reduceMs;
                    let newEggsReady = farm.eggsReady || 0;
                    const now = Date.now();
                    
                    // 🌟 多雞折算：判斷目前真實的生產速度
                    const henCount = farm.hens || 1;
                    const currentLayTimeMs = Math.floor(LAY_EGG_TIME_MS / henCount);
                    const maxEggs = henCount * 6;
                    
                    while (now - newLastLayTime >= currentLayTimeMs && newEggsReady < maxEggs) {
                        newEggsReady++;
                        newLastLayTime += currentLayTimeMs;
                    }
                    if (newEggsReady >= maxEggs && (now - newLastLayTime > 0)) { newLastLayTime = now; }

                    t.update(myFarmRef, { [`farm.${key}`]: farm[key] - 1, "farm.lastLayTime": newLastLayTime, "farm.eggsReady": newEggsReady });
                }
            });
            this.showHeartEffect(key === 'earthworms');
            this.showMsg(`全體母雞很開心！下顆蛋加速 ${reduceMins} 分鐘`, '#4CAF50');
        } catch (e) { console.error(e); } 
        finally { this.isFeeding = false; }
    }

    async discardItem(key) {
        if (!this.farmData || (this.farmData[key] || 0) <= 0) return;
        this.actionPanel.setVisible(false);
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[key] > 0) { t.update(myFarmRef, { [`farm.${key}`]: farm[key] - 1 }); }
            });
            this.showMsg('已丟棄物品！', '#BDBDBD');
        } catch (e) { console.error(e); }
    }

    showHeartEffect(isBig) {
        this.tweens.add({ targets: this.hen, y: this.hen.y - 15, duration: 150, yoyo: true });
        const heart = this.add.image(this.hen.x, this.hen.y - 30, 'heart').setScale(isBig ? 2 : 1).setDepth(20);
        this.tweens.add({ targets: heart, y: heart.y - 50, alpha: 0, duration: 1500, onComplete: () => heart.destroy() });
    }
    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2500, delay: 1000 });
    }
}
