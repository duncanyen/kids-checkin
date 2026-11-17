/** 共用農場彈窗遮罩、輸入鎖與場景清理；不發出遊戲交易。 */
export function createFarmDialog(scene, { property = 'eggResultDialog', kind, panelClass = '', label, valid = () => true } = {}) {
    const input = scene.input, before = input.enabled, token = scene.farmSceneToken || scene.visitToken;
    const previousFocus = document.activeElement;
    const root = document.createElement('div'); root.className = 'farm-egg-result-overlay'; root.dataset.resultKind = kind;
    const panel = document.createElement('section'); panel.className = 'farm-egg-result-panel' + (panelClass ? ' ' + panelClass : '');
    panel.tabIndex = -1; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', label);
    root.append(panel);
    let closed = false, scrollNodes = [], scrollProtected = false;
    const isCurrent = () => !closed && scene.sys.isActive() && (scene.farmSceneToken || scene.visitToken) === token && valid();
    const close = () => {
        if (closed) return;
        closed = true; root.remove(); input.enabled = before;
        scene.events.off('shutdown', close); scene.events.off('destroy', close);
        if (scene[property] === dialog) scene[property] = null;
        dialog.onClose?.();
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
    const dialog = { root, panel, close, isCurrent,
        mount() { if (!isCurrent()) { close(); return false; } document.body.append(root); panel.focus({ preventScroll: true }); return true; },
        protectScroll(scrollNode) {
            scrollNodes = Array.isArray(scrollNode) ? scrollNode : [scrollNode];
            if (scrollProtected) return;
            scrollProtected = true;
            for (const eventName of ['touchmove', 'wheel']) root.addEventListener(eventName, event => { if (!scrollNodes.some(node => node.contains(event.target))) event.preventDefault(); }, { passive: false });
        }
    };
    scene[property] = dialog; input.enabled = false;
    scene.events.once('shutdown', close); scene.events.once('destroy', close);
    return dialog;
}
