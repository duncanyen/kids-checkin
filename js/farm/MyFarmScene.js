import { db } from '../firebase-config.js';
import { onSnapshot, setDoc, updateDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, LAY_EGG_TIME_MS, playerName } from './constants.js';

export default class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        const cx = this.cameras.main.centerX; 
        const cy = this.cameras.main.centerY;
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.isHarvesting = false; 

        document.getElementById('playerName').innerText = playerName;

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5);
        this.coopEgg = this.add.image(cx, cy - 140, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        // 多隻母雞管理陣列
        this.hensGroup = []; 

        // 10x10 大菜園
        const startX = cx - 135, startY = cy + 60, spacing = 30;
        this.add.rectangle(cx, startY + 135, 300, 300, 0x5D4037, 0.4).setOrigin(0.5);
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                let cab = this.add.image(startX + c * spacing, startY + r * spacing, 'cabbage').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
                cab.on('pointerdown', () => this.searchCabbage(cab));
            }
        }

        const sign = this.add.image(startX, startY - 20, 'signboard').setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(5);
        sign.on('pointerdown', () => {
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        // UI 按鈕
        const btnLobby = this.add.rectangle(55, 40, 85, 40, 0x1976D2, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 40, '🏠 村落', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnLobby.on('pointerdown', () => this.scene.start('LobbyScene'));

        const btnShop = this.add.rectangle(145, 40, 85, 40, 0x8E24AA, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(145, 40, '🛒 商店', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnShop.on('pointerdown', () => this.scene.start('ShopScene'));

        const btnWarehouse = this.add.rectangle(235, 40, 85, 40, 0xE65100, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(235, 40, '🎒 倉庫', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnWarehouse.on('pointerdown', () => this.scene.start('WarehouseScene'));

        this.add.rectangle(340, 40, 90, 40, 0x000000, 0.6).setOrigin(0.5);
        this.add.image(315, 40, 'coin').setScale(0.8).setOrigin(0.5);
        this.coinsText = this.add.text(345, 40, '0', { fontSize: '16px', fontFamily: 'monospace', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.timerBg = this.add.rectangle(cx, 90, 200, 30, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '連線中...', { fontSize: '15px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        this.initFirebase();
        this.time.addEvent({ delay: 30000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });

        this.events.on('shutdown', () => {
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
            this.hensGroup.forEach(hen => {
                if (hen.walkTween) hen.walkTween.stop();
                if (hen.waddleTween) hen.waddleTween.stop();
            });
        });
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (!docSnap.exists() || !docSnap.data().farm) {
                setDoc(myFarmRef, { farm: { coins: 0, inventoryEggs: 0, hens: 1, coopLevel: 1, eggsReady: 0, lastLayTime: Date.now(), warehouseLimit: 10, worms: 0, earthworms: 0, wolfFangs: 0 } }, { merge: true });
                return;
            }
            this.farmData = docSnap.data().farm;
            this.updateUI();
            this.syncHens(); 
            this.startEggTimer(); 
        });
    }

    updateUI() {
        if (!this.farmData) return;
        this.coinsText.setText(`${this.farmData.coins || 0}`);
        this.coopEgg.setVisible(this.farmData.eggsReady > 0);
    }

    syncHens() {
        if (!this.farmData) return;
        const henCount = this.farmData.hens || 1;
        const coopLevel = this.farmData.coopLevel || 1;

        if (coopLevel === 1) this.coop.setScale(1);
        else if (coopLevel === 2) this.coop.setScale(1.2);
        else if (coopLevel === 3) this.coop.setScale(1.5);

        while (this.hensGroup.length < henCount) {
            let newHen = this.add.image(
                this.cameras.main.centerX + Phaser.Math.Between(-30, 30), 
                this.cameras.main.centerY - 30 + Phaser.Math.Between(-20, 20), 
                'hen'
            ).setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' });
            
            newHen.on('pointerdown', () => {
                if (!this.isHenSitting && this.emptyClickCount < 4) {
                    this.tweens.add({ targets: newHen, y: newHen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
                }
                this.harvestEgg();
            });

            this.hensGroup.push(newHen);
            this.wanderSingleHen(newHen);
        }
    }

    wanderSingleHen(henSprite) {
        if (this.isHenSitting || !henSprite || !henSprite.active) return;
        const targetX = Phaser.Math.Between(50, 340);
        const targetY = Phaser.Math.Between(120, 450); 
        henSprite.setFlipX(targetX < henSprite.x);
        const distance = Phaser.Math.Distance.Between(henSprite.x, henSprite.y, targetX, targetY);
        
        henSprite.walkTween = this.tweens.add({
            targets: henSprite, x: targetX, y: targetY, duration: distance * 20, ease: 'Linear',
            onComplete: () => {
                if (this.isHenSitting) return;
                this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => this.wanderSingleHen(henSprite));
            }
        });
        henSprite.waddleTween = this.tweens.add({ targets: henSprite, y: '-=6', duration: 150, yoyo: true, repeat: Math.floor((distance * 20) / 300) });
    }

    prepareToLayEgg() {
        this.isHenSitting = true;
        const nestX = this.cameras.main.centerX;
        const nestY = this.cameras.main.centerY - 130;

        this.hensGroup.forEach(hen => {
            if (hen.walkTween) hen.walkTween.stop();
            if (hen.waddleTween) hen.waddleTween.stop();
            hen.setFlipX(nestX < hen.x);
            this.tweens.add({
                targets: hen, x: nestX + Phaser.Math.Between(-20, 20), y: nestY + Phaser.Math.Between(-10, 10), duration: 2000, ease: 'Power2',
                onComplete: () => {
                    this.tweens.add({
                        targets: hen, scaleY: 0.7, scaleX: 1.15, y: hen.y + 10, duration: 300, ease: 'Power2',
                        onComplete: () => {
                            this.time.delayedCall(3000, () => {
                                this.tweens.add({ targets: hen, scaleY: 1, scaleX: 1, y: hen.y - 10, duration: 300, onComplete: () => { 
                                    this.isHenSitting = false; this.wanderSingleHen(hen); 
                                } });
                            });
                        }
                    });
                }
            });
        });
    }

    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;
            const now = Date.now();
            let eggsReady = this.farmData.eggsReady || 0;
            let lastLayTime = this.farmData.lastLayTime || now;
            let changed = false;

            const henCount = this.farmData.hens || 1;
            // 🌟 多母雞加速機制：母雞越多，等待時間越短！
            const currentLayTimeMs = Math.floor(LAY_EGG_TIME_MS / henCount);
            const maxEggs = henCount * 6; // 最大容量一樣提升

            while (now - lastLayTime >= currentLayTimeMs && eggsReady < maxEggs) {
                eggsReady++;
                lastLayTime += currentLayTimeMs;
                changed = true;
            }

            if (eggsReady >= maxEggs) {
                if (now - lastLayTime > 0) { lastLayTime = now; changed = true; }
            }

            if (changed) {
                updateDoc(myFarmRef, { "farm.eggsReady": eggsReady, "farm.lastLayTime": lastLayTime }).catch(e => console.error(e));
                this.farmData.eggsReady = eggsReady;
                this.farmData.lastLayTime = lastLayTime;
                this.updateUI(); 
            }

            if (eggsReady >= maxEggs) {
                this.timerText.setText(`📦 產能已滿 (${maxEggs}/${maxEggs})`).setColor('#A5D6A7');
            } else {
                let timeLeft = currentLayTimeMs - (now - lastLayTime);
                if (timeLeft < 0) timeLeft = 0;
                const h = Math.floor(timeLeft / 3600000);
                const m = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
                this.timerText.setText(`下顆蛋倒數: ${h}:${m}:${s}`).setColor('#FFD54F');
            }
        }, 1000);
    }

    async searchCabbage(cabSprite) {
        if (!this.farmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
        const limit = this.farmData.warehouseLimit || 10;
        const rand = Phaser.Math.Between(1, 500);
        let foundType = null, icon = null;
        
        if (rand === 1) { foundType = 'earthworms'; icon = '蚯蚓'; }
        else if (rand >= 2 && rand <= 6) { foundType = 'worms'; icon = '菜蟲'; }
        else return;

        if (usedSpace >= limit) {
            this.showFloatingText('倉庫已滿！', '#F44336', 16, cabSprite.x, cabSprite.y);
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
            });
            this.showFloatingText(`+1 ${icon}`, '#A5D6A7', 16, cabSprite.x, cabSprite.y);
        } catch (e) { console.error(e); }
    }

    async harvestEgg() {
        if (this.isHarvesting) return; 

        if (!this.farmData || this.farmData.eggsReady <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickTimer) this.emptyClickTimer.remove();
            this.emptyClickTimer = this.time.delayedCall(2000, () => this.emptyClickCount = 0);

            if (this.emptyClickCount >= 5) {
                this.showFloatingText('沒蛋啦還一直點~咕咕💢', '#F44336', 16); 
                this.hensGroup.forEach(hen => {
                    hen.setTint(0xff0000); 
                    this.time.delayedCall(500, () => hen.clearTint());
                    this.tweens.add({ targets: hen, y: hen.y - 25, duration: 100, yoyo: true, repeat: 1 });
                });
                this.emptyClickCount = 0;
            } else {
                this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff', 20);
            }
            return;
        }

        const eggsToHarvest = this.farmData.eggsReady;
        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
        const limit = this.farmData.warehouseLimit || 10;
        
        if (usedSpace + eggsToHarvest > limit) {
            this.showFloatingText('⚠️ 倉庫空間不足，請先擴充！', '#F44336', 14);
            return;
        }

        this.emptyClickCount = 0;
        this.isHarvesting = true; 

        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(myFarmRef);
                const farm = docSnap.data().farm;
                if (farm.eggsReady > 0) {
                    transaction.update(myFarmRef, {
                        "farm.inventoryEggs": (farm.inventoryEggs || 0) + farm.eggsReady,
                        "farm.eggsReady": 0
                    });
                }
            });
            this.showFloatingText(`+${eggsToHarvest} 🥚`, '#FFD54F', 22);
        } catch (e) { console.error(e); } 
        finally { this.isHarvesting = false; }
    }

    showFloatingText(msg, color, fontSize = 22, x = this.cameras.main.centerX, y = this.cameras.main.centerY - 60) {
        const floatTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1200, onComplete: () => floatTxt.destroy() });
    }

    showNoticeText(msg, color, fontSize, x, y) {
        if (this.noticeTxt) this.noticeTxt.destroy();
        this.noticeTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 2, backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 8, y: 8 } }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: this.noticeTxt, alpha: 0, duration: 3500, delay: 2000, onComplete: () => { if(this.noticeTxt) this.noticeTxt.destroy(); } });
    }
}
