// Shared combat balance. Explicit enemy damage avoids accidental changes to other fights.
export const ENEMY_HEALTH = Object.freeze({ wolf: 200, tiger: 200, dragon: 600, gorilla: 1000, eagle: 200 });
export const WEAPONS_CONFIG = {
    club: { name: '木棒', damage: 1, damageByEnemy: { wolf: 1, tiger: 1, dragon: 0, eagle: 0, gorilla: 1 }, icon: 'club' },
    mace: { name: '狼牙棒', damage: 10, damageByEnemy: { wolf: 10, tiger: 10, dragon: 0, eagle: 0, gorilla: 5 }, icon: 'mace', buyPrice: 2000, sellPrice: 1000 },
    battleaxe: { name: '雙手斧', damage: 20, damageByEnemy: { wolf: 40, tiger: 20, dragon: 0, eagle: 0, gorilla: 25 }, icon: 'battleaxe', buyPrice: 5000 },
    shortbow: { name: '短弓', ranged: true, damage: 0, damageByEnemy: { dragon: 30, eagle: 20 }, icon: 'shortbow', buyPrice: 1000, sellPrice: 500 },
    huntingbow: { name: '獵弓', ranged: true, damage: 0, damageByEnemy: { dragon: 60, eagle: 40 }, icon: 'huntingbow', buyPrice: 5000, sellPrice: 2500 }
};
export function weaponDamage(weapon, enemy) {
    return Math.max(0, Number(weapon.damageByEnemy?.[enemy] ?? weapon.damage) || 0);
}
// Legacy saves may have an equipped key without a remaining owned copy.
export function equippedWeapon(farm) {
    const key = farm?.equippedWeapon;
    return key !== 'club' && !WEAPONS_CONFIG[key]?.ranged && WEAPONS_CONFIG[key] && farm?.[key] > 0 ? WEAPONS_CONFIG[key] : WEAPONS_CONFIG.club;
}
export function hitsToDefeat(weapon, enemy) {
    return Math.ceil(ENEMY_HEALTH[enemy] / weaponDamage(weapon, enemy));
}

export function equippedBow(farm) {
    const key = farm?.equippedBow;
    return WEAPONS_CONFIG[key]?.ranged && farm?.[key] > 0 ? WEAPONS_CONFIG[key] : null;
}
