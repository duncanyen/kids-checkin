import { db } from '../firebase-config.js';
import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, DRAGON_CONFIG, WEAPONS_CONFIG, getUsedSpace, LAY_EGG_TIME_MS } from './constants.js';

export function registerDragonAnimations(scene) {
    for (const [action, row, repeat] of [['fly', 0, -1], ['fire', 1, -1], ['hit', 2, 0], ['dead', 3, 0]]) {
        if (!scene.anims.exists(`dragon_${action}`)) scene.anims.create({
            key: `dragon_${action}`,
            frames: scene.anims.generateFrameNumbers('dragon', { start: row * 8, end: row * 8 + 7 }),
            frameRate: action === 'hit' ? 16 : 10,
            repeat,
        });
    }
}

// Roll once, after the visited farm arrives. Level 1 never rolls for a dragon.
export function rollVisitEncounter(level, roll = Phaser.Math.Between) {
    if ((level || 1) >= 2 && roll(1, DRAGON_CONFIG.encounterOdds) === 1) return 'dragon';
    if (roll(1, 30) === 1) return 'tiger';
    if (roll(1, 10) === 1) return 'wolf';
    return null;
}

export function rollHomeDragonEncounter(level, roll = Phaser.Math.Between) {
    return (level || 1) >= 2 && roll(1, DRAGON_CONFIG.homeEncounterOdds) === 1;
}

// Both the egg loss and coin penalty commit together; retries cannot duplicate loot.
export async function settleDragonEncounter(id, outcome, targetAccountId) {
    if (!['win', 'loss'].includes(outcome)) throw new Error('無效的戰鬥結果');
    const targetRef = doc(db, 'groups', CURRENT_GROUP_ID, 'users', targetAccountId);
    return runTransaction(db, async transaction => {
        const ownSnap = await transaction.get(myFarmRef);
        const own = ownSnap.data()?.farm;
        if (!own) throw new Error('找不到玩家農場');
        const results = own.dragonResults || [];
        const previous = results.find(result => result.id === id);
        if (previous) return previous;
        const updates = {};
        const result = { id, outcome };
        if (outcome === 'win') {
            // Boss loot is guaranteed, including when the warehouse is already full.
            updates['farm.dragonScales'] = (own.dragonScales || 0) + 1;
            result.overflow = getUsedSpace(own) >= (own.warehouseLimit || 10);
        } else {
            const targetSnap = await transaction.get(targetRef);
            const target = targetSnap.data()?.farm;
            if (!target) throw new Error('找不到目標雞舍');
            result.coinsLost = Math.min(DRAGON_CONFIG.coinPenalty, Math.max(0, own.coins || 0));
            updates['farm.coins'] = Math.max(0, (own.coins || 0) - DRAGON_CONFIG.coinPenalty);
            const eggUpdates = { 'farm.eggsReady': 0 };
            // Consume any production ticks accrued during combat, without erasing
            // progress toward the next egg or allowing old eggs to reappear.
            if (Number.isFinite(target.lastLayTime)) {
                const now = Date.now();
                const interval = Math.floor(LAY_EGG_TIME_MS / Math.max(1, target.hens || 1));
                const ticks = Math.max(0, Math.floor((now - target.lastLayTime) / interval));
                eggUpdates['farm.lastLayTime'] = (target.eggsReady || 0) >= Math.max(1, target.hens || 1) * 6
                    ? now : target.lastLayTime + ticks * interval;
            }
            if (targetRef.path === myFarmRef.path) Object.assign(updates, eggUpdates);
            else transaction.update(targetRef, eggUpdates);
        }
        // Bound the retry journal; retain recent encounters across parallel tabs.
        updates['farm.dragonResults'] = [...results.slice(-31), result];
        transaction.update(myFarmRef, updates);
        return result;
    });
}

