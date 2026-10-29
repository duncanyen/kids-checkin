import { farmView } from './viewport.js';

export const TIGER_APPROACH_MS = 10000;
export const TIGER_DEADLINE_MS = 50000;
export const TIGER_ATTACK_INTERVAL_MS = 5000;

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
            sprite.play(`${kind}_${sprite.getData('atCoop') ? 'idle' : 'walk'}`);
        }
    });
    sprite.once('destroy', () => {
        sprite.attackTimer?.remove();
        sprite.deadlineTimer?.remove();
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
    if (kind === 'tiger') return {
        x: scene.coop.x - scene.coop.displayWidth * 0.35,
        y: scene.coop.y - scene.coop.displayHeight / 2 - 12,
    };
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

export function startTigerAttack(scene, sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    sprite.setData('atCoop', true).setFlipX(scene.coop.x < sprite.x).play('tiger_idle');
    sprite.attackTimer = scene.time.addEvent({
        delay: TIGER_ATTACK_INTERVAL_MS, loop: true,
        callback: () => {
            if (sprite.active && !sprite.getData('resolved')) {
                sprite.setFlipX(scene.coop.x < sprite.x).play('tiger_attack');
            }
        },
    });
}
