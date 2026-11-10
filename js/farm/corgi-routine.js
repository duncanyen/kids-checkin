// 僅控制畫面行為，不參與租金、租期或防守判定。
export const CORGI_ROUTINE = Object.freeze({
    runSpeed: 77, walkSpeed: 52.5, runFrameRate: 7, walkFrameRate: 4.2,
    activeMs: 60000, sitAt: Object.freeze([20000, 40000]), sitMs: 4000, sleepMs: 60000
});

/** 回家抵達後才開始睡眠；警戒中暫停計時，避免少睡或反覆重設一分鐘。 */
export function createCorgiRoutine(now) {
    let startedAt = now, sleepUntil = null, returning = false, pausedAt = null;
    return {
        phase(time) {
            if (pausedAt !== null) return { kind: 'guard' };
            if (sleepUntil !== null) {
                if (time < sleepUntil) return { kind: 'sleep', remaining: sleepUntil - time };
                sleepUntil = null; returning = false; startedAt = time;
            }
            const elapsed = Math.max(0, time - startedAt);
            if (returning || elapsed >= CORGI_ROUTINE.activeMs) {
                returning = true;
                return { kind: 'return' };
            }
            for (const at of CORGI_ROUTINE.sitAt) {
                if (elapsed >= at && elapsed < at + CORGI_ROUTINE.sitMs) {
                    return { kind: 'sit', remaining: at + CORGI_ROUTINE.sitMs - elapsed };
                }
            }
            const next = CORGI_ROUTINE.sitAt.find(at => at > elapsed) ?? CORGI_ROUTINE.activeMs;
            return { kind: 'run', remaining: next - elapsed };
        },
        arriveHome(time) {
            if (returning && sleepUntil === null) sleepUntil = time + CORGI_ROUTINE.sleepMs;
        },
        pause(time) { if (pausedAt === null) pausedAt = time; },
        resume(time) {
            if (pausedAt === null) return;
            const duration = Math.max(0, time - pausedAt);
            startedAt += duration;
            if (sleepUntil !== null) sleepUntil += duration;
            pausedAt = null;
        }
    };
}

// 同一遊戲工作階段內依租約保留行為，進商店或切換場景不重設睡眠倒數。
const sessions = new WeakMap();
export function corgiRoutineFor(game, leaseId, now) {
    if (!sessions.has(game)) sessions.set(game, new Map());
    const leases = sessions.get(game);
    if (!leases.has(leaseId)) leases.set(leaseId, createCorgiRoutine(now));
    return leases.get(leaseId);
}
export function forgetCorgiRoutine(game, leaseId) { sessions.get(game)?.delete(leaseId); }
