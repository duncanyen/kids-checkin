// Photo gestures and saving stay independent of the feed and Firebase SDKs.
export function createPhotoViewer({ modal, image, wrapper, counter, getQueue, onIndexChange = () => {} }) {
    let index = 0, scale = 1, x = 0, y = 0, gesture = null, hadPinch = false;
    let lastTap = 0, suppressTapUntil = 0, savedOverflow = '', file = null, revision = 0;
    const pointers = new Map();
    const status = modal.querySelector('[data-viewer-status]');
    const download = modal.querySelector('[data-viewer-download]');
    const share = modal.querySelector('[data-viewer-share]');
    const original = modal.querySelector('[data-viewer-original]');
    const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
    function paint() {
        x = clamp(x, -Math.max(0, (image.clientWidth * scale - wrapper.clientWidth) / 2), Math.max(0, (image.clientWidth * scale - wrapper.clientWidth) / 2));
        y = clamp(y, -Math.max(0, (image.clientHeight * scale - wrapper.clientHeight) / 2), Math.max(0, (image.clientHeight * scale - wrapper.clientHeight) / 2));
        image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
        image.dataset.scale = String(scale);
    }
    function reset() { scale = 1; x = y = 0; pointers.clear(); gesture = null; lastTap = 0; paint(); }
    function show(next) {
        const queue = getQueue();
        if (!queue.length) return close();
        index = (next + queue.length) % queue.length;
        revision++; file = null; share.hidden = true; original.hidden = true; download.disabled = false;
        status.textContent = ''; reset();
        image.src = queue[index]; image.decoding = 'async';
        counter.textContent = `${index + 1} / ${queue.length}`;
        onIndexChange(index);
    }
    function open(next) {
        if (modal.style.display !== 'flex') savedOverflow = document.body.style.overflow;
        modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; show(next);
    }
    function close() {
        modal.style.display = 'none'; image.removeAttribute('src'); document.body.style.overflow = savedOverflow;
        revision++; file = null; reset();
    }
    function startGesture() {
        const points = [...pointers.values()];
        if (points.length >= 2) {
            const [a, b] = points;
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            const rect = wrapper.getBoundingClientRect();
            gesture = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale, anchorX: (mid.x - rect.left - rect.width / 2 - x) / scale, anchorY: (mid.y - rect.top - rect.height / 2 - y) / scale };
            hadPinch = true; lastTap = 0;
        } else if (points.length === 1) gesture = { start: { ...points[0] }, x, y };
    }
    wrapper.addEventListener('pointerdown', event => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        if (!pointers.size) hadPinch = false;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        wrapper.setPointerCapture(event.pointerId); startGesture();
    });
    wrapper.addEventListener('pointermove', event => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size >= 2 && gesture?.distance) {
            const [a, b] = [...pointers.values()], rect = wrapper.getBoundingClientRect();
            scale = clamp(gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance, 1, 5);
            x = (a.x + b.x) / 2 - rect.left - rect.width / 2 - gesture.anchorX * scale;
            y = (a.y + b.y) / 2 - rect.top - rect.height / 2 - gesture.anchorY * scale;
        } else if (gesture?.start && scale > 1) {
            x = gesture.x + event.clientX - gesture.start.x; y = gesture.y + event.clientY - gesture.start.y;
        }
        paint();
    });
    function finish(event, cancelled = false) {
        if (!pointers.has(event.pointerId)) return;
        const start = gesture?.start;
        pointers.delete(event.pointerId);
        if (hadPinch || cancelled) { suppressTapUntil = Date.now() + 350; lastTap = 0; }
        if (!pointers.size && start && !hadPinch && !cancelled) {
            const dx = event.clientX - start.x, dy = event.clientY - start.y;
            if (Math.hypot(dx, dy) < 12 && Date.now() > suppressTapUntil) {
                if (lastTap && Date.now() - lastTap < 300) {
                    scale = scale > 1 ? 1 : 2.5; x = y = 0; lastTap = 0; paint();
                } else lastTap = Date.now();
            } else if (scale === 1) {
                if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
                else if (dy > 100 && Math.abs(dy) > Math.abs(dx)) close();
            }
        }
        if (pointers.size) startGesture(); else gesture = null;
    }
    wrapper.addEventListener('pointerup', event => finish(event));
    wrapper.addEventListener('pointercancel', event => finish(event, true));
    window.addEventListener('pagehide', () => { if (modal.style.display === 'flex') close(); });
    image.addEventListener('load', paint);
    image.addEventListener('dragstart', event => event.preventDefault());
    window.addEventListener('resize', paint);
    document.addEventListener('keydown', event => {
        if (modal.style.display !== 'flex') return;
        if (event.key === 'Escape') close();
        if (event.key === 'ArrowRight') show(index + 1);
        if (event.key === 'ArrowLeft') show(index - 1);
    });
    download.addEventListener('click', async () => {
        const source = image.getAttribute('src'), token = revision;
        if (!source || download.disabled) return;
        download.disabled = true; status.textContent = '正在準備照片…';
        try {
            const response = await fetch(source);
            if (!response.ok) throw new Error('無法下載');
            const blob = await response.blob();
            if (!blob.size || !blob.type.startsWith('image/')) throw new Error('圖片格式無效');
            if (token !== revision) return;
            const extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' })[blob.type] || 'jpg';
            file = new File([blob], `photo-dump-${Date.now()}-${index + 1}.${extension}`, { type: blob.type });
            const url = URL.createObjectURL(blob), link = document.createElement('a');
            link.href = url; link.download = file.name; document.body.append(link); link.click(); link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            share.hidden = !(navigator.canShare?.({ files: [file] }));
            status.textContent = share.hidden ? '已送出下載。若未存入相簿，可開啟原圖後長按儲存。' : '已送出下載。要存入相簿，請點「分享／儲存相簿」並選擇儲存影像。';
            original.href = source; original.hidden = false;
        } catch {
            if (token !== revision) return;
            status.textContent = '瀏覽器無法直接下載這張照片，請開啟原圖後長按儲存。';
            original.href = source; original.hidden = false;
        } finally { if (token === revision) download.disabled = false; }
    });
    share.addEventListener('click', () => {
        if (!file || !navigator.share) return;
        // A separate tap preserves the user activation required by mobile Safari.
        navigator.share({ files: [file] }).catch(error => {
            if (error.name !== 'AbortError') status.textContent = '無法開啟分享，請改用下載或開啟原圖。';
        });
    });
    return { open, close, previous: () => show(index - 1), next: () => show(index + 1), setIndex: value => { index = value; } };
}
