import { clearPoultryEggs } from './poultry.js';
import { equippedWeapon } from './combat-rules.js';
import { bossWeaponDamage, rollVisitBossEncounter } from './gorilla-rules.js';
import { readVillageAccess } from './villages.js';
import { db } from '../firebase-config.js';
import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID, myFarmRef, DRAGON_CONFIG, DRAGON_SCALE_PRICE, getUsedSpace } from './constants.js';

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
    const boss = rollVisitBossEncounter(level, roll, DRAGON_CONFIG.encounterOdds);
    if (boss) return boss;
    if (roll(1, 30) === 1) return 'tiger';
    if (roll(1, 10) === 1) return 'wolf';
    return null;
}

export function rollHomeDragonEncounter(level, roll = Phaser.Math.Between) {
    return (level || 1) >= 2 && roll(1, DRAGON_CONFIG.homeEncounterOdds) === 1;
}

// Both the egg loss and coin penalty commit together; retries cannot duplicate loot.
export async function settleDragonEncounter(id, outcome, targetAccountId, targetGroupId = CURRENT_GROUP_ID) {
    if (!['win', 'loss'].includes(outcome)) throw new Error('無效的戰鬥結果');
    const targetRef = doc(db, 'groups', targetGroupId, 'users', targetAccountId);
    return runTransaction(db, async transaction => {
        await readVillageAccess(CURRENT_GROUP_ID, targetGroupId, CURRENT_ACCOUNT_ID, ref => transaction.get(ref), targetAccountId);
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
            const eggUpdates = clearPoultryEggs(target);
            if (targetRef.path === myFarmRef.path) Object.assign(updates, eggUpdates);
            else transaction.update(targetRef, eggUpdates);
        }
        // Bound the retry journal; retain recent encounters across parallel tabs.
        updates['farm.dragonResults'] = [...results.slice(-31), result];
        transaction.update(myFarmRef, updates);
        return result;
    });
}

const DRAGON_SPEC = {
    key: 'dragon', name: '烈火龍', config: DRAGON_CONFIG, size: 176,
    travel: 'fly', attack: 'fire', attackPhase: 'fire',
    movingLabel: '飛近雞舍中', attackLabel: '噴火中', reward: '龍麟',
    salePrice: DRAGON_SCALE_PRICE, settle: settleDragonEncounter,
};

export class BossEncounter {
    constructor(scene, spec) {
        this.scene = scene;
        this.spec = spec;
        this.config = spec.config;
        this.targetAccountId = scene.targetAccountId || CURRENT_ACCOUNT_ID;
        this.targetGroupId = scene.targetGroupId || CURRENT_GROUP_ID;
        this.id = crypto.randomUUID();
        this.health = this.config.health;
        this.phase = 'flight';
        this.result = null;
        this.destroyed = false;
        this.settling = false;
        this.weapon = equippedWeapon(scene.myFarmData || scene.farmData);
        this.damage = bossWeaponDamage(this.weapon, spec.key);
        this.destination = { x: Math.max(spec.minX || 80, scene.coop.getBounds().left - (spec.approachInset || 34)), y: scene.coop.getBounds().bottom + 10 };
        this.sprite = scene.add.sprite(spec.spawnX || 58, scene.scale.height - 140, spec.key, 0)
            .setOrigin(0.5, 0.875).setDisplaySize(spec.size, spec.size).setDepth(25)
            .setInteractive({ cursor: 'pointer', hitArea: new Phaser.Geom.Rectangle(12, 12, spec.frameSize - 24, spec.frameSize - 24), hitAreaCallback: Phaser.Geom.Rectangle.Contains });
        scene[spec.key] = this.sprite;
        this.sprite.play(`${spec.key}_${spec.travel}`);
        this.sprite.on('pointerdown', pointer => this.hit(pointer));
        this.sprite.on('animationcomplete', animation => {
            if (!this.result && animation.key === `${spec.key}_hit`) this.sprite.play(`${spec.key}_${this.phase === spec.attackPhase ? spec.attack : spec.travel}`);
        });
        this.weaponSprite = scene.add.image(0, 0, this.weapon.icon).setDisplaySize(64, 86).setDepth(28).setVisible(false);
        this.warning = scene.add.text(195, 112, '', {
            fontSize: '15px', color: '#FFF2CC', fontStyle: 'bold', align: 'center',
            backgroundColor: '#542723', padding: { x: 12, y: 8 },
        }).setOrigin(0.5).setDepth(31);
        this.healthBack = scene.add.rectangle(195, 164, 220, 8, 0x522422).setDepth(31);
        this.healthBar = scene.add.rectangle(85, 164, 220, 8, 0xffae45).setOrigin(0, 0.5).setDepth(32);
        this.flame = scene.add.graphics().setDepth(24).setVisible(false);
        this.flight = scene.tweens.add({ targets: this.sprite, ...this.destination, duration: this.config.flightMs, ease: 'Cubic.Out' });
        this.arrivalTimer = scene.time.delayedCall(this.config.flightMs, () => this.startFire());
        this.deadlineTimer = scene.time.delayedCall(this.config.durationMs, () => this.resolve('loss'));
        this.displayTimer = scene.time.addEvent({ delay: 100, loop: true, callback: () => this.refresh() });
        this.refresh();
        scene.avoidPredators();
    }

