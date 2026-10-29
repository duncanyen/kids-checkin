import { farmView } from './viewport.js';

export const TIGER_APPROACH_MS = 10000;
export const TIGER_DEADLINE_MS = 50000;
export const TIGER_ATTACK_INTERVAL_MS = 5000;
const TIGER_PATROL_SPEED = 45;

// Use the painted landmarks, so the route stays in the hens' clearing on both
// portrait and panoramic maps. Coordinates describe the tiger's grounded feet.
export function tigerPatrolArea(scene) {
    const view = farmView(scene);
    const garden = scene.gardenBounds;
    const left = Math.max(view.left + 84, garden.left + 32);
    const right = Math.max(left, Math.min(view.left + view.width - 84, garden.right - 32));
    const bottom = garden.top - 24;
    const top = Math.min(bottom, scene.coop.getBounds().bottom + 90);
    return { left, right, top, bottom, y: top + (bottom - top) * 0.55 };
}

export function nearestTigerHen(scene, sprite) {
    return (scene.hensGroup || []).filter(hen => hen.active && hen.visible)
        .reduce((nearest, hen) => !nearest || Math.hypot(hen.x - sprite.x, hen.y - sprite.y) <
            Math.hypot(nearest.x - sprite.x, nearest.y - sprite.y) ? hen : nearest, null);
}

function resumeTigerPatrol(sprite) {
    sprite.setFlipX(sprite.patrolDirection < 0).play('tiger_walk');
    sprite.moveTween?.resume();
}

function walkTigerPatrol(scene, sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    const area = tigerPatrolArea(scene);
    const x = sprite.patrolDirection > 0 ? area.right : area.left;
    sprite.moveTween = scene.tweens.add({
        targets: sprite, x, y: area.y,
        duration: Math.max(200, Math.abs(x - sprite.x) / TIGER_PATROL_SPEED * 1000), ease: 'Linear',
        onComplete: () => {
            sprite.patrolDirection *= -1;
            walkTigerPatrol(scene, sprite);
        },
    });
    if (['tiger_attack', 'tiger_hit'].includes(sprite.anims.currentAnim?.key)) sprite.moveTween.pause();
    else resumeTigerPatrol(sprite);
}

export function reflowTigerPatrol(scene, sprite) {
    const area = tigerPatrolArea(scene);
    sprite.moveTween?.stop();
    sprite.setPosition(Math.max(area.left, Math.min(area.right, sprite.x)), area.y);
    walkTigerPatrol(scene, sprite);
}

export function registerPredatorAnimations(scene) {
    for (const kind of ['wolf', 'tiger']) {
        if (!scene.textures.exists(kind)) continue;
        const actions = kind === 'tiger' ? [
            ['idle', 0, 1, -1, 0], ['walk', 0, 6, -1], ['run', 0, 12, -1],
            ['attack', 4, 8, 0], ['hit', 8, 8, 0], ['dead', 12, 7, 0],
        ] : [
            ['walk', 0, 4, -1], ['run', 4, 10, -1],
            ['hit', 8, 8, 0], ['dead', 12, 7, 0],
        ];
        for (const [action, start, rate, repeat, end = start + 3] of actions) {
            const key = `${kind}_${action}`;
            if (!scene.anims.exists(key)) {
                scene.anims.create({
                    key,
                    frames: scene.anims.generateFrameNumbers(kind, { start, end }),
                    frameRate: rate,
                    repeat,
                });
            }
        }
    }
}

export function createPredator(scene, kind, x, y) {
    const sprite = scene.add.sprite(x, y, kind, 0)
        .setOrigin(0.5, 0.875).setDisplaySize(192, 192).setDepth(25)
        .setInteractive({
            cursor: 'pointer',
            hitArea: new Phaser.Geom.Rectangle(24, 16, 208, 224),
            hitAreaCallback: Phaser.Geom.Rectangle.Contains,
        });
    // Both tiger walk and attack frames face right in the atlas.
    sprite.setFlipX(scene.coop.x < x);
    sprite.play(`${kind}_walk`);
    sprite.on('animationcomplete', animation => {
        if ([`${kind}_hit`, `${kind}_attack`].includes(animation.key) && sprite.active && !sprite.getData('resolved')) {
            if (kind === 'tiger' && sprite.getData('patrolling')) resumeTigerPatrol(sprite);
            else sprite.play(`${kind}_walk`);
        }
    });
    sprite.once('destroy', () => {
        sprite.attackTimer?.remove();
        sprite.deadlineTimer?.remove();
        sprite.moveTween?.stop();
    });
    return sprite;
}

export function hitPredator(sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    // A hit changes the pose, never the approach path or encounter deadline.
    sprite.play(`${sprite.texture.key}_hit`);
}

export function finishPredator(sprite, action) {
    if (!sprite.active || sprite.getData('resolved')) return false;
    sprite.setData('resolved', true).disableInteractive();
    sprite.moveTween?.stop();
    sprite.attackTimer?.remove();
    sprite.deadlineTimer?.remove();
    if (sprite.warning?.scene) {
        sprite.scene.tweens.killTweensOf(sprite.warning);
        sprite.warning.destroy();
    }
    if (action === 'run') sprite.setFlipX(false);
    sprite.play(`${sprite.texture.key}_${action}`);
    return true;
}

export function predatorDestination(scene, kind = 'wolf') {
    if (kind === 'tiger') {
        const area = tigerPatrolArea(scene);
        return { x: area.left, y: area.y };
    }
    return { x: scene.coop.x, y: scene.coop.y + scene.coop.displayHeight / 2 + 20 };
}

export function predatorSpawnPoint(scene, kind) {
    if (kind === 'tiger') {
        const view = farmView(scene);
        return { x: view.left + 65, y: view.top + view.height - 60 };
    }
    const destination = predatorDestination(scene);
    const x = kind === 'wolf' ? 390 - 70 : 70;
    // Equal horizontal/vertical travel matches the sheet's 45-degree heading.
    return { x, y: destination.y + Math.abs(destination.x - x) };
}

export function startTigerPatrol(scene, sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    sprite.setData('patrolling', true);
    sprite.patrolDirection = 1;
    walkTigerPatrol(scene, sprite);
    sprite.attackTimer = scene.time.addEvent({
        delay: TIGER_ATTACK_INTERVAL_MS, loop: true,
        callback: () => {
            if (sprite.active && !sprite.getData('resolved')) {
                const hen = nearestTigerHen(scene, sprite);
                if (!hen) return;
                sprite.moveTween?.pause();
                sprite.attackTarget = hen;
                sprite.setFlipX(hen.x < sprite.x).play('tiger_attack');
            }
        },
    });
}
