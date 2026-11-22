import { farmActionsBlocked } from './entry-encounter.js';
import { isUncertainSteal } from './steal-request.js';
import {FARM_BACKEND_ENABLED,farmCommand,farmCommandOrLegacy,visitPayload,recordBattleHit,settleBackendBattle,hasPendingBackendBattle,farmNow,routeBackendChallenge} from './backend-client.js';
import { maybeStartGiant } from './giant-trigger.js';
import { restorePendingBattle } from './pending-battle.js';
import { LayingVisit } from './laying-visit.js';
import { outdoorHens, treatmentPatch } from './poultry-housing.js';
import { openCoopActions } from './poultry-housing-ui.js';
import { maybeStartMole } from './mole.js';
import { maybeStartCobra } from './cobra-trigger.js';
import { mountHalloween } from './halloween.js';
import { ensureAssets, bossAssets } from './assets.js';
import { farmLoading } from './loading-ui.js';
import { onSceneExit } from './scene-cleanup.js';
import { HornetEncounter } from './hornet.js';
import { EagleEncounter } from './eagle.js';
import { isFarmSave, copyFarmSave } from './save-store.js';
import { configureFarmViewport } from './viewport.js';
import { BREEDS, poultryState, settlePoultry, poultryPatch, productionChanged, nextEggStatus, collectPoultry } from './poultry.js';
import { addPoultrySprite, poultryAnim } from './poultry-art.js';
import { GardenFeedback } from './garden-feedback.js';
import { mountGuardDog } from './guard-dog-art.js';
import { GARDEN_ROLL_SIZE, gardenFindForRoll } from './garden-core.js';
import { attachFarmAtmosphere } from './atmosphere.js';
import { GorillaEncounter } from './gorilla.js';
import { rollHomeBossEncounter } from './gorilla-rules.js';
import { equippedWeapon } from './combat-rules.js';
import { DragonEncounter } from './dragon.js';
import { getThreatZones, henRouteIsSafe, planHenPath } from './hen-navigation.js';
import { addFarmBackground, addFarmCoop, addFarmSign, addFarmEgg, addVegetableGarden, setCoopSize, randomHenPosition, getHenWalkArea, getHenWanderArea } from './scenery.js';
import { db } from '../firebase-config.js';
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, playerName, getUsedSpace } from './constants.js';

// 結果視窗不是進入遊戲的必要相依；模組或圖片暫時無法下載時，不應阻止整座農場啟動。
let eggResultUI;
function loadEggResultUI() {
    if (!eggResultUI) eggResultUI = import('./egg-result-ui.js').catch(error => { eggResultUI = null; throw error; });
    return eggResultUI;
}

let coopCleanUI;
const loadCoopCleanUI = () => coopCleanUI ||= import('./coop-clean-ui.js').catch(error => { coopCleanUI = null; throw error; });
const hasPendingOwnClean = () => !!sessionStorage.getItem('nexus.farm.pending:'+JSON.stringify([CURRENT_ACCOUNT_ID,CURRENT_GROUP_ID,'cleanOwn',{}]));

