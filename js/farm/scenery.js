// Shared scenery keeps the home and visiting farms aligned with the same artwork.
export function addFarmBackground(scene) {
    return scene.add.image(0, 0, 'farm_background')
        .setOrigin(0, 0)
        .setDisplaySize(scene.scale.width, scene.scale.height)
        .setDepth(-10);
}

export function setCoopSize(coop, level = 1) {
    const scale = level >= 3 ? 1.5 : level === 2 ? 1.2 : 1;
    coop.setDisplaySize(160 * scale, 150 * scale);
}

// All points lie in a convex clearing below the largest visible edge of the
// coop. Straight tween segments between them cannot cut through the building.
export function getHenWalkArea(scene) {
    return {
        left: 60,
        right: scene.scale.width - 60,
        top: Math.ceil(scene.coop.y + scene.coop.displayHeight / 2 + 40),
        bottom: scene.cameras.main.centerY,
    };
}

export function randomHenPosition(scene) {
    const area = getHenWalkArea(scene);
    return {
        x: Phaser.Math.Between(area.left, area.right),
        y: Phaser.Math.Between(area.top, Math.max(area.top, area.bottom)),
    };
}

export function addVegetableGarden(scene, onPlantClick) {
    const startX = scene.cameras.main.centerX - 117;
    const startY = scene.cameras.main.centerY + 80;
    const spacing = 26;

    scene.add.image(scene.cameras.main.centerX, startY + 117, 'garden_bed')
        .setDisplaySize(330, 330).setDepth(1);

    for (let row = 0; row < 10; row++) {
        for (let column = 0; column < 10; column++) {
            const plant = scene.add.image(startX + column * spacing, startY + row * spacing, 'cabbage')
                .setDisplaySize(24, 24).setDepth(2)
                .setInteractive({ cursor: 'pointer' });
            plant.on('pointerdown', () => onPlantClick(plant));
        }
    }

    return { startX, startY };
}
