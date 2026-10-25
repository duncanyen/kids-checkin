// Pure breed/production rules, shared by home, visits, shop, feeding and boss loss.
export const HOUR = 3600000;
export const BREEDS = Object.freeze({
    hen: { name: '母雞', texture: 'hen', buy: 1000, sell: 500, interval: 4 * HOUR, daily: 6, eggKey: 'inventoryEggs', eggName: '雞蛋', eggIcon: 'egg', eggPrice: 10 },
    silkie: { name: '烏骨雞', texture: 'silkie', buy: 2000, sell: 1000, interval: 4 * HOUR, daily: 6, eggKey: 'silkieEggs', eggName: '烏骨雞蛋', eggIcon: 'silkie_egg', eggPrice: 30 },
    bresse: { name: '布雷斯雞', texture: 'bresse', buy: 4000, sell: 2000, interval: 6 * HOUR, daily: 4, eggKey: 'bresseEggs', eggName: '布雷斯雞蛋', eggIcon: 'bresse_egg', eggPrice: 60 }
});
export const breedOf = hen => BREEDS[hen?.breed] ? hen.breed : 'hen';
export const coopCapacity = level => level >= 3 ? 20 : level >= 2 ? 10 : 3;
const count = n => Math.max(0, Math.floor(Number(n) || 0));
export function poultryState(farm, now = Date.now()) {
    const legacy = farm.poultryVersion !== 2;
    const total = farm.hens === undefined ? 1 : count(farm.hens);
    const states = Array.isArray(farm.hensState) ? farm.hensState : [];
    const healthyIndexes = Array.from({ length: total }, (_, i) => i).filter(i => !states[i]?.isSick);
    const hens = Array.from({ length: total }, (_, i) => {
        const h = states[i] || {};
        return { ...h, id: h.id || `legacy-${i}`, breed: breedOf(h), laidAt: Number.isFinite(h.laidAt) ? h.laidAt : (Number.isFinite(farm.lastLayTime) ? farm.lastLayTime : now) - (legacy && !h.isSick ? Math.max(0, healthyIndexes.indexOf(i)) * BREEDS[breedOf(h)].interval / Math.max(1, healthyIndexes.length) : 0) };
    });
    const ready = Object.fromEntries(Object.keys(BREEDS).map(key => [key, legacy ? (key === 'hen' ? count(farm.eggsReady) : 0) : count(farm.readyEggs?.[key])]));
    return { hens, ready, cleanliness: count(farm.cleanliness) };
}
export function settlePoultry(farm, now = Date.now()) {
    const state = poultryState(farm, now);
    state.hens = state.hens.filter(h => !(h.isSick && h.sickTimestamp && now - h.sickTimestamp > 48 * HOUR));
    let produced = 0;
    for (const breed of Object.keys(BREEDS)) {
        const birds = state.hens.filter(h => h.breed === breed);
        const config = BREEDS[breed], capacity = birds.length * config.daily;
        for (const h of birds) {
            if (h.isSick || h.pausedFull) continue;
            const ticks = Math.max(0, Math.floor((now - h.laidAt) / config.interval));
            const added = Math.min(ticks, Math.max(0, capacity - state.ready[breed]));
            state.ready[breed] += added; produced += added;
            h.laidAt += ticks * config.interval;
        }
        if (birds.length && state.ready[breed] >= capacity) {
            for (const h of birds) if (!h.pausedFull) { h.laidAt = now; h.pausedFull = true; }
        }
    }
    state.cleanliness = Math.min(100, state.cleanliness + produced * 2);
    return state;
}
export function poultryPatch(state) {
    return { 'farm.poultryVersion': 2, 'farm.hens': state.hens.length, 'farm.hensState': state.hens,
        'farm.readyEggs': state.ready, 'farm.eggsReady': Object.values(state.ready).reduce((a, b) => a + b, 0),
        'farm.cleanliness': state.cleanliness,
        'farm.lastLayTime': state.hens.length ? Math.min(...state.hens.map(h => h.laidAt)) : 0 };
}
export function productionChanged(farm, now) {
    if (farm.poultryVersion !== 2) return true;
    const patch = poultryPatch(settlePoultry(farm, now));
    return Object.entries(patch).some(([key, value]) => JSON.stringify(farm[key.slice(5)]) !== JSON.stringify(value));
}
export function nextEggStatus(farm, now = Date.now()) {
    const state = poultryState(farm, now);
    const active = state.hens.filter(h => !h.isSick && !h.pausedFull);
    const next = active.map(h => ({ breed: h.breed, ms: Math.max(0, BREEDS[h.breed].interval - (now - h.laidAt)) })).sort((a, b) => a.ms - b.ms)[0];
    return { next, hens: state.hens.length, eggs: Object.values(state.ready).reduce((a, b) => a + b, 0), full: state.hens.length > 0 && state.hens.every(h => h.pausedFull) };
}
export function releaseFullClocks(state, now) {
    for (const h of state.hens) if (h.pausedFull) { h.laidAt = now; delete h.pausedFull; }
}
export function clearPoultryEggs(farm, now = Date.now()) {
    const state = settlePoultry(farm, now);
    state.ready = { hen: 0, silkie: 0, bresse: 0 }; releaseFullClocks(state, now);
    return poultryPatch(state);
}
export function collectPoultry(farm, now = Date.now()) {
    const state = settlePoultry(farm, now), inventory = {}, collected = { ...state.ready };
    for (const [key, config] of Object.entries(BREEDS)) inventory[`farm.${config.eggKey}`] = count(farm[config.eggKey]) + state.ready[key];
    state.ready = { hen: 0, silkie: 0, bresse: 0 }; releaseFullClocks(state, now);
    return { patch: { ...poultryPatch(state), ...inventory }, collected, total: Object.values(collected).reduce((a, b) => a + b, 0) };
}
export function takePoultryEgg(farm, roll = 0, now = Date.now()) {
    const state = settlePoultry(farm, now), total = Object.values(state.ready).reduce((a, b) => a + b, 0);
    if (!total) throw new Error('雞舍目前沒有蛋！');
    let ticket = Math.min(total - 1, Math.floor(Math.max(0, roll) * total)), breed;
    for (const key of Object.keys(BREEDS)) { if (ticket < state.ready[key]) { breed = key; break; } ticket -= state.ready[key]; }
    state.ready[breed]--; releaseFullClocks(state, now);
    return { breed, patch: poultryPatch(state) };
}
export function tradePoultry(farm, breed, quantity, type, now = Date.now(), ids = []) {
    if (!BREEDS[breed] || !Number.isSafeInteger(quantity) || quantity <= 0 || !['buy', 'sell'].includes(type)) throw new Error('交易內容不正確。');
    const state = settlePoultry(farm, now), config = BREEDS[breed];
    let coins = Number(farm.coins) || 0;
    if (type === 'buy') {
        if (state.hens.length + quantity > coopCapacity(farm.coopLevel)) throw new Error('雞舍空間不足，請先升級或賣出雞隻！');
        if (coins < config.buy * quantity) throw new Error('金幣不足！');
        coins -= config.buy * quantity;
        for (let i = 0; i < quantity; i++) state.hens.push({ id: ids[i] || `${breed}-${now}-${i}`, breed, isSick: false, laidAt: now });
    } else {
        if (state.hens.filter(h => h.breed === breed).length < quantity) throw new Error('此品種的雞隻數量不足！');
        // Sell healthy birds first; preserve already laid eggs even after the last bird is sold.
        const selected = state.hens.filter(h => h.breed === breed).sort((a, b) => Number(a.isSick || false) - Number(b.isSick || false)).slice(0, quantity);
        state.hens = state.hens.filter(h => !selected.includes(h)); coins += config.sell * quantity;
    }
    releaseFullClocks(state, now);
    return { ...poultryPatch(state), 'farm.coins': coins };
}
export function feedPoultry(farm, item, breed, now = Date.now()) {
    if (!['worms', 'earthworms'].includes(item) || !BREEDS[breed] || !(farm[item] > 0)) throw new Error('飼料不足或選擇無效！');
    const state = settlePoultry(farm, now), birds = state.hens.filter(h => h.breed === breed);
    const healthy = birds.filter(h => !h.isSick && !h.pausedFull);
    if (!healthy.length) throw new Error('此品種目前沒有可餵食的健康雞隻，或產能已滿！');
    for (const h of healthy) h.laidAt -= (item === 'worms' ? 30 : 60) * 60000;
    const accelerated = settlePoultry({ ...farm, ...Object.fromEntries(Object.entries(poultryPatch(state)).map(([key, value]) => [key.slice(5), value])) }, now);
    return { ...poultryPatch(accelerated), [`farm.${item}`]: farm[item] - 1 };
}
