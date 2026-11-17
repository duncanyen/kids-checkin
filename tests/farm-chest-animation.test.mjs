import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {playChestFrames} from '../js/farm/chest-animation.js';
const manifest=JSON.parse(fs.readFileSync(new URL('../assets/farm/chest/v1/manifest.json',import.meta.url)));
function clock(){let now=0,serial=0;const pending=new Map();return{schedule(fn,ms){const id=++serial;pending.set(id,{fn,at:now+ms});return id;},cancel(id){pending.delete(id);},run(ms){const target=now+ms;while(true){const next=[...pending].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>target)break;now=next[1].at;pending.delete(next[0]);next[1].fn();}now=target;},now:()=>now};}
test('provided 4x2/512px manifest plays once for 900ms, reveals frame 4 at 370ms and holds frame 7',()=>{
 assert.deepEqual([manifest.columns,manifest.rows,manifest.frame_width,manifest.frame_height],[4,2,512,512]);assert.deepEqual(manifest.origin_normalized_xy,[.5,.78125]);assert.equal(manifest.repeat,0);
 const c=clock(),frames=[],reveals=[],finished=[];
 playChestFrames(manifest,{...c,frame:f=>frames.push([f.index,c.now()]),reveal:()=>reveals.push(c.now()),finish:()=>finished.push(c.now())});c.run(2000);
 assert.deepEqual(frames,[[0,0],[1,90],[2,170],[3,270],[4,370],[5,480],[6,600],[7,740]]);assert.deepEqual(reveals,[370]);assert.deepEqual(finished,[900]);
});
test('skip only reveals the supplied result once and cancels remaining frame callbacks; stop cancels everything',()=>{
 for(const stop of [false,true]){const c=clock(),frames=[];let reveals=0,finished=0;const controller=playChestFrames(manifest,{...c,frame:f=>frames.push(f.index),reveal:()=>reveals++,finish:()=>finished++});c.run(100);if(stop)controller.stop();else{controller.skip();controller.skip();}c.run(2000);assert.deepEqual(frames,stop?[0,1]:[0,1,7]);assert.equal(reveals,stop?0:1);assert.equal(finished,stop?0:1);}
});
