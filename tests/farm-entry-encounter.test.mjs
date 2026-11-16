import test from 'node:test';
import assert from 'node:assert/strict';
import { farmActionsBlocked } from '../js/farm/entry-encounter.js';
test('進場確認、所有怪物種類與結算期間攔住農場物件；結算完成才開放',()=>{
 assert.equal(farmActionsBlocked({entryChecked:false}),true);
 for(const flag of ['checkingEntry','resumingPendingBattle','preparingEncounter','preparingGiant','preparingCobra','preparingMole'])assert.equal(farmActionsBlocked({entryChecked:true,[flag]:true}),true);
 for(const key of ['giantEncounter','moleEncounter','cobraEncounter','eagleEncounter','dragonEncounter','gorillaEncounter']){
  const scene={entryChecked:true,[key]:{settled:false}};assert.equal(farmActionsBlocked(scene),true);scene[key].settled=true;assert.equal(farmActionsBlocked(scene),false);
 }
 for(const key of ['wolf','tiger']){let resolved=false;const scene={entryChecked:true,[key]:{active:true,getData:()=>resolved}};assert.equal(farmActionsBlocked(scene),true);resolved=true;assert.equal(farmActionsBlocked(scene),false);}
 assert.equal(farmActionsBlocked({entryChecked:true},true),true,'等候後端戰鬥結算仍需鎖住其他物件');
 assert.equal(farmActionsBlocked({entryChecked:true}),false);
});

test('進場確認期間 HUD 隱藏導覽；一般交易不被誤認為怪物',async()=>{
 const {hasFarmHudEncounter}=await import('../js/farm/hud-ui.js');
 assert.equal(hasFarmHudEncounter({entryChecked:false}),true);
 assert.equal(hasFarmHudEncounter({entryChecked:true,checkingEntry:true}),true);
 assert.equal(hasFarmHudEncounter({entryChecked:true,isHarvesting:true}),false);
});
