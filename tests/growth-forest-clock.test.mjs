import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingClock} from '../js/growth-forest/reading-clock.js';
test('reading timestamps survive background gaps, pause/resume and a new page instance',()=>{
 const values=new Map(),storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};let now=100000;
 let clock=new ReadingClock(storage,'alice:A',()=>now);clock.start();now+=5*60000;assert.equal(clock.elapsed(),300000);
 clock=new ReadingClock(storage,'alice:A',()=>now);now+=10*60000;assert.equal(clock.elapsed(),900000);
 clock.pause();now+=60*60000;assert.equal(clock.elapsed(),900000);clock.start();now+=5*60000;
 assert.equal(clock.finish(),20);assert.equal(clock.elapsed(),0);assert.equal(clock.running,false);
 assert.equal(new ReadingClock(storage,'alice:B',()=>now).elapsed(),0);
});
test('corrupted timer storage and backwards clock never create negative time',()=>{
 const storage={getItem:()=>'{bad',setItem:()=>{}};let now=1000;const clock=new ReadingClock(storage,'x',()=>now);clock.start();now=0;assert.equal(clock.elapsed(),0);
});