export default class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        configureFarmViewport(this);
        // 固定收蛋素材背景預熱，不等待圖片就開始遊戲；場景結束由 Phaser 取消延遲工作。
        this.time.delayedCall(1500, () => {
            void loadEggResultUI().then(ui => ui.prepareEggResultAssets()).catch(() => {});
            void loadCoopCleanUI().then(ui => ui.prepareCoopCleanAssets()).catch(() => {});
        });
        const cx = 195;
        this.farmData = null;
        this.henAssetsPending = false;
        this.preparingEncounter = false;
        this.entryChecked = false;
        this.checkingEntry = false;
        this.resumingPendingBattle = false;
        this.giantEncounter = null; this.preparingGiant = false;
        this.pendingEncounter = null;
        this.preparingCobra = false;
        this.cobraEntryChecked = false;
        this.moleEncounter = null; this.preparingMole = false; this.gardenSearching = false;
        this.cobraEncounter = null;
        this.cobra = null;
        this.farmSceneToken = Symbol();
        this.henVisualKey = null;
        this.rubbishVisualKey = null;
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.isHarvesting = false;
        this.harvestStatus = null;
        this.coopCleanDialog = null; this.coopCleanOpening = null; this.cleaningRequest = null;
        this.eagleEncounter = null; this.hornetEncounter = null;
        this.eagle = null; this.hornet = null;
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

        this.coopEgg = addFarmEgg(this, () => this.harvestEgg());

        this.hensGroup = []; 
        this.rubbishGroup = this.add.group();

        addVegetableGarden(this, plant => this.searchCabbage(plant));
        addFarmSign(this, sign => {
            if (farmActionsBlocked(this, hasPendingBackendBattle())) return;
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        this.timerBg = this.add.rectangle(cx, 90, 200, 26, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '讀取存檔中…', { fontSize: '13px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        this.timerText.setInteractive({ cursor: 'pointer' }).on('pointerdown', () => this.game.retryFarmSave?.());
        mountHalloween(this);
        this.createConfirmDialog();
        this.initFirebase();
        mountGuardDog(this,()=>this.farmData,true);
        this.layingVisit = new LayingVisit(this);

        onSceneExit(this, () => {
            this.farmSceneToken = null;
            this.isHarvesting = false;
            this.harvestStatus = null;
            this.resumingPendingBattle = false;
            this.hornetEncounter?.destroy(); this.eagleEncounter?.destroy(); this.dragonEncounter?.destroy();
            this.gorillaEncounter?.destroy(); this.cobraEncounter?.destroy(); this.moleEncounter?.destroy(); this.giantEncounter?.destroy();
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
            this.farmInterval = null;
            this.layingVisit?.cancel();
            this.eggTick = null;
            this.hensGroup.forEach(hen => {
                hen.walkTimer?.remove();
                if (hen.statusIcon) hen.statusIcon.destroy();
                if (hen.walkTween) hen.walkTween.stop();
            });
        });
    }

    update(time) {
        this.layingVisit?.update();
        for (const hen of this.hensGroup || []) {
            if (hen.statusIcon?.active) hen.statusIcon.setPosition(hen.x, hen.y - 26 + Math.sin(time / 200) * 2);
        }
        if (time < this.nextHenAvoidanceAt) return;
        this.nextHenAvoidanceAt = time + 200;
        this.avoidPredators();
    }

    avoidPredators() {
        const zones = getThreatZones(this);
        if (!zones.length) return;
        for (const hen of this.hensGroup || []) {
            const obstacles=hen.nesting?zones.filter(zone=>!zone.friendlyGuard):zones;
            if (!hen.active || henRouteIsSafe(this, hen, obstacles)) continue;
            this.tweens.killTweensOf(hen);
            hen.walkTimer?.remove();
            this.wanderSingleHen(hen, true);
        }
    }

    createMinBtn(x, y, label, color, callback) {
        const btn = this.add.rectangle(x, y, 80, 36, color, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(x, y, label, { fontSize: '13px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btn.on('pointerdown', () => {
            if (!this.isSaveReady() || farmActionsBlocked(this, hasPendingBackendBattle())) {
                this.timerText?.setText('請等待存檔連線完成');
                return;
            }
            callback();
        });
        return btn;
    }

    initFirebase() {
        let closed = false, revision = 0;
        const apply = farm => {
            if (!farm || closed) return;
            const token = ++revision;
            const keys = [...new Set(poultryState(farm).hens.map(h=>h.breed))];
            if(keys.some(key=>!this.textures.exists(key))){
                this.henAssetsPending = true;
                ensureAssets(this, keys, n=>{
                    if(!this.game.registry.get('farmInitialReady'))farmLoading.progress(90+n*8,'準備雞隻');
                }).then(()=>{if(!closed && token===revision)apply(farm);},()=>{
                    if(closed || token!==revision)return;
                    farmLoading.error('雞隻素材載入失敗，存檔未變更。',()=>apply(this.registry.get('myFarmData')));
                });
                return;
            }
            const resumedAssets = this.henAssetsPending;
            this.henAssetsPending = false;
            // Work on a view copy; never turn incomplete snapshots into defaults.
            this.farmData = copyFarmSave(farm);
            if (!this.farmData.equippedWeapon) this.farmData.equippedWeapon = 'club';
            this.farmData.hensState = poultryState(this.farmData).hens;
            this.housingDialog?.refresh?.();
            this.farmData.hens = this.farmData.hensState.length;
            this.farmData.cleanliness ??= 0;
            this.farmData.warehouseLimit ||= 10;
            this.farmData.coopLevel ||= 1;
            this.updateUI();
            this.renderCleanlinessVisual();
            // Coins and inventory updates do not replace moving hens. Include
            // illness age so a fresh snapshot can still update sick/skull art.
            const now = Date.now();
            const key = JSON.stringify([this.farmData.coopLevel, this.farmData.outdoorHensByBreed, this.farmData.hensState.map(({ laidAt, pausedFull, ...visual }) => visual),
                this.farmData.hensState.map(h => h.isSick && h.sickTimestamp
                    ? Math.floor((now - h.sickTimestamp) / 86400000) : 0)]);
            if (key !== this.henVisualKey || this.farmData.hensState.some(h => h.isSick && h.sickTimestamp && now - h.sickTimestamp > 48 * 3600000)) { this.henVisualKey = key; this.syncHens(); }
            this.startEggTimer();
            if (!this.cobraEntryChecked) {
                this.cobraEntryChecked = true;
                this.time.delayedCall(0, () => { void this.startEntryEncounter(); });
            }
            if(!this.game.registry.get('farmInitialReady')){
                this.game.registry.set('farmInitialReady',true);
                // Let the first populated farm frame render before hiding the shell.
                const readyToken=this.farmSceneToken;
                this.game.events.once('postrender',()=>{if(this.sys.isActive() && this.farmSceneToken===readyToken && this.entryChecked)farmLoading.complete();});
            } else if(resumedAssets && !this.preparingEncounter) farmLoading.complete(true);
        };
        const showState = state => {
            if (state && state.phase !== 'ready' && this.timerText?.active) this.timerText.setText(state.phase === 'error' ? '存檔未確認，點此重試' : '讀取存檔中，請稍候…');
        };
        const onFarm = (_parent, farm) => apply(farm);
        const onState = (_parent, state) => showState(state);
        const onFirst = (_parent, key, value) => {
            if (key === 'myFarmData') apply(value);
            if (key === 'farmLoadState') showState(value);
        };
        this.registry.events.on('changedata-myFarmData', onFarm);
        this.registry.events.on('changedata-farmLoadState', onState);
        this.registry.events.on('setdata', onFirst);
        apply(this.registry.get('myFarmData'));
        showState(this.registry.get('farmLoadState'));
        this.unsubscribe = () => {
            closed = true;
            this.registry.events.off('changedata-myFarmData', onFarm);
            this.registry.events.off('changedata-farmLoadState', onState);
            this.registry.events.off('setdata', onFirst);
        };
    }

    async startEntryEncounter() {
        if (this.checkingEntry || this.entryChecked || !this.farmData) return;
        const token = this.farmSceneToken, active = () => this.sys.isActive() && this.farmSceneToken === token;
        this.checkingEntry = true;
        try {
            // 里程碑也只在進場檢查，抓蟲／收蛋及擊倒後不臨時開下一場。
            for (const start of (FARM_BACKEND_ENABLED ? [] : this.farmData.giantChallenge ? [maybeStartGiant] : this.farmData.moleChallenge ? [maybeStartMole] : [maybeStartCobra, maybeStartGiant, maybeStartMole])) {
                if (!active()) return;
                if (await start(this)) {
                    if (!active()) return;
                    if (!farmActionsBlocked({ ...this, entryChecked: true, checkingEntry: false })) throw Error('進場挑戰尚未確認');
                    this.entryChecked = true;
                    return;
                }
            }
            let authorized = FARM_BACKEND_ENABLED ? await farmCommand('homeEncounter', {}) : { kind: rollHomeBossEncounter(this.farmData.coopLevel) };
            if (!active()) return;
            if (authorized?.result && !authorized.challenge) {
                authorized = await farmCommand('homeEncounter', {});
                if (!active()) return;
            }
            if (FARM_BACKEND_ENABLED && !routeBackendChallenge(this, authorized)) return;
            this.backendChallenge = authorized?.challenge || null;
            // 此次進場的權威回覆取代通知較晚送達的舊會話提示，不另啟動第二條恢復流程。
            this.registry.remove('farmPendingBattle');
            const kind = authorized?.kind;
            if (kind) {
                this.preparingEncounter = true;
                await ensureAssets(this, [...bossAssets(kind), equippedWeapon(this.farmData).icon]);
                if (!active()) return;
                // 包含伺服器原有會話；不改血量、期限或原始目標。
                if (['giant','cobra','mole'].includes(kind)) {
                    this.preparingEncounter = false;
                    await restorePendingBattle(this, authorized.challenge);
                } else if (kind === 'hornet') this.hornetEncounter = new HornetEncounter(this);
                else if (kind === 'eagle') this.eagleEncounter = new EagleEncounter(this);
                else if (kind === 'gorilla') this.gorillaEncounter = new GorillaEncounter(this);
                else this.dragonEncounter = new DragonEncounter(this);
            }
            if (active()) this.entryChecked = true;
        } catch (error) {
            if (active()) farmLoading.error('進場怪物確認失敗，請重試；尚未開放農場操作。', () => this.startEntryEncounter());
            console.warn('farm-entry-encounter-failure', error?.code || error?.name || 'unknown');
        } finally { if (this.farmSceneToken === token) { this.checkingEntry = false; this.preparingEncounter = false; if(this.entryChecked){this.updateEggCountdown();farmLoading.complete();} } }
    }

    isSaveReady() {
        return !this.preparingGiant && !this.henAssetsPending && !this.preparingEncounter && !!this.farmData && this.registry.get('farmLoadState')?.phase === 'ready';
    }

    updateUI() {
        if (!this.farmData) return;
        this.coopEgg.setVisible((this.farmData.eggsReady || 0) > 0);
    }

    renderCleanlinessVisual() {
        const cleanVal = this.farmData ? (this.farmData.cleanliness || 0) : 0;
        const area = getHenWalkArea(this);
        const key = JSON.stringify([cleanVal, this.farmData?.coopLevel, area]);
        if (this.rubbishVisualKey === key) return;
        this.rubbishVisualKey = key;
        this.rubbishGroup.clear(true, true);
        if (cleanVal > 50) {
            const count = Math.min(12, Math.floor((cleanVal - 50) / 4) + 2);
            for (let i = 0; i < count; i++) {
                let rx = Phaser.Math.Between(area.left, area.right);
                let ry = Phaser.Math.Between(area.top, area.bottom);
                this.rubbishGroup.add(this.add.image(rx, ry, 'rubbish').setDepth(2));
            }
        }
    }

    async askCleanMyFarm(cleanOnly = false) {
        if (farmActionsBlocked(this, hasPendingBackendBattle()) || !this.isSaveReady()) return;
        if (this.eggResultDialog || this.coopCleanDialog || this.coopCleanOpening || this.cleaningRequest || this.housingDialog) return;
        if (!cleanOnly && poultryState(this.farmData).hens.some(h=>h.isSick)) { openCoopActions(this); return; }
        const uncertain = FARM_BACKEND_ENABLED && hasPendingOwnClean();
        if (!uncertain && !(this.farmData?.cleanliness > 0)) {
            this.showFloatingText('雞舍非常乾淨，不需要打掃～', '#FFFFFF', 16); return;
        }
        const context = Object.freeze({ groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID, token: this.farmSceneToken });
        const valid = () => this.sys.isActive() && this.farmSceneToken === context.token;
        this.coopCleanOpening = context;
        try {
            const ui = await loadCoopCleanUI();
            if (!valid() || farmActionsBlocked(this, hasPendingBackendBattle())) return;
            return ui.openCoopCleanConfirm(this, { context, own: true, valid, uncertain, confirm: captured => this.cleanMyFarm(captured) });
        } catch {
            if (valid()) this.showFloatingText('打掃視窗暫時無法載入，請再點雞舍重試。', '#F44336', 14);
        } finally { if (this.coopCleanOpening === context) this.coopCleanOpening = null; }
    }

    cleanMyFarm(context = { groupId: CURRENT_GROUP_ID, accountId: CURRENT_ACCOUNT_ID, token: this.farmSceneToken }) {
        const active = () => this.sys.isActive() && this.farmSceneToken === context.token;
        if (!active() || context.groupId !== CURRENT_GROUP_ID || context.accountId !== CURRENT_ACCOUNT_ID) return Promise.resolve({ status: 'error', message: '雞舍已變更，請重新開啟視窗。' });
        if (farmActionsBlocked(this, hasPendingBackendBattle()) || !this.isSaveReady()) return Promise.resolve({ status: 'error', message: '請先完成進場確認、存檔連線與怪物結算。' });
        if (this.cleaningRequest) return this.cleaningRequest;
        const work = (async () => {
            try {
                await farmCommandOrLegacy('cleanOwn', {}, () => runTransaction(db, async transaction => {
                    const farm = (await transaction.get(myFarmRef)).data()?.farm;
                    if (!farm) throw Error('找不到目前農場。');
                    if (!(farm.cleanliness > 0)) throw Error('雞舍已經乾淨');
                    transaction.update(myFarmRef, { 'farm.cleanliness': 0 });
                }));
                return { status: 'success' };
            } catch (error) {
                const message = error?.message || '打掃失敗，請稍後重試。';
                if (/已經乾淨/.test(message)) {
                    if (active()) this.showFloatingText('雞舍已經很乾淨囉！', '#FFFFFF', 16);
                    return { status: 'already-clean' };
                }
                const uncertain = isUncertainSteal(error);
                if (active() && !this.coopCleanDialog) this.showFloatingText(uncertain ? '打掃結果尚未確認，請再點雞舍確認原交易。' : message, '#F44336', 14);
                return { status: 'error', uncertain, message };
            }
        })();
        this.cleaningRequest = work;
        void work.finally(() => { if (this.cleaningRequest === work) this.cleaningRequest = null; });
        return work;
    }

    syncHens() {
        if (!this.farmData) return;
        const outside = outdoorHens(this.farmData);
        const henCount = outside.length;
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

        this.layingVisit?.cancel();
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
            const hState = outside[i];
            const originalIndex = hensState.findIndex(h=>h.id===hState.id);
            
            const position = randomHenPosition(this);
            let newHen = addPoultrySprite(this, hState, position.x, position.y);
            newHen.henIndex = originalIndex;
            newHen.hState = hState;

            if (hState.isSick) {
                newHen.play(poultryAnim(newHen, 'idle'), true);
                const sickDuration = hState.sickTimestamp ? (now - hState.sickTimestamp) : 0;
                let iconKey = (sickDuration > 24 * 3600 * 1000) ? 'skull' : 'sick_pelt';
                
                let icon = this.add.image(newHen.x, newHen.y - 25, iconKey).setDepth(11);
                this.tweens.add({ targets: icon, y: newHen.y - 28, duration: 600, yoyo: true, repeat: -1 });
                newHen.statusIcon = icon;

                newHen.on('pointerdown', () => this.askTreatment(originalIndex));
            } else {
                newHen.play(poultryAnim(newHen, 'idle'), true);
                newHen.on('pointerdown', () => {
                if (farmActionsBlocked(this, hasPendingBackendBattle())) return;
                    if (!newHen.nesting && this.emptyClickCount < 4) {
                        // 同步放大點擊時的動畫比例 (原本是 1.1 / 0.9，改成基準值 2 乘上去，也就是 2.2 / 1.8)
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
        if (!this.isSaveReady()) return;
        try {
            await farmCommandOrLegacy('settlePoultry',{},()=>runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                if (!isFarmSave(snap.data()?.farm)) throw new Error('存檔未確認，停止更新雞隻');
                t.update(myFarmRef, poultryPatch(settlePoultry(snap.data().farm)));
            }));
            this.showFloatingText('有雞隻生病太久不幸離世了...', '#F44336', 16);
        } catch (e) { console.error(e); }
    }

    askTreatment(henIndex) {
        if (farmActionsBlocked(this, hasPendingBackendBattle())) return;
        if (!this.isSaveReady()) return;
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
        const targetId=this.selectedHenId || this.farmData?.hensState?.[henIndex]?.id;
        if(!targetId)return;
        return this.performTreatment({id:targetId});
    }
    async treatRandomSickHen() { return this.performTreatment({roll:Math.random()}); }
    async performTreatment(options) {
        if (farmActionsBlocked(this, hasPendingBackendBattle())) return;
        if(!this.isSaveReady()||this.isTreating)return;
        this.isTreating=true;
        try{
            await farmCommandOrLegacy('treatHen',{henId:options.id||null},()=>runTransaction(db,async t=>{
                const snapshot=await t.get(myFarmRef),farm=snapshot.data()?.farm;
                if(!isFarmSave(farm))throw Error('存檔尚未確認');
                t.update(myFarmRef,treatmentPatch(farm,{...options,now:Date.now()}));
            }));
            this.treatmentMessage='治療成功！雞隻恢復健康了！';
            this.showFloatingText(this.treatmentMessage,'#4CAF50',18);
        }catch(error){this.treatmentMessage=error.message||'治療失敗，請重試';this.showFloatingText(this.treatmentMessage,'#F44336',16);}
        finally{this.isTreating=false;}
    }

    wanderSingleHen(henSprite, fleeing = false) {
        if (!henSprite?.active || (henSprite.nesting && !fleeing) || (henSprite.hState?.isSick && !fleeing)) return;
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
        this.layingVisit?.update();
    }

    updateEggCountdown(now = Date.now()) {
        if (!this.timerText?.active || !this.farmData) return;
        if (!this.entryChecked) { this.timerText.setText('進入農場確認中…'); return; }
        if (this.isHarvesting) { this.timerText.setText(this.harvestStatus || '收蛋中…'); return; }
        const status = nextEggStatus(this.farmData, now);
        if (!status.hens) this.timerText.setText('雞舍空著，去商店選購雞隻吧！');
        else if (status.full) this.timerText.setText(`產能已滿 (${status.eggs} 顆)`);
        else if (!status.next) this.timerText.setText('雞隻生病了，請先治療');
        else {
            const ms = Math.ceil(status.next.ms / 1000) * 1000;
            const time = `${Math.floor(ms / 3600000)}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
            this.timerText.setText(`${BREEDS[status.next.breed].name}下顆蛋 ${time}`);
        }
    }

    startEggTimer() {
        if (this.farmInterval) return;
        const tick = async () => {
            if (document.hidden || !this.scene.isActive() || !this.timerText?.active || !this.farmData) return;
            const connection = this.registry.get('farmLoadState');
            if (connection && connection.phase !== 'ready') { this.timerText.setText(connection.phase === 'error' ? '存檔未確認，點此重試' : '讀取存檔中，請稍候…'); return; }
            const now = Date.now();
            this.updateEggCountdown(now);
            if (this.isUpdatingEggs || !productionChanged(this.farmData, now)) return;
            this.isUpdatingEggs = true;
            const illnessRolls = Array.from({ length: 20 }, () => Math.random());
            try {
                await farmCommandOrLegacy('settlePoultry',{},()=>runTransaction(db, async transaction => {
                    const snap = await transaction.get(myFarmRef), farm = snap.data()?.farm;
                    if (!isFarmSave(farm)) throw new Error('存檔未確認，停止更新雞蛋');
                    const state = settlePoultry(farm, now);
                    const added = Object.values(state.ready).reduce((a, b) => a + b, 0) - (farm.eggsReady || 0);
                    const risk = state.cleanliness > 80 ? 0.5 : state.cleanliness > 50 ? 0.2 : 0;
                    if (added > 0) state.hens.forEach((h, i) => { if (!h.isSick && illnessRolls[i] < risk) { h.isSick = true; h.sickTimestamp = now; } });
                    transaction.update(myFarmRef, poultryPatch(state));
                }));
            } catch (e) { console.error('生蛋計時更新失敗:', e); }
            finally { this.isUpdatingEggs = false; }
        };
        this.eggTick = tick;
        this.farmInterval = setInterval(tick, 1000);
    }

    async searchCabbage(cabSprite) {
        if (farmActionsBlocked(this, hasPendingBackendBattle()) || this.gardenSearching) return;
        const token = this.farmSceneToken || this.visitToken;
        const active = () => this.sys.isActive() && token === (this.farmSceneToken || this.visitToken);
        this.gardenSearching = true;
        try {
            if (!active()) return;
            await this.searchGardenPlant(cabSprite);
        } finally { if (active()) this.gardenSearching = false; }
    }

    async searchGardenPlant(cabSprite) {
        if (farmActionsBlocked(this, hasPendingBackendBattle())) return;
        if (!this.isSaveReady()) return;
        if (!this.farmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        if(FARM_BACKEND_ENABLED){
            try{const result=await farmCommand('searchGarden',{});if(result.caught&&this.gardenFeedback?.alive)this.gardenFeedback.show(result.foundType,cabSprite.x,cabSprite.y);}
            catch(error){this.showFloatingText(error.message||'未能收入倉庫，請重試','#F44336',14,cabSprite.x,cabSprite.y);}
            return;
        }
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
                if (farm.moleChallenge || getUsedSpace(farm) >= (farm.warehouseLimit || 10)) return false;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1, 'farm.gardenCatchCount': (farm.gardenCatchCount || 0) + 1 });
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
        if (!this.isSaveReady() || farmActionsBlocked(this, hasPendingBackendBattle())) return;
        if (this.isHarvesting || this.eggResultDialog || this.resumingPendingBattle || this.preparingEncounter || this.preparingMole || this.preparingCobra || this.preparingGiant) return;
        const activeBoss = [this.hornetEncounter, this.giantEncounter, this.moleEncounter, this.cobraEncounter, this.eagleEncounter, this.dragonEncounter, this.gorillaEncounter].find(boss => boss && !boss.destroyed && !boss.settled);
        if (activeBoss) {
            this.showFloatingText(`請先擊退${activeBoss.spec.name}並完成結算！`, '#FFD54F', 16);
            return;
        }

        const cobraToken = this.farmSceneToken;
        const active = () => this.sys.isActive() && this.farmSceneToken === cobraToken;
        // 在任何 await 前鎖住本次收蛋，包含蛇王檢查及雞舍驗證的等待時間。
        this.isHarvesting = true;
        this.harvestStatus = '確認雞舍中…';
        this.updateEggCountdown();
        try {
            if (!this.sys.isActive() || this.farmSceneToken !== cobraToken) return;

            if (!this.farmData || !Object.values(settlePoultry(this.farmData).ready).some(n => n > 0)) {
                this.emptyClickCount++;
                if (this.emptyClickTimer) this.emptyClickTimer.remove();
                this.emptyClickTimer = this.time.delayedCall(2000, () => this.emptyClickCount = 0);

                if (this.emptyClickCount >= 5) {
                    this.showFloatingText('沒蛋啦還一直點~咕咕', '#F44336', 16);
                    this.hensGroup.filter(hen => !hen.nesting).forEach(hen => {
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

            const usedSpace = getUsedSpace(this.farmData);
            const limit = this.farmData.warehouseLimit || 10;
        
            if (usedSpace >= limit) {
                this.showFloatingText('倉庫空間不足，請先擴充！', '#F44336', 14);
                return;
            }

            const authorized = FARM_BACKEND_ENABLED ? await farmCommand('homeEncounter', { verifyOnly: true, collectWhenClear: true }) : null;
            if (!active()) return;
            // 其他分頁可能新增戰鬥；操作驗證只攔下操作，不在收蛋中生成怪物。
            if (authorized?.challenge || authorized?.result) {
                this.showFloatingText('進場狀態已變更，請重新進入農場確認。', '#FFD54F', 15);
                return;
            }
            this.emptyClickCount = 0;
            this.harvestStatus = '收蛋中…';
            this.updateEggCountdown();

            // 舊 Functions 尚未更新時不會回傳 harvest，保留既有兩段流程，避免前後端發布先後造成收蛋中斷。
            const result = authorized?.harvest || await farmCommandOrLegacy('collectEggs',{},()=>runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(myFarmRef);
                if (!docSnap.exists() || !docSnap.data().farm) throw new Error('農場資料不存在');
                const farm = docSnap.data().farm;
                const result = collectPoultry(farm);
                if (!result.total && result.remaining) throw new Error('倉庫空間不足，請先擴充！');
                transaction.update(myFarmRef, result.patch);
                return result;

            }));
            if (!active()) return;
            this.hornetEncounter?.destroy(); this.eagleEncounter?.destroy(); this.dragonEncounter?.destroy(); this.gorillaEncounter?.destroy(); this.cobraEncounter?.destroy();
            this.eagleEncounter = null; this.hornetEncounter = null; this.dragonEncounter = null; this.gorillaEncounter = null; this.cobraEncounter = null; this.cobra = null;
            this.eagle = null; this.hornet = null; this.dragon = null; this.gorilla = null;
            if (this.layingVisit?.task && result.collected[this.layingVisit.task.breed] > 0 && Date.now() >= this.layingVisit.task.dueAt) this.layingVisit.cancel();
            const warning = result.remaining ? `\n倉庫空間不足，尚有 ${result.remaining} 顆蛋\n留在雞舍，請擴充倉庫！` : '';
            const summary = (Object.entries(result?.collected || {}).filter(([, n]) => n).map(([key, n]) => `${BREEDS[key]?.eggName || key} +${n}`).join('\n') || '雞舍目前沒有蛋') + warning;
            // 此處交易已成功；圖片或 DOM 失敗只能退回文字提示，不得重送收蛋或提示交易失敗。
            try {
                const ui = await loadEggResultUI();
                if (!active()) return;
                if (!await ui.openEggResult(this, result) && active()) this.showFloatingText(summary, '#FFD54F', result.remaining ? 14 : 18);
            } catch {
                console.error('farm-egg-result-display-failure', { total: result?.total });
                if (active()) this.showFloatingText(summary, '#FFD54F', result.remaining ? 14 : 18);
            }
        } catch (e) { if (active()) this.showFloatingText(e.message || '收蛋失敗，請稍後重試', '#F44336', 16); }
        finally {
            if (active()) {
                this.isHarvesting = false;
                this.harvestStatus = null;
                this.updateEggCountdown();
            }
        }
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

    showFloatingText(msg, color, fontSize = 22, x = 195, y = 422 - 60) {
        const floatTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1200, onComplete: () => floatTxt.destroy() });
    }

    showNoticeText(msg, color, fontSize, x, y) {
        if (this.noticeTxt) this.noticeTxt.destroy();
        this.noticeTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 2, backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 8, y: 8 } }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: this.noticeTxt, alpha: 0, duration: 3500, delay: 2000, onComplete: () => { if(this.noticeTxt) this.noticeTxt.destroy(); } });
    }
}
