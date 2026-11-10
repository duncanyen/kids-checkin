import { ensureAssets } from './assets.js';
import { activeGuardDog, guardDogLeases, GUARD_DOG_BREEDS, guardDogPatrolPhase } from './guard-dog-core.js';
import { expireDogs } from './guard-dog-store.js';
import { onSceneExit } from './scene-cleanup.js';
import { getHenWalkArea } from './scenery.js';
import { CORGI_ROUTINE, corgiRoutineFor, forgetCorgiRoutine } from './corgi-routine.js';

export function mountGuardDog(scene, getFarm, owner = false) {
    let disposed=false,identity=null,loading=false,sprite=null,move=null,activity=null,cleaning=false,lastCleanup=0;
    let corgiRoutine=null,corgiAngle=0,corgiDirection=1;
    const stopMovement=()=>{move?.stop();activity?.remove();move=null;activity=null;};
    // Calm breeds patrol the strip in front of the coop, above the hens' clearing.
    // The full 96px dog body stays at least 12px clear of the 64px hens.
    const home=()=>({x:scene.coop.x+scene.coop.displayWidth*.32,y:getHenWalkArea(scene).top-58});
    const corgiStep=()=>{
        if(!sprite?.active||!corgiRoutine)return;
        stopMovement();
        const phase=corgiRoutine.phase(scene.time.now);
        if(phase.kind==='guard')return;
        if(phase.kind==='sleep'){
            sprite.setPosition(home().x,home().y).setData('guardActivity','rest').play(`${sprite.texture.key}_sleep`,true);
            activity=scene.time.delayedCall(phase.remaining,corgiStep);return;
        }
        if(phase.kind==='sit'){
            sprite.setData('guardActivity','sit').play(`${sprite.texture.key}_sit`,true);
            activity=scene.time.delayedCall(phase.remaining,corgiStep);return;
        }
        if(phase.kind==='return'){
            const point=home(),distance=Math.hypot(point.x-sprite.x,point.y-sprite.y);
            const arrived=()=>{corgiRoutine.arriveHome(scene.time.now);corgiStep();};
            if(distance<2){sprite.setPosition(point.x,point.y);arrived();return;}
            sprite.setFlipX(point.x<sprite.x).setData('guardActivity','return').play(`${sprite.texture.key}_walk`,true);
            move=scene.tweens.add({targets:sprite,...point,duration:distance/CORGI_ROUTINE.walkSpeed*1000,ease:'Linear',onComplete:arrived});return;
        }
        // 順著雞群外緣繞行，每段前進約 40–60 度，避免任意折返穿過雞群。
        const area=getHenWalkArea(scene),hens=(scene.hensGroup||[]).filter(hen=>hen.active&&hen.visible);
        const center=hens.length?{x:hens.reduce((sum,h)=>sum+h.x,0)/hens.length,y:hens.reduce((sum,h)=>sum+h.y,0)/hens.length}:{x:(area.left+area.right)/2,y:(area.top+area.bottom)/2};
        corgiAngle+=corgiDirection*(.7+Math.random()*.35);
        const radius=80+Math.random()*35;
        const point={x:Phaser.Math.Clamp(center.x+Math.cos(corgiAngle)*radius,area.left,area.right),y:Phaser.Math.Clamp(center.y+Math.sin(corgiAngle)*radius,area.top,area.bottom)};
        const distance=Math.hypot(point.x-sprite.x,point.y-sprite.y);
        sprite.setData('guardActivity','run').play(`${sprite.texture.key}_run`,true);
        if(distance<2){activity=scene.time.delayedCall(Math.min(250,phase.remaining),corgiStep);return;}
        const travel=distance/CORGI_ROUTINE.runSpeed*1000,duration=Math.min(travel,phase.remaining,3500),fraction=duration/travel;
        sprite.setFlipX(point.x<sprite.x);
        move=scene.tweens.add({targets:sprite,x:sprite.x+(point.x-sprite.x)*fraction,y:sprite.y+(point.y-sprite.y)*fraction,duration,ease:'Linear',onComplete:corgiStep});
    };
    const herdingPatrol=()=>{
        if(!sprite?.active)return;stopMovement();
        const phase=guardDogPatrolPhase(sprite.getData('guardBreedId'),scene.time.now-sprite.getData('guardPatrolStartedAt'));
        let point,speed;
        if(phase.running){
            const area=getHenWalkArea(scene),hens=(scene.hensGroup||[]).filter(hen=>hen.active&&hen.visible);
            const center=hens.length?{x:hens.reduce((n,h)=>n+h.x,0)/hens.length,y:hens.reduce((n,h)=>n+h.y,0)/hens.length}:{x:(area.left+area.right)/2,y:(area.top+area.bottom)/2};
            const angle=Math.random()*Math.PI*2,radius=70+Math.random()*55;
            point={x:Phaser.Math.Clamp(center.x+Math.cos(angle)*radius,area.left,area.right),y:Phaser.Math.Clamp(center.y+Math.sin(angle)*radius,area.top,Math.max(area.top,area.bottom))};
            if(Math.hypot(point.x-sprite.x,point.y-sprite.y)<24)point.x=sprite.x<(area.left+area.right)/2?area.right:area.left;
            speed=110;sprite.setData('guardActivity','run').play(`${sprite.texture.key}_run`,true);
        }else{
            point=home();speed=75;
            if(Math.hypot(point.x-sprite.x,point.y-sprite.y)<2){
                sprite.setPosition(point.x,point.y).setData('guardActivity','rest').play(`${sprite.texture.key}_rest`,true);
                activity=scene.time.delayedCall(phase.remaining,herdingPatrol);return;
            }
            sprite.setData('guardActivity','return').play(`${sprite.texture.key}_walk`,true);
        }
        const dist=Math.hypot(point.x-sprite.x,point.y-sprite.y),travel=Math.max(1,dist/speed*1000),duration=Math.min(travel,phase.remaining),fraction=duration/travel;
        sprite.setFlipX(point.x<sprite.x);
        move=scene.tweens.add({targets:sprite,x:sprite.x+(point.x-sprite.x)*fraction,y:sprite.y+(point.y-sprite.y)*fraction,duration,ease:'Linear',onComplete:herdingPatrol});
    };
    const rest=()=>{
        if(!sprite?.active)return;stopMovement();const point=home();
        sprite.setPosition(point.x,point.y).setFlipX(false).play(`${sprite.texture.key}_rest`);
        sprite.setData('guardActivity','rest');
        activity=scene.time.delayedCall(8000+Math.random()*8000,()=>{
            if(Math.random()<.75)rest();else wander();
        });
    };
    const wander=()=>{
        if(!sprite?.active)return;const area=getHenWalkArea(scene);
        const x=Phaser.Math.Clamp(area.left+Math.random()*(area.right-area.left),area.left,area.right);
        const y=home().y;
        const run=Math.random()<.35,dist=Math.hypot(x-sprite.x,y-sprite.y);
        sprite.setFlipX(x<sprite.x).play(`${sprite.texture.key}_${run?'run':'walk'}`).setData('guardActivity',run?'run':'walk');
        move=scene.tweens.add({targets:sprite,x,y,duration:Math.max(600,dist/(run?80:35)*1000),ease:'Linear',onComplete:goHome});
    };
    const goHome=()=>{
        if(!sprite?.active)return;stopMovement();const point=home(),dist=Math.hypot(point.x-sprite.x,point.y-sprite.y);
        sprite.setFlipX(point.x<sprite.x).play(`${sprite.texture.key}_walk`).setData('guardActivity','return');
        move=scene.tweens.add({targets:sprite,...point,duration:Math.max(300,dist/35*1000),ease:'Linear',onComplete:rest});
    };
    const remove=()=>{corgiRoutine?.resume(scene.time.now);stopMovement();sprite?.destroy();sprite=null;corgiRoutine=null;scene.guardDog=null;};
    const tick=async()=>{
        const farm=getFarm();if(disposed||!farm)return;
        if(owner&&!cleaning&&Date.now()-lastCleanup>15000&&guardDogLeases(farm).length!==(farm.guardDogs||[]).length){
            cleaning=true;lastCleanup=Date.now();expireDogs().catch(()=>{}).finally(()=>{cleaning=false;});
        }
        const dog=activeGuardDog(farm),next=dog?.id||null;
        if(next!==identity){if(identity)forgetCorgiRoutine(scene.game,identity);identity=next;remove();}
        if(sprite&&corgiRoutine&&sprite.getData('guardActivity')!=='guard'){
            const phase=corgiRoutine.phase(scene.time.now),shown=sprite.getData('guardActivity');
            if((phase.kind==='sleep'?'rest':phase.kind)!==shown)corgiStep();
        }
        if(!dog||sprite||loading)return;
        const breed=GUARD_DOG_BREEDS[dog.breedId];if(!breed)return;
        loading=true;
        try{
            await ensureAssets(scene,[breed.texture]);
            if(disposed||identity!==dog.id||activeGuardDog(getFarm())?.id!==dog.id)return;
            scene.textures.get(breed.texture).setFilter(Phaser.Textures.FilterMode.NEAREST);
            for(const [action,start,rate,repeat] of [['rest',0,1,0],['walk',4,6,-1],['run',8,10,-1],['guard',12,8,0]]){
                const frameRate=dog.breedId==='corgi'?(action==='run'?CORGI_ROUTINE.runFrameRate:action==='walk'?CORGI_ROUTINE.walkFrameRate:rate):rate;
                if(!scene.anims.exists(`${breed.texture}_${action}`))scene.anims.create({key:`${breed.texture}_${action}`,frames:scene.anims.generateFrameNumbers(breed.texture,{start,end:start+3}),frameRate,repeat});
            }
            if(dog.breedId==='corgi'){
                for(const [action,frames,frameRate] of [['sit',[12,13,15,13],2],['sleep',[2,3],1]]){
                    if(!scene.anims.exists(`${breed.texture}_${action}`))scene.anims.create({key:`${breed.texture}_${action}`,frames:frames.map(frame=>({key:breed.texture,frame})),frameRate,repeat:-1});
                }
            }
            const size=breed.displaySize||96;
            sprite=scene.guardDog=scene.add.sprite(0,0,breed.texture,0).setOrigin(.5,.875).setDisplaySize(size,size).setDepth(12);
            sprite.setData('guardLeaseId',dog.id).setData('guardBreedId',dog.breedId).setData('henObstacle',!!breed.herding).setData('guardPatrolStartedAt',scene.time.now);
            sprite.on('animationcomplete',anim=>{if(anim.key===`${breed.texture}_guard`){if(corgiRoutine){corgiRoutine.resume(scene.time.now);corgiStep();}else if(breed.herding)herdingPatrol();else goHome();}});
            if(dog.breedId==='corgi'){
                corgiRoutine=corgiRoutineFor(scene.game,dog.id,scene.time.now);corgiAngle=Math.random()*Math.PI*2;corgiDirection=Math.random()<.5?-1:1;
                const point=home();sprite.setPosition(point.x,point.y);corgiStep();
            }else if(breed.herding){const point=home();sprite.setPosition(point.x,point.y);herdingPatrol();}else rest();
        }catch(error){/* Keep the farm usable; the next tick retries missing art. */}
        finally{loading=false;}
    };
    const resize=()=>{if(sprite?.active){if(corgiRoutine){if(sprite.getData('guardActivity')!=='guard')corgiStep();}else if(sprite.getData('henObstacle')){const point=home();sprite.setPosition(point.x,point.y);herdingPatrol();}else rest();}};scene.events.on('farm-viewport-resize',resize);
    const timer=scene.time.addEvent({delay:1000,loop:true,callback:tick});
    const controller={
        tick,
        bark(){if(sprite?.active){corgiRoutine?.pause(scene.time.now);stopMovement();sprite.setData('guardActivity','guard').play(`${sprite.texture.key}_guard`);}},
        dispose(){disposed=true;timer.remove();scene.events.off('farm-viewport-resize',resize);remove();},
    };
    onSceneExit(scene,()=>controller.dispose());scene.guardDogController=controller;tick();return controller;
}
