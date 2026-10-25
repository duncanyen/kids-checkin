// Shared combat balance. Explicit enemy damage avoids accidental changes to other fights.
export const ENEMY_HEALTH = Object.freeze({ wolf: 200, tiger: 200, dragon: 600, gorilla: 1000 });
export const WEAPONS_CONFIG = {
    club: { name: '木棒', damage: 1, damageByEnemy: { wolf: 1, tiger: 1, dragon: 1, gorilla: 1 }, icon: 'club' },
    mace: { name: '狼牙棒', damage: 10, damageByEnemy: { wolf: 10, tiger: 10, dragon: 10, gorilla: 5 }, icon: 'mace', buyPrice: 2000, sellPrice: 1000 },
    battleaxe: { name: '雙手斧', damage: 20, damageByEnemy: { wolf: 40, tiger: 20, dragon: 30, gorilla: 25 }, icon: 'battleaxe', buyPrice: 5000 }
};
export function weaponDamage(weapon, enemy) {
    return Math.max(1, Number(weapon.damageByEnemy?.[enemy] ?? weapon.damage) || 1);
}
// Legacy saves may have an equipped key without a remaining owned copy.
export function equippedWeapon(farm) {
    const key = farm?.equippedWeapon;
    return key !== 'club' && WEAPONS_CONFIG[key] && farm?.[key] > 0 ? WEAPONS_CONFIG[key] : WEAPONS_CONFIG.club;
}
export function hitsToDefeat(weapon, enemy) {
    return Math.ceil(ENEMY_HEALTH[enemy] / weaponDamage(weapon, enemy));
}
