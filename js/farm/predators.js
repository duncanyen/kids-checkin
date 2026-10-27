export function registerPredatorAnimations(scene) {
    for (const kind of ['wolf', 'tiger']) {
        for (const [action, start, rate, repeat] of [
            ['walk', 0, 4, -1], ['run', 4, 10, -1],
            ['hit', 8, 8, 0], ['dead', 12, 7, 0],
        ]) {
            const key = `${kind}_${action}`;
            if (!scene.anims.exists(key)) {
                scene.anims.create({
                    key,
                    frames: scene.anims.generateFrameNumbers(kind, { start, end: start + 3 }),
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
    // The sheet faces northeast; mirroring it produces northwest travel.
    sprite.setFlipX(scene.coop.x < x);
    sprite.play(`${kind}_walk`);
    sprite.on('animationcomplete', animation => {
        if (animation.key === `${kind}_hit` && sprite.active && !sprite.getData('resolved')) {
            sprite.play(`${kind}_walk`);
        }
    });
    return sprite;
}

export function hitPredator(sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    // A hit changes the pose, never the 50/60-second approach clock or path.
    sprite.play(`${sprite.texture.key}_hit`);
}

export function finishPredator(sprite, action) {
    if (!sprite.active || sprite.getData('resolved')) return false;
    sprite.setData('resolved', true).disableInteractive();
    sprite.moveTween?.stop();
    if (sprite.warning?.scene) {
        sprite.scene.tweens.killTweensOf(sprite.warning);
        sprite.warning.destroy();
    }
    if (action === 'run') sprite.setFlipX(false);
    sprite.play(`${sprite.texture.key}_${action}`);
    return true;
}

export function predatorDestination(scene) {
    return { x: scene.coop.x, y: scene.coop.y + scene.coop.displayHeight / 2 + 20 };
}

export function predatorSpawnPoint(scene, kind) {
    const destination = predatorDestination(scene);
    const x = kind === 'wolf' ? 390 - 70 : 70;
    // Equal horizontal/vertical travel matches the sheet's 45-degree heading.
    return { x, y: destination.y + Math.abs(destination.x - x) };
}
