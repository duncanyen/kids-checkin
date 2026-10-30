import { ensureAssets } from './assets.js';
import { activeGuardDog, guardDogLeases, GUARD_DOG_BREEDS } from './guard-dog-core.js';
import { expireDogs } from './guard-dog-store.js';
import { onSceneExit } from './scene-cleanup.js';
import { getHenWalkArea } from './scenery.js';

export function mountGuardDog(scene, getFarm, owner = false) {
    let disposed=false,identity=null,loading=false,sprite=null,move=null,activity=null,cleaning=false,lastCleanup=0;
    const stopMovement=()=>{move?.stop();activity?.remove();move=null;activity=null;};
    // Patrol the strip in front of the coop, above the hens' clearing.
    // The full 96px dog body stays at least 12px clear of the 64px hens.
    const home=()=>({x:scene.coop.x+scene.coop.displayWidth*.32,y:getHenWalkArea(scene).top-58});
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
    const remove=()=>{stopMovement();sprite?.destroy();sprite=null;scene.guardDog=null;};
    const tick=async()=>{
        const farm=getFarm();if(disposed||!farm)return;
        if(owner&&!cleaning&&Date.now()-lastCleanup>15000&&guardDogLeases(farm).length!==(farm.guardDogs||[]).length){
            cleaning=true;lastCleanup=Date.now();expireDogs().catch(()=>{}).finally(()=>{cleaning=false;});
        }
        const dog=activeGuardDog(farm),next=dog?.id||null;
        if(next!==identity){identity=next;remove();}
        if(!dog||sprite||loading)return;
        const breed=GUARD_DOG_BREEDS[dog.breedId];if(!breed)return;
        loading=true;
        try{
            await ensureAssets(scene,[breed.texture]);
            if(disposed||identity!==dog.id||activeGuardDog(getFarm())?.id!==dog.id)return;
            scene.textures.get(breed.texture).setFilter(Phaser.Textures.FilterMode.NEAREST);
            for(const [action,start,rate,repeat] of [['rest',0,1,0],['walk',4,6,-1],['run',8,10,-1],['guard',12,8,0]]){
                if(!scene.anims.exists(`${breed.texture}_${action}`))scene.anims.create({key:`${breed.texture}_${action}`,frames:scene.anims.generateFrameNumbers(breed.texture,{start,end:start+3}),frameRate:rate,repeat});
            }
            sprite=scene.guardDog=scene.add.sprite(0,0,breed.texture,0).setOrigin(.5,.875).setDisplaySize(96,96).setDepth(12);
            sprite.setData('guardLeaseId',dog.id);sprite.on('animationcomplete',anim=>{if(anim.key===`${breed.texture}_guard`)goHome();});rest();
        }catch(error){/* Keep the farm usable; the next tick retries missing art. */}
        finally{loading=false;}
    };
    const resize=()=>{if(sprite?.active)rest();};scene.events.on('farm-viewport-resize',resize);
    const timer=scene.time.addEvent({delay:1000,loop:true,callback:tick});
    const controller={
        tick,
        bark(){if(sprite?.active){stopMovement();sprite.setData('guardActivity','guard').play(`${sprite.texture.key}_guard`);}},
        dispose(){disposed=true;timer.remove();scene.events.off('farm-viewport-resize',resize);remove();},
    };
    onSceneExit(scene,()=>controller.dispose());scene.guardDogController=controller;tick();return controller;
}
