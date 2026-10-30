import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

async function fixture() {
    const docs = {
        'groups/A': { members: ['alice'] }, 'groups/B': { members: ['alice'] },
        'groups/A/users/alice': { farm: { coins: 12, worms: 2, earthworms: 1, warehouseLimit: 10 } },
        'groups/B/users/alice': { farm: { coins: 0 } }
    };
    const state = { fail: false, commits: 0 }, versions = new Map();
    globalThis.__mailFixture = { docs, state, versions };
    const mock = `
      const {docs,state,versions}=globalThis.__mailFixture;
      const doc=(_, ...parts)=>({path:parts.join('/')}),collection=doc,onSnapshot=()=>{};
      async function runTransaction(_,callback){
        for(let attempt=0;attempt<10;attempt++){
          const reads=new Map(),writes=[];
          const result=await callback({
            get:async ref=>{const data=structuredClone(docs[ref.path]);reads.set(ref.path,versions.get(ref.path)||0);return{exists:()=>data!==undefined,data:()=>data}},
            set:(ref,data)=>writes.push({path:ref.path,data}),update:(ref,data)=>writes.push({path:ref.path,data,merge:true}),delete:ref=>writes.push({path:ref.path,remove:true})
          });
          if(state.fail)throw Error('offline');
          if([...reads].some(([path,version])=>(versions.get(path)||0)!==version))continue;
          for(const write of writes){
            if(write.remove)delete docs[write.path];
            else{
              const next=write.merge?structuredClone(docs[write.path]):{};
              for(const [path,value]of Object.entries(write.data)){const bits=path.split('.');let target=next;for(const bit of bits.slice(0,-1))target=target[bit]??={};target[bits.at(-1)]=structuredClone(value)}
              docs[write.path]=next;
            }
            versions.set(write.path,(versions.get(write.path)||0)+1);
          }
          if(writes.length)state.commits++;
          return result;
        }
        throw Error('Too many retries');
      }
    `;
    const source = readFileSync(new URL('../js/farm/mail-store.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(mock + source + `\n// ${Math.random()}`).toString('base64'));
    return { ...mod, docs, state, store: mod.createFarmMailStore({}, { groupId: 'A', accountId: 'alice' }) };
}
const owner = 'groups/A/users/alice', notice = owner + '/farm_notifications/welcome-v1';

test('concurrent welcome delivery and claims award exactly once, including full warehouses', async () => {
    const f = await fixture();
    await Promise.all([f.store.ensureWelcome(), f.store.ensureWelcome()]);
    assert.equal(f.state.commits, 1);
    assert.equal(f.docs[notice].body, f.WELCOME_BODY);
    const results = await Promise.all([f.store.claim(f.WELCOME_ID), f.store.claim(f.WELCOME_ID)]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.deepEqual(f.docs[owner].farm, { coins: 1012, worms: 10, earthworms: 5, warehouseLimit: 10 });
    assert.ok(f.docs[owner].farmMail.welcomeClaimedAt);
    assert.ok(f.docs[notice].claimedAt);
    await f.store.remove(f.WELCOME_ID);
    await f.store.ensureWelcome();
    assert.equal(f.docs[notice], undefined);
    await assert.rejects(f.store.claim(f.WELCOME_ID), /通知已刪除/);
    assert.equal(f.docs[owner].farm.coins, 1012);
});

test('deleting unclaimed mail does not resend it; each group has its own welcome', async () => {
    const f = await fixture();
    await f.store.ensureWelcome(); await f.store.remove(f.WELCOME_ID); await f.store.ensureWelcome();
    assert.equal(f.docs[notice], undefined);
    assert.equal(f.docs[owner].farm.coins, 12);
    const other = f.createFarmMailStore({}, { groupId: 'B', accountId: 'alice' });
    await other.ensureWelcome(); await other.claim(f.WELCOME_ID);
    assert.equal(f.docs['groups/B/users/alice'].farm.coins, 1000);
    assert.equal(f.docs[owner].farm.coins, 12);
});

test('failed transaction does not consume rewards and removed members cannot manage mail', async () => {
    const f = await fixture();
    await f.store.ensureWelcome();
    f.state.fail = true;
    await assert.rejects(f.store.claim(f.WELCOME_ID), /offline/);
    assert.equal(f.docs[owner].farm.coins, 12);
    assert.equal(f.docs[notice].claimedAt, null);
    f.state.fail = false;
    f.docs['groups/A'].members = [];
    await assert.rejects(f.store.claim(f.WELCOME_ID), /不在此群組/);
    await assert.rejects(f.store.remove(f.WELCOME_ID), /不在此群組/);
    assert.ok(f.docs[notice]);
});

test('visitor records are anonymous and timestamps always use Taiwan time', async () => {
    const f = await fixture();
    const time = Date.parse('2026-10-27T00:55:34Z');
    assert.deepEqual(f.visitorNotice(time), { type: 'visitor', title: '訪客來訪', note: '訪客來偷蛋', createdAt: time, readAt: null });
    assert.equal(f.formatMailTime(time), '2026-10-27 08:55:34');
    assert.equal(f.formatMailTime(Date.parse('2026-10-26T16:00:00Z')), '2026-10-27 00:00:00');
});


test('read receipts persist, tolerate deleted mail and never change rewards', async () => {
    const f = await fixture();
    await f.store.ensureWelcome();
    assert.equal(f.docs[notice].readAt, null);
    f.state.fail = true;
    await assert.rejects(f.store.markRead([f.WELCOME_ID]), /offline/);
    assert.equal(f.docs[notice].readAt, null);
    f.state.fail = false;
    await f.store.markRead([f.WELCOME_ID, f.WELCOME_ID, 'already-deleted']);
    const readAt = f.docs[notice].readAt;
    assert.ok(readAt);
    await f.store.markRead([f.WELCOME_ID]);
    assert.equal(f.docs[notice].readAt, readAt);
    assert.equal(f.docs[notice].claimedAt, null);
    assert.equal(f.docs[owner].farm.coins, 12);
    f.docs['groups/A'].members = [];
    await assert.rejects(f.store.markRead([f.WELCOME_ID]), /不在此群組/);
});

test('batch deletion is scoped, deduplicated, atomic and cannot recreate deleted rewards', async () => {
 const f=await fixture();await f.store.ensureWelcome();
 for(let i=0;i<100;i++)f.docs[owner+'/farm_notifications/batch-'+i]={type:'visitor'};
 const ids=Array.from({length:99},(_,i)=>'batch-'+i).concat(f.WELCOME_ID);
 f.state.fail=true;
 await assert.rejects(f.store.removeBatch(ids),/offline/);assert.ok(f.docs[notice]);
 assert.ok(f.docs[owner+'/farm_notifications/batch-0']);
 f.state.fail=false;await f.store.removeBatch(ids);await f.store.ensureWelcome();
 assert.equal(f.docs[notice],undefined);assert.ok(f.docs[owner+'/farm_notifications/batch-99']);
 assert.equal(f.docs[owner].farm.coins,12);
 await assert.rejects(async()=>f.store.removeBatch(Array.from({length:101},(_,i)=>'x'+i)),/最多/);
 await assert.rejects(async()=>f.store.removeBatch(['bad/path']),/無效/);
 f.docs['groups/A'].members=[];
 await assert.rejects(f.store.removeBatch(['batch-99']),/不在此群組/);
 assert.ok(f.docs[owner+'/farm_notifications/batch-99']);
});
