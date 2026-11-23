import { onSceneExit } from './scene-cleanup.js';
import { farmActionsBlocked } from './entry-encounter.js';

const headerOwners=new WeakMap();
/** Visiting controls are DOM overlays; leaving never performs a game transaction. */
export function mountVisitHud(scene,{pendingBattle=()=>false}={}){
    const host=document.getElementById('game-container');
    const nav=document.querySelector('.top-nav'),ownLabel=document.querySelector('[data-farm-own-label]'),visitLabel=document.querySelector('[data-farm-visit-label]');
    const token=Symbol('visit-header');
    if(nav&&ownLabel&&visitLabel){
        const name=String(scene.targetName||scene.targetAccountId||'村落主人').trim()||'村落主人';
        headerOwners.set(nav,token);nav.classList.add('is-visiting');
        visitLabel.textContent=`${name} 的家`;visitLabel.title=visitLabel.textContent;
        ownLabel.hidden=true;visitLabel.hidden=false;
    }
    const root=document.createElement('div');root.className='farm-visit-hud';
    const button=document.createElement('button');button.type='button';button.className='farm-visit-leave';button.setAttribute('aria-label','離開');
    button.innerHTML='<svg viewBox="0 0 28 28" aria-hidden="true" focusable="false"><path d="M4 4.5h9v19H4z" fill="currentColor" opacity=".22"/><path d="M13 8V4H4v20h9v-4M11 14h13m-5-5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="8" cy="14" r="1" fill="currentColor"/></svg><span>離開</span>';
    root.append(button);host?.append(root);
    let alive=true,leaving=false;
    const blocked=()=>!alive||leaving||!scene.sys.isActive()||farmActionsBlocked(scene,pendingBattle())||scene.input?.enabled===false||scene.game.input.enabled===false;
    const update=()=>{const disabled=!!blocked();if(button.disabled!==disabled)button.disabled=disabled;};
    for(const event of ['pointerdown','pointerup','touchstart','touchend','dblclick'])button.addEventListener(event,e=>e.stopPropagation());
    button.addEventListener('click',event=>{
        event.stopPropagation();if(blocked())return;
        leaving=true;button.disabled=true;
        scene.scene.start('LobbyScene',{targetGroupId:scene.targetGroupId});
    });
    update();scene.events.on('update',update);
    onSceneExit(scene,()=>{
        alive=false;scene.events.off('update',update);root.remove();
        if(nav&&headerOwners.get(nav)===token){
            headerOwners.delete(nav);nav.classList.remove('is-visiting');
            ownLabel.hidden=false;visitLabel.hidden=true;visitLabel.textContent='';visitLabel.removeAttribute('title');
        }
    });
    return {button,root};
}
