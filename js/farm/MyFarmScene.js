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
        
        // 🏠 雞舍可點擊互動，點擊後觸發打掃流程
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.coop.on('pointerdown', () => this.askCleanMyFarm());

        this.coopEgg = this.add.image(cx, cy - 140, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        // 多隻母雞管理陣列與環境垃圾群組
        this.hensGroup = []; 
        this.rubbishGroup = this.add.group();

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

        // 🎯 上方功能選單按鈕
        this.createMinBtn(55, 40, '🏠 村落', 0x1976D2, () => this.scene.start('LobbyScene'));
        this.createMinBtn(145, 40, '🛒 商店', 0x8E24AA, () => this.scene.start('ShopScene'));
        this.createMinBtn(235, 40, '🎒 倉庫', 0xE65100, () => this.scene.start('WarehouseScene'));

        // 📊 右上角 UI 狀態欄 (僅顯示金幣與髒亂值)
        this.add.rectangle(335, 40, 95, 48, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.coinsText = this.add.text(295, 24, '💰 0', { fontSize: '12px', color: '#FFD54F', fontStyle: 'bold' }).setDepth(31);
        this.cleanText = this.add.text(295, 42, '🗑️ 0/100', { fontSize: '12px', color: '#FFFFFF', fontStyle: 'bold' }).setDepth(31);

        // ⏱️ 生蛋計時器看板
        this.timerBg = this.add.rectangle(cx, 90, 200, 26, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '連線中...', { fontSize: '13px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        // 建立通用對話框 (預設隱藏且完全收納於 Container 內)
        this.createConfirmDialog();
        
        // 綁定連線與對話監聽
        this.initFirebase();
        this.time.addEvent({ delay: 30000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });

        this.events.on('shutdown', () => {
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
            if (this.cleanFlashTween) this.cleanFlashTween.stop();
            this.hensGroup.forEach(hen => {
                if (hen.statusIcon) hen.statusIcon.destroy();
                if (hen.walkTween) hen.walkTween.stop();
                if (hen.waddleTween) hen.waddleTween.stop();
            });
        });
    }

    createMinBtn(x, y, label, color, callback) {
        const btn = this.add.rectangle(x, y, 80, 36, color, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(x, y, label, { fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btn.on('pointerdown', callback);
        return btn;
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            // 🛡️ 防禦修正 1：嚴格驗證文件與 farm 物件，只有在【文件完全不存在】時才進行初始化
            if (!docSnap.exists()) {
                setDoc(myFarmRef, { 
                    farm: { 
                        coins: 0, inventoryEggs: 0, hens: 1, coopLevel: 1, eggsReady: 0, 
                        lastLayTime: Date.now(), warehouseLimit: 10, worms: 0, earthworms: 0, 
                        wolfFangs: 0, tigerPelts: 0, medicines: 0, cleanliness: 0, moral: 100,
                        hensState: [{ isSick: false }] 
                    } 
                }, { merge: true });
                return;
            }

            const rawData = docSnap.data();
            if (!rawData || !rawData.farm) {
                console.warn("⚠️ Farm 欄位未即時載入，等待快取或同步，暫不重置資料庫！");
                return; // 防護：不要直接重置整個資料庫，避免快取延遲時誤刪！
            }

            this.farmData = rawData.farm;

            // 🛡️ 防禦修正 2：安全補齊缺漏欄位（以原本的進度為底，絕不歸零）
            const safeHens = Math.max(1, this.farmData.hens || 1);
            this.farmData.hens = safeHens;
            this.farmData.coins = this.farmData.coins !== undefined ? this.farmData.coins : 0;
            this.farmData.cleanliness = this.farmData.cleanliness !== undefined ? this.farmData.cleanliness : 0;
            this.farmData.warehouseLimit = this.farmData.warehouseLimit || 10;
            this.farmData.coopLevel = this.farmData.coopLevel || 1;
            
            if (!Array.isArray(this.farmData.hensState) || this.farmData.hensState.length === 0) {
                this.farmData.hensState = Array.from({ length: safeHens }, () => ({ isSick: false }));
            } else if (this.farmData.hensState.length < safeHens) {
                // 補足缺少狀態的母雞
                while (this.farmData.hensState.length < safeHens) {
                    this.farmData.hensState.push({ isSick: false });
                }
            }

            this.updateUI();
            this.renderCleanlinessVisual();
            this.syncHens(); 
            this.startEggTimer(); 
        });
    }

    updateUI() {
        if (!this.farmData) return;
        this.coinsText.setText(`💰 ${this.farmData.coins || 0}`);
        this.coopEgg.setVisible((this.farmData.eggsReady || 0) > 0);

        const cleanVal = this.farmData.cleanliness || 0;
        this.cleanText.setText(`🗑️ ${cleanVal}/100`);

        // 髒亂警示顏色
        if (this.cleanFlashTween) this.cleanFlashTween.stop();
        if (cleanVal <= 50) {
            this.cleanText.setColor('#FFFFFF').setAlpha(1);
        } else if (cleanVal <= 80) {
            this.cleanText.setColor('#FFB74D').setAlpha(1);
        } else {
            this.cleanText.setColor('#E53935');
            this.cleanFlashTween = this.tweens.add({ targets: this.cleanText, alpha: 0.3, duration: 400, yoyo: true, repeat: -1 });
        }
    }

    renderCleanlinessVisual() {
        this.rubbishGroup.clear(true, true);
        const cleanVal = this.farmData ? (this.farmData.cleanliness || 0) : 0;
        if (cleanVal > 50) {
            const count = Math.min(12, Math.floor((cleanVal - 50) / 4) + 2);
            for (let i = 0; i < count; i++) {
                let rx = Phaser.Math.Between(40, 350);
                let ry = Phaser.Math.Between(220, 500);
                this.rubbishGroup.add(this.add.image(rx, ry, 'rubbish').setDepth(2));
            }
        }
    }

    askCleanMyFarm() {
        if (!this.farmData || (this.farmData.cleanliness || 0) === 0) {
            this.showFloatingText('雞舍非常乾淨，不需要打掃～', '#FFFFFF', 16);
            return;
        }

        this.dialogActionType = 'clean';
        this.dialogText.setText(`雞舍目前的髒亂值為 ${this.farmData.cleanliness}\n是否要開始幫忙打掃？`);
        this.dialogContainer.setVisible(true);
    }

    async cleanMyFarm() {
        try {
            await runTransaction(db, async (t) => {
                t.update(myFarmRef, { "farm.cleanliness": 0 });
            });
            this.showFloatingText('✨ 打掃完成！雞舍煥然一新！', '#4CAF50', 18);
        } catch (e) { console.error(e); }
    }

    syncHens() {
        if (!this.farmData) return;
        const henCount = Math.max(1, this.farmData.hens || 1);
        const coopLevel = this.farmData.coopLevel || 1;
        const hensState = Array.isArray(this.farmData.hensState) ? this.farmData.hensState : [];
        const now = Date.now();

        if (coopLevel === 1) this.coop.setScale(1);
        else if (coopLevel === 2) this.coop.setScale(1.2);
        else if (coopLevel === 3) this.coop.setScale(1.5);

        // 病逝判定 (>48小時)
        let needsDeadCleanup = false;
        const validHensState = hensState.filter(h => {
            if (h && h.isSick && h.sickTimestamp && (now - h.sickTimestamp > 48 * 3600 * 1000)) {
                needsDeadCleanup = true;
                return false; 
            }
            return true;
        });

        if (needsDeadCleanup) {
            this.cleanupDeadHens(validHensState);
            return;
        }

        this.hensGroup.forEach(hen => {
            if (hen.statusIcon) hen.statusIcon.destroy();
            hen.destroy();
        });
        this.hensGroup = [];

        for (let i = 0; i < henCount; i++) {
            const hState = hensState[i] || { isSick: false };
            let newHen = this.add.image(
                this.cameras.main.centerX + Phaser.Math.Between(-30, 30), 
                this.cameras.main.centerY - 30 + Phaser.Math.Between(-20, 20), 
                'hen'
            ).setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' });
            
            newHen.henIndex = i;
            newHen.hState = hState;

            if (hState.isSick) {
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                
                let icon = this.add.image(newHen.x, newHen.y - 25, iconKey).setDepth(11);
                this.tweens.add({ targets: icon, y: newHen.y - 28, duration: 600, yoyo: true, repeat: -1 });
                newHen.statusIcon = icon;

                newHen.on('pointerdown', () => this.askTreatment(i));
            } else {
                newHen.on('pointerdown', () => {
                    if (!this.isHenSitting && this.emptyClickCount < 4) {
                        this.tweens.add({ targets: newHen, y: newHen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
                    }
                    this.harvestEgg();
                });
            }

            this.hensGroup.push(newHen);
            this.wanderSingleHen(newHen);
        }
    }

    // 🛡️ 防禦修正 3：防止清理死雞時將母雞數量扣到 0 或造成資料歸零
    async cleanupDeadHens(newHensState) {
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                if (!snap.exists() || !snap.data().farm) return;
                
                const safeCount = Math.max(1, newHensState.length); // 至少保留 1 隻
                t.update(myFarmRef, { 
                    "farm.hens": safeCount,
                    "farm.hensState": newHensState 
                });
            });
            this.showFloatingText('💔 有母雞生病太久不幸離世了...', '#F44336', 16);
        } catch (e) { console.error(e); }
    }

    askTreatment(henIndex) {
        const meds = this.farmData.medicines || 0;
        if (meds < 1) {
            this.showFloatingText('倉庫沒有 [咕咕活力散]，請先去商店購買！', '#F44336', 15);
            return;
        }
        this.dialogActionType = 'treat';
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
                
                let states = Array.isArray(farm.hensState) ? farm.hensState : [];
                if (states[henIndex]) {
                    states[henIndex].isSick = false;
                    delete states[henIndex].sickTimestamp;
                }

                t.update(myFarmRef, { 
                    "farm.medicines": farm.medicines - 1,
                    "farm.hensState": states
                });
            });
            this.showFloatingText('✨ 治療成功！母雞恢復健康了！', '#4CAF50', 18);
        } catch (e) { this.showFloatingText(typeof e === 'string' ? e : "治療失敗", '#F44336', 16); }
    }

    wanderSingleHen(henSprite) {
        if (this.isHenSitting || !henSprite || !henSprite.active || (henSprite.hState && henSprite.hState.isSick)) return;
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

    // ⏱️ 生蛋計時器與生產演算
    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;
            const now = Date.now();
            let eggsReady = this.farmData.eggsReady || 0;
            let lastLayTime = this.farmData.lastLayTime || now;
            let cleanliness = this.farmData.cleanliness || 0;
            let hensState = Array.isArray(this.farmData.hensState) ? this.farmData.hensState : [];
            let changed = false;

            const totalHens = Math.max(1, this.farmData.hens || 1);
            const healthyHens = hensState.filter(h => !h.isSick).length;
            const activeHens = Math.max(1, healthyHens > 0 ? healthyHens : totalHens);

            const currentLayIntervalMs = Math.floor(LAY_EGG_TIME_MS / activeHens);
            const maxEggs = totalHens * 6; 

            while (now - lastLayTime >= currentLayIntervalMs && eggsReady < maxEggs) {
                eggsReady++;
                lastLayTime += currentLayIntervalMs;
                cleanliness = Math.min(100, cleanliness + 2);
                
                let sickProb = 0;
                if (cleanliness > 80) sickProb = 0.5;
                else if (cleanliness > 50) sickProb = 0.2;

                if (sickProb > 0) {
                    for (let i = 0; i < totalHens; i++) {
                        if (!hensState[i]) hensState[i] = { isSick: false };
                        if (!hensState[i].isSick && Math.random() < sickProb) {
                            hensState[i].isSick = true;
                            hensState[i].sickTimestamp = now;
                        }
                    }
                }
                changed = true;
            }

            if (eggsReady >= maxEggs && (now - lastLayTime > 0)) {
                lastLayTime = now;
                changed = true;
            }

            // 🛡️ 防禦修正 4：避免頻繁直寫數據，採用安全獨立欄位 updateDoc
            if (changed) {
                updateDoc(myFarmRef, { 
                    "farm.eggsReady": eggsReady, 
                    "farm.lastLayTime": lastLayTime,
                    "farm.cleanliness": cleanliness,
                    "farm.hensState": hensState
                }).catch(e => console.error("生蛋計時更新失敗:", e));
            }

            if (eggsReady >= maxEggs) {
                this.timerText.setText(`📦 產能已滿 (${maxEggs}/${maxEggs})`).setColor('#A5D6A7');
            } else {
                let timeLeft = currentLayIntervalMs - (now - lastLayTime);
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

        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0) + (this.farmData.tigerPelts || 0) + (this.farmData.medicines || 0);
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
                if (!snap.exists() || !snap.data().farm) return;
                const farm = snap.data().farm;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
            });
            this.showFloatingText(`+1 ${icon}`, '#A5D6A7', 16, cabSprite.x, cabSprite.y);
        } catch (e) { console.error(e); }
    }

    async harvestEgg() {
        if (this.isHarvesting) return; 

        if (!this.farmData || (this.farmData.eggsReady || 0) <= 0) {
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
        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0) + (this.farmData.tigerPelts || 0) + (this.farmData.medicines || 0);
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
                if (!docSnap.exists() || !docSnap.data().farm) return;
                const farm = docSnap.data().farm;
                if ((farm.eggsReady || 0) > 0) {
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

    // 🔒 確認對話框
    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); 
        const bg = this.add.rectangle(195, 422, 300, 150, 0xffffff, 1).setOrigin(0.5);
        this.dialogText = this.add.text(195, 380, '', { fontSize: '15px', color: '#000', fontStyle: 'bold', align:'center' }).setOrigin(0.5);
        
        const btnYes = this.add.rectangle(130, 450, 90, 36, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        const textYes = this.add.text(130, 450, '是', { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnNo = this.add.rectangle(260, 450, 90, 36, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        const textNo = this.add.text(260, 450, '否', { fontSize: '15px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        btnNo.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            this.dialogActionType = null;
        });

        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.dialogActionType === 'treat' && this.selectedHenIndex !== undefined) {
                this.treatHen(this.selectedHenIndex);
            } else if (this.dialogActionType === 'clean') {
                this.cleanMyFarm();
            }
            this.dialogActionType = null;
        });

        this.dialogContainer.add([overlay, bg, this.dialogText, btnYes, textYes, btnNo, textNo]);
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
