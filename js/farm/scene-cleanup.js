// Scene destruction can bypass shutdown (for example Game.destroy).
// Remove the companion hook so restarting a scene never accumulates callbacks.
export function onSceneExit(scene, cleanup) {
    const finish = () => {
        scene.events.off('shutdown', finish);
        scene.events.off('destroy', finish);
        cleanup();
    };
    scene.events.once('shutdown', finish);
    scene.events.once('destroy', finish);
    return finish;
}
