import {WEAPON_ATTACK,ENEMY_HEALTH,LEGACY_ENEMY_HEALTH,WEAPONS_CONFIG,LEGACY_WEAPONS_CONFIG,weaponDamage,equippedWeapon,equippedBow} from './combat-rules.js';
export const COMBAT_VERSION=2;
export const DAMAGE_SPREAD=10;
export function weaponKey(weapon){return Object.keys(WEAPONS_CONFIG).find(key=>WEAPONS_CONFIG[key]===weapon||WEAPONS_CONFIG[key].icon===weapon?.icon)||'club';}
export function makeCombatSnapshot(farm,kind,seed,balance){
 const melee=weaponKey(equippedWeapon(farm)),bow=equippedBow(farm),ranged=bow?weaponKey(bow):null;
 return {combatVersion:COMBAT_VERSION,damageVersion:4,balanceRevision:balance?.revision||0,maxHealth:balance?.monsters?.[kind]?.hp??ENEMY_HEALTH[kind],damageSeed:seed,weapons:{melee,ranged},baseDamage:{melee:weaponDamage(WEAPONS_CONFIG[melee],kind)>0?(balance?.weapons?.[melee]?.attack??WEAPON_ATTACK[melee]):0,ranged:ranged&&weaponDamage(WEAPONS_CONFIG[ranged],kind)>0?(balance?.weapons?.[ranged]?.attack??WEAPON_ATTACK[ranged]):0},chainCriticalRate:{melee:balance?.weapons?.[melee]?.chainCriticalRate??5,ranged:ranged?(balance?.weapons?.[ranged]?.chainCriticalRate??5):0},criticalRate:{melee:balance?.weapons?.[melee]?.criticalRate??5,ranged:ranged?(balance?.weapons?.[ranged]?.criticalRate??5):0}};
}
function hash(value){let x=2166136261;for(let i=0;i<value.length;i++){x^=value.charCodeAt(i);x=Math.imul(x,16777619);}x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^(x>>>16))>>>0;}
// Snapshots are immutable. Cache only reproducible per-weapon outcomes, never
// client-supplied damage or RNG. Partitioning a batch cannot change a streak.
const sequences=new WeakMap();
const succeeds=(seed,tag,mode,index,rate)=>rate>=100||rate>0&&hash(`${seed}|${tag}|${mode}|${index}`)/4294967296*100<rate;
function criticalAt(battle,mode,index){
 let modes=sequences.get(battle);if(!modes){modes={};sequences.set(battle,modes);}
 const hits=modes[mode]||=([]);
 while(hits.length<=index){
  const i=hits.length,previous=hits[i-1],base=succeeds(battle.damageSeed,'critical',mode,i,battle.criticalRate?.[mode]||0);
  const extra=!!previous?.critical&&succeeds(battle.damageSeed,'chain',mode,i,battle.chainCriticalRate?.[mode]||0),critical=base||extra;
  hits.push({critical,chainProc:extra&&!base,streak:critical?(previous?.streak||0)+1:0});
 }
 return hits[index];
}
/** Each server-created battle has a reproducible per-mode hit sequence. No client damage is trusted. */
export function hitResult(battle,mode,index,weapon,kind,chainState){
 if(battle?.combatVersion===COMBAT_VERSION){
  const base=battle.baseDamage?.[mode]||0;if(!base)return {damage:0,critical:false};
  // V2 sessions without the new snapshot retain their exact old sequence.
  const low=Math.max(1,base-DAMAGE_SPREAD),span=battle.damageVersion>=3?base+DAMAGE_SPREAD-low+1:DAMAGE_SPREAD*2+1;
  const normal=low+hash(`${battle.damageSeed}|${mode}|${index}`)%span;
  const rate=battle.damageVersion>=3?(battle.criticalRate?.[mode]||0):0;
  if(battle.damageVersion===5)return refinedHitResult(battle,mode,index,chainState??battle.chainState);
  if(battle.damageVersion===4){const outcome=criticalAt(battle,mode,index);return {damage:Math.round(normal*(outcome.critical?1.5:1)),normalDamage:normal,multiplier:outcome.critical?1.5:1,...outcome};}
  const critical=rate>=100||rate>0&&hash(`${battle.damageSeed}|critical|${mode}|${index}`)%1000000<rate*10000;
  const multiplier=critical?2000+hash(`${battle.damageSeed}|multiplier|${mode}|${index}`)%1001:1000;
  return {damage:Math.round(normal*multiplier/1000),critical,normalDamage:normal,multiplier:multiplier/1000};
 }
 return {damage:weaponDamage(LEGACY_WEAPONS_CONFIG[weaponKey(weapon)]||LEGACY_WEAPONS_CONFIG.club,kind),critical:false};
}
export function hitDamage(...args){return hitResult(...args).damage;}

