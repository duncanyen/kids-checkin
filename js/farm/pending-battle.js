import {routeBackendChallenge,settleBackendBattle,farmNow} from './backend-client.js';
import {bossAssets,ensureAssets} from './assets.js';
import {WEAPONS_CONFIG} from './combat-rules.js';
import {EagleEncounter} from './eagle.js';
import {DragonEncounter} from './dragon.js';
import {GorillaEncounter} from './gorilla.js';
import {GiantEncounter} from './giant.js';
import {CobraEncounter} from './cobra.js';
import {MoleEncounter} from './mole.js';
import {farmLoading} from './loading-ui.js';

/** 恢復伺服器保留的原戰鬥；不抽新怪、不改血量與期限，也不自動收蛋。 */
export async function restorePendingBattle(scene,challenge){
 const token=scene.farmSceneToken,active=()=>scene.sys.isActive()&&scene.farmSceneToken===token;
 scene.preparingEncounter=true;
 try{
  if(challenge.health===0||challenge.deadline<=farmNow()){
   // 已到期的拜訪戰鬥也由原會話結算；不必重新開啟可能已關閉的目標村落。
   const result=await settleBackendBattle(challenge.id);
   if(active())scene.showFloatingText(result.outcome==='win'?'上一場戰鬥已完成結算':`上一場戰鬥已結算（損失 ${result.coinsLost||0} 金幣）`,'#FFD54F',16);
   return;
  }
  const claim={kind:challenge.kind,challenge};
  // 拜訪時留下的挑戰仍回到原目標，由 VisitScene 重新核對並取得目前狀態。
  if(!routeBackendChallenge(scene,claim))return;
  const constructors={eagle:EagleEncounter,dragon:DragonEncounter,gorilla:GorillaEncounter,giant:GiantEncounter,cobra:CobraEncounter,mole:MoleEncounter};
  const Encounter=Object.hasOwn(constructors,challenge.kind)?constructors[challenge.kind]:null;if(!Encounter)throw Error('未完成戰鬥的類型無法在自家恢復');
  const key=challenge.kind+'Encounter',existing=scene[key];
  if(existing&&!existing.destroyed&&existing.id===challenge.id)return;
  const weapon=WEAPONS_CONFIG[scene.farmData?.equippedWeapon]||WEAPONS_CONFIG.club;
  const keys=[...bossAssets(challenge.kind),weapon.icon];
  if(keys.some(key=>!scene.textures.exists(key)))farmLoading.begin('恢復未完成的戰鬥');
  await ensureAssets(scene,keys,progress=>{if(active())farmLoading.progress(progress*95,'恢復未完成的戰鬥');});
  if(!active())return;
  if(scene[key]&&!scene[key].destroyed&&scene[key].id===challenge.id){farmLoading.complete(true);return;}
  scene.backendChallenge=challenge;
  scene[key]=new Encounter(scene,challenge);
  farmLoading.complete(true);
 }finally{if(active())scene.preparingEncounter=false;}
}
