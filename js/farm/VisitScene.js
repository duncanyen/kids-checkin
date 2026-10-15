import { db } from '../firebase-config.js';
import { doc, onSnapshot, runTransaction, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CURRENT_GROUP_ID, myFarmRef, STEAL_COOLDOWN_MS, STEAL_SUCCESS_RATE } from './constants.js';

export default class VisitScene extends Phaser.Scene {
    constructor() { super({ key: 'VisitScene' }); }

    init(data) {
        this.targetAccountId = data.targetAccountId; 
        this.targetName = data.targetName;
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        this.emptyClickCount = 0;
        this.targetFarmData = null;
        this.myFarmData = null; 
        this.isStealing = false; 

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5);
        this.coopEgg = this.add.image(cx, cy - 140, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        this.hensGroup = []; // 儲存鄰居的母雞

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
        sign.on('pointerdown', () => { this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20); });

        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.add.text(195, 50, `潛入 [${this.targetName}] 的家`, { fontSize: '16px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);

        const btnBack = this.add.rectangle(55, 50, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(30);
        this.add.text(55, 50, '🏃 溜走', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
        btnBack.on('pointerdown', () => this.scene.start('LobbyScene'));

        this.initFirebase();

        // 🐺 大野狼突發事件 (10% 機率)
        if (Phaser.Math.Between(1, 10) === 1) {
            this.spawnWolfEvent();
        }

        this.events.on('shutdown', () => { 
            if (this.unsubscribeTarget) this.unsubscribeTarget(); 
            if (this.unsubscribeMyFarm) this.unsubscribeMyFarm(); 
            this.hensGroup.forEach(hen => {
                if (hen.walkTween) hen.walkTween.stop();
                if (hen.waddleTween) hen.waddleTween.stop();
            });
        });
    }

    // --- 🐺 大野狼事件邏輯 ---
    spawnWolfEvent() {
        this.isWolfDefeated = false;
        this.wolfHitCount = 0;

        const spawnX = this.cameras.main.centerX + 120;
        const spawnY = this.cameras.main.centerY + 220; 
        
        // 使用放大版的新野狼
        this.wolf = this.add.image(spawnX, spawnY, 'wolf').setOrigin(0.5).setScale(1.5).setDepth(25).setInteractive({ cursor: 'pointer' });
        this.club = this.add.image(0, 0, 'club').setOrigin(0.5).setScale(1.5).setDepth(30).setVisible(false);

        const warnText = this.add.text(this.cameras.main.centerX, 120, '⚠️ 警告：大野狼來襲！\n快用木棒打退牠 (點擊200下)', { 
            fontSize: '18px', color: '#F44336', fontStyle: 'bold', align: 'center', stroke: '#fff', strokeThickness: 3 
        }).setOrigin(0.5).setDepth(30);
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 500 });

        this.wolfTween = this.tweens.add({
            targets: this.wolf, x: this.coop.x, y: this.coop.y + 40, duration: 60000, ease: 'Linear',
            onComplete: () => {
                warnText.destroy();
                if (!this.isWolfDefeated) this.wolfEscapes(); 
            }
        });

        this.wolf.on('pointerdown', (pointer) => {
            if (this.isWolfDefeated) return;
            this.wolfHitCount++;
            this.wolf.setTint(0xff0000);
            this.time.delayedCall(50, () => this.wolf.clearTint());

            this.club.setPosition(pointer.x + 15, pointer.y - 15);
            this.club.setVisible(true);
            this.club.setAngle(-45);
            this.tweens.add({ targets: this.club, angle: 45, duration: 50, yoyo: true, onComplete: () => this.club.setVisible(false) });

            if (this.wolfHitCount >= 200) {
                warnText.destroy();
                this.defeatWolf();
            } else if (this.wolfHitCount % 20 === 0) {
                this.showFloatingText(`還差 ${200 - this.wolfHitCount} 下!`, '#FF9800', 16, this.wolf.x, this.wolf.y - 40);
            }
        });
    }

    defeatWolf() {
        this.isWolfDefeated = true;
        if (this.wolfTween) this.wolfTween.stop();
        this.wolf.setTexture('wolf_bump'); 
        this.club.setVisible(false);

        this.showFloatingText('🎉 成功擊退大野狼！', '#4CAF50', 22, this.wolf.x, this.wolf.y - 50);
        this.tweens.add({ targets: this.wolf, alpha: 0, y: this.wolf.y - 50, duration: 1500, delay: 1000, onComplete: () => this.wolf.destroy() });

        runTransaction(db, async (t) => {
            const snap = await t.get(myFarmRef);
            const farm = snap.data().farm;
            const usedSpace = (farm.inventoryEggs || 0) + (farm.worms || 0) + (farm.earthworms || 0) + (farm.wolfFangs || 0);
            if (usedSpace < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.wolfFangs": (farm.wolfFangs || 0) + 1 });
                return true; 
            } else { return false; }
        }).then((success) => {
            if (success) { this.time.delayedCall(1000, () => this.showFloatingText('獲得 狼牙 +1 🦷', '#FFF', 20, this.cameras.main.centerX, this.cameras.main.centerY)); }
            else { this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了裝不下狼牙...', '#F44336', 16, this.cameras.main.centerX, this.cameras.main.centerY)); }
        }).catch(e => console.error(e));
    }

    wolfEscapes() {
        this.showFloatingText('大野狼偷走了一顆蛋逃跑了！', '#F44336', 18, this.wolf.x, this.wolf.y - 30);
        this.tweens.add({ targets: this.wolf, alpha: 0, x: this.wolf.x + 100, duration: 1000, onComplete: () => this.wolf.destroy() });

        runTransaction(db, async (t) => {
            const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
            const targetDoc = await t.get(targetRef);
            const targetFarm = targetDoc.data().farm;
            if (targetFarm && targetFarm.eggsReady > 0) {
                t.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
            }
        }).catch(e => console.error(e));
    }

    // --- Firebase 與多隻母雞同步 ---
    initFirebase() {
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        this.unsubscribeTarget = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.coopEgg.setVisible(this.targetFarmData.eggsReady > 0);
                this.syncTargetHens(); // 同步鄰居的母雞群
            }
        });

