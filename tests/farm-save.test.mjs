import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = 'groups/A/users/alice';
const farm = { coins: 54321, hens: 0, inventoryEggs: 22, silkieEggs: 9, bresseEggs: 6, eggsReady: 0,
    worms: 15, earthworms: 7, mace: 1, battleaxe: 1, coopLevel: 3, warehouseLimit: 200,
    hensState: [], poultryVersion: 2, readyEggs: { hen: 0, silkie: 0, bresse: 0 }, futureItem: 19 };
async function fixture(existing = farm) {
    const docs = { 'groups/A': { members: ['alice'] }, ...(existing === undefined ? {} : { [path]: { farm: structuredClone(existing), otherSetting: 'keep' } }) };
    const state = { offline: false, cache: false, commits: [], beforeCommit: null }, versions = new Map();
    globalThis.__saveFixture = { docs, state, versions };
    const mock = `
      const {docs,state,versions}=globalThis.__saveFixture;
      const doc=(_, ...parts)=>({path:parts.join('/')});
      async function runTransaction(_,callback){
        for(let attempt=0;attempt<10;attempt++){
          if(state.offline)throw Error('offline');
          const reads=new Map(),writes=[];
          const result=await callback({
            get:async ref=>{const data=structuredClone(docs[ref.path]);reads.set(ref.path,versions.get(ref.path)||0);return{metadata:{fromCache:state.cache},exists:()=>data!==undefined,data:()=>data}},
            set:(ref,data,options)=>writes.push({path:ref.path,data,merge:!!options?.merge})
          });
          if(state.beforeCommit){const fn=state.beforeCommit;state.beforeCommit=null;await fn();}
          if(state.offline)throw Error('offline');
          if([...reads].some(([path,version])=>(versions.get(path)||0)!==version))continue;
          for(const write of writes){docs[write.path]=write.merge?{...docs[write.path],...structuredClone(write.data)}:structuredClone(write.data);versions.set(write.path,(versions.get(write.path)||0)+1);state.commits.push(write);}
          return result;
        }
        throw Error('Too many retries');
      }
    `;
    const source = readFileSync(new URL('../js/farm/save-store.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');
    const mod = await import('data:text/javascript;base64,' + Buffer.from(mock + source + `\n// ${Math.random()}`).toString('base64'));
    return { ...mod, docs, state, versions, ensure: options => mod.ensureFarmSave({}, { groupId: 'A', accountId: 'alice' }, options) };
}

test('cache miss verifies the server without changing any existing asset or unrelated field', async () => {
    const f = await fixture();
    assert.deepEqual(await f.ensure(), farm);
    assert.equal(f.state.commits.length, 0);
    assert.deepEqual(f.docs[path], { farm, otherSetting: 'keep' });
    assert.equal(f.isFarmSave(farm), true); // Selling the last chicken is valid.
    assert.equal(f.isFarmSave({ ...farm, eggsReady: 4, readyEggs: { hen: 0, silkie: 0, bresse: 4 } }), true);
});

test('display copies preserve timestamp readers and cannot mutate saved hen state', async () => {
    const f = await fixture();
    const original = { ...farm, hensState: [{ id: 'h', breed: 'hen' }], timestamp: { toMillis: () => 123 } };
    const copy = f.copyFarmSave(original);
    copy.hensState[0].breed = 'bresse';
    assert.equal(original.hensState[0].breed, 'hen');
    assert.equal(copy.timestamp.toMillis(), 123);
});

test('offline initialization queues no defaults; reconnect preserves the server save', async () => {
    const f = await fixture();
    f.state.offline = true;
    await assert.rejects(f.ensure(), /offline/);
    assert.equal(f.state.commits.length, 0);
    f.state.offline = false;
    assert.deepEqual(await f.ensure(), farm);
    assert.equal(f.state.commits.length, 0);
});

test('two first visits create exactly one farm and receipt; a concurrent save always wins', async () => {
    const f = await fixture(); delete f.docs[path];
    const [a, b] = await Promise.all([f.ensure(), f.ensure()]);
    assert.equal(f.state.commits.filter(write => write.path === path).length, 1);
    assert.deepEqual(a, b);
    assert.equal(a.hens, 1);
    assert.equal(a.coins, 0);
    assert.ok(f.docs[path + '/farm_meta/creation']);
    delete f.docs[path];
    await assert.rejects(f.ensure(), /停止自動重建/);
    const concurrent = await fixture(); delete concurrent.docs[path];
    concurrent.state.beforeCommit = () => {
        concurrent.docs[path] = { farm: structuredClone(farm) };
        concurrent.versions.set(path, 1);
    };
    assert.deepEqual(await concurrent.ensure(), farm);
    assert.equal(concurrent.state.commits.length, 0);
    assert.deepEqual(concurrent.docs[path].farm, farm);
});

test('partial, malformed, cached transaction data and revoked membership never create a farm', async () => {
    for (const invalid of [null, {}, { coins: 0 }, { coins: 0, hens: 1, worms: null }, { ...farm, hensState: [{}] }, { ...farm, eggsReady: 9 }, { ...farm, readyEggs: null }]) {
        const f = await fixture(invalid);
        await assert.rejects(f.ensure(), /存檔資料不完整/);
        assert.equal(f.state.commits.length, 0);
    }
    const f = await fixture(); f.state.cache = true;
    await assert.rejects(f.ensure(), /尚未取得伺服器存檔/);
    f.state.cache = false; f.docs['groups/A'].members = [];
    await assert.rejects(f.ensure(), /群組資格/);
    assert.equal(f.state.commits.length, 0);
    const missing = await fixture(); delete missing.docs[path];
    await assert.rejects(missing.ensure({ canCreate: () => false }), /停止自動重建/);
    await assert.rejects(missing.ensure({ active: () => false }), /已離開/);
    assert.equal(missing.state.commits.length, 0);
});

const snapshot = (farm, metadata) => ({ exists: () => farm !== undefined, data: () => ({ farm }), metadata });
test('delayed verification cannot replace a newer confirmed farm; stale cache and missing events preserve the display', async () => {
    const f = await fixture(), received = [], states = [];
    let next, resolve, options;
    const newer = { ...farm, coins: 60000 };
    const session = f.startFarmSaveSession({
        watch: callback => { next = callback; return () => {}; },
        verify: value => { options = value; return new Promise(done => { resolve = done; }); },
        receive: value => received.push(value), status: value => states.push(value)
    });
    next(snapshot(undefined, { fromCache: true }));
    await Promise.resolve();
    assert.equal(received.length, 0);
    next(snapshot(newer, { fromCache: false }));
    assert.equal(options.canCreate(), false);
    resolve(farm); await session.retry();
    assert.deepEqual(received.at(-1), newer);
    next(snapshot(farm, { fromCache: true })); await Promise.resolve();
    assert.deepEqual(received.at(-1), newer);
    // Simulated outage never publishes an empty/default object.
    next(snapshot(undefined, { fromCache: true }));
    assert.deepEqual(received.at(-1), newer);
    session.stop(); resolve(farm); await session.retry();
    assert.deepEqual(received.at(-1), newer);
    assert.ok(states.some(state => state.phase === 'loading'));
});

test('permission/read failure and pending default writes are never presented as a new game', async () => {
    const f = await fixture(), received = [], states = [];
    let next, fail, stopped = false;
    const session = f.startFarmSaveSession({
        watch: (callback, error) => { next = callback; fail = error; return () => { stopped = true; }; },
        verify: async () => { throw Error('offline'); }, receive: value => received.push(value), status: value => states.push(value)
    });
    next(snapshot(f.initialFarm(), { hasPendingWrites: true, fromCache: true }));
    await session.retry();
    assert.equal(received.length, 0);
    assert.equal(states.at(-1).phase, 'error');
    fail(Error('permission-denied'));
    assert.equal(received.length, 0);
    session.stop(); assert.equal(stopped, true);
    next(snapshot(farm)); assert.equal(received.length, 0);
});


test('a pending create with no metadata-only acknowledgement still becomes ready after commit', async () => {
    const f = await fixture(), received = [], states = [];
    let next, done;
    const fresh = f.initialFarm();
    const session = f.startFarmSaveSession({
        watch: callback => { next = callback; return () => {}; },
        verify: () => new Promise(resolve => { done = resolve; }),
        receive: value => received.push(value), status: value => states.push(value)
    });
    next(snapshot(undefined, { fromCache: true }));
    await Promise.resolve();
    next(snapshot(fresh, { fromCache: true, hasPendingWrites: true }));
    assert.equal(received.length, 0);
    done(fresh); await session.retry();
    assert.deepEqual(received.at(-1), fresh);
    assert.equal(states.at(-1).phase, 'ready');
    session.stop();
});
