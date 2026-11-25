/** Admin-only balance configuration. Read once when a new battle is created. */
const D=require('./domain.cjs');
const MAX_HP=10000000,MAX_ATTACK=1000000;
async function defaults(){
 const C=await import('./game/combat-rules.js');
 return {monsters:Object.fromEntries(Object.entries(C.ENEMY_HEALTH).map(([id,hp])=>[id,{hp}])),weapons:Object.fromEntries(Object.entries(C.WEAPON_ATTACK).map(([id,attack])=>[id,{attack,criticalRate:5,chainCriticalRate:5}]))};
}
function validate(type,value){
 if(!value||typeof value!=='object')D.fail('invalid-argument','缺少戰鬥數值');
 if(type==='monsters')return {hp:D.integer(value.hp,1,MAX_HP)};
 if(type!=='weapons')D.fail('invalid-argument','未知戰鬥設定類型');
 const attack=D.integer(value.attack,1,MAX_ATTACK),rate=value.criticalRate;
 if(typeof rate!=='number'||!Number.isFinite(rate)||rate<0||rate>100)D.fail('invalid-argument','爆擊率必須為 0–100%');
 const chain=value.chainCriticalRate??5;
 if(typeof chain!=='number'||!Number.isFinite(chain)||chain<0||chain>100)D.fail('invalid-argument','連續爆擊率必須為 0–100%');
 return {attack,criticalRate:rate,chainCriticalRate:chain};
}
async function merge(raw={}){
 const base=await defaults(),out={revision:raw.revision||0,updatedAt:raw.updatedAt||null};
 for(const type of ['monsters','weapons'])out[type]=Object.fromEntries(Object.entries(base[type]).map(([id,value])=>[id,validate(type,raw[type]?.[id]??value)]));
 return out;
}
async function config(db,t){const ref=db.doc('ops_game_config/combat'),snap=await(t?t.get(ref):ref.get());return merge(snap.data());}
module.exports={MAX_HP,MAX_ATTACK,defaults,validate,merge,config};
