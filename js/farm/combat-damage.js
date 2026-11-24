import {ENEMY_HEALTH,LEGACY_ENEMY_HEALTH,WEAPONS_CONFIG,LEGACY_WEAPONS_CONFIG,weaponDamage,equippedWeapon,equippedBow} from './combat-rules.js';
export const COMBAT_VERSION=2;
export const DAMAGE_SPREAD=10;
export function weaponKey(weapon){return Object.keys(WEAPONS_CONFIG).find(key=>WEAPONS_CONFIG[key]===weapon||WEAPONS_CONFIG[key].icon===weapon?.icon)||'club';}
export function makeCombatSnapshot(farm,kind,seed){
 const melee=weaponKey(equippedWeapon(farm)),bow=equippedBow(farm),ranged=bow?weaponKey(bow):null;
 return {combatVersion:COMBAT_VERSION,maxHealth:ENEMY_HEALTH[kind],damageSeed:seed,weapons:{melee,ranged},baseDamage:{melee:weaponDamage(WEAPONS_CONFIG[melee],kind),ranged:ranged?weaponDamage(WEAPONS_CONFIG[ranged],kind):0}};
}
function hash(value){let x=2166136261;for(let i=0;i<value.length;i++){x^=value.charCodeAt(i);x=Math.imul(x,16777619);}x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^(x>>>16))>>>0;}
/** Each server-created battle has a reproducible per-mode hit sequence. No client damage is trusted. */
export function hitDamage(battle,mode,index,weapon,kind){
 if(battle?.combatVersion===COMBAT_VERSION){
  const base=battle.baseDamage?.[mode]||0;if(!base)return 0;
  return Math.max(1,base-DAMAGE_SPREAD)+hash(`${battle.damageSeed}|${mode}|${index}`)%(DAMAGE_SPREAD*2+1);
 }
 return weaponDamage(LEGACY_WEAPONS_CONFIG[weaponKey(weapon)]||LEGACY_WEAPONS_CONFIG.club,kind);
}
export function maximumHealth(battle,kind){return battle?.maxHealth||(battle?.combatVersion===COMBAT_VERSION?ENEMY_HEALTH[kind]:LEGACY_ENEMY_HEALTH[kind]);}
export function batchDamage(battle,mode,start,count){let total=0;for(let i=start;i<start+count;i++)total+=hitDamage(battle,mode,i);return total;}
