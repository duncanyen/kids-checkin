// Shared by the eagle and dragon: approach the coop, circle, and feint down
// once per five seconds. Pure geometry; no combat or reward side effects.
export function aerialDestination(scene){return {x:scene.coop.x+75,y:scene.coop.getBounds().top+70};}
export function aerialPatrolPoint(seconds,centerX,coopTop){
 const phase=(seconds%5+5)%5,dive=phase>=4;
 return {x:centerX+Math.cos(seconds*1.2)*75,y:coopTop+70+Math.sin(seconds*1.8)*12+(dive?Math.sin((phase-4)*Math.PI)*135:0),flipX:-Math.sin(seconds*1.2)>0,dive};
}
export function animateAerialPatrol(encounter){
 if(encounter.battle?.inputProtocol===1||encounter.destroyed||encounter.result||encounter.phase!=='circle')return;
 const t=(encounter.config.durationMs-encounter.deadlineTimer.getRemaining()-encounter.config.flightMs)/1000;
 const coop=encounter.scene.coop,p=aerialPatrolPoint(t,coop.x,coop.getBounds().top),key=encounter.spec.key;
 encounter.sprite.setFlipX(key==='dragon'?!p.flipX:p.flipX).setPosition(p.x,p.y);
 if(!encounter.sprite.anims.currentAnim?.key.endsWith('_hit'))encounter.sprite.play(p.dive&&key==='eagle'?'eagle_dive':`${key}_fly`,true);
}