    startFire() {
        if (this.destroyed || this.result) return;
        this.phase = this.spec.attackPhase;
        this.flight.stop();
        this.sprite.setPosition(this.destination.x, this.destination.y).play(`${this.spec.key}_${this.spec.attack}`);
        this.flame.setVisible(true);
        this.refresh();
    }

    refresh() {
        if (this.destroyed || this.result) return;
        const remaining = Math.max(0, Math.ceil(this.deadlineTimer.getRemaining() / 1000));
        this.warning.setText(`${this.spec.name}來襲！${remaining} 秒\n${this.weapon.name}再打 ${Math.ceil(this.health / this.damage)} 下・${this.phase === this.spec.attackPhase ? this.spec.attackLabel : this.spec.movingLabel}`);
        this.healthBar.width = 220 * this.health / this.config.health;
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
        } else if (this.phase === 'attack') {
            const pulse = .5 + .5 * Math.sin(this.scene.time.now / 140);
            const x = this.sprite.x + 65, y = this.sprite.y - 30;
            this.flame.clear().lineStyle(3, 0xffd57a, pulse * .7)
                .strokeEllipse(x, y, 22 + pulse * 18, 32 + pulse * 12)
                .fillStyle(0xd8bc83, pulse * .3).fillEllipse(x - 10, this.sprite.y, 58, 12);
        }
    }

    hit(pointer) {
        if (this.destroyed || this.result) return;
        if (this.deadlineTimer.getRemaining() <= 0) { this.resolve('loss'); return; }
        this.health = Math.max(0, this.health - this.damage);
        this.sprite.play(`${this.spec.key}_hit`);
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
        this.healthBar.width = 220 * this.health / this.config.health;
        this.warning.setText('戰鬥結算中…');
        this.sprite.play(`${this.spec.key}_${outcome === 'win' ? 'dead' : this.spec.travel}`);
        this.scene.tweens.add({ targets: this.sprite, alpha: 0, ...(outcome === 'loss' ? { x: -120, y: this.sprite.y + (this.spec.escapeRise ?? -100) } : {}), duration: 1200, delay: outcome === 'win' ? 850 : 0 });
        this.settle();
    }

    async settle() {
        if (this.settling || this.settled || this.destroyed) return;
        this.settling = true;
        this.warning.disableInteractive();
        try {
            const result = await this.spec.settle(this.id, this.result, this.targetAccountId, this.targetGroupId);
            this.settled = true;
            if (this.destroyed) return;
            this.warning.setText(result.outcome === 'win'
                ? `擊退${this.spec.name}！${this.spec.reward} ×1 已收入倉庫${result.overflow ? '\n倉庫已滿，請先出售或擴充' : `\n可在商店售出 ${this.spec.salePrice} 金幣`}`
                : `防守失敗！雞舍內的蛋已全數損失\n扣除 ${result.coinsLost} 金幣`);
            this.scene.time.delayedCall(6000, () => { if (!this.destroyed) this.warning.setVisible(false); });
            this.healthBack.setVisible(false);
            this.healthBar.setVisible(false);
        } catch (error) {
            console.error(`${this.spec.name}結算失敗`, error);
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

export class DragonEncounter extends BossEncounter {
    constructor(scene) { super(scene, { ...DRAGON_SPEC, frameSize: 256 }); }
}
