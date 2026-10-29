import { preloadSceneAssets, finishSceneAssets } from './assets.js';
import { onSceneExit } from './scene-cleanup.js';
import { EagleEncounter } from './eagle.js';
import { configureFarmViewport } from './viewport.js';
import { visitorNotice } from './mail-store.js';
import { stealBlockedUntil, guardDogInterception } from './guard-dog-core.js';
import { prepareGuardDogNotice } from './guard-dog-notices.js';
import { watchFarm } from '../live-reads.js';
import { BREEDS, poultryState, settlePoultry, poultryPatch, productionChanged, takePoultryEgg } from './poultry.js';
import { addPoultrySprite, poultryAnim } from './poultry-art.js';
import { ENEMY_HEALTH, equippedWeapon, weaponDamage } from './combat-rules.js';
import { GorillaEncounter } from './gorilla.js';
import { GardenFeedback } from './garden-feedback.js';
import { mountGuardDog } from './guard-dog-art.js';
import { GARDEN_ROLL_SIZE, gardenFindForRoll } from './garden-core.js';
import { attachFarmAtmosphere } from './atmosphere.js';
import { readVillageAccess, isPublicVillage, villageTargetKey } from './villages.js';
import { DragonEncounter, rollVisitEncounter } from './dragon.js';
import { createPredator, hitPredator, finishPredator, predatorDestination, predatorSpawnPoint, startPredatorPatrol, PREDATOR_APPROACH_MS, TIGER_DEADLINE_MS, WOLF_DEADLINE_MS } from './predators.js';
import { addFarmBackground, addFarmCoop, addFarmSign, addFarmEgg, addVegetableGarden, setCoopSize, randomHenPosition, getHenWalkArea, getHenWanderArea } from './scenery.js';
import { getThreatZones, henRouteIsSafe, planHenPath } from './hen-navigation.js';
import { db } from '../firebase-config.js';
import { doc, onSnapshot, runTransaction, getDoc, addDoc, collection, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, STEAL_COOLDOWN_MS, playerName, getUsedSpace } from './constants.js';

export default class VisitScene extends Phaser.Scene {
    constructor() { super({ key: 'VisitScene' }); }

    preload() { preloadSceneAssets(this); }

    init(data) {
        this.targetGroupId = data.targetGroupId || CURRENT_GROUP_ID;
        this.targetGroupName = data.targetGroupName || '';
        this.targetAccountId = data.targetAccountId; 
        this.targetName = data.targetName;
    }

