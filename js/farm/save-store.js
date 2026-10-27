import { doc, runTransaction } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

// Clone mutable records without breaking SDK Timestamp objects or RTDB wire
// timestamps that expose toMillis/toDate functions.
export function copyFarmSave(value) {
    if (Array.isArray(value)) return value.map(copyFarmSave);
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyFarmSave(item)]));
    }
    return value;
}

export function isFarmSave(farm) {
    if (!farm || typeof farm !== 'object' || Array.isArray(farm)) return false;
    if (!Number.isFinite(farm.coins) || !Number.isInteger(farm.hens)) return false;
    const counts = ['coins', 'hens', 'inventoryEggs', 'silkieEggs', 'bresseEggs', 'eggsReady', 'worms', 'earthworms',
        'wolfFangs', 'tigerPelts', 'dragonScales', 'gorillaFangs', 'medicines', 'mace', 'battleaxe', 'warehouseLimit'];
    if (counts.some(key => key in farm && (!Number.isFinite(farm[key]) || farm[key] < 0))) return false;
    if ('hensState' in farm && !Array.isArray(farm.hensState)) return false;
    if (farm.poultryVersion === 2) {
        if (!Array.isArray(farm.hensState) || farm.hensState.length !== farm.hens) return false;
        if (!farm.readyEggs || ['hen', 'silkie', 'bresse'].some(key => !Number.isInteger(farm.readyEggs[key]) || farm.readyEggs[key] < 0)) return false;
        if (['hen', 'silkie', 'bresse'].reduce((sum, key) => sum + farm.readyEggs[key], 0) !== farm.eggsReady) return false;
    }
    return true;
}

export function initialFarm(now = Date.now()) {
    return {
        coins: 0, inventoryEggs: 0, silkieEggs: 0, bresseEggs: 0, hens: 1, coopLevel: 1,
        eggsReady: 0, readyEggs: { hen: 0, silkie: 0, bresse: 0 }, poultryVersion: 2,
        lastLayTime: now, warehouseLimit: 10, worms: 0, earthworms: 0,
        wolfFangs: 0, tigerPelts: 0, dragonScales: 0, gorillaFangs: 0,
        medicines: 0, cleanliness: 0, moral: 100, equippedWeapon: 'club',
        hensState: [{ id: crypto.randomUUID(), breed: 'hen', laidAt: now, isSick: false }]
    };
}

// Firestore transactions read the server and fail offline; unlike setDoc they
// cannot enqueue a default farm based on an empty local-cache snapshot.
export function ensureFarmSave(db, { groupId, accountId }, { canCreate = () => true, active = () => true } = {}) {
    const owner = doc(db, 'groups', groupId, 'users', accountId);
    const receipt = doc(db, 'groups', groupId, 'users', accountId, 'farm_meta', 'creation');
    const fresh = initialFarm();
    return runTransaction(db, async transaction => {
        if (!active()) throw new Error('已離開農場，停止建立存檔');
        const group = await transaction.get(doc(db, 'groups', groupId));
        if (!group.exists() || !group.data().members?.includes(accountId)) throw new Error('無法確認群組資格，請重新登入');
        const snapshot = await transaction.get(owner);
        if (snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) throw new Error('尚未取得伺服器存檔');
        if (snapshot.exists()) {
            const farm = snapshot.data()?.farm;
            if (!isFarmSave(farm)) throw new Error('存檔資料不完整，已停止自動初始化，請聯絡管理者');
            return farm; // Never fill or replace any existing farm fields.
        }
        const created = await transaction.get(receipt);
        if (!active()) throw new Error('已離開農場，停止建立存檔');
        if (created.exists() || !canCreate()) throw new Error('找不到原有存檔，已停止自動重建，請聯絡管理者');
        transaction.set(owner, { farm: fresh }, { merge: true });
        transaction.set(receipt, { groupId, accountId, createdAt: fresh.lastLayTime });
        return fresh;
    });
}

// A single session owns initialization and the last good snapshot across scenes.
export function startFarmSaveSession({ watch, verify, receive, status }) {
    let stopped = false, pending, latest, revision = 0, seenFarm = false;
    const state = (phase, message) => { if (!stopped) status({ phase, message }); };
    const publish = farm => {
        if (stopped) return;
        seenFarm = true;
        state('ready', '存檔已連線');
        receive(copyFarmSave(farm));
    };
    const retry = () => {
        if (stopped || pending) return pending;
        const startRevision = revision;
        state('loading', seenFarm ? '重新確認存檔中，保留上次資料…' : '讀取存檔中，請稍候…');
        pending = Promise.resolve().then(() => verify({ canCreate: () => !seenFarm, active: () => !stopped })).then(farm => {
            if (stopped) return;
            if (!isFarmSave(farm)) throw new Error('未能確認完整存檔');
            if (revision > startRevision && !latest) { state('error', '尚未能確認最新存檔，保留上次資料；點此重試'); return; }
            // A newer authoritative update wins over a delayed verification.
            publish(revision > startRevision && latest?.confirmed ? latest.farm : farm);
        }).catch(error => {
            if (revision > startRevision && latest?.confirmed) return;
            state('error', `${error.message || '連線失敗'}；點此重試`);
        }).finally(() => { pending = null; });
        return pending;
    };
    state('loading', '讀取存檔中，請稍候…');
    const unsubscribe = watch(snapshot => {
        if (stopped) return;
        const farm = snapshot.exists() ? snapshot.data()?.farm : undefined;
        revision++;
        if (isFarmSave(farm) && !snapshot.metadata?.hasPendingWrites) {
            seenFarm = true;
            latest = { farm: copyFarmSave(farm), confirmed: !snapshot.metadata?.fromCache };
            if (latest.confirmed) publish(farm);
            else {
                // Keep the last confirmed display. Cached balances cannot
                // authorize a new farm or replace newer server balances.
                retry();
            }
        } else {
            // A pending create can be acknowledged by the transaction without a
            // second snapshot (metadata-only changes are not always emitted).
            // An empty cache likewise cannot overrule a server verification.
            latest = snapshot.metadata?.fromCache || (isFarmSave(farm) && snapshot.metadata?.hasPendingWrites) ? { confirmed: false } : null;
            retry();
        }
    }, error => {
        revision++; latest = null;
        state('error', `${error.message || '存檔讀取失敗'}；點此重試`);
    });
    return { retry, stop() { stopped = true; unsubscribe(); } };
}
