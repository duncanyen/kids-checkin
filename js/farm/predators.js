import { farmView } from './viewport.js';

export const PREDATOR_APPROACH_MS = 10000;
export const TIGER_DEADLINE_MS = 50000;
export const WOLF_DEADLINE_MS = 60000;
export const PREDATOR_ATTACK_INTERVAL_MS = 5000;
const PREDATOR_PATROL_SPEED = 45;

// Use the painted landmarks, so the route stays in the hens' clearing on both
// portrait and panoramic maps. Coordinates describe the predator's grounded feet.
export function predatorPatrolArea(scene) {
    const view = farmView(scene);
    const garden = scene.gardenBounds;
    const left = Math.max(view.left + 84, garden.left + 32);
    const right = Math.max(left, Math.min(view.left + view.width - 84, garden.right - 32));
    const bottom = garden.top - 24;
    const top = Math.min(bottom, scene.coop.getBounds().bottom + 90);
    return { left, right, top, bottom, y: top + (bottom - top) * 0.55 };
}

export function nearestPredatorHen(scene, sprite) {
    return (scene.hensGroup || []).filter(hen => hen.active && hen.visible)
        .reduce((nearest, hen) => !nearest || Math.hypot(hen.x - sprite.x, hen.y - sprite.y) <
            Math.hypot(nearest.x - sprite.x, nearest.y - sprite.y) ? hen : nearest, null);
}

function resumePredatorPatrol(sprite) {
    sprite.setFlipX(sprite.patrolDirection < 0).play(`${sprite.texture.key}_walk`);
    sprite.moveTween?.resume();
}

function walkPredatorPatrol(scene, sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    const area = predatorPatrolArea(scene);
    const x = sprite.patrolDirection > 0 ? area.right : area.left;
    sprite.moveTween = scene.tweens.add({
        targets: sprite, x, y: area.y,
        duration: Math.max(200, Math.abs(x - sprite.x) / PREDATOR_PATROL_SPEED * 1000), ease: 'Linear',
        onComplete: () => {
            sprite.patrolDirection *= -1;
            walkPredatorPatrol(scene, sprite);
        },
    });
    const kind = sprite.texture.key;
    if ([`${kind}_attack`, `${kind}_hit`].includes(sprite.anims.currentAnim?.key)) sprite.moveTween.pause();
    else resumePredatorPatrol(sprite);
}

export function reflowPredatorPatrol(scene, sprite) {
    const area = predatorPatrolArea(scene);
    sprite.moveTween?.stop();
    sprite.setPosition(Math.max(area.left, Math.min(area.right, sprite.x)), area.y);
    walkPredatorPatrol(scene, sprite);
}

export function registerPredatorAnimations(scene) {
    for (const kind of ['wolf', 'tiger']) {
        if (!scene.textures.exists(kind)) continue;
        const actions = [
            ['idle', 0, 1, -1, 0], ['walk', 0, 6, -1], ['run', 0, 12, -1],
            ['attack', 4, 8, 0], ['hit', 8, 8, 0], ['dead', 12, 7, 0],
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
    // Both predator atlases face right; mirroring handles leftward movement.
    sprite.setFlipX(scene.coop.x < x);
    sprite.play(`${kind}_walk`);
    sprite.on('animationcomplete', animation => {
        if ([`${kind}_hit`, `${kind}_attack`].includes(animation.key) && sprite.active && !sprite.getData('resolved')) {
            if (sprite.getData('patrolling')) resumePredatorPatrol(sprite);
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
    const area = predatorPatrolArea(scene);
    return { x: kind === 'wolf' ? area.right : area.left, y: area.y };
}

export function predatorSpawnPoint(scene, kind) {
    const view = farmView(scene);
    return { x: view.left + (kind === 'wolf' ? view.width - 65 : 65), y: view.top + view.height - 60 };
}

export function startPredatorPatrol(scene, sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    sprite.setData('patrolling', true);
    sprite.patrolDirection = sprite.texture.key === 'wolf' ? -1 : 1;
    walkPredatorPatrol(scene, sprite);
    sprite.attackTimer = scene.time.addEvent({
        delay: PREDATOR_ATTACK_INTERVAL_MS, loop: true,
        callback: () => {
            if (sprite.active && !sprite.getData('resolved')) {
                const hen = nearestPredatorHen(scene, sprite);
                if (!hen) return;
                sprite.moveTween?.pause();
                sprite.attackTarget = hen;
                sprite.setFlipX(hen.x < sprite.x).play(`${sprite.texture.key}_attack`);
            }
        },
    });
}
