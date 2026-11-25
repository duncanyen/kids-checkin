import test from 'node:test';
import assert from 'node:assert/strict';
import {aerialDestination,aerialPatrolPoint,animateAerialPatrol} from '../js/farm/aerial-patrol.js';
import {startPredatorPatrol,predatorPatrolArea} from '../js/farm/predators.js';

test('wolf and tiger patrol at double walking speed without changing attack cadence',()=>{
 for(const kind of ['wolf','tiger']){
  let move,timer;const scene={scale:{width:390,height:844},gardenBounds:{left:32,right:358,top:600},coop:{getBounds:()=>({bottom:300})},tweens:{add:options=>{move=options;return{resume(){},pause(){}};}},time:{addEvent:options=>{timer=options;return{};}}};
  const area=predatorPatrolArea(scene),sprite={active:true,x:kind==='wolf'?area.right:area.left,texture:{key:kind},anims:{currentAnim:{key:kind+'_walk'}},getData:()=>false,setData(){return this;},setFlipX(){return this;},play(){return this;}};
  startPredatorPatrol(scene,sprite);const distance=Math.abs(move.x-sprite.x);
  assert.ok(Math.abs(move.duration-distance/90*1000)<1e-9);assert.equal(move.y,area.y);assert.equal(move.ease,'Linear');assert.equal(timer.delay,5000);assert.equal(timer.loop,true);
 }
});
test('dragon and eagle share identical orbit/dive geometry and hit animation is preserved',()=>{
 const coop={x:195,getBounds:()=>({top:240})};assert.deepEqual(aerialDestination({coop}),{x:270,y:310});
 for(const t of [0,.1,1,3.999,4,4.5,4.999,5,9.5,24.5]){
  const points=[];
  for(const key of ['dragon','eagle']){
   const sprite={anims:{currentAnim:{key:key+'_fly'}},setFlipX(v){this.flipX=v;return this;},setPosition(x,y){this.x=x;this.y=y;return this;},play(animation){this.animation=animation;return this;}};
   const e={spec:{key},phase:'circle',scene:{coop},config:{durationMs:60000,flightMs:10000},deadlineTimer:{getRemaining:()=>50000-t*1000},sprite};
   animateAerialPatrol(e);points.push({x:sprite.x,y:sprite.y});assert.equal(sprite.flipX,key==='dragon'?!aerialPatrolPoint(t,195,240).flipX:aerialPatrolPoint(t,195,240).flipX);
   assert.equal(sprite.animation,key==='eagle'&&aerialPatrolPoint(t,195,240).dive?'eagle_dive':key+'_fly');
   sprite.animation='preserve';sprite.anims.currentAnim.key=key+'_hit';animateAerialPatrol(e);assert.equal(sprite.animation,'preserve');
   const last={x:sprite.x,y:sprite.y};e.result='win';e.deadlineTimer.getRemaining=()=>1;animateAerialPatrol(e);assert.deepEqual({x:sprite.x,y:sprite.y},last);
  }
  assert.deepEqual(points[0],points[1]);
 }
 assert.ok(aerialPatrolPoint(4.5,195,240).y>430,'the fifth second includes a downward feint');
 assert.ok(Math.abs(aerialPatrolPoint(4.99999,195,240).y-aerialPatrolPoint(5,195,240).y)<.01,'dive smoothly rejoins orbit');
});