export class DragonEncounter {
    constructor(scene) {
        this.scene = scene;
        this.targetAccountId = scene.targetAccountId || CURRENT_ACCOUNT_ID;
        this.id = crypto.randomUUID();
        this.health = DRAGON_CONFIG.health;
        this.phase = 'flight';
        this.result = null;
        this.destroyed = false;
        this.settling = false;
        const equipped = (scene.myFarmData || scene.farmData)?.equippedWeapon || 'club';
        this.weapon = WEAPONS_CONFIG[equipped] || WEAPONS_CONFIG.club;
        this.damage = Math.max(1, Number(this.weapon.damage) || 1);
        this.destination = { x: Math.max(80, scene.coop.getBounds().left - 34), y: scene.coop.getBounds().bottom + 10 };
        this.sprite = scene.add.sprite(58, scene.scale.height - 140, 'dragon', 0)
            .setOrigin(0.5, 0.875).setDisplaySize(176, 176).setDepth(25)
            .setInteractive({ cursor: 'pointer', hitArea: new Phaser.Geom.Rectangle(12, 12, 232, 232), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
        scene.dragon = this.sprite;
        this.sprite.play('dragon_fly');
        this.sprite.on('pointerdown', pointer => this.hit(pointer));
        this.sprite.on('animationcomplete', animation => {
            if (!this.result && animation.key === 'dragon_hit') this.sprite.play(this.phase === 'fire' ? 'dragon_fire' : 'dragon_fly');
        });
        this.weaponSprite = scene.add.image(0, 0, this.weapon.icon).setScale(1.5).setDepth(28).setVisible(false);
        this.warning = scene.add.text(195, 112, '', {
            fontSize: '15px', color: '#FFF2CC', fontStyle: 'bold', align: 'center',
            backgroundColor: '#542723', padding: { x: 12, y: 8 },
        }).setOrigin(0.5).setDepth(31);
        this.healthBack = scene.add.rectangle(195, 164, 220, 8, 0x522422).setDepth(31);
        this.healthBar = scene.add.rectangle(85, 164, 220, 8, 0xffae45).setOrigin(0, 0.5).setDepth(32);
        this.flame = scene.add.graphics().setDepth(24).setVisible(false);
        this.flight = scene.tweens.add({ targets: this.sprite, ...this.destination, duration: DRAGON_CONFIG.flightMs, ease: 'Cubic.Out' });
        this.arrivalTimer = scene.time.delayedCall(DRAGON_CONFIG.flightMs, () => this.startFire());
        this.deadlineTimer = scene.time.delayedCall(DRAGON_CONFIG.durationMs, () => this.resolve('loss'));
        this.displayTimer = scene.time.addEvent({ delay: 100, loop: true, callback: () => this.refresh() });
        this.refresh();
        scene.avoidPredators();
    }

    startFire() {
        if (this.destroyed || this.result) return;
        this.phase = 'fire';
        this.flight.stop();
        this.sprite.setPosition(this.destination.x, this.destination.y).play('dragon_fire');
        this.flame.setVisible(true);
        this.refresh();
    }

    refresh() {
        if (this.destroyed || this.result) return;
        const remaining = Math.max(0, Math.ceil(this.deadlineTimer.getRemaining() / 1000));
        this.warning.setText(`烈火龍來襲！${remaining} 秒\n${this.weapon.name}再打 ${Math.ceil(this.health / this.damage)} 下${this.phase === 'fire' ? '・噴火中' : '・飛近雞舍中'}`);
        this.healthBar.width = 220 * this.health / DRAGON_CONFIG.health;
        if (this.phase === 'fire') {
            const mouthX = this.sprite.x + 57, mouthY = this.sprite.y - 70;
            const endX = Math.max(mouthX + 55, this.scene.coop.x + 15);
            const pulse = 3 * Math.sin(this.scene.time.now / 75);
            this.flame.clear().fillStyle(0xff5b18, 0.85)
                .fillTriangle(mouthX, mouthY, endX, mouthY - 17 - pulse, endX, mouthY + 17 + pulse)
                .fillEllipse(endX, mouthY, 30, 34 + pulse)
                .fillStyle(0xffcb35, 0.95)
                .fillTriangle(mouthX, mouthY, endX, mouthY - 10, endX, mouthY + 10)
                .fillStyle(0xfff4ad, 1).fillEllipse(endX - 6, mouthY, 17, 12);
        }
    }

    hit(pointer) {
        if (this.destroyed || this.result) return;
        if (this.deadlineTimer.getRemaining() <= 0) { this.resolve('loss'); return; }
        this.health = Math.max(0, this.health - this.damage);
        this.sprite.play('dragon_hit');
        this.scene.tweens.killTweensOf(this.weaponSprite);
        this.weaponSprite.setPosition(pointer?.x ?? this.sprite.x + 35, pointer?.y ?? this.sprite.y - 40).setAngle(-45).setVisible(true);
        this.scene.tweens.add({ targets: this.weaponSprite, angle: 45, duration: 55, yoyo: true, onComplete: () => this.weaponSprite.setVisible(false) });
        if (this.health === 0) this.resolve('win');
        else this.refresh();
    }

    resolve(outcome) {
        if (this.destroyed || this.result) return;
        this.result = outcome; // Lock immediately, before any asynchronous writes.
        this.phase = 'resolved';
        this.arrivalTimer.remove();
        this.deadlineTimer.remove();
        this.displayTimer.remove();
        this.flight.stop();
        this.sprite.disableInteractive().setData('resolved', true);
        this.flame.setVisible(false);
        this.scene.tweens.killTweensOf(this.weaponSprite);
        this.weaponSprite.setVisible(false);
        this.healthBar.width = 220 * this.health / DRAGON_CONFIG.health;
        this.warning.setText('戰鬥結算中…');
        this.sprite.play(outcome === 'win' ? 'dragon_dead' : 'dragon_fly');
        this.scene.tweens.add({ targets: this.sprite, alpha: 0, ...(outcome === 'loss' ? { x: -120, y: this.sprite.y - 100 } : {}), duration: 1200, delay: outcome === 'win' ? 850 : 0 });
        this.settle();
    }

    async settle() {
        if (this.settling || this.settled || this.destroyed) return;
        this.settling = true;
        this.warning.disableInteractive();
        try {
            const result = await settleDragonEncounter(this.id, this.result, this.targetAccountId);
            this.settled = true;
            if (this.destroyed) return;
            this.warning.setText(result.outcome === 'win'
                ? `擊退烈火龍！龍麟 ×1 已收入倉庫${result.overflow ? '\n倉庫已滿，請先出售或擴充' : '\n可在商店售出 200 金幣'}`
                : `防守失敗！雞舍內的蛋已全數損失\n扣除 ${result.coinsLost} 金幣`);
            this.scene.time.delayedCall(6000, () => { if (!this.destroyed) this.warning.setVisible(false); });
            this.healthBack.setVisible(false);
            this.healthBar.setVisible(false);
        } catch (error) {
            console.error('烈火龍結算失敗', error);
            if (!this.destroyed) this.warning.setText('結算尚未完成，點此重試').setInteractive({ cursor: 'pointer' });
        } finally { this.settling = false; }
        if (!this.destroyed && !this.settled) this.warning.once('pointerdown', () => this.settle());
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.arrivalTimer.remove();
        this.deadlineTimer.remove();
        this.displayTimer.remove();
        this.flight.stop();
        for (const object of [this.sprite, this.flame, this.weaponSprite, this.warning, this.healthBack, this.healthBar]) {
            this.scene.tweens.killTweensOf(object);
            object.destroy();
        }
    }
}
