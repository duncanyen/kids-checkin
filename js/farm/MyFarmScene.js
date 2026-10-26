import { watchFarm } from '../live-reads.js';
import { BREEDS, poultryState, settlePoultry, poultryPatch, productionChanged, nextEggStatus, collectPoultry } from './poultry.js';
import { addPoultrySprite, poultryAnim } from './poultry-art.js';
import { GardenFeedback } from './garden-feedback.js';
import { GARDEN_ROLL_SIZE, gardenFindForRoll } from './garden-core.js';
import { attachFarmAtmosphere } from './atmosphere.js';
import { GorillaEncounter } from './gorilla.js';
import { rollHomeBossEncounter } from './gorilla-rules.js';
import { DragonEncounter } from './dragon.js';
import { getThreatZones, henRouteIsSafe, planHenPath } from './hen-navigation.js';
import { addFarmBackground, addFarmCoop, addFarmSign, farmEggPosition, addVegetableGarden, setCoopSize, randomHenPosition, getHenWalkArea, getHenWanderArea } from './scenery.js';
import { db } from '../firebase-config.js';
import { setDoc, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, CURRENT_GROUP_ID, playerName, getUsedSpace } from './constants.js';

export default class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        const cx = this.cameras.main.centerX; 
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.isHarvesting = false;
        this.dragonEncounter = null;
        this.dragon = null;
        this.gorillaEncounter = null;
        this.gorilla = null;
        this.nextHenAvoidanceAt = 0;

        document.getElementById('playerName').innerText = playerName;

        addFarmBackground(this, true);
        this.gardenFeedback = new GardenFeedback(this);
        attachFarmAtmosphere(this, { groupId: CURRENT_GROUP_ID });
        
        this.coop = addFarmCoop(this, () => this.askCleanMyFarm());

        const eggPosition = farmEggPosition(this);
        this.coopEgg = this.add.image(eggPosition.x, eggPosition.y, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);
        this.coopEgg.setInteractive({ cursor: 'pointer' }).on('pointerdown', () => this.harvestEgg());

        this.hensGroup = []; 
        this.rubbishGroup = this.add.group();

        addVegetableGarden(this, plant => this.searchCabbage(plant));
        addFarmSign(this, sign => {
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        this.createMinBtn(55, 40, '🏠 村落', 0x1976D2, () => this.scene.start('LobbyScene'));
        this.createMinBtn(145, 40, '🛒 商店', 0x8E24AA, () => this.scene.start('ShopScene'));
        this.createMinBtn(235, 40, '🎒 倉庫', 0xE65100, () => this.scene.start('WarehouseScene'));

        this.add.rectangle(335, 40, 95, 48, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.coinsText = this.add.text(295, 24, '💰 0', { fontSize: '12px', color: '#FFD54F', fontStyle: 'bold' }).setDepth(31);
        this.cleanText = this.add.text(295, 42, '🗑️ 0/100', { fontSize: '12px', color: '#FFFFFF', fontStyle: 'bold' }).setDepth(31);

        this.timerBg = this.add.rectangle(cx, 90, 200, 26, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '連線中...', { fontSize: '13px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        this.createConfirmDialog();
        this.initFirebase();
        this.time.addEvent({ delay: 30000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });

        this.events.once('shutdown', () => {
            this.dragonEncounter?.destroy();
            this.gorillaEncounter?.destroy();
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
            if (this.cleanFlashTween) this.cleanFlashTween.stop();
            this.hensGroup.forEach(hen => {
                hen.walkTimer?.remove();
                if (hen.statusIcon) hen.statusIcon.destroy();
                if (hen.walkTween) hen.walkTween.stop();
            });
        });
    }

    update(time) {
        for (const hen of this.hensGroup || []) {
            if (hen.statusIcon?.active) hen.statusIcon.setPosition(hen.x, hen.y - 26 + Math.sin(time / 200) * 2);
        }
        if (time < this.nextHenAvoidanceAt) return;
        this.nextHenAvoidanceAt = time + 200;
        this.avoidPredators();
    }

    avoidPredators() {
        if (!getThreatZones(this).length) return;
        for (const hen of this.hensGroup || []) {
            if (!hen.active || henRouteIsSafe(this, hen)) continue;
            this.tweens.killTweensOf(hen);
            hen.walkTimer?.remove();
            this.wanderSingleHen(hen, true);
        }
    }

    createMinBtn(x, y, label, color, callback) {
        const btn = this.add.rectangle(x, y, 80, 36, color, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(x, y, label, { fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btn.on('pointerdown', callback);
        return btn;
    }

    initFirebase() {
        this.unsubscribe = watchFarm(myFarmRef, (docSnap) => {
            if (!docSnap.exists()) {
                setDoc(myFarmRef, { 
                    farm: { 
                        coins: 0, inventoryEggs: 0, hens: 1, coopLevel: 1, eggsReady: 0, 
                        lastLayTime: Date.now(), warehouseLimit: 10, worms: 0, earthworms: 0, 
                        wolfFangs: 0, tigerPelts: 0, dragonScales: 0, gorillaFangs: 0, medicines: 0, cleanliness: 0, moral: 100,
                        equippedWeapon: 'club',
                        hensState: [{ isSick: false }] 
                    } 
                }, { merge: true });
                return;
            }

            const rawData = docSnap.data();
            if (!rawData || !rawData.farm) return;

            this.farmData = rawData.farm;
            if (!this.farmData.equippedWeapon) this.farmData.equippedWeapon = 'club';

            this.farmData.hensState = poultryState(this.farmData).hens;
            this.farmData.hens = this.farmData.hensState.length;
            this.farmData.coins ??= 0;
            this.farmData.cleanliness ??= 0;
            this.farmData.warehouseLimit ||= 10;
            this.farmData.coopLevel ||= 1;

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
                const area = getHenWalkArea(this);
                let rx = Phaser.Math.Between(area.left, area.right);
                let ry = Phaser.Math.Between(area.top, area.bottom);
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
        const henCount = poultryState(this.farmData).hens.length;
        const coopLevel = this.farmData.coopLevel || 1;
        const hensState = Array.isArray(this.farmData.hensState) ? this.farmData.hensState : [];
        const now = Date.now();

        setCoopSize(this.coop, coopLevel);

        let needsDeadCleanup = false;
        const validHensState = hensState.filter(h => {
            if (h && h.isSick && h.sickTimestamp && (now - h.sickTimestamp > 48 * 3600 * 1000)) {
                needsDeadCleanup = true; return false; 
            } return true;
        });

        if (needsDeadCleanup) {
            this.cleanupDeadHens(validHensState); return;
        }

        this.isHenSitting = false;
        this.hensGroup.forEach(hen => {
            hen.walkTimer?.remove();
            this.tweens.killTweensOf(hen);
            if (hen.statusIcon) {
                this.tweens.killTweensOf(hen.statusIcon);
                hen.statusIcon.destroy();
            }
            hen.destroy();
        });
        this.hensGroup = [];

        for (let i = 0; i < henCount; i++) {
            const hState = hensState[i] || { isSick: false };
            
            const position = randomHenPosition(this);
            let newHen = addPoultrySprite(this, hState, position.x, position.y);
            newHen.henIndex = i;
            newHen.hState = hState;

            if (hState.isSick) {
                newHen.play(poultryAnim(newHen, 'idle'), true);
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                
                let icon = this.add.image(newHen.x, newHen.y - 25, iconKey).setDepth(11);
                this.tweens.add({ targets: icon, y: newHen.y - 28, duration: 600, yoyo: true, repeat: -1 });
                newHen.statusIcon = icon;

                newHen.on('pointerdown', () => this.askTreatment(i));
            } else {
                newHen.play(poultryAnim(newHen, 'idle'), true);
                newHen.on('pointerdown', () => {
                    if (!this.isHenSitting && this.emptyClickCount < 4) {
                        // 🌟 同步放大點擊時的動畫比例 (原本是 1.1 / 0.9，改成基準值 2 乘上去，也就是 2.2 / 1.8)
                        this.tweens.add({ targets: newHen, y: newHen.y - 15, scaleX: newHen.baseScale * 1.1, scaleY: newHen.baseScale * 0.9, duration: 100, yoyo: true });
                    }
                    this.harvestEgg();
                });
            }

            this.hensGroup.push(newHen);
            this.wanderSingleHen(newHen);
        }
    }

    async cleanupDeadHens(newHensState) {
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                if (!snap.exists() || !snap.data().farm) return;
                t.update(myFarmRef, poultryPatch(settlePoultry(snap.data().farm)));
            });
            this.showFloatingText('💔 有雞隻生病太久不幸離世了...', '#F44336', 16);
        } catch (e) { console.error(e); }
    }

    askTreatment(henIndex) {
        const meds = this.farmData.medicines || 0;
        if (meds < 1) {
            this.showFloatingText('倉庫沒有 [咕咕活力散]，請先去商店購買！', '#F44336', 15); return;
        }
        this.dialogActionType = 'treat';
        this.selectedHenIndex = henIndex;
        this.selectedHenId = this.farmData.hensState[henIndex]?.id;
        this.dialogText.setText(`確定消耗 1 包 [咕咕活力散]\n治療這隻雞嗎？`);
        this.dialogContainer.setVisible(true);
    }

    async treatHen(henIndex) {
        const targetId = this.selectedHenId || this.farmData?.hensState?.[henIndex]?.id;
        const healedAt = Date.now();
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.medicines || 0) < 1) throw "藥包不足！";
                
                const state = settlePoultry(farm);
                const states = state.hens;
                if (targetId) henIndex = states.findIndex(h => h.id === targetId);
                if (!states[henIndex]?.isSick) throw "雞隻已售出或已康復，請重新選擇！";
                if (states[henIndex]) {
                    states[henIndex].isSick = false;
                    states[henIndex].laidAt = healedAt;
                    delete states[henIndex].sickTimestamp;
                }

                t.update(myFarmRef, { ...poultryPatch(state), "farm.medicines": farm.medicines - 1 });
            });
            this.showFloatingText('✨ 治療成功！雞隻恢復健康了！', '#4CAF50', 18);
        } catch (e) { this.showFloatingText(typeof e === 'string' ? e : "治療失敗", '#F44336', 16); }
    }

    wanderSingleHen(henSprite, fleeing = false) {
        if (!henSprite?.active || (this.isHenSitting && !fleeing) || (henSprite.hState?.isSick && !fleeing)) return;
        const route = planHenPath(this, henSprite, getHenWanderArea(this));
        henSprite.walkPath = route.points;
        henSprite.isEvading = route.evading;
        const step = () => {
            if (!henSprite.active) return;
            const target = henSprite.walkPath[0];
            if (!target) {
                henSprite.walkTween = null;
                henSprite.isEvading = false;
                henSprite.play(poultryAnim(henSprite, 'idle'), true);
                henSprite.walkTimer = this.time.delayedCall(
                    getThreatZones(this).length ? 500 : Phaser.Math.Between(1000, 3000),
                    () => this.wanderSingleHen(henSprite));
                return;
            }
            henSprite.setFlipX(target.x < henSprite.x).play(poultryAnim(henSprite, 'walk'), true);
            const distance = Phaser.Math.Distance.Between(henSprite.x, henSprite.y, target.x, target.y);
            henSprite.walkTween = this.tweens.add({
                targets: henSprite, x: target.x, y: target.y,
                duration: Math.max(100, distance * (route.evading ? 7 : 20)), ease: 'Linear',
                onComplete: () => {
                    if (!henSprite.active) return;
                    henSprite.walkPath.shift();
                    step();
                }
            });
        };
        step();
    }

    prepareToLayEgg() {
        if ([this.dragonEncounter, this.gorillaEncounter].some(boss => boss && !boss.result)) return;
        this.isHenSitting = true;
        const nestX = this.coop.x;
        const area = getHenWalkArea(this);
        const nestY = Math.min(area.bottom, area.top + 10);

        this.hensGroup.forEach(hen => {
            if (hen.walkTween) hen.walkTween.stop();
            hen.setFlipX(nestX < hen.x);
            hen.play(poultryAnim(hen, 'walk'), true);

            this.tweens.add({
                targets: hen, x: nestX + Phaser.Math.Between(-20, 20), y: Phaser.Math.Clamp(nestY + Phaser.Math.Between(-8, 8), area.top, area.bottom), duration: 2000, ease: 'Power2',
                onComplete: () => {
                    if (!hen.active) return;
                    hen.play(poultryAnim(hen, 'idle'), true);
                    // 🌟 同步放大生蛋時的壓扁特效 (原本是 0.7 / 1.15，改成 1.4 / 2.3)
                    this.tweens.add({
                        targets: hen, scaleY: hen.baseScale * 0.7, scaleX: hen.baseScale * 1.15, y: hen.y + 10, duration: 300, ease: 'Power2',
                        onComplete: () => {
                            this.time.delayedCall(3000, () => {
                                if (!hen.active) return;
                                // 🌟 恢復時必須恢復成 2 倍大小
                                this.tweens.add({ targets: hen, scaleY: hen.baseScale, scaleX: hen.baseScale, y: hen.y - 10, duration: 300, onComplete: () => {
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
        const tick = async () => {
            if (!this.scene.isActive() || !this.timerText?.active || !this.farmData) return;
            const now = Date.now(), status = nextEggStatus(this.farmData, now);
            if (!status.hens) this.timerText.setText('雞舍空著，去商店選購雞隻吧！');
            else if (status.full) this.timerText.setText(`📦 產能已滿 (${status.eggs} 顆)`);
            else if (!status.next) this.timerText.setText('雞隻生病了，請先治療');
            else {
                const ms = status.next.ms;
                const time = `${Math.floor(ms / 3600000)}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
                this.timerText.setText(`${BREEDS[status.next.breed].name}下顆蛋 ${time}`);
            }
            if (this.isUpdatingEggs || !productionChanged(this.farmData, now)) return;
            this.isUpdatingEggs = true;
            const illnessRolls = Array.from({ length: 20 }, () => Math.random());
            try {
                await runTransaction(db, async transaction => {
                    const snap = await transaction.get(myFarmRef), farm = snap.data()?.farm;
                    if (!farm) return;
                    const state = settlePoultry(farm, now);
                    const added = Object.values(state.ready).reduce((a, b) => a + b, 0) - (farm.eggsReady || 0);
                    const risk = state.cleanliness > 80 ? 0.5 : state.cleanliness > 50 ? 0.2 : 0;
                    if (added > 0) state.hens.forEach((h, i) => { if (!h.isSick && illnessRolls[i] < risk) { h.isSick = true; h.sickTimestamp = now; } });
                    transaction.update(myFarmRef, poultryPatch(state));
                });
            } catch (e) { console.error('生蛋計時更新失敗:', e); }
            finally { this.isUpdatingEggs = false; }
        };
        this.farmInterval = setInterval(tick, 1000);
    }

    async searchCabbage(cabSprite) {
        if (!this.farmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = getUsedSpace(this.farmData);
        const limit = this.farmData.warehouseLimit || 10;
        const foundType = gardenFindForRoll(Phaser.Math.Between(1, GARDEN_ROLL_SIZE));
        if (!foundType) return;
        const feedback = this.gardenFeedback;

        if (usedSpace >= limit) {
            this.showFloatingText('倉庫已滿！', '#F44336', 16, cabSprite.x, cabSprite.y);
            return;
        }

        try {
            const caught = await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                if (!snap.exists() || !snap.data().farm) throw new Error('農莊資料不存在。');
                const farm = snap.data().farm;
                if (getUsedSpace(farm) >= (farm.warehouseLimit || 10)) return false;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
                return true;
            });
            if (!feedback?.alive) return;
            if (caught) feedback.show(foundType, cabSprite.x, cabSprite.y);
            else this.showFloatingText('倉庫已滿！', '#F44336', 16, cabSprite.x, cabSprite.y);
        } catch (e) {
            console.error(e);
            if (feedback?.alive) this.showFloatingText('未能收入倉庫，請稍後再試', '#F44336', 14, cabSprite.x, cabSprite.y);
        }
    }

    async harvestEgg() {
        if (this.isHarvesting) return;
        const activeBoss = [this.dragonEncounter, this.gorillaEncounter].find(boss => boss && !boss.destroyed && !boss.settled);
        if (activeBoss) {
            this.showFloatingText(`請先擊退${activeBoss.spec.name}並完成結算！`, '#FFD54F', 16);
            return;
        }

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
        const usedSpace = getUsedSpace(this.farmData);
        const limit = this.farmData.warehouseLimit || 10;
        
        if (usedSpace + eggsToHarvest > limit) {
            this.showFloatingText('⚠️ 倉庫空間不足，請先擴充！', '#F44336', 14);
            return;
        }

        const defended = [this.dragonEncounter, this.gorillaEncounter].some(boss => boss?.settled && boss.result === 'win');
        const encounter = defended ? null : rollHomeBossEncounter(this.farmData.coopLevel);
        if (encounter) {
            this.dragonEncounter?.destroy(); this.gorillaEncounter?.destroy();
            this.dragonEncounter = null; this.gorillaEncounter = null;
            this.dragon = null; this.gorilla = null;
            if (encounter === 'gorilla') this.gorillaEncounter = new GorillaEncounter(this);
            else this.dragonEncounter = new DragonEncounter(this);
            return;
        }

        this.emptyClickCount = 0;
        this.isHarvesting = true; 

        try {
            const result = await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(myFarmRef);
                if (!docSnap.exists() || !docSnap.data().farm) throw new Error('農場資料不存在');
                const farm = docSnap.data().farm;
                const result = collectPoultry(farm);
                if (getUsedSpace(farm) + result.total > (farm.warehouseLimit || 10)) throw new Error('倉庫空間不足，請先擴充！');
                transaction.update(myFarmRef, result.patch);
                return result;

            });
            this.dragonEncounter?.destroy(); this.gorillaEncounter?.destroy();
            this.dragonEncounter = null; this.gorillaEncounter = null;
            this.dragon = null; this.gorilla = null;
            this.showFloatingText(Object.entries(result?.collected || {}).filter(([, n]) => n).map(([key, n]) => `${BREEDS[key].eggName} +${n}`).join('\n') || '雞舍目前沒有蛋', '#FFD54F', 18);
        } catch (e) { this.showFloatingText(e.message || '收蛋失敗，請稍後重試', '#F44336', 16); }
        finally { this.isHarvesting = false; }
    }

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
