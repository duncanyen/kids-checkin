import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// 直接載入正式函式；排除需要瀏覽器 Firebase SDK 的其他命令。
const source = readFileSync(new URL('../js/farm/backend-client.js', import.meta.url), 'utf8');
const { routeBackendChallenge } = await import('data:text/javascript;base64,' + Buffer.from(
    "const FARM_BACKEND_ENABLED=true, readGameContext=()=>({groupId:'A',accountId:'alice'});\n" + source.slice(source.indexOf('export function routeBackendChallenge'))
).toString('base64'));
const fixture = (key, groupId, accountId) => {
    const starts=[],messages=[];
    return { starts,messages,scene:{scene:{key,start:(...args)=>starts.push(args)},targetGroupId:groupId,targetAccountId:accountId,visitEncounterReady:true,showFloatingText:message=>messages.push(message)} };
};

test('拜訪期間遇到其他帳號或跨群組同帳號的戰鬥，留在原地並阻止偷蛋', () => {
    for (const [groupId,accountId] of [['A','carol'],['B','bob']]) {
        const f=fixture('VisitScene','A','bob'),challenge={targetGroupId:groupId,targetAccountId:accountId};
        assert.equal(routeBackendChallenge(f.scene,{challenge}),false);
        assert.deepEqual(f.starts,[]);assert.equal(f.scene.targetGroupId,'A');assert.equal(f.scene.targetAccountId,'bob');
        assert.equal(f.scene.backendChallenge,null);assert.equal(f.scene.visitEncounterReady,false);assert.equal(f.messages.length,1);
    }
});
test('相同雞舍正常接戰，從自家恢復原戰鬥仍能前往正確雞舍', () => {
    const challenge={targetGroupId:'B',targetAccountId:'bob',targetName:'Bob'};
    const same=fixture('VisitScene','B','bob');
    assert.equal(routeBackendChallenge(same.scene,{challenge}),true);assert.equal(same.scene.backendChallenge,challenge);assert.deepEqual(same.starts,[]);
    const home=fixture('MyFarmScene');
    assert.equal(routeBackendChallenge(home.scene,{challenge}),false);assert.deepEqual(home.starts,[['VisitScene',{targetGroupId:'B',targetAccountId:'bob',targetName:'Bob'}]]);
    assert.equal(routeBackendChallenge(same.scene,{}),true);
});
