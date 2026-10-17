import { db } from '../firebase-config.js';
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef } from './constants.js';

export default class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5);

        // UI Header - 金幣、髒亂值與道德值
        this.add.rectangle(300, 50, 150, 75, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.coinText = this.add.text(240, 22, '💰 0', { fontSize: '13px', color: '#FFD54F', fontStyle: 'bold' }).setDepth(31);
        this.cleanText = this.add.text(240, 40, '🗑️ 0/100', { fontSize: '13px', color: '#FFFFFF', fontStyle: 'bold' }).setDepth(31);
        this.moralText = this.add.text(240, 58, '😇 道德: 100', { fontSize: '13px', color: '#81D4FA', fontStyle: 'bold' }).setDepth(31);

        // 🧹 自己打掃雞舍按鈕
        const btnClean = this.add.rectangle(60, 110, 90, 36, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(30);
        this.add.text(60, 110, '🧹 打掃', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
        btnClean.on('pointerdown', () => this.cleanMyFarm());

        this.hensSprites = [];
        this.rubbishGroup = this.add.group();

        this.createConfirmDialog();
        this.initGlobalData();

        this.events.on('shutdown', () => {
            this.registry.events.off('changedata-myFarmData', this.onFarmDataChanged, this);
            if (this.cleanFlashTween) this.cleanFlashTween.stop();
        });
    }

    initGlobalData() {
        const farmData = this.registry.get('myFarmData');
        if (farmData) this.onFarmDataChanged(null, farmData);
        this.registry.events.on('changedata-myFarmData', this.onFarmDataChanged, this);
    }

    onFarmDataChanged(parent, farmData) {
        if (!farmData) return;
        this.farmData = farmData;

        // 1. UI 數值更新
        const cleanVal = farmData.cleanliness || 0;
        const moralVal = farmData.moral !== undefined ? farmData.moral : 100;

        this.coinText.setText(`💰 ${farmData.coins || 0}`);
        this.cleanText.setText(`🗑️ ${cleanVal}/100`);
        this.moralText.setText(`😇 道德: ${moralVal}`);

        if (this.cleanFlashTween) this.cleanFlashTween.stop();
        if (cleanVal <= 50) {
            this.cleanText.setColor('#FFFFFF').setAlpha(1);
        } else if (cleanVal <= 80) {
            this.cleanText.setColor('#FFB74D').setAlpha(1);
        } else {
            this.cleanText.setColor('#E53935');
            this.cleanFlashTween = this.tweens.add({ targets: this.cleanText, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
        }

        // 2. 髒亂垃圾繪製
        this.rubbishGroup.clear(true, true);
        if (cleanVal > 50) {
            const count = Math.min(12, Math.floor((cleanVal - 50) / 4) + 2);
            for (let i = 0; i < count; i++) {
                let rx = Phaser.Math.Between(40, 350);
                let ry = Phaser.Math.Between(220, 500);
                this.rubbishGroup.add(this.add.image(rx, ry, 'rubbish').setDepth(2));
            }
        }

        this.syncHens(farmData);
    }

    async cleanMyFarm() {
        if (!this.farmData || (this.farmData.cleanliness || 0) === 0) {
            this.showMsg('雞舍已經非常乾淨囉！', '#FFFFFF');
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                t.update(myFarmRef, { "farm.cleanliness": 0 });
            });
            this.showMsg('✨ 打掃完成！雞舍煥然一新！', '#4CAF50');
        } catch (e) { console.error(e); }
    }

    syncHens(farmData) {
        const hensState = farmData.hensState || [];
        const henCount = farmData.hens || 1;
        const now = Date.now();

        let needsDeadCleanup = false;
        const validHensState = hensState.filter(h => {
            if (h.isSick && h.sickTimestamp && (now - h.sickTimestamp > 48 * 3600 * 1000)) {
                needsDeadCleanup = true;
                return false; 
            }
            return true;
        });

        if (needsDeadCleanup) {
            this.cleanupDeadHens(validHensState);
            return;
        }

        this.hensSprites.forEach(s => {
            if (s.statusIcon) s.statusIcon.destroy();
            s.destroy();
        });
        this.hensSprites = [];

        for (let i = 0; i < henCount; i++) {
            const hState = hensState[i] || { isSick: false };
            const cx = this.cameras.main.centerX + Phaser.Math.Between(-40, 40);
            const cy = this.cameras.main.centerY - 30 + Phaser.Math.Between(-20, 20);

            let henSprite = this.add.image(cx, cy, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' });
            henSprite.henIndex = i;
            henSprite.hState = hState;

            if (hState.isSick) {
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                
                let icon = this.add.image(cx, cy - 25, iconKey).setDepth(11);
                this.tweens.add({ targets: icon, y: cy - 28, duration: 600, yoyo: true, repeat: -1 });
                henSprite.statusIcon = icon;

                henSprite.on('pointerdown', () => this.askTreatment(i));
            }

            this.hensSprites.push(henSprite);
        }
    }

    async cleanupDeadHens(newHensState) {
        try {
            await runTransaction(db, async (t) => {
                t.update(myFarmRef, { 
                    "farm.hens": Math.max(0, newHensState.length),
                    "farm.hensState": newHensState 
                });
            });
            this.showMsg('💔 有母雞生病太久不幸離世了...', '#F44336');
        } catch (e) { console.error(e); }
    }

    askTreatment(henIndex) {
        const meds = this.farmData.medicines || 0;
        if (meds < 1) {
            this.showMsg('倉庫沒有 [咕咕活力散]，請先去商店購買！', '#F44336');
            return;
        }
        this.selectedHenIndex = henIndex;
        this.dialogText.setText(`確定消耗 1 包 [咕咕活力散]\n治療這隻母雞嗎？`);
        this.dialogContainer.setVisible(true);
    }

    async treatHen(henIndex) {
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.medicines || 0) < 1) throw "藥包不足！";
                
                let states = farm.hensState || [];
                if (states[henIndex]) {
                    states[henIndex].isSick = false;
                    delete states[henIndex].sickTimestamp;
                }

                t.update(myFarmRef, { 
                    "farm.medicines": farm.medicines - 1,
                    "farm.hensState": states
                });
            });
            this.showMsg('✨ 治療成功！母雞恢復健康了！', '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "治療失敗", '#F44336'); }
    }

    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); 
        const bg = this.add.rectangle(195, 422, 300, 150, 0xffffff, 1).setOrigin(0.5);
        this.dialogText = this.add.text(195, 380, '', { fontSize: '16px', color: '#000', fontStyle: 'bold', align:'center' }).setOrigin(0.5);
        
        const btnYes = this.add.rectangle(120, 460, 100, 40, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(120, 460, '確認', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnNo = this.add.rectangle(270, 460, 100, 40, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(270, 460, '取消', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        btnNo.on('pointerdown', () => this.dialogContainer.setVisible(false));
        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.selectedHenIndex !== undefined) this.treatHen(this.selectedHenIndex);
        });
        this.dialogContainer.add([overlay, bg, this.dialogText, btnYes, btnNo]);
    }

    showMsg(msg, color) {
        const txt = this.add.text(195, 680, msg, { fontSize: '16px', fontStyle: 'bold', fill: color, stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(90);
        this.tweens.add({ targets: txt, alpha: 0, duration: 2000, delay: 1000, onComplete: () => txt.destroy() });
    }
}
