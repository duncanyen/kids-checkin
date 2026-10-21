export function registerPredatorAnimations(scene) {
    for (const kind of ['wolf', 'tiger']) {
        for (const [action, start, rate, repeat] of [
            ['walk', 0, 7, -1], ['run', 4, 12, -1],
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
        .setDisplaySize(144, 144).setDepth(25)
        .setInteractive({ cursor: 'pointer' });
    sprite.setFlipX(scene.coop.x < x);
    sprite.play(`${kind}_run`);
    scene.time.delayedCall(900, () => {
        if (sprite.active && !sprite.getData('resolved') && sprite.anims.currentAnim?.key === `${kind}_run`) {
            sprite.play(`${kind}_walk`);
        }
    });
    sprite.on('animationcomplete', animation => {
        if (animation.key === `${kind}_hit` && sprite.active && !sprite.getData('resolved')) {
            sprite.moveTween?.resume();
            sprite.play(`${kind}_walk`);
        }
    });
    return sprite;
}

export function hitPredator(sprite) {
    if (!sprite.active || sprite.getData('resolved')) return;
    sprite.moveTween?.pause();
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
