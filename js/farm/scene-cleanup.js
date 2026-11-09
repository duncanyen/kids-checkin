// Game.destroy 可能不先觸發 shutdown；清理時移除另一個掛鉤，避免重啟場景累積回呼。
/**
 * 在場景 shutdown 或 destroy 首次發生時執行清理，並移除另一個掛鉤。
 * @param {Object} scene - Phaser Scene。
 * @param {Function} cleanup - 清理場景外監聽、DOM、計時器或戰鬥狀態。
 * @returns {Function} 同一個清理入口；呼叫端不應重複手動執行。
 */
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
