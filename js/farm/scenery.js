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
