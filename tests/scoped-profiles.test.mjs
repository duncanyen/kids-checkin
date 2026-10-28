import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source = (await fs.readFile(new URL('../js/scoped-profiles.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/, 'const {collection,doc,getDoc,getDocs,query,where}=globalThis.__profileSdk;\n');
let fixtureId=0;
async function setup(profiles, groups={}) {
    const calls=[];let active=0,peak=0,fail=false;
    globalThis.__profileSdk={
        collection:(_,path)=>({path}), doc:(_,path,id)=>({path:`${path}/${id}`}),
        where:(field,op,value)=>({field,op,value}),query:(ref,...filters)=>({...ref,filters}),
        getDoc:async ref=>({exists:()=>!!groups[ref.path],data:()=>groups[ref.path]}),
        getDocs:async ref=>{
            calls.push(ref);peak=Math.max(peak,++active);
            await new Promise(r=>setTimeout(r,5));active--;
            if(fail)throw Error('offline');
            return {docs:profiles.filter(p=>ref.filters.every(f=>f.value.includes(p[f.field])))
                .map((p,i)=>({id:String(i),data:()=>p}))};
        },
    };
    const module=await import(`data:text/javascript;base64,${Buffer.from(source+'\n//'+fixtureId++).toString('base64')}`);
    return {...module,calls,db:{},get peak(){return peak;},set fail(value){fail=value;}};
}
test('account IDs query only selected identities; identical concurrent work shares one request',async()=>{
    const s=await setup([{accountId:'a',name:'A'},{accountId:'b',name:'B'},{accountId:'outside',name:'Outside'}]);
    const [a,b]=await Promise.all([s.loadScopedProfiles(s.db,['a','b','a']),s.loadScopedProfiles(s.db,['a','b','a'])]);
    assert.deepEqual(a.map(p=>p.accountId),['a','b']);assert.equal(a,b);assert.equal(s.calls.length,1);
    await s.loadScopedProfiles(s.db,['a','b']);assert.equal(s.calls.length,2); // no stale permanent cache
});
test('legacy fallback queries only unresolved tokens, rejects ambiguous names',async()=>{
    const s=await setup([{accountId:'a',name:'A'},{accountId:'b',name:'舊名'},{accountId:'c',name:'重名'},{accountId:'outside',name:'重名'}]);
    assert.deepEqual((await s.loadScopedProfiles(s.db,['a','舊名','重名'])).map(p=>p.accountId),['a','b']);
    assert.deepEqual(s.calls[1].filters[0].value,['舊名','重名']);
});
test('batch reads overlap, at most four workers, all 55 members preserved',async()=>{
    const profiles=Array.from({length:55},(_,i)=>({accountId:'id'+i,name:'Name'+i}));const s=await setup(profiles);
    const result=await s.loadScopedProfiles(s.db,profiles.map(p=>p.accountId));
    assert.equal(result.length,55);assert.equal(s.calls.length,6);assert.equal(s.peak,4);
    assert.ok(s.calls.every(c=>c.filters[0].value.length<=10));
});
test('empty group does not scan users; absent group fails closed; supplied snapshot avoids reread',async()=>{
    const s=await setup([{accountId:'a'}],{'groups/A':{members:[]},'groups/B':{members:['a']}});
    assert.deepEqual(await s.loadGroupProfiles(s.db,'A'),[]);assert.equal(s.calls.length,0);
    await assert.rejects(s.loadGroupProfiles(s.db,'missing'));
    assert.equal((await s.loadGroupProfiles(s.db,'B',{members:['a']}))[0].accountId,'a');
});
test('failed concurrent work is removed, allowing retry',async()=>{
    const s=await setup([{accountId:'a'}]);s.fail=true;await assert.rejects(s.loadScopedProfiles(s.db,['a']));
    s.fail=false;assert.equal((await s.loadScopedProfiles(s.db,['a'])).length,1);assert.equal(s.calls.length,2);
});
test('avatar aliases never replace an account ID or guess between duplicate names',async()=>{
    const s=await setup([]);const map=s.profileAvatarMap([{accountId:'a',name:'同名',avatar:'a.png'},{accountId:'b',name:'同名',avatar:'b.png'},{accountId:'c',name:'a',avatar:'c.png'}]);
    assert.equal(map.a,'a.png');assert.equal(map.b,'b.png');assert.equal(map.c,'c.png');assert.equal(map['同名'],undefined);
});

test('known account IDs never fall back to a different account with that display name',async()=>{
    const s=await setup([{accountId:'outside',name:'deleted-id'}]);
    assert.deepEqual(await s.loadScopedProfiles(s.db,['deleted-id'],{allowLegacyNames:false}),[]);
    assert.equal(s.calls.length,1);
});
