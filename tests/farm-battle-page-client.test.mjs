import test from 'node:test';import assert from 'node:assert/strict';
import {createBattlePage} from '../js/farm/battle-page-client.js';
function fixture(request,entries=[]){
 const data=new Map(entries),events=new Map();let n=0,resumes=0;
 const storage={get length(){return data.size;},key:i=>[...data.keys()][i],removeItem:key=>data.delete(key)};
 const api=createBattlePage({request,storage,events:{addEventListener:(name,fn)=>events.set(name,fn)},uuid:()=>`page-fixture-${++n}`,resume:()=>resumes++});
 return{api,data,events,resumes:()=>resumes};
}
test('one page registration gates concurrent requests; pagehide closes once and bfcache resumes by reload',async()=>{
 const calls=[];let release;
 const f=fixture(async(action,payload,id)=>{calls.push({action,payload,id});if(action==='beginBattlePage'){await new Promise(r=>release=r);return{result:{protocolVersion:1,battlePageId:payload.battlePageId}};}return{result:{ok:true}};});
 const a=f.api.execute('homeEncounter',{},'one'),b=f.api.execute('ensureWelcome',{},'two');assert.equal(calls.length,1);release();await Promise.all([a,b]);assert.equal(calls.filter(c=>c.action==='beginBattlePage').length,1);assert.equal(calls[1].payload.battlePageId,calls[2].payload.battlePageId);
 f.events.get('pagehide')();f.events.get('pagehide')();assert.equal(calls.filter(c=>c.action==='abandonBattlePage').length,1);
 await assert.rejects(f.api.execute('battleAttack',{},'three'),{code:'ops/battle-page-closed'});f.events.get('pageshow')({persisted:true});assert.equal(f.resumes(),1);
});
test('legacy backend may fall back only on explicit unknown-action validation; other registration failures remain blocked',async()=>{
 const calls=[];const f=fixture(async(action,payload)=>{calls.push({action,payload});if(action==='beginBattlePage')throw Object.assign(Error('選項無效 [400]'),{code:'functions/invalid-argument'});return{result:{}};});await f.api.execute('homeEncounter',{},'one');assert.equal(calls[1].payload.battlePageId,undefined);
 const denied=fixture(async()=>{throw Object.assign(Error('denied'),{code:'functions/permission-denied'});});await assert.rejects(denied.api.execute('homeEncounter',{},'x'),{code:'functions/permission-denied'});
});
test('closing while registration is pending prevents the delayed gameplay request',async()=>{
 const calls=[];let release;const f=fixture(async(action,payload)=>{calls.push(action);await new Promise(r=>release=r);return{result:{protocolVersion:1,battlePageId:payload.battlePageId}};});const pending=f.api.execute('homeEncounter',{},'one');f.api.close();release();await assert.rejects(pending,{code:'ops/battle-page-closed'});assert.deepEqual(calls,['beginBattlePage']);
});

test('fresh page clears only pending pure battle commands and retains economic receipt recovery',()=>{
 const key=(action,payload={})=>'nexus.farm.pending:'+JSON.stringify(['alice','A',action,payload]);
 const entries=[['other-module','keep'],[key('battleAttack'),'drop'],[key('battleSettle'),'drop'],[key('homeEncounter'),'drop'],[key('visitEncounter'),'drop'],[key('claimEncounter'),'drop'],[key('homeEncounter',{collectWhenClear:true}),'keep'],[key('visitEncounter',{stealWhenClear:true}),'keep'],[key('stealEgg'),'keep'],[key('helpClean'),'keep']];
 const f=fixture(async()=>({result:{}}),entries);assert.deepEqual([...f.data.values()],['keep','keep','keep','keep','keep']);
});
