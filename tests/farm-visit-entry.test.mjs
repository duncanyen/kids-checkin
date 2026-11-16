import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareVisitEntry, visitEntryMilestone } from '../js/farm/visit-entry.js';
const context={targetGroupId:'B',targetAccountId:'bob',ownFarm:{coopLevel:3}};
test('無怪進場結果在列表取得，結果為 null 也代表已確認，不額外重送',async()=>{
 const calls=[];
 const result=await prepareVisitEntry(context,{active:()=>true,command:async(...args)=>{calls.push(args);return null;}});
 assert.deepEqual(result,{targetGroupId:'B',targetAccountId:'bob',authorized:null});assert.deepEqual(calls,[['visitEncounter',{targetGroupId:'B',targetAccountId:'bob'}]]);
});
test('里程碑順序一致，已到期的舊事件只補確認一次，保留實際怪物血量期限',async()=>{
 assert.equal(visitEntryMilestone({giantChallenge:{},moleChallenge:{}}),'giant');assert.equal(visitEntryMilestone({moleChallenge:{}}),'mole');
 const calls=[],challenge={targetGroupId:'B',targetAccountId:'bob',health:600,deadline:123};
 const result=await prepareVisitEntry({...context,ownFarm:{moleChallenge:{}}},{active:()=>true,command:async(...args)=>{calls.push(args);return calls.length===1?{expired:true,result:{outcome:'loss'}}:{kind:'mole',challenge};}});
 assert.equal(calls[0][0],'claimEncounter');assert.equal(calls[0][1].monster,'mole');assert.deepEqual(calls[1],['visitEncounter',{targetGroupId:'B',targetAccountId:'bob',reusePermit:true}]);assert.equal(result.authorized.challenge,challenge);
});
test('切換選擇後丟棄回覆，不補送請求；其他雞舍未完成事件不得默默換目標',async()=>{
 let current=true,count=0;
 assert.equal(await prepareVisitEntry(context,{active:()=>current,command:async()=>{count++;current=false;return{expired:true,result:{}};}}),null);assert.equal(count,1);
 await assert.rejects(prepareVisitEntry(context,{active:()=>true,command:async()=>({challenge:{targetGroupId:'C',targetAccountId:'carol'}})}),/其他雞舍/);
 current=false;assert.equal(await prepareVisitEntry(context,{active:()=>current,command:async()=>{throw Error('不可送出');}}),null);
});
