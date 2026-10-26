export const liveKey = value => encodeURIComponent(String(value)).replaceAll('.', '%2E');
export function fromWire(node) {
    if (!node || node.kind === 'null') return null;
    if (node.kind === 'timestamp') return { toDate: () => new Date(node.value), toMillis: () => node.value };
    if (node.kind === 'array') return Object.entries(node.value || {}).sort(([a], [b]) => Number(a) - Number(b)).map(([, value]) => fromWire(value));
    if (node.kind === 'object') return Object.fromEntries(Object.entries(node.value || {}).map(([key, value]) => [decodeURIComponent(key), fromWire(value)]));
    return node.value;
}
export function liveDocument(id, node) {
    const value = node && !node.deleted && node.data ? fromWire(node.data) : undefined;
    return { id: decodeURIComponent(id), exists: () => value !== undefined, data: () => value };
}
export function liveQuery(value) {
    const docs = Object.entries(value || {}).filter(([, node]) => node.data && !node.deleted)
        .sort(([a, x], [b, y]) => (y.sortTime || 0) - (x.sortTime || 0) || b.localeCompare(a))
        .map(([id, node]) => liveDocument(id, node));
    return { docs, empty: !docs.length, size: docs.length, forEach: callback => docs.forEach(callback) };
}
export const accessDenied = error => /permission-denied|unauthenticated/.test(error?.code || '');
// Own cancellation covers both delayed authentication and subscriptions, including
// unmounting a scene while a token request is still pending.
export function subscribeLive({ enabled, connect, context, channel, path, list = false, limit, fallback, next, error = () => {} }) {
    let closed = false, stopLive, stopFallback, fallbackTimer;
    const startFallback = () => { if (!closed && !stopFallback) stopFallback = fallback(value => { if (!closed) next(value); }, reason => { if (!closed) error(reason); }); };
    if (!enabled) startFallback();
    else {
        fallbackTimer = setTimeout(startFallback, 8000);
        Promise.resolve().then(() => connect(context)).then(runtime => {
            if (closed) return;
            if (!runtime.ready[channel]) { clearTimeout(fallbackTimer); startFallback(); return; }
            stopLive = runtime.listen(path, { list, limit }, value => {
                if (closed) return;
                clearTimeout(fallbackTimer);
                // A just-created farm may not have been mirrored yet. Verify it in
                // Firestore instead of treating a missing mirror as an empty farm.
                if (channel === 'farms' && !list && (!value || value.deleted)) { startFallback(); return; }
                stopFallback?.(); stopFallback = null;
                next(list ? liveQuery(value) : liveDocument(path.split('/').at(-1), value));
            }, reason => {
                if (closed) return;
                clearTimeout(fallbackTimer); stopLive?.();
                if (accessDenied(reason)) { stopFallback?.(); stopFallback = null; error(reason); } else startFallback();
            });
        }).catch(reason => { clearTimeout(fallbackTimer); if (!closed) { if (accessDenied(reason)) { stopFallback?.(); stopFallback = null; error(reason); } else startFallback(); } });
    }
    return () => { closed = true; clearTimeout(fallbackTimer); stopLive?.(); stopFallback?.(); };
}
