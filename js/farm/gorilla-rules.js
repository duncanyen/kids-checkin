export const GORILLA_CONFIG = Object.freeze({ health: 1000, flightMs: 10000, durationMs: 40000, encounterOdds: 30, minCoopLevel: 3, coinPenalty: 100 });
export const GORILLA_FANG_PRICE = 300;

// A single exclusive roll preserves BOTH exact rates at Lv.3+: 2/60 gorilla,
// 3/60 dragon. Lv.2 retains its existing 1/20 dragon encounter.
export function rollHomeBossEncounter(level, roll = (min, max) => Phaser.Math.Between(min, max)) {
    if ((level || 1) >= 3) {
        const result = roll(1, 60);
        return result <= 2 ? 'gorilla' : result <= 5 ? 'dragon' : null;
    }
    return (level || 1) >= 2 && roll(1, 20) === 1 ? 'dragon' : null;
}
export function bossWeaponDamage(weapon, enemy) {
    return Math.max(1, Number(weapon.damageByEnemy?.[enemy] ?? weapon.damage) || 1);
}
