// 複製可變記錄時保留 SDK Timestamp 與具 toMillis／toDate 的 RTDB 時間物件。
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
    const counts = ['coins', 'hens', 'inventoryEggs', 'silkieEggs', 'bresseEggs', 'onagadoriEggs', 'eggsReady', 'worms', 'earthworms',
        'ancientStones', 'giantLastMilestone', 'wolfFangs', 'tigerPelts', 'dragonScales', 'gorillaFangs', 'medicines', 'mace', 'battleaxe', 'shortbow', 'huntingbow', 'paladinbow', 'eagleFeathers', 'sweetPotatoes', 'ironhammer', 'cobraFangs', 'gardenCatchCount', 'moleLastMilestone', 'cobraLastMilestone', 'warehouseLimit'];
    if (counts.some(key => key in farm && (!Number.isFinite(farm[key]) || farm[key] < 0))) return false;
    if ('combatKills' in farm && (!farm.combatKills || typeof farm.combatKills !== 'object' || Array.isArray(farm.combatKills))) return false;
    if (farm.combatKills && ['wolf', 'tiger', 'eagle'].some(key => key in farm.combatKills && (!Number.isSafeInteger(farm.combatKills[key]) || farm.combatKills[key] < 0))) return false;
    if ('hensState' in farm && !Array.isArray(farm.hensState)) return false;
    if (farm.poultryVersion === 2) {
        if (!Array.isArray(farm.hensState) || farm.hensState.length !== farm.hens) return false;
        if (!farm.readyEggs || ['hen', 'silkie', 'bresse'].some(key => !Number.isInteger(farm.readyEggs[key]) || farm.readyEggs[key] < 0)) return false;
        if ('onagadori' in farm.readyEggs && (!Number.isInteger(farm.readyEggs.onagadori) || farm.readyEggs.onagadori < 0)) return false;
        if (['hen', 'silkie', 'bresse', 'onagadori'].reduce((sum, key) => sum + (farm.readyEggs[key] || 0), 0) !== farm.eggsReady) return false;
    }
    return true;
}

export function initialFarm(now = Date.now()) {
    return {
        coins: 0, inventoryEggs: 0, silkieEggs: 0, bresseEggs: 0, onagadoriEggs: 0, hens: 1, coopLevel: 1,
        eggsReady: 0, readyEggs: { hen: 0, silkie: 0, bresse: 0, onagadori: 0 }, poultryVersion: 2,
        lastLayTime: now, warehouseLimit: 10, worms: 0, earthworms: 0,
        ancientStones: 0, giantLastMilestone: 0, wolfFangs: 0, tigerPelts: 0, dragonScales: 0, gorillaFangs: 0,
        medicines: 0, cleanliness: 0, moral: 100, equippedWeapon: 'club',
        hensState: [{ id: crypto.randomUUID(), breed: 'hen', laidAt: now, isSick: false }]
    };
}
