import { BREEDS, breedOf } from './poultry.js';
export function registerPoultryAnimations(scene) {
    for (const breed of ['hen', 'silkie', 'bresse']) {
        for (const [action, start, end, fps] of [['idle', 0, 7, 5], ['walk', 8, 15, 8]]) {
            if (scene.anims.exists(`${breed}_${action}`)) continue;
            scene.anims.create({ key: `${breed}_${action}`, frames: scene.anims.generateFrameNumbers(breed, { start, end }), frameRate: fps, repeat: -1 });
        }
    }
}
export const poultryAnim = (sprite, action) => `${breedOf(sprite.hState)}_${action}`;
export function addPoultrySprite(scene, hState, x, y) {
    const sprite = scene.add.sprite(x, y, BREEDS[breedOf(hState)].texture, 0).setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' });
    sprite.hState = hState;
    sprite.setScale(64 / sprite.width);
    sprite.baseScale = sprite.scaleX;
    return sprite;
}
