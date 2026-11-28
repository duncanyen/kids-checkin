/** Private equipped-instance resolution. Acquired bonuses survive admission switches. */
const D=require('./domain.cjs'),W=require('./weapon-repository.cjs'),Core=require('./refinement-core.cjs');
async function equippedAbilities({db,t,actor,farm,balance}){
 if(!W.isV2(farm))return null;
 const repo=W.createWeaponRepository({db}),header=await repo.owner(t,actor,farm),rules=await import('./game/combat-rules.js'),slots={};
 for(const [mode,id]of [['melee',header.equippedMeleeInstanceId],['ranged',header.equippedBowInstanceId]]){
  if(!id){slots[mode]=null;continue;}
  const item=await repo.get(t,actor,farm,id,header),raw=header.hasRefinementStates?(await t.get(db.doc(W.statePath(actor,id)))).data():null,state=raw?Core.validateState(raw,item,header.generation):Core.initialState(item,header.generation),liveBase=Core.baseSnapshot(balance.weapons[item.weaponId],balance.revision),base=Core.effectiveBase(state,liveBase),stats=Core.calculateStats(base,state.refineBonus);
  slots[mode]={instanceId:id,weaponId:item.weaponId,refineLevel:state.refineLevel,refineBonus:state.refineBonus,base,liveBase,stats,criticalRatePercent:state.refineLevel?stats.criticalRateBp/100:balance.weapons[item.weaponId].criticalRate,chainCriticalRatePercent:state.refineLevel?stats.chainCriticalRateBp/100:balance.weapons[item.weaponId].chainCriticalRate,stateRevision:state.revision,refineEpoch:state.refineEpoch,refineStatsVersion:state.refineStatsVersion,criticalMultiplier:1.5,damageSpread:10,serverHitsPerSecond:mode==='ranged'?10:20,serverBurst:4,clientShotIntervalMs:mode==='ranged'?250:null,allowedMonsters:Object.entries(rules.WEAPONS_CONFIG[item.weaponId].damageByEnemy||{}).filter(([,damage])=>damage>0).map(([kind])=>kind),otherEffects:[]};
 }
 return{schemaVersion:1,generation:header.generation,ownerRevision:header.revision,slots};
}
function applyAbilities(snapshot,abilities){
 if(!abilities)return snapshot;
 const eligible=['melee','ranged'].some(mode=>snapshot.baseDamage[mode]>0&&abilities.slots[mode]?.refineLevel>0);
 if(!eligible)return snapshot; // +0 and incompatible refined weapons keep exact V4 semantics.
 const next={...snapshot,damageVersion:5,abilitySnapshotVersion:1,weaponAbilities:abilities,chainState:{mode:null,critical:false,streak:0},actionCount:0,baseDamage:{...snapshot.baseDamage},criticalRate:{...snapshot.criticalRate},chainCriticalRate:{...snapshot.chainCriticalRate}};
 for(const mode of ['melee','ranged']){const slot=abilities.slots[mode];if(!slot)continue;if(slot.weaponId!==snapshot.weapons[mode])D.fail('failed-precondition','裝備種類與個體不一致');if(!next.baseDamage[mode])continue;next.baseDamage[mode]=slot.stats.attack;next.criticalRate[mode]=slot.criticalRatePercent;next.chainCriticalRate[mode]=slot.chainCriticalRatePercent;}
 return next;
}
module.exports={equippedAbilities,applyAbilities};