    create() {
        if (!finishSceneAssets(this)) return;
        configureFarmViewport(this);
        this.visitToken = Symbol('visit');
        this.emptyClickCount = 0;
        this.hasRolledEncounter = false;
        this.eagleEncounter = null;
        this.eagle = null;
        this.dragonEncounter = null;
        this.dragon = null;
        this.gorillaEncounter = null;
        this.gorilla = null;
        this.targetFarmData = null;
        this.myFarmData = null; 
        this.isStealing = false; 
        this.nextHenAvoidanceAt = 0;

        addFarmBackground(this, true);
        this.gardenFeedback = new GardenFeedback(this);
        attachFarmAtmosphere(this, { groupId: this.targetGroupId });

        this.coop = addFarmCoop(this, () => this.askCleanTargetFarm());

        this.coopEgg = addFarmEgg(this, () => this.attemptSteal());

        this.hensGroup = []; 
        this.rubbishGroup = this.add.group();

        addVegetableGarden(this, plant => this.searchCabbage(plant));
        addFarmSign(this, sign => {
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.add.text(195, 50, `潛入 [${this.targetName}] 的家`, { fontSize: '16px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);

        const btnBack = this.add.rectangle(55, 50, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(30);
        this.add.text(55, 50, '🏃 溜走', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
        btnBack.on('pointerdown', () => this.scene.start('LobbyScene', { targetGroupId: this.targetGroupId }));

        this.createConfirmDialog();
        this.initFirebase();
        mountGuardDog(this,()=>this.targetFarmData);

        onSceneExit(this, () => {
            this.visitToken = null;
            this.eagleEncounter?.destroy(); this.dragonEncounter?.destroy();
            this.gorillaEncounter?.destroy();
            this.groupUnsubscribes?.forEach(unsubscribe => unsubscribe());
            if (this.unsubscribeTarget) this.unsubscribeTarget(); 
            this.registry.events.off('changedata-myFarmData', this.onMyFarmDataChanged, this);
            this.hensGroup.forEach(h => {
                h.walkTimer?.remove();
                if (h.statusIcon) h.statusIcon.destroy();
                if (h.walkTween) h.walkTween.stop();
            });
        });
    }

    update(time) {
        for (const hen of this.hensGroup || []) {
            if (hen.statusIcon?.active) {
                hen.statusIcon.setPosition(hen.x, hen.y - 26 + Math.sin(time / 200) * 2);
            }
        }
        if (time < this.nextHenAvoidanceAt) return;
        this.nextHenAvoidanceAt = time + 200;
        this.avoidPredators();
    }

    avoidPredators() {
        const zones = getThreatZones(this);
        if (!zones.length) return;
        for (const hen of this.hensGroup || []) {
            if (!hen.active || henRouteIsSafe(this, hen, zones)) continue;
            this.tweens.killTweensOf(hen);
            hen.walkTimer?.remove();
            this.wanderSingleHen(hen, true);
        }
    }

    async initFirebase() {
        const token = this.visitToken;
        this.myFarmData = this.registry.get('myFarmData');
        this.registry.events.on('changedata-myFarmData', this.onMyFarmDataChanged, this);

        try {
            const group = await this.assertVisitAccess();
            if (!this.scene.isActive() || this.visitToken !== token) return;
            this.targetGroupName = group.name || this.targetGroupName;
            if (this.targetGroupId !== CURRENT_GROUP_ID) {
                this.groupUnsubscribes = [CURRENT_GROUP_ID, this.targetGroupId].map(groupId =>
                    onSnapshot(doc(db, 'groups', groupId), snapshot => {
                        if (this.visitToken !== token) return;
                        const group = snapshot.exists() ? snapshot.data() : null;
                        const memberId = groupId === CURRENT_GROUP_ID ? CURRENT_ACCOUNT_ID : this.targetAccountId;
                        if (!isPublicVillage(group) || !(group.members || []).includes(memberId)) {
                            if (this.scene.isActive() && this.visitToken === token) this.scene.start('LobbyScene', { notice: '村落已封閉或成員已離開，已返回自己的村落。' });
                        }
                    }));
            }
        } catch (error) {
            if (this.scene.isActive() && this.visitToken === token) this.scene.start('LobbyScene', { notice: error.message });
            return;
        }
        const targetRef = doc(db, "groups", this.targetGroupId, "users", this.targetAccountId);
        this.unsubscribeTarget = watchFarm(targetRef, (docSnap) => {
            if (!this.scene.isActive() || this.visitToken !== token) return;
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.checkAndUpdateTargetEggLaying(targetRef, this.targetFarmData);
                this.coopEgg.setVisible((this.targetFarmData.eggsReady || 0) > 0);
                this.syncTargetHens(); 
                this.renderTargetCleanliness();
                if (!this.hasRolledEncounter) {
                    this.hasRolledEncounter = true;
                    const encounter = rollVisitEncounter(this.targetFarmData.coopLevel);
                    if (encounter === 'eagle') this.eagleEncounter = new EagleEncounter(this);
                    else if (encounter === 'gorilla') this.spawnGorillaEvent();
                    else if (encounter === 'dragon') this.spawnDragonEvent();
                    else if (encounter === 'tiger') this.spawnTigerEvent();
                    else if (encounter === 'wolf') this.spawnWolfEvent();
                }
            }
        });
    }

    assertVisitAccess(transaction) {
        return readVillageAccess(CURRENT_GROUP_ID, this.targetGroupId, CURRENT_ACCOUNT_ID,
            transaction ? ref => transaction.get(ref) : getDoc, this.targetAccountId);
    }

    runVisitTransaction(callback) {
        const token = this.visitToken;
        const groupId = this.targetGroupId, accountId = this.targetAccountId;
        return runTransaction(db, async transaction => {
            if (this.visitToken !== token) throw new Error('拜訪已結束。');
            await readVillageAccess(CURRENT_GROUP_ID, groupId, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), accountId);
            if (this.visitToken !== token) throw new Error('拜訪已結束。');
            const result = await callback(transaction);
            if (this.visitToken !== token) throw new Error('拜訪已結束。');
            return result;
        });
    }

    spawnGorillaEvent() {
        if ([this.eagleEncounter, this.dragonEncounter, this.gorillaEncounter].some(boss => boss && !boss.destroyed)) return;
        this.gorillaEncounter = new GorillaEncounter(this);
    }

    spawnDragonEvent() {
        if ([this.eagleEncounter, this.dragonEncounter, this.gorillaEncounter].some(boss => boss && !boss.destroyed)) return;
        this.dragonEncounter = new DragonEncounter(this);
    }

    async checkAndUpdateTargetEggLaying(targetRef, farm) {
        if (!farm || this.isUpdatingTargetEggs || !productionChanged(farm, Date.now())) return;
        this.isUpdatingTargetEggs = true;
        try {
            await this.runVisitTransaction(async transaction => {
                const snap = await transaction.get(targetRef);
                if (snap.data()?.farm) transaction.update(targetRef, poultryPatch(settlePoultry(snap.data().farm)));
            });
        } catch (e) { console.error('更新目標玩家生蛋進度失敗:', e); }
        finally { this.isUpdatingTargetEggs = false; }
    }

    onMyFarmDataChanged(parent, value) { this.myFarmData = value; }

    askCleanTargetFarm() {
        if (!this.targetFarmData || (this.targetFarmData.cleanliness || 0) === 0) {
            this.showFloatingText('鄰居家已經很乾淨囉！', '#FFFFFF', 16, 195, 150); return;
        }
        this.dialogText.setText(`[${this.targetName}] 的雞舍有點髒亂\n是否要幫忙打掃雞舍？`);
        this.dialogContainer.setVisible(true);
    }

    async cleanTargetFarm() {
        const targetRef = doc(db, "groups", this.targetGroupId, "users", this.targetAccountId);
        try {
            await this.runVisitTransaction(async (t) => {
                const targetDoc = await t.get(targetRef);
                if (!targetDoc.exists() || !targetDoc.data()?.farm) return;
                const targetClean = targetDoc.data().farm.cleanliness || 0;
                const newClean = Math.max(0, targetClean - 30);
                const myDoc = await t.get(myFarmRef);
                if (!myDoc.exists() || !myDoc.data()?.farm) return;
                const myMoral = myDoc.data().farm.moral !== undefined ? myDoc.data().farm.moral : 100;
                const newMoral = Math.min(100, myMoral + 3);

                t.update(targetRef, { "farm.cleanliness": newClean });
                t.update(myFarmRef, { "farm.moral": newMoral });
            });
            this.showFloatingText('幫忙打掃完成！', '#81D4FA', 18, 195, 150);
            this.sendSystemNotification(`${playerName}幫${this.targetName}打掃了雞舍`);
        } catch (e) { console.error(e); }
    }

    renderTargetCleanliness() {
        this.rubbishGroup.clear(true, true);
        const cleanVal = this.targetFarmData ? (this.targetFarmData.cleanliness || 0) : 0;
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

    syncTargetHens() {
        if (!this.targetFarmData) return;
        const henCount = poultryState(this.targetFarmData).hens.length;
        const hensState = poultryState(this.targetFarmData).hens;
        const now = Date.now();
        setCoopSize(this.coop, this.targetFarmData.coopLevel);

        this.hensGroup.forEach(h => {
            h.walkTimer?.remove();
            this.tweens.killTweensOf(h);
            if (h.statusIcon) {
                this.tweens.killTweensOf(h.statusIcon);
                h.statusIcon.destroy();
            }
            h.destroy();
        });
        this.hensGroup = [];

        for (let i = 0; i < henCount; i++) {
            const { x: cx, y: cy } = randomHenPosition(this);
            // 🐔 加入 setScale(2)
            let newHen = addPoultrySprite(this, hensState[i], cx, cy);

            const hState = hensState[i] || {};
            newHen.hState = hState;
            if (hState.isSick) {
                newHen.play(poultryAnim(newHen, 'idle'), true);
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                let icon = this.add.image(cx, cy - 25, iconKey).setDepth(11);
                newHen.statusIcon = icon;
            } else {
                newHen.play(poultryAnim(newHen, 'idle'), true);
            }

            newHen.on('pointerdown', () => {
                // 🌟 同步放大偷蛋點擊時的比例
                this.tweens.add({ targets: newHen, y: newHen.y - 15, scaleX: newHen.baseScale * 1.1, scaleY: newHen.baseScale * 0.9, duration: 100, yoyo: true });
                this.attemptSteal(); 
            });

            this.hensGroup.push(newHen);
            this.wanderSingleHen(newHen);
        }
    }

    wanderSingleHen(henSprite, fleeing = false) {
        if (!henSprite?.active || (henSprite.hState?.isSick && !fleeing)) return;
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

    async sendSystemNotification(messageContent) {
        try {
            const configDoc = await getDoc(doc(db, "groups", CURRENT_GROUP_ID, "settings", "gameConfig"));
            if (configDoc.exists() && configDoc.data().targetRoomId) {
                const targetRoomId = configDoc.data().targetRoomId;
                const room = await getDoc(doc(db, 'rooms', targetRoomId));
                if (!room.exists() || room.data().groupId !== CURRENT_GROUP_ID) return;
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
                const finalText = `${messageContent}\n🕒 ${timeStr}`;
                await addDoc(collection(db, "messages"), { groupId: CURRENT_GROUP_ID, roomId: targetRoomId, sender: "村落廣播", text: finalText, time: timeStr, timestamp: serverTimestamp(), isSystem: true });
                await updateDoc(doc(db, "rooms", targetRoomId), { lastMessage: `村落廣播: ${messageContent}`, lastMessageTime: serverTimestamp() });
            }
        } catch (e) { console.error("發送廣播失敗:", e); }
    }

    showDizzyEffect(x, y) {
        const star1 = this.add.image(x - 15, y - 10, 'star').setDepth(40);
        const star2 = this.add.image(x + 15, y - 20, 'star').setDepth(40);
        const star3 = this.add.image(x, y - 30, 'star').setDepth(40);
        
        [star1, star2, star3].forEach(star => {
            this.tweens.add({
                targets: star, y: star.y - 30, angle: 360, alpha: 0,
                duration: 600 + Phaser.Math.Between(0, 300),
                onComplete: () => star.destroy()
            });
        });
    }

    spawnTigerEvent() {
        this.isTigerDefeated = false; this.tigerHitCount = 0;
        const weapon = equippedWeapon(this.myFarmData);
        const damage = weaponDamage(weapon, 'tiger');
        const health = ENEMY_HEALTH.tiger;
        const totalHitsNeeded = Math.ceil(health / damage);
        const spawn = predatorSpawnPoint(this, 'tiger');
        this.tiger = createPredator(this, 'tiger', spawn.x, spawn.y);
        this.club = this.add.image(0, 0, weapon.icon).setOrigin(0.5).setDisplaySize(64, 86).setDepth(30).setVisible(false);
        const warnText = this.add.text(195, 120, `🚨 危機：猛虎出閘！\n快用[${weapon.name}]打退牠 (需 ${totalHitsNeeded} 下)`, { fontSize: '18px', color: '#FF9800', fontStyle: 'bold', align: 'center', stroke: '#000', strokeThickness: 4 }).setOrigin(0.5).setDepth(30);
        // Keep the warning above the clearing, clear of the patrol and hens.
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 400 });
        this.tiger.warning = warnText;

        this.tigerTween = this.tweens.add({
            targets: this.tiger, ...predatorDestination(this, 'tiger'), duration: PREDATOR_APPROACH_MS, ease: 'Linear',
            onComplete: () => startPredatorPatrol(this, this.tiger),
        });

        this.tiger.moveTween = this.tigerTween;
        // Patrolling and attacking are visual only; keep the original 50s deadline.
        this.tiger.deadlineTimer = this.time.delayedCall(TIGER_DEADLINE_MS, () => {
            if (!this.isTigerDefeated) this.tigerEscapes();
        });
        this.tiger.on('pointerdown', (pointer) => {
            if (this.isTigerDefeated || !this.tiger.active || this.tiger.getData('resolved')) return;
            this.tigerHitCount += damage;
            hitPredator(this.tiger);
            this.club.setPosition(pointer.x + 15, pointer.y - 15).setVisible(true).setAngle(-45);
            this.tweens.add({ targets: this.club, angle: 45, duration: 50, yoyo: true, onComplete: () => this.club.setVisible(false) });
            
            if (damage > 1) { this.showDizzyEffect(pointer.x, pointer.y - 30); }
            if (this.tigerHitCount >= health) { this.defeatTiger(); }
            else {
                const hitsLeft = Math.ceil(Math.max(0, health - this.tigerHitCount) / damage);
                if (this.tigerHitCount % 20 === 0 || damage > 1) {
                    this.showFloatingText(`還差 ${hitsLeft} 下!`, '#FF9800', 16, this.tiger.x, this.tiger.y - 50); 
                }
            }
        });
        this.avoidPredators();
    }

    defeatTiger() {
        this.isTigerDefeated = true; if (this.tigerTween) this.tigerTween.stop();
        if (!finishPredator(this.tiger, 'dead')) return;
        this.club.setVisible(false);
        this.showFloatingText('🏆 成功擊退猛虎！', '#FFC107', 22, this.tiger.x, this.tiger.y - 50);
        this.tweens.add({ targets: this.tiger, alpha: 0, y: this.tiger.y - 50, duration: 1500, delay: 1000, onComplete: () => this.tiger.destroy() });

        this.runVisitTransaction(async (t) => {
            const snap = await t.get(myFarmRef);
            if (!snap.exists() || !snap.data()?.farm) return false;
            const farm = snap.data().farm;
            if (getUsedSpace(farm) < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.tigerPelts": (farm.tigerPelts || 0) + 1 }); return true; 
            } else return false; 
        }).then((success) => {
            if (success) { 
                this.time.delayedCall(1000, () => this.showFloatingText('獲得 虎皮 +1 🐅', '#FFF', 20, 195, 422));
                this.sendSystemNotification(`${playerName}在${this.targetName}家中擊退老虎`);
            } else { this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了...', '#F44336', 16, 195, 422)); }
        }).catch(e => console.error(e));
    }

    tigerEscapes() {
        if (!finishPredator(this.tiger, 'run')) return;
        this.club.setVisible(false);
        this.showFloatingText('老虎在你身上搶走 5 枚金幣！', '#F44336', 16, this.tiger.x, this.tiger.y - 40);
        this.tweens.add({ targets: this.tiger, alpha: 0, x: this.tiger.x + 100, duration: 1000, onComplete: () => this.tiger.destroy() });
        this.runVisitTransaction(async (t) => {
            const snap = await t.get(myFarmRef);
            if (!snap.exists() || !snap.data()?.farm) return;
            const farm = snap.data().farm;
            t.update(myFarmRef, { "farm.coins": Math.max(0, (farm.coins || 0) - 5) });
        }).catch(e => console.error(e));
    }

    spawnWolfEvent() {
        this.isWolfDefeated = false; this.wolfHitCount = 0;
        const weapon = equippedWeapon(this.myFarmData);
        const damage = weaponDamage(weapon, 'wolf');
        const health = ENEMY_HEALTH.wolf;
        const totalHitsNeeded = Math.ceil(health / damage);
        const spawn = predatorSpawnPoint(this, 'wolf');
        this.wolf = createPredator(this, 'wolf', spawn.x, spawn.y);
        this.club = this.add.image(0, 0, weapon.icon).setOrigin(0.5).setDisplaySize(64, 86).setDepth(30).setVisible(false);
        const warnText = this.add.text(195, 120, `⚠️ 警告：大野狼來襲！\n快用[${weapon.name}]打退牠 (需 ${totalHitsNeeded} 下)`, { fontSize: '18px', color: '#F44336', fontStyle: 'bold', align: 'center', stroke: '#fff', strokeThickness: 3 }).setOrigin(0.5).setDepth(30);
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 500 });
        this.wolf.warning = warnText;

        this.wolfTween = this.tweens.add({
            targets: this.wolf, ...predatorDestination(this, 'wolf'), duration: PREDATOR_APPROACH_MS, ease: 'Linear',
            onComplete: () => startPredatorPatrol(this, this.wolf),
        });

        this.wolf.moveTween = this.wolfTween;
        // Patrol attacks are visual; the original egg-loss deadline stays 60s.
        this.wolf.deadlineTimer = this.time.delayedCall(WOLF_DEADLINE_MS, () => {
            if (!this.isWolfDefeated) this.wolfEscapes();
        });
        this.wolf.on('pointerdown', (pointer) => {
            if (this.isWolfDefeated || !this.wolf.active || this.wolf.getData('resolved')) return;
            this.wolfHitCount += damage;
            hitPredator(this.wolf);
            
            this.club.setPosition(pointer.x + 15, pointer.y - 15).setVisible(true).setAngle(-45);
            this.tweens.add({ targets: this.club, angle: 45, duration: 50, yoyo: true, onComplete: () => this.club.setVisible(false) });
            
            if (damage > 1) { this.showDizzyEffect(pointer.x, pointer.y - 30); }
            if (this.wolfHitCount >= health) { this.defeatWolf(); }
            else {
                const hitsLeft = Math.ceil(Math.max(0, health - this.wolfHitCount) / damage);
                if (this.wolfHitCount % 20 === 0 || damage > 1) {
                    this.showFloatingText(`還差 ${hitsLeft} 下!`, '#FF9800', 16, this.wolf.x, this.wolf.y - 40); 
                }
            }
        });
        this.avoidPredators();
    }

    defeatWolf() {
        this.isWolfDefeated = true; if (this.wolfTween) this.wolfTween.stop();
        if (!finishPredator(this.wolf, 'dead')) return;
        this.club.setVisible(false);
        this.showFloatingText('🎉 成功擊退大野狼！', '#4CAF50', 22, this.wolf.x, this.wolf.y - 50);
        this.tweens.add({ targets: this.wolf, alpha: 0, y: this.wolf.y - 50, duration: 1500, delay: 1000, onComplete: () => this.wolf.destroy() });

        this.runVisitTransaction(async (t) => {
            const snap = await t.get(myFarmRef);
            if (!snap.exists() || !snap.data()?.farm) return false;
            const farm = snap.data().farm;
            if (getUsedSpace(farm) < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.wolfFangs": (farm.wolfFangs || 0) + 1 }); return true; 
            } else return false; 
        }).then((success) => {
            if (success) { 
                this.time.delayedCall(1000, () => this.showFloatingText('獲得 狼牙 +1 🦷', '#FFF', 20, 195, 422));
                this.sendSystemNotification(`${playerName}在${this.targetName}家中擊退大野狼`);
            } else { this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了...', '#F44336', 16, 195, 422)); }
        }).catch(e => console.error(e));
    }

    wolfEscapes() {
        if (!finishPredator(this.wolf, 'run')) return;
        this.club.setVisible(false);
        this.showFloatingText('大野狼偷走了一顆蛋逃跑了！', '#F44336', 18, this.wolf.x, this.wolf.y - 30);
        this.tweens.add({ targets: this.wolf, alpha: 0, x: this.wolf.x + 100, duration: 1000, onComplete: () => this.wolf.destroy() });
        this.runVisitTransaction(async (t) => {
            const targetRef = doc(db, "groups", this.targetGroupId, "users", this.targetAccountId);
            const targetDoc = await t.get(targetRef);
            if (!targetDoc.exists() || !targetDoc.data()?.farm) return;
            const targetFarm = targetDoc.data().farm;
            if (targetFarm && (targetFarm.eggsReady || 0) > 0) { t.update(targetRef, takePoultryEgg(targetFarm, Math.random()).patch); }
        }).catch(e => console.error(e));
    }

    async searchCabbage(cabSprite) {
        if (!this.myFarmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = getUsedSpace(this.myFarmData);
        const limit = this.myFarmData.warehouseLimit || 10;
        const foundType = gardenFindForRoll(Phaser.Math.Between(1, GARDEN_ROLL_SIZE));
        if (!foundType) return;
        const feedback = this.gardenFeedback;

        if (usedSpace >= limit) { this.showFloatingText('我的倉庫滿了！', '#F44336', 16, cabSprite.x, cabSprite.y); return; }
        try {
            const caught = await this.runVisitTransaction(async (t) => {
                const snap = await t.get(myFarmRef);
                if (!snap.exists() || !snap.data()?.farm) throw new Error('農莊資料不存在。');
                const farm = snap.data().farm;
                if (getUsedSpace(farm) >= (farm.warehouseLimit || 10)) return false;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
                return true;
            });
            if (!feedback?.alive) return;
            if (caught) feedback.show(foundType, cabSprite.x, cabSprite.y);
            else this.showFloatingText('我的倉庫滿了！', '#F44336', 16, cabSprite.x, cabSprite.y);
        } catch (e) {
            console.error(e);
            if (feedback?.alive) this.showFloatingText('未能收入倉庫，請稍後再試', '#F44336', 14, cabSprite.x, cabSprite.y);
        }
    }

    async attemptSteal() {
        if (this.isStealing || !this.myFarmData) return;
        const activeBoss = [this.eagleEncounter, this.gorillaEncounter, this.dragonEncounter].find(boss => boss && !boss.destroyed && !boss.settled);
        if (activeBoss) {
            this.showFloatingText(`請先擊退${activeBoss.spec.name}並完成結算！`, '#FFD54F', 16);
            return;
        }
        const safeX = 195, safeY = 422 - 60;
        const key = villageTargetKey(this.targetGroupId, this.targetAccountId);
        const blockedUntil = farm => stealBlockedUntil(farm, key, this.targetGroupId === CURRENT_GROUP_ID ? this.targetAccountId : null);
        if (Date.now() < blockedUntil(this.myFarmData)) {
            this.showFloatingText('剛偷過這座雞舍，請稍後再來！', '#F44336', 15, safeX, safeY);
            return;
        }
        if (!this.targetFarmData || (this.targetFarmData.eggsReady || 0) <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickCount >= 5) {
                this.showFloatingText('沒蛋啦還一直點~咕咕💢', '#F44336', 16, safeX, safeY);
                this.hensGroup.forEach(hen => {
                    hen.setTint(0xff0000);
                    this.time.delayedCall(500, () => { if (hen.active) hen.clearTint(); });
                    this.tweens.add({ targets: hen, y: hen.y - 25, duration: 100, yoyo: true, repeat: 1 });
                });
                this.emptyClickCount = 0;
            } else this.showFloatingText('人家現在沒蛋啦！', '#ffffff', 18, safeX, safeY);
            return;
        }
        if (getUsedSpace(this.myFarmData) >= (this.myFarmData.warehouseLimit || 10)) {
            this.showFloatingText('你的倉庫滿了，偷不了！', '#F44336', 15, safeX, safeY);
            return;
        }
        this.emptyClickCount = 0;
        this.isStealing = true;
        const targetRef = doc(db, 'groups', this.targetGroupId, 'users', this.targetAccountId);
        const roll = Math.random(); // A Firestore retry keeps the same attempt outcome.
        const eggRoll = Math.random();
        const visitMailRef = doc(db, 'groups', this.targetGroupId, 'users', this.targetAccountId, 'farm_notifications', `visit-${crypto.randomUUID()}`);
        const visitTime = Date.now();
        const attemptId = crypto.randomUUID();
        try {
            const result = await this.runVisitTransaction(async transaction => {
                const targetDoc = await transaction.get(targetRef);
                const ownDoc = await transaction.get(myFarmRef);
                const target = targetDoc.data()?.farm, own = ownDoc.data()?.farm;
                if (!target || !own) throw new Error('農場資料不存在。');
                const now = Date.now();
                if (now < blockedUntil(own)) throw new Error('這座雞舍仍在禁偷時間內，請稍後再來！');
                if ((target.eggsReady || 0) <= 0) throw new Error('手腳太慢，蛋不見了！');
                if (getUsedSpace(own) >= (own.warehouseLimit || 10)) throw new Error('你的倉庫滿了，偷不了！');
                const moral = own.moral ?? 100;
                const interception = guardDogInterception(target, roll, now);
                const notify = interception ? await prepareGuardDogNotice(transaction, {
                    groupId: this.targetGroupId, accountId: this.targetAccountId, ownerName: this.targetName,
                    thiefName: playerName, breedName: interception.breed.name, blockMs: interception.breed.blockMs, id: attemptId, now,
                }) : null;
                const updates = { [`farm.villageStealCooldowns.${key}`]: now,
                    [`farm.villageStealBlockedUntil.${key}`]: now + (interception?.breed.blockMs || STEAL_COOLDOWN_MS),
                    'farm.moral': Math.max(0, moral - 5) };
                let eggName;
                if (!interception) {
                    const egg = takePoultryEgg(target, eggRoll);
                    const itemKey = BREEDS[egg.breed].eggKey;
                    updates[`farm.${itemKey}`] = (own[itemKey] || 0) + 1;
                    eggName = BREEDS[egg.breed].eggName;
                    transaction.update(targetRef, egg.patch);
                    transaction.set(visitMailRef, visitorNotice(visitTime));
                }
                notify?.();
                transaction.update(myFarmRef, updates);
                return { success: !interception, eggName, blockMs: interception?.breed.blockMs || 0 };
            });
            this.showFloatingText(result.success ? `🕵️ 偷到${result.eggName || '雞蛋'}` : `被護衛犬攔截！這座雞舍禁偷 ${result.blockMs / 3600000} 小時`, result.success ? '#FFD54F' : '#F44336', 18, safeX, safeY);
            if (!result.success) { this.cameras.main.shake(300, 0.01); this.guardDogController?.bark(); }
            if (result.success) this.sendSystemNotification(`${playerName}在${this.targetGroupName || '群組'}村落偷了${this.targetName}的雞蛋`);
        } catch (error) {
            this.showFloatingText(`❌ ${error.message || error}`, '#F44336', 16, safeX, safeY);
            this.cameras.main.shake(300, 0.01);
        } finally { this.isStealing = false; }
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
            this.cleanTargetFarm();
        });

        this.dialogContainer.add([overlay, bg, this.dialogText, btnYes, textYes, btnNo, textNo]);
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
