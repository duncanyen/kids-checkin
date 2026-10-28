import { onSceneExit } from './scene-cleanup.js';
// Keep the existing HUD/character units while the canvas fills its container.
export const FARM_WIDTH = 390;
export const FARM_HEIGHT = 844;

export function farmView(scene) {
    const width = scene.scale.width, height = scene.scale.height;
    const zoom = Math.min(width / FARM_WIDTH, height / FARM_HEIGHT);
    const worldWidth = width / zoom, worldHeight = height / zoom;
    return { zoom, width: worldWidth, height: worldHeight,
        left: (FARM_WIDTH - worldWidth) / 2, top: (FARM_HEIGHT - worldHeight) / 2 };
}

export function configureFarmViewport(scene) {
    const resize = () => {
        const view = farmView(scene);
        scene.cameras.main.setZoom(view.zoom);
        // A zoomed camera's scroll refers to the unzoomed canvas rectangle.
        scene.cameras.main.centerOn(FARM_WIDTH / 2, FARM_HEIGHT / 2);
        scene.events.emit('farm-viewport-resize', view);
    };
    resize();
    scene.scale.on('resize', resize);
    onSceneExit(scene, () => scene.scale.off('resize', resize));
}
