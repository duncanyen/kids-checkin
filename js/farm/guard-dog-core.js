export const DAY_MS = 86400000;
export const GUARD_DOG_BREEDS = {
    pyrenees: { rentable: true, name: '大白熊犬', texture: 'guard_dog', biteChance: 0.7, blockMs: 4 * 3600000, dayPrice: 80, weekPrice: 400 },
    beagle: { rentable: true, name: '米格魯', texture: 'guard_beagle', biteChance: 0.33, blockMs: 2 * 3600000, dayPrice: 20, weekPrice: 100 },
    collie: { rentable: false, name: '邊境牧羊犬', texture: 'guard_collie', biteChance: 0.8, blockMs: 4 * 3600000, dayPrice: 200, weekPrice: 1000, herding: true },
    // patrolRunMs 保留舊版相容；現行柯基使用 corgi-routine.js 的到家後睡眠流程。
    corgi: { rentable: true, name: '柯基犬', texture: 'guard_corgi', biteChance: 0.4, blockMs: 2 * 3600000, dayPrice: 100, weekPrice: 500, herding: true, patrolRunMs: 15000, displaySize: 84 },
};

// 每 30 秒有 18 秒奔跑，剩餘 12 秒返回或休息。
export const COLLIE_CYCLE_MS = 30000;
export const COLLIE_RUN_MS = 18000;
export function colliePatrolPhase(elapsedMs) {
    return guardDogPatrolPhase('collie', elapsedMs);
}

/** 舊版巡邏相容入口；邊牧維持 18 秒，現行柯基改由 corgi-routine.js 控制。 */
export function guardDogPatrolPhase(breedId, elapsedMs) {
    const runMs = GUARD_DOG_BREEDS[breedId]?.patrolRunMs ?? COLLIE_RUN_MS;
    const position = Math.max(0, elapsedMs) % COLLIE_CYCLE_MS;
    return {running:position<runMs,remaining:(position<runMs?runMs:COLLIE_CYCLE_MS)-position};
}

/**
 * 以日租與週租組合計算最低費用，允許整週覆蓋剩餘天數以取得更低價格。
 * @param {string} breedId - 護衛犬品種鍵。
 * @param {number} days - 欲租用的正整數天數。
 * @param {Object} [catalog] - 預設品種表；後端可傳入已驗證的營運覆寫設定。
 * @returns {number} 安全整數金幣費用，不在此扣款或建立租約。
 * @throws {Error} 品種、天數、時間或價格超出合法範圍。
 */
export function rentalPrice(breedId, days, catalog = GUARD_DOG_BREEDS) {
    const breed = catalog[breedId];
    if (!breed || !Number.isSafeInteger(days) || days < 1 || !Number.isSafeInteger(days * DAY_MS + Date.now()) || days * DAY_MS + Date.now() > 8640000000000000) throw new Error('請輸入有效的整數天數');
    const price = Math.min(Math.floor(days / 7) * breed.weekPrice + days % 7 * breed.dayPrice, Math.ceil(days / 7) * breed.weekPrice);
    if (!Number.isSafeInteger(price)) throw new Error('租用天數過大');
    return price;
}

/** 值勤依絕對期限計算；待命保存毫秒餘額，缺少新欄位的舊待命租約沿用原天數。 */
export function guardDogRemainingMs(dog, now = Date.now()) {
    if (!dog || !Number.isSafeInteger(dog.days) || dog.days < 1) return 0;
    const full = dog.days * DAY_MS;
    if (!Number.isSafeInteger(full)) return 0;
    if (Number.isFinite(dog.startedAt)) {
        return Number.isSafeInteger(dog.expiresAt) ? Math.min(full, Math.max(0, dog.expiresAt - now)) : 0;
    }
    if (!Object.hasOwn(dog, 'remainingMs')) return full;
    return Number.isSafeInteger(dog.remainingMs) && dog.remainingMs > 0 && dog.remainingMs <= full ? dog.remainingMs : 0;
}

