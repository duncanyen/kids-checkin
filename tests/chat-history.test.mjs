import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatHistory } from '../js/chat-history.js';
const row=(id,days)=>({id,timestamp:{toMillis:()=>Date.now()-days*86400000},text:id});
test('history reaches beyond 30 days, merges live updates and deduplicates',async()=>{
    const h=new ChatHistory('r',async()=>({messages:[row('old',65),row('month',31)],cursor:'p1',hasMore:false}));
    h.merge([row('latest',0)]);await h.loadOlder();h.merge([{...row('latest',0),text:'updated'},row('new',-1)]);
    assert.deepEqual(h.list.map(m=>m.id),['old','month','latest','new']);assert.equal(h.messages.get('latest').text,'updated');
    assert.equal(h.hasMore,false);assert.equal(await h.loadOlder(),false);
});
test('one page at a time, errors keep cursor and allow retry',async()=>{
    let release,calls=0;
    const h=new ChatHistory('r',async cursor=>{calls++;if(calls===1)await new Promise(r=>release=r);if(calls===2)throw Error('offline');return{messages:[row('a',60)],cursor:'last',hasMore:true};});
    const pending=h.loadOlder();assert.equal(await h.loadOlder(),false);assert.equal(calls,1);release();await pending;
    await assert.rejects(h.loadOlder(),/offline/);assert.equal(h.cursor,'last');assert.equal(h.error,true);assert.equal(h.loading,false);
    await h.loadOlder();assert.equal(h.error,false);assert.equal(h.list.length,1);
});
test('equal timestamps use deterministic document ID order',()=>{
    const h=new ChatHistory('r',()=>{});const timestamp={toMillis:()=>100};
    h.merge([{id:'b',timestamp},{id:'a',timestamp},{id:'b',timestamp,text:'updated'}]);
    assert.deepEqual(h.list.map(m=>m.id),['a','b']);assert.equal(h.list[1].text,'updated');
});
