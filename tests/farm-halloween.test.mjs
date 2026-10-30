import test from 'node:test';
import assert from 'node:assert/strict';
import { HALLOWEEN_START, HALLOWEEN_END, halloweenActive, createHolidayClock } from '../js/farm/halloween-core.js';
import { ASSET_MANIFEST, CORE_ASSETS, ALL_ASSETS } from '../js/farm/asset-manifest.js';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), sharp = require('sharp');

test('event starts immediately on Oct 30 and ends exclusively at Taiwan Nov 1 midnight', () => {
    assert.equal(HALLOWEEN_END,Date.parse('2026-10-31T16:00:00Z'));
    for (const [time,active] of [[HALLOWEEN_START-1,false],[HALLOWEEN_START,true],
        [Date.parse('2026-10-31T23:59:59.999+08:00'),true],[HALLOWEEN_END,false],[HALLOWEEN_END+1,false],
        [Date.parse('2027-10-31T12:00:00+08:00'),false],[NaN,false]]) assert.equal(halloweenActive(time),active);
});

test('server correction, monotonic expiry and concurrent refresh do not depend on device timezone or clock changes', async () => {
    let wall=Date.parse('1999-01-01T00:00:00Z'),mono=10,requests=0,received=0;
    const clock=createHolidayClock({wallNow:()=>wall,monotonicNow:()=>mono,readServerTime:async()=>{requests++;mono+=100;return HALLOWEEN_END-2000;}});
    clock.subscribe(()=>received++);
    assert.equal(halloweenActive(clock.now()),false);
    await Promise.all([clock.refresh(),clock.refresh(true)]);
    assert.equal(requests,1);assert.equal(received,1);assert.equal(clock.synced,true);
    assert.equal(clock.now(),HALLOWEEN_END-1450);
    wall=0;mono+=1449;assert.equal(halloweenActive(clock.now()),true);
    mono++;assert.equal(halloweenActive(clock.now()),false);
    await clock.refresh();assert.equal(requests,1);
    await clock.refresh(true);assert.equal(requests,2);assert.equal(halloweenActive(clock.now()),false);
    clock.dispose();await clock.refresh(true);assert.equal(requests,2);
});

test('offline fallback continues monotonic time; disposed/in-flight requests cannot revive a scene', async () => {
    let mono=0;
    const clock=createHolidayClock({wallNow:()=>HALLOWEEN_END-1000,monotonicNow:()=>mono,readServerTime:async()=>{throw Error('offline');}});
    await clock.refresh();mono=999;assert.equal(halloweenActive(clock.now()),true);
    mono=1000;assert.equal(halloweenActive(clock.now()),false);assert.equal(clock.synced,false);
    let resolve;
    const late=createHolidayClock({wallNow:()=>HALLOWEEN_END,monotonicNow:()=>mono,readServerTime:()=>new Promise(r=>{resolve=r;})});
    const pending=late.refresh();await Promise.resolve();late.dispose();resolve(HALLOWEEN_START);await pending;
    assert.equal(late.now(),HALLOWEEN_END);
});

test('offline device sleep that pauses performance time still crosses the cutoff', async () => {
    let wall=HALLOWEEN_END-1000,mono=0;
    const clock=createHolidayClock({wallNow:()=>wall,monotonicNow:()=>mono});
    wall+=86400000;
    assert.equal(halloweenActive(clock.now()),false);
    wall-=2*86400000;mono=1;
    assert.equal(halloweenActive(clock.now()),false);
});

test('seasonal atlas stays out of normal bundles and every frame has transparent sampling margins', async () => {
    assert.ok(ASSET_MANIFEST.halloween_2026);
    assert.ok(!CORE_ASSETS.includes('halloween_2026'));assert.ok(!ALL_ASSETS.includes('halloween_2026'));
    const {frames}=JSON.parse(readFileSync(new URL('../assets/farm/halloween-2026.json',import.meta.url)));
    const {data,info}=await sharp(new URL('../assets/farm/halloween-2026.png',import.meta.url).pathname).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(Object.keys(frames).length,6);
    for(const {frame:f} of Object.values(frames)) {
        let opaque=0;
        for(let y=f.y;y<f.y+f.h;y++)for(let x=f.x;x<f.x+f.w;x++) {
            const a=data[(y*info.width+x)*4+3];
            if(y===f.y||y===f.y+f.h-1||x===f.x||x===f.x+f.w-1)assert.equal(a,0);
            if(a>200)opaque++;
        }
        assert.ok(opaque>100);
    }
});
