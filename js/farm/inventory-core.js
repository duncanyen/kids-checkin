export const INVENTORY_KEYS = ['silkieEggs', 'bresseEggs', 'inventoryEggs', 'worms', 'earthworms', 'wolfFangs', 'tigerPelts', 'dragonScales', 'gorillaFangs', 'medicines', 'mace', 'battleaxe', 'shortbow', 'huntingbow', 'eagleFeathers'];

// 動態計算倉庫目前使用容量
export const getUsedSpace = (farm) => {
    if (!farm) return 0;
    return INVENTORY_KEYS.reduce((sum, key) => sum + (farm[key] || 0), 0);
};
