// One explicitly dated event; never reopens automatically the following year.
export const HALLOWEEN_START = Date.parse('2026-10-30T00:00:00+08:00');
export const HALLOWEEN_END = Date.parse('2026-11-01T00:00:00+08:00');
export const halloweenActive = now => Number.isFinite(now) && now >= HALLOWEEN_START && now < HALLOWEEN_END;

// Anchor elapsed time to the monotonic clock so changing the phone clock cannot
// extend an already running event. Forward wall time also covers devices
// whose performance clock stops during OS sleep. Same-origin HTTP Date corrects device skew.
export function createHolidayClock({ wallNow = Date.now, monotonicNow = () => performance.now(), readServerTime } = {}) {
    let anchor = wallNow(), wallStamp = anchor, stamp = monotonicNow(), lastAttempt = -Infinity, pending;
    let stopped = false, synced = false, ended = false, latest = anchor;
    const listeners = new Set();
    const clock = {
        now() {
            latest = Math.max(latest, anchor + Math.max(0, monotonicNow() - stamp, wallNow() - wallStamp));
            if (synced && latest >= HALLOWEEN_END) ended = true;
            return latest;
        },
        get synced() { return synced; },
        subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); },
        refresh(force = false) {
            if (stopped || pending || !readServerTime || (!force && monotonicNow() - lastAttempt < 300000)) return pending;
            const start = monotonicNow(); lastAttempt = start;
            pending = Promise.resolve().then(readServerTime).then(server => {
                if (stopped || !Number.isFinite(server)) return;
                const end = monotonicNow();
                // Date headers have second precision; use the middle of that
                // second plus half the round trip as our estimated server time.
                const estimate = server + 500 + Math.max(0, end - start) / 2;
                // Once a calibrated session reaches the cutoff, a delayed/stale
                // HTTP response must never revive this year's decorations.
                anchor = ended ? Math.max(latest, estimate) : estimate;
                stamp = end; wallStamp = wallNow(); latest = anchor; synced = true;
                listeners.forEach(callback => callback());
            }).catch(() => { /* Offline: keep the last monotonic estimate. */ }).finally(() => { pending = null; });
            return pending;
        },
        dispose() { stopped = true; listeners.clear(); },
    };
    return clock;
}
