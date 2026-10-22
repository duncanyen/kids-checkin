import { chooseHenPosition } from './hen-navigation.js';

// Shared scenery keeps the home and visiting farms aligned with the same artwork.
export function addFarmBackground(scene, field = false) {
    if (field) {
        const map = getFarmMapLayout(scene);
        return scene.add.image(map.offsetX, 0, 'farm_map').setOrigin(0, 0)
            .setDisplaySize(720 * map.scale, 1280 * map.scale).setDepth(-10);
    }
    return scene.add.image(0, 0, 'farm_background')
        .setOrigin(0, 0)
        .setDisplaySize(scene.scale.width, scene.scale.height)
        .setDepth(-10);
}

// The supplied 720×1280 map is fitted without distortion; the outer tree
// margins are cropped by the canvas, leaving the house, clearing and plot.
export function getFarmMapLayout(scene) {
    const scale = Math.max(scene.scale.width / 720, scene.scale.height / 1280);
    const offsetX = (scene.scale.width - 720 * scale) / 2;
    return { scale, offsetX, point: (x, y) => ({ x: offsetX + x * scale, y: y * scale }) };
}

export function addFarmCoop(scene, onClick) {
    const map = getFarmMapLayout(scene);
    const position = map.point(370, 322.5);
    const coop = scene.add.zone(position.x, position.y, 260 * map.scale, 225 * map.scale)
        .setInteractive({ cursor: 'pointer' }).setData('mapCoop', true);
    coop.on('pointerdown', onClick);
    coop.levelBadge = scene.add.text(coop.x, coop.y + coop.height / 2 + 9, '', {
        fontSize: '11px', color: '#fff7dc', backgroundColor: '#66502acc', padding: { x: 7, y: 4 }
    }).setOrigin(0.5).setDepth(5);
    setCoopSize(coop);
    return coop;
}

export function farmEggPosition(scene) {
    return getFarmMapLayout(scene).point(327, 395);
}

export function addFarmSign(scene, onClick) {
    const position = getFarmMapLayout(scene).point(160, 940);
    const sign = scene.add.image(position.x, position.y, 'signboard')
        .setDisplaySize(32, 38).setDepth(5).setInteractive({ cursor: 'pointer' });
    sign.on('pointerdown', () => onClick(sign));
    return sign;
}

export function setCoopSize(coop, level = 1) {
    if (coop.getData('mapCoop')) {
        // Capacity upgrades remain unchanged. The baked map building keeps its
        // artwork aligned with its hit zone; its current level is shown here.
        coop.levelBadge.setText('雞舍 Lv.' + level);
        return;
    }
    const scale = level >= 3 ? 1.5 : level === 2 ? 1.2 : 1;
    coop.setDisplaySize(160 * scale, 150 * scale);
}

// All points lie in a convex clearing below the largest visible edge of the
// coop. Straight tween segments between them cannot cut through the building.
export function getHenWalkArea(scene) {
    const map = getFarmMapLayout(scene);
    return {
        left: Math.ceil(map.point(185, 0).x),
        right: Math.floor(map.point(545, 0).x),
        top: Math.ceil(Math.max(scene.coop.y + scene.coop.displayHeight / 2 + 40, map.point(0, 495).y + 32)),
        bottom: Math.floor(map.point(0, 900).y - 44),
    };
}

export function randomHenPosition(scene) {
    return chooseHenPosition(scene, getHenWalkArea(scene));
}

export function addVegetableGarden(scene, onPlantClick) {
    const map = getFarmMapLayout(scene);
    const rows = [961, 993, 1027, 1062, 1099, 1137];
    scene.gardenPlants = [];
    const corner = map.point(145, 900);
    scene.gardenBounds = { left: corner.x, top: corner.y,
        right: map.point(596, 0).x, bottom: map.point(0, 1194).y };
    // Seven columns and six rows follow the cabbages already painted on the
    // supplied map. Zones preserve the existing independent search actions.
    for (let row = 0; row < rows.length; row++) {
        const firstX = 217 - row * 3.2, spacing = 49 + row * 0.8;
        for (let column = 0; column < 7; column++) {
            const position = map.point(firstX + column * spacing, rows[row]);
            const plant = scene.add.zone(position.x, position.y, 28, 22)
                .setInteractive({ cursor: 'pointer' });
            plant.on('pointerdown', () => {
                if (plant.isAnimating) return;
                const pulse = scene.add.circle(plant.x, plant.y, 12, 0xffebad, 0.3)
                    .setStrokeStyle(2, 0xffedb4, 0.9).setDepth(4);
                scene.tweens.add({ targets: pulse, y: pulse.y - 8, alpha: 0,
                    duration: 250, onComplete: () => pulse.destroy() });
                onPlantClick(plant);
            });
            scene.gardenPlants.push(plant);
        }
    }

    return scene.gardenPlants;
}
