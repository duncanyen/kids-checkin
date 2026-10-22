// Browser-only, in-memory Firestore fixture. Never connects to a real backend.
const listeners = new Map();
export const doc = (db, ...parts) => ({ path: parts.join('/') });
export const collection = doc;
export const where = (field, op, value) => ({ field, op, value });
export const query = (ref, ...filters) => ({ ...ref, filters });
const snap = (path, store = window.__store) => ({
    exists: () => Object.hasOwn(store, path), data: () => structuredClone(store[path])
});
export const getDoc = async ref => snap(ref.path);
export async function getDocs(q) {
    window.__queries.push(structuredClone(q));
    const values = Object.entries(window.__store).filter(([path]) => path.startsWith(q.path + '/'))
        .map(([, data]) => data).filter(data => q.filters.every(f => f.op === 'in' ? f.value.includes(data[f.field]) : data[f.field] === f.value));
    return { forEach: callback => values.forEach(data => callback({ data: () => structuredClone(data) })) };
}
export function onSnapshot(ref, callback) {
    listeners.set(ref.path, callback);
    queueMicrotask(() => callback(snap(ref.path)));
    return () => listeners.delete(ref.path);
}
export async function runTransaction(db, callback) {
    const store = structuredClone(window.__store), pending = [];
    const result = await callback({
        get: async ref => snap(ref.path, store),
        set: (ref, data, options) => pending.push({ path: ref.path, data: structuredClone(data), options })
    });
    if (window.__failNext) { window.__failNext = false; throw Error('模擬網路中斷'); }
    for (const write of pending) {
        window.__store[write.path] = write.options?.merge ? { ...window.__store[write.path], ...write.data } : write.data;
        window.__writes.push(write);
    }
    queueMicrotask(() => pending.forEach(write => listeners.get(write.path)?.(snap(write.path))));
    return result;
}
