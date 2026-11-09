import test from 'node:test';
import assert from 'node:assert/strict';
import { hasFarmHudEncounter } from '../js/farm/hud-ui.js';

test('所有 Boss：戰鬥與結算重試持續隱藏，成功結算或移除後恢復',()=>{
    for(const key of ['giantEncounter','cobraEncounter','moleEncounter','dragonEncounter','gorillaEncounter','eagleEncounter']){
        const boss={}; const scene={[key]:boss};
        assert.equal(hasFarmHudEncounter(scene),true,key);
        boss.result='win'; boss.settling=true;
        assert.equal(hasFarmHudEncounter(scene),true,key);
        boss.settling=false; // 寫入失敗、等待玩家重試，仍不可顯示導覽。
        assert.equal(hasFarmHudEncounter(scene),true,key);
        boss.settled=true;
        assert.equal(hasFarmHudEncounter(scene),false,key);
        boss.settled=false; boss.destroyed=true;
        assert.equal(hasFarmHudEncounter(scene),false,key);
    }
});
test('野狼與老虎：擊敗或逃跑後解除隱藏，不必等退場動畫完成',()=>{
    for(const key of ['wolf','tiger']){
        let resolved=false;
        const actor={active:true,getData:name=>name==='resolved'&&resolved};
        assert.equal(hasFarmHudEncounter({[key]:actor}),true);
        resolved=true;
        assert.equal(hasFarmHudEncounter({[key]:actor}),false);
        resolved=false; actor.active=false;
        assert.equal(hasFarmHudEncounter({[key]:actor}),false);
    }
});
test('準備怪物時隱藏，普通交易、一般對話及沒有怪物時不隱藏',()=>{
    for(const key of ['preparingEncounter','preparingGiant','preparingCobra','preparingMole']){
        assert.equal(hasFarmHudEncounter({[key]:true}),true,key);
        assert.equal(hasFarmHudEncounter({[key]:false}),false,key);
    }
    assert.equal(hasFarmHudEncounter(null),false);
    assert.equal(hasFarmHudEncounter({isProcessing:true,dialogContainer:{visible:true}}),false);
    assert.equal(hasFarmHudEncounter({giantEncounter:{settled:true},moleEncounter:{}}),true);
});