        this.unsubscribeMyFarm = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.myFarmData = docSnap.data().farm;
            }
        });
    }

    syncTargetHens() {
        if (!this.targetFarmData) return;
        const henCount = this.targetFarmData.hens || 1;
        const coopLevel = this.targetFarmData.coopLevel || 1;

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
                this.tweens.add({ targets: newHen, y: newHen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
                this.attemptSteal(); 
            });

            this.hensGroup.push(newHen);
            this.wanderSingleHen(newHen);
        }
    }

    wanderSingleHen(henSprite) {
        if (!henSprite || !henSprite.active) return;
        const targetX = Phaser.Math.Between(50, 340);
        const targetY = Phaser.Math.Between(120, 450); 
        henSprite.setFlipX(targetX < henSprite.x);
        const distance = Phaser.Math.Distance.Between(henSprite.x, henSprite.y, targetX, targetY);
        
        henSprite.walkTween = this.tweens.add({
            targets: henSprite, x: targetX, y: targetY, duration: distance * 20, ease: 'Linear',
            onComplete: () => { this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => this.wanderSingleHen(henSprite)); }
        });
        henSprite.waddleTween = this.tweens.add({ targets: henSprite, y: '-=6', duration: 150, yoyo: true, repeat: Math.floor((distance * 20) / 300) });
    }

    async searchCabbage(cabSprite) {
        if (!this.myFarmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0);
        const limit = this.myFarmData.warehouseLimit || 10;
        const rand = Phaser.Math.Between(1, 500);
        let foundType = null, icon = null;
        
        if (rand === 1) { foundType = 'earthworms'; icon = '蚯蚓'; }
        else if (rand >= 2 && rand <= 6) { foundType = 'worms'; icon = '菜蟲'; }
        else return;

        if (usedSpace >= limit) { this.showFloatingText('我的倉庫滿了！', '#F44336', 16, cabSprite.x, cabSprite.y); return; }

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
            });
            this.showFloatingText(`+1 ${icon}`, '#A5D6A7', 16, cabSprite.x, cabSprite.y);
        } catch (e) { console.error(e); }
    }

    async attemptSteal() {
        if (this.isStealing || !this.myFarmData) return;
        const safeX = this.cameras.main.centerX, safeY = this.cameras.main.centerY - 60;
        
        if (this.myFarmData.lastStealTime && Date.now() - this.myFarmData.lastStealTime < STEAL_COOLDOWN_MS) {
            const leftMins = Math.ceil((STEAL_COOLDOWN_MS - (Date.now() - this.myFarmData.lastStealTime)) / 60000);
            this.showFloatingText(`還在被警察追！請等 ${leftMins} 分鐘`, '#F44336', 15, safeX, safeY); return;
        }

        if (!this.targetFarmData || this.targetFarmData.eggsReady <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickCount >= 5) {
                this.showFloatingText('沒蛋啦還一直點~咕咕💢', '#F44336', 16, safeX, safeY); 
                this.hensGroup.forEach(h => {
                    h.setTint(0xff0000); 
                    this.time.delayedCall(500, () => h.clearTint());
                    this.tweens.add({ targets: h, y: h.y - 25, duration: 100, yoyo: true, repeat: 1 });
                });
                this.emptyClickCount = 0;
            } else { this.showFloatingText('人家現在沒蛋啦！', '#ffffff', 18, safeX, safeY); }
            return;
        }

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0);
        if (usedSpace >= (this.myFarmData.warehouseLimit || 10)) {
            this.showFloatingText('你的倉庫滿了，偷不了！', '#F44336', 15, safeX, safeY); return;
        }

        this.emptyClickCount = 0;
        this.isStealing = true;
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);

        try {
            await runTransaction(db, async (t) => {
                const targetDoc = await t.get(targetRef);
                const targetFarm = targetDoc.data().farm;
                const myDoc = await t.get(myFarmRef);
                const myCurrentFarm = myDoc.data().farm;

                if (!targetFarm || targetFarm.eggsReady <= 0) throw "手腳太慢，蛋不見了！";
                if (Math.random() > STEAL_SUCCESS_RATE) {
                    t.update(myFarmRef, { "farm.lastStealTime": Date.now() });
                    throw "被狗咬了！偷竊失敗！";
                }

                t.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
                t.update(myFarmRef, { "farm.inventoryEggs": (myCurrentFarm.inventoryEggs || 0) + 1, "farm.lastStealTime": Date.now() });
            });
            this.showFloatingText('🕵️ 偷到 +1 🥚', '#FFD54F', 18, safeX, safeY);
        } catch (error) {
            this.showFloatingText(`❌ ${error}`, '#F44336', 16, safeX, safeY);
            this.cameras.main.shake(300, 0.01);
        } finally { this.isStealing = false; }
    }

    showFloatingText(msg, color, fontSize = 22, x, y) {
        const floatTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
    showNoticeText(msg, color, fontSize, x, y) {
        if (this.noticeTxt) this.noticeTxt.destroy();
        this.noticeTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 2, backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 8, y: 8 } }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: this.noticeTxt, alpha: 0, duration: 3500, delay: 2000, onComplete: () => { if(this.noticeTxt) this.noticeTxt.destroy(); } });
    }
}
