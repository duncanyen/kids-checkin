import { db } from '../firebase-config.js';
import { doc, onSnapshot, runTransaction, getDoc, addDoc, collection, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CURRENT_GROUP_ID, myFarmRef, STEAL_COOLDOWN_MS, playerName } from './constants.js';

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

        this.hensGroup = []; 
        this.rubbishGroup = this.add.group();

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

        // 🧹 幫鄰居打掃按鈕
        const btnHelper = this.add.rectangle(335, 50, 80, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(30);
        this.add.text(335, 50, '🧹 幫打掃', { fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
        btnHelper.on('pointerdown', () => this.cleanTargetFarm());

        this.initFirebase();

        if (Phaser.Math.Between(1, 30) === 1) {
            this.spawnTigerEvent();
        } else if (Phaser.Math.Between(1, 10) === 1) {
            this.spawnWolfEvent();
        }

        this.events.on('shutdown', () => { 
            if (this.unsubscribeTarget) this.unsubscribeTarget(); 
            this.registry.events.off('changedata-myFarmData', this.onMyFarmDataChanged, this);
            this.hensGroup.forEach(h => {
                if (h.statusIcon) h.statusIcon.destroy();
                if (h.walkTween) h.walkTween.stop();
                if (h.waddleTween) h.waddleTween.stop();
            });
        });
    }

    initFirebase() {
        this.myFarmData = this.registry.get('myFarmData');
        this.registry.events.on('changedata-myFarmData', this.onMyFarmDataChanged, this);

        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        this.unsubscribeTarget = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.coopEgg.setVisible(this.targetFarmData.eggsReady > 0);
                this.syncTargetHens(); 
                this.renderTargetCleanliness();
            }
        });
    }

    onMyFarmDataChanged(parent, value) { this.myFarmData = value; }

    async cleanTargetFarm() {
        if (!this.targetFarmData || (this.targetFarmData.cleanliness || 0) === 0) {
            this.showFloatingText('鄰居家已經很乾淨囉！', '#FFFFFF', 16, this.cameras.main.centerX, 150);
            return;
        }

        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        try {
            await runTransaction(db, async (t) => {
                const targetDoc = await t.get(targetRef);
                const targetClean = targetDoc.data().farm.cleanliness || 0;
                const newClean = Math.max(0, targetClean - 30);

                const myDoc = await t.get(myFarmRef);
                const myMoral = myDoc.data().farm.moral !== undefined ? myDoc.data().farm.moral : 100;
                const newMoral = Math.min(100, myMoral + 3);

                t.update(targetRef, { "farm.cleanliness": newClean });
                t.update(myFarmRef, { "farm.moral": newMoral });
            });

            this.showFloatingText('🧹 幫忙打掃完成！道德值 +3 😇', '#81D4FA', 18, this.cameras.main.centerX, 150);
            this.sendSystemNotification(`${playerName}幫${this.targetName}打掃了雞舍`);
        } catch (e) { console.error(e); }
    }

    renderTargetCleanliness() {
        this.rubbishGroup.clear(true, true);
        const cleanVal = this.targetFarmData.cleanliness || 0;
        if (cleanVal > 50) {
            const count = Math.min(12, Math.floor((cleanVal - 50) / 4) + 2);
            for (let i = 0; i < count; i++) {
                let rx = Phaser.Math.Between(40, 350);
                let ry = Phaser.Math.Between(220, 500);
                this.rubbishGroup.add(this.add.image(rx, ry, 'rubbish').setDepth(2));
            }
        }
    }

    syncTargetHens() {
        if (!this.targetFarmData) return;
        const henCount = this.targetFarmData.hens || 1;
        const hensState = this.targetFarmData.hensState || [];
        const now = Date.now();

        this.hensGroup.forEach(h => { if(h.statusIcon) h.statusIcon.destroy(); h.destroy(); });
        this.hensGroup = [];

        for (let i = 0; i < henCount; i++) {
            let cx = this.cameras.main.centerX + Phaser.Math.Between(-30, 30);
            let cy = this.cameras.main.centerY - 30 + Phaser.Math.Between(-20, 20);
            let newHen = this.add.image(cx, cy, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' });

            const hState = hensState[i] || {};
            if (hState.isSick) {
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                let icon = this.add.image(cx, cy - 25, iconKey).setDepth(11);
                this.tweens.add({ targets: icon, y: cy - 28, duration: 600, yoyo: true, repeat: -1 });
                newHen.statusIcon = icon;
            }

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

    async sendSystemNotification(messageContent) {
        try {
            const configDoc = await getDoc(doc(db, "settings", "gameConfig"));
            if (configDoc.exists() && configDoc.data().targetRoomId) {
                const targetRoomId = configDoc.data().targetRoomId;
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                const finalText = `${messageContent}\n🕒 ${timeStr}`;

                await addDoc(collection(db, "messages"), { 
                    roomId: targetRoomId, sender: "莊園廣播", text: finalText, time: timeStr,
                    timestamp: serverTimestamp(), isSystem: true 
                });
                await updateDoc(doc(db, "rooms", targetRoomId), { 
                    lastMessage: `莊園廣播: ${messageContent}`, lastMessageTime: serverTimestamp() 
                });
            }
        } catch (e) { console.error("發送廣播失敗:", e); }
    }

    // --- 野狼與老虎事件邏輯維持不變 ---
    spawnTigerEvent() {
        this.isTigerDefeated = false; this.tigerHitCount = 0;
        this.tiger = this.add.image(-20, this.cameras.main.height - 50, 'tiger').setOrigin(0.5).setScale(1.6).setDepth(25).setInteractive({ cursor: 'pointer' });
        this.club = this.add.image(0, 0, 'club').setOrigin(0.5).setScale(1.5).setDepth(30).setVisible(false);
        const warnText = this.add.text(this.cameras.main.centerX, 120, '🚨 危機：猛虎出閘！\n快用木棒打退牠 (點擊200下)', { fontSize: '18px', color: '#FF9800', fontStyle: 'bold', align: 'center', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(30);
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 400 });

        this.tigerTween = this.tweens.add({
            targets: this.tiger, x: this.coop.x, y: this.coop.y + 40, duration: 50000, ease: 'Linear',
            onComplete: () => { warnText.destroy(); if (!this.isTigerDefeated) this.tigerEscapes(); }
        });

        this.tiger.on('pointerdown', (pointer) => {
            if (this.isTigerDefeated) return;
            this.tigerHitCount++;
            this.tiger.setTint(0xff0000); this.time.delayedCall(50, () => this.tiger.clearTint());
            this.club.setPosition(pointer.x + 15, pointer.y - 15).setVisible(true).setAngle(-45);
            this.tweens.add({ targets: this.club, angle: 45, duration: 50, yoyo: true, onComplete: () => this.club.setVisible(false) });
            if (this.tigerHitCount >= 200) { warnText.destroy(); this.defeatTiger(); }
            else if (this.tigerHitCount % 20 === 0) { this.showFloatingText(`還差 ${200 - this.tigerHitCount} 下!`, '#FF9800', 16, this.tiger.x, this.tiger.y - 50); }
        });
    }

    defeatTiger() {
        this.isTigerDefeated = true; if (this.tigerTween) this.tigerTween.stop();
        this.tiger.setTexture('tiger_bump'); this.club.setVisible(false);
        this.showFloatingText('🏆 成功擊退猛虎！', '#FFC107', 22, this.tiger.x, this.tiger.y - 50);
        this.tweens.add({ targets: this.tiger, alpha: 0, y: this.tiger.y - 50, duration: 1500, delay: 1000, onComplete: () => this.tiger.destroy() });

        runTransaction(db, async (t) => {
            const snap = await t.get(myFarmRef);
            const farm = snap.data().farm;
            const usedSpace = (farm.inventoryEggs || 0) + (farm.worms || 0) + (farm.earthworms || 0) + (farm.wolfFangs || 0) + (farm.tigerPelts || 0) + (farm.medicines || 0);
            if (usedSpace < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.tigerPelts": (farm.tigerPelts || 0) + 1 }); return true; 
            } else return false; 
        }).then((success) => {
            if (success) { 
                this.time.delayedCall(1000, () => this.showFloatingText('獲得 虎皮 +1 🐅', '#FFF', 20, this.cameras.main.centerX, this.cameras.main.centerY)); 
                this.sendSystemNotification(`${playerName}在${this.targetName}家中擊退大老虎`);
            } else { this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了...', '#F44336', 16, this.cameras.main.centerX, this.cameras.main.centerY)); }
        }).catch(e => console.error(e));
    }

    tigerEscapes() {
        this.showFloatingText('猛虎把你身上的蛋吃光，還搶走 5 元！', '#F44336', 16, this.tiger.x, this.tiger.y - 40);
        this.tweens.add({ targets: this.tiger, alpha: 0, x: this.tiger.x + 100, duration: 1000, onComplete: () => this.tiger.destroy() });
        runTransaction(db, async (t) => {
            const snap = await t.get(myFarmRef);
            const farm = snap.data().farm;
            t.update(myFarmRef, { "farm.coins": Math.max(0, (farm.coins || 0) - 5), "farm.inventoryEggs": 0 });
        }).catch(e => console.error(e));
    }

    spawnWolfEvent() {
        this.isWolfDefeated = false; this.wolfHitCount = 0;
        this.wolf = this.add.image(this.cameras.main.centerX + 120, this.cameras.main.centerY + 220, 'wolf').setOrigin(0.5).setScale(1.5).setDepth(25).setInteractive({ cursor: 'pointer' });
        this.club = this.add.image(0, 0, 'club').setOrigin(0.5).setScale(1.5).setDepth(30).setVisible(false);
        const warnText = this.add.text(this.cameras.main.centerX, 120, '⚠️ 警告：大野狼來襲！\n快用木棒打退牠 (點擊200下)', { fontSize: '18px', color: '#F44336', fontStyle: 'bold', align: 'center', stroke: '#fff', strokeThickness: 3 }).setOrigin(0.5).setDepth(30);
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 500 });

        this.wolfTween = this.tweens.add({
            targets: this.wolf, x: this.coop.x, y: this.coop.y + 40, duration: 60000, ease: 'Linear',
            onComplete: () => { warnText.destroy(); if (!this.isWolfDefeated) this.wolfEscapes(); }
        });

        this.wolf.on('pointerdown', (pointer) => {
            if (this.isWolfDefeated) return;
            this.wolfHitCount++;
            this.wolf.setTint(0xff0000); this.time.delayedCall(50, () => this.wolf.clearTint());
            this.club.setPosition(pointer.x + 15, pointer.y - 15).setVisible(true).setAngle(-45);
            this.tweens.add({ targets: this.club, angle: 45, duration: 50, yoyo: true, onComplete: () => this.club.setVisible(false) });
            if (this.wolfHitCount >= 200) { warnText.destroy(); this.defeatWolf(); }
            else if (this.wolfHitCount % 20 === 0) { this.showFloatingText(`還差 ${200 - this.wolfHitCount} 下!`, '#FF9800', 16, this.wolf.x, this.wolf.y - 40); }
        });
    }

    defeatWolf() {
        this.isWolfDefeated = true; if (this.wolfTween) this.wolfTween.stop();
        this.wolf.setTexture('wolf_bump'); this.club.setVisible(false);
        this.showFloatingText('🎉 成功擊退大野狼！', '#4CAF50', 22, this.wolf.x, this.wolf.y - 50);
        this.tweens.add({ targets: this.wolf, alpha: 0, y: this.wolf.y - 50, duration: 1500, delay: 1000, onComplete: () => this.wolf.destroy() });

        runTransaction(db, async (t) => {
            const snap = await t.get(myFarmRef);
            const farm = snap.data().farm;
            const usedSpace = (farm.inventoryEggs || 0) + (farm.worms || 0) + (farm.earthworms || 0) + (farm.wolfFangs || 0) + (farm.tigerPelts || 0) + (farm.medicines || 0);
            if (usedSpace < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.wolfFangs": (farm.wolfFangs || 0) + 1 }); return true; 
            } else return false; 
        }).then((success) => {
            if (success) { 
                this.time.delayedCall(1000, () => this.showFloatingText('獲得 狼牙 +1 🦷', '#FFF', 20, this.cameras.main.centerX, this.cameras.main.centerY)); 
                this.sendSystemNotification(`${playerName}在${this.targetName}家中擊退大野狼`);
            } else { this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了...', '#F44336', 16, this.cameras.main.centerX, this.cameras.main.centerY)); }
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

    async searchCabbage(cabSprite) {
        if (!this.myFarmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0) + (this.myFarmData.tigerPelts || 0) + (this.myFarmData.medicines || 0);
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

    // 偷蛋邏輯：扣 5 點道德值，並依據道德值決定成功率
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

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0) + (this.myFarmData.tigerPelts || 0) + (this.myFarmData.medicines || 0);
        if (usedSpace >= (this.myFarmData.warehouseLimit || 10)) {
            this.showFloatingText('你的倉庫滿了，偷不了！', '#F44336', 15, safeX, safeY); return;
        }

        this.emptyClickCount = 0;
        this.isStealing = true;
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);

        // 依據道德值計算成功率 (低於 50 道德成功率降為 0.4)
        const myMoral = this.myFarmData.moral !== undefined ? this.myFarmData.moral : 100;
        const successRate = myMoral < 50 ? 0.4 : 0.7;

        try {
            await runTransaction(db, async (t) => {
                const targetDoc = await t.get(targetRef);
                const targetFarm = targetDoc.data().farm;
                const myDoc = await t.get(myFarmRef);
                const myCurrentFarm = myDoc.data().farm;

                if (!targetFarm || targetFarm.eggsReady <= 0) throw "手腳太慢，蛋不見了！";
                
                const currentMoral = myCurrentFarm.moral !== undefined ? myCurrentFarm.moral : 100;
                const newMoral = Math.max(0, currentMoral - 5); // 偷蛋扣 5 道德

                if (Math.random() > successRate) {
                    t.update(myFarmRef, { "farm.lastStealTime": Date.now(), "farm.moral": newMoral });
                    throw "被狗咬了！偷竊失敗！";
                }

                t.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
                t.update(myFarmRef, { 
                    "farm.inventoryEggs": (myCurrentFarm.inventoryEggs || 0) + 1, 
                    "farm.lastStealTime": Date.now(),
                    "farm.moral": newMoral
                });
            });
            this.showFloatingText('🕵️ 偷到 +1 🥚 (道德 -5)', '#FFD54F', 18, safeX, safeY);
            this.sendSystemNotification(`${playerName}偷了${this.targetName}蛋`);

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