export function maximumHealth(battle,kind){return battle?.maxHealth||(battle?.combatVersion===COMBAT_VERSION?ENEMY_HEALTH[kind]:LEGACY_ENEMY_HEALTH[kind]);}
export function batchDamage(battle,mode,start,count){let total=0;for(let i=start;i<start+count;i++)total+=hitDamage(battle,mode,i);return total;}

/** V5 explicit chronological chain cursor: changing attack slot resets the streak. */
export function refinedHitResult(battle,mode,index,state){
 const base=battle.baseDamage?.[mode]||0;
 if(!base)return{damage:0,critical:false,normalDamage:0,multiplier:1,chainProc:false,streak:0};
 const low=Math.max(1,base-DAMAGE_SPREAD),span=base+DAMAGE_SPREAD-low+1,normal=low+hash(`${battle.damageSeed}|${mode}|${index}`)%span;
 const previous=state?.mode===mode&&!!state.critical,baseProc=succeeds(battle.damageSeed,'critical',mode,index,battle.criticalRate?.[mode]||0),extraProc=previous&&succeeds(battle.damageSeed,'chain',mode,index,battle.chainCriticalRate?.[mode]||0),critical=baseProc||extraProc;
 return{damage:Math.round(normal*(critical?1.5:1)),normalDamage:normal,multiplier:critical?1.5:1,critical,chainProc:extraProc&&!baseProc,streak:critical?(previous?state.streak+1:1):0};
}
export function chronologicalDamage(battle,runs,attacks=battle.attacks||{melee:0,ranged:0},state=battle.chainState){
 const counts={melee:attacks.melee||0,ranged:attacks.ranged||0};let damage=0,chainState=state||{mode:null,critical:false,streak:0};
 outer:for(const run of runs){
  if(run.type==='switch'){chainState={mode:run.mode,critical:false,streak:0};continue;}
  for(let n=0;n<run.count;n++){
  if(damage>=(battle.health??Infinity)){chainState={mode:null,critical:false,streak:0};break outer;}
  const hit=refinedHitResult(battle,run.mode,counts[run.mode],chainState);
  if(!hit.damage)throw Error('Invalid chronological attack');
  counts[run.mode]++;damage+=hit.damage;chainState={mode:run.mode,critical:hit.critical,streak:hit.streak};
 }}
 if(damage>=(battle.health??Infinity))chainState={mode:null,critical:false,streak:0};
 return{damage,attacks:counts,chainState,actionCount:counts.melee+counts.ranged};
}

/** Shared client/server boundary. Legacy sessions without arrival metadata remain compatible. */
export function battleAttackAvailable(battle,now){
 if(!Number.isFinite(now))return false;
 if(battle?.approachEndsAt!==undefined&&(!Number.isFinite(battle.approachEndsAt)||now<battle.approachEndsAt))return false;
 return battle?.deadline===undefined||Number.isFinite(battle.deadline)&&now<battle.deadline;
}
