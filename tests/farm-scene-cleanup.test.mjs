import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../js/farm/scene-cleanup.js',import.meta.url),'utf8');
const {onSceneExit}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('20 restarts release both hooks; destroy also cleans once',()=>{
 const scene={events:new EventEmitter()};let count=0;
 for(let i=0;i<20;i++){
  onSceneExit(scene,()=>count++);scene.events.emit('shutdown');
  assert.equal(scene.events.listenerCount('shutdown'),0);assert.equal(scene.events.listenerCount('destroy'),0);
 }
 onSceneExit(scene,()=>count++);scene.events.emit('destroy');scene.events.emit('shutdown');
 assert.equal(count,21);
});
