// DOM shell is available before Phaser/Firebase. Progress advances only on work completion.
const root = document.querySelector('[data-farm-loading]');
let value = 0, raf = 0, timer = 0, texture, lastFrame = 0, frameIndex = 8, disposed = false;
let retryAction = () => window.location.reload();
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animate(now) {
    raf = 0;
    if (disposed || !root || root.hidden || document.hidden) return;
    if (texture && now - lastFrame >= 125) {
        lastFrame = now;
        const frame = texture.get(String(frameIndex));
        const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d');
        const scale = 68 / Math.max(frame.realWidth, frame.realHeight);
        ctx.clearRect(0, 0, 72, 72);
        ctx.drawImage(texture.getSourceImage(), frame.cutX, frame.cutY, frame.cutWidth, frame.cutHeight,
            2 + frame.x * scale, 2 + frame.y * scale, frame.cutWidth * scale, frame.cutHeight * scale);
        frameIndex = reduced() ? 8 : 8 + (frameIndex - 7) % 8;
    }
    if (!reduced()) raf = requestAnimationFrame(animate);
}
function restartAnimation() { if (!raf && !document.hidden && root && !root.hidden && !disposed) raf = requestAnimationFrame(animate); }
function pause() { cancelAnimationFrame(raf); raf = 0; }
function visibility() { if (document.hidden) pause(); else restartAnimation(); }
const retryClick = () => retryAction();
root?.querySelector('[data-loading-retry]')?.addEventListener('click', retryClick);
document.addEventListener('visibilitychange', visibility);
window.addEventListener('pageshow', restartAnimation);
export const farmLoading = {
    begin(label = '準備進入咕咕村落') {
        if (!root || disposed) return;
        clearTimeout(timer); retryAction = () => window.location.reload(); delete root.dataset.failed; value = 0; root.hidden = false;
        root.querySelector('[data-loading-retry]').hidden = true;
        this.progress(0, label); restartAnimation();
    },
    progress(next, label) {
        if (!root || disposed) return;
        value = Math.max(value, Math.min(100, Math.floor(next)));
        root.style.setProperty('--farm-load-progress', `${value}%`);
        root.style.setProperty('--farm-load-fraction', String(value/100));
        root.querySelector('[role=progressbar]').setAttribute('aria-valuenow', value);
        root.querySelector('[data-loading-percent]').textContent = `${value}%`;
        if (label && root.querySelector('[data-loading-status]').textContent !== label) root.querySelector('[data-loading-status]').textContent = label;
    },
    attachHen(next) {
        texture = next; lastFrame = 0;
        if (root) { root.querySelector('canvas').hidden = false; root.querySelector('[data-loading-hen-fallback]').setAttribute('hidden',''); }
        restartAnimation();
    },
    error(label, retry = () => window.location.reload()) {
        if (!root || disposed) return;
        clearTimeout(timer); root.hidden = false; root.dataset.failed='true'; retryAction = retry;
        root.querySelector('[data-loading-status]').textContent = label;
        root.querySelector('[data-loading-retry]').hidden = false; pause();
    },
    complete(immediate = false) {
        if (!root || disposed || root.hidden) return;
        retryAction = () => window.location.reload(); delete root.dataset.failed;
        this.progress(100, '農莊準備好了');
        root.querySelector('[data-loading-retry]').hidden = true;
        clearTimeout(timer);
        if(immediate){root.hidden=true;pause();return;}
        timer = setTimeout(() => { root.hidden = true; pause(); }, reduced() ? 0 : 240);
    },
    dispose() {
        disposed = true; clearTimeout(timer); pause(); texture = null; retryAction = () => {};
        root?.querySelector('[data-loading-retry]')?.removeEventListener('click', retryClick);
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('pageshow', restartAnimation);
        if (root) root.hidden = true;
    }
};
restartAnimation();