export function guardDogLeases(farm, now = Date.now()) {
    return (Array.isArray(farm?.guardDogs) ? farm.guardDogs : []).filter(dog => guardDogRemainingMs(dog, now) > 0);
}
export const activeGuardDog = (farm, now = Date.now()) => guardDogLeases(farm, now).find(dog => Number.isFinite(dog.startedAt) && dog.expiresAt > now) || null;

export function rentGuardDog(farm, breedId, days, id, now = Date.now(), catalog = GUARD_DOG_BREEDS) {
    if(!Object.hasOwn(catalog,breedId))throw new Error('找不到此護衛犬');
    if(catalog[breedId].rentable===false)throw new Error(`${catalog[breedId].name}尚未開放租用`);
    const price = rentalPrice(breedId, days, catalog), dogs = guardDogLeases(farm, now);
    if (dogs.some(dog => dog.breedId === breedId)) throw new Error('同一品種同時只能租用一隻');
    if (!Number.isFinite(farm.coins) || farm.coins < price) throw new Error('金幣不足');
    return { 'farm.coins': farm.coins - price, 'farm.guardDogs': [...dogs, { id, breedId, days, paid: price, rentedAt: now, startedAt: null, expiresAt: null, remainingMs: days * DAY_MS }] };
}

export function activateGuardDog(farm, id, now = Date.now()) {
    const dogs = guardDogLeases(farm, now), dog = dogs.find(item => item.id === id);
    if (!dog || !GUARD_DOG_BREEDS[dog.breedId] || !Number.isSafeInteger(dog.days) || dog.days < 1) throw new Error('找不到可用的護衛犬');
    if (Number.isFinite(dog.startedAt)) throw new Error('這隻護衛犬已在護衛中，不能重設租期');
    if (activeGuardDog(farm, now)) throw new Error('請先解除目前的護衛犬回到倉庫，剩餘時間會保留');
    const remainingMs = guardDogRemainingMs(dog, now), expiresAt = now + remainingMs;
    if (!Number.isSafeInteger(expiresAt) || expiresAt > 8640000000000000) throw new Error('租用天數過大');
    return { 'farm.guardDogs': dogs.map(item => item.id === id ? { ...item, startedAt: now, expiresAt, remainingMs } : item) };
}

export function releaseGuardDog(farm, id, now = Date.now()) {
    const dogs = guardDogLeases(farm, now), dog = dogs.find(item => item.id === id);
    if (!dog) throw new Error('找不到可用的護衛犬');
    // 已回倉庫的重複解除是無操作，不重算餘額，也不恢復完整天數。
    if (!Number.isFinite(dog.startedAt)) return { 'farm.guardDogs': dogs };
    const remainingMs = guardDogRemainingMs(dog, now);
    return { 'farm.guardDogs': dogs.map(item => item.id === id ? { ...item, startedAt: null, expiresAt: null, remainingMs } : item) };
}

export function stealBlockedUntil(farm, key, legacyAccountId) {
    const legacy = farm.villageStealCooldowns?.[key] || (legacyAccountId ? farm.stealCooldowns?.[legacyAccountId] : 0) || 0;
    return Math.max(farm.villageStealBlockedUntil?.[key] || 0, legacy ? legacy + 3600000 : 0);
}

export function guardDogInterception(farm, roll, now = Date.now()) {
    const dog = activeGuardDog(farm, now), breed = dog && GUARD_DOG_BREEDS[dog.breedId];
    return breed && roll < breed.biteChance ? { dog, breed } : null;
}

export function guardDogStatus(dog, now = Date.now()) {
    const minutes = Math.max(0, Math.ceil(guardDogRemainingMs(dog, now) / 60000));
    return `${Number.isFinite(dog.startedAt) ? '護衛中' : '待命'}・餘 ${Math.floor(minutes / 60)}時${minutes % 60}分`;
}
