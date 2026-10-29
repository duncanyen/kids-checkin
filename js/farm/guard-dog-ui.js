import { GUARD_DOG_BREEDS, rentalPrice, guardDogLeases, activeGuardDog, guardDogStatus } from './guard-dog-core.js';
import { rentDog, activateDog, releaseDog, expireDogs } from './guard-dog-store.js';
import { onSceneExit } from './scene-cleanup.js';

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
}
function modal(scene, title) {
    scene.guardDogDialog?.close();
    const previous = document.activeElement;
    const root = node('div', null, 'guard-dog-overlay');root.dataset.guardDogDialog = '';
    const panel = node('section', null, 'guard-dog-panel');panel.setAttribute('role', 'dialog');panel.setAttribute('aria-modal', 'true');
    const heading = node('h2', title);heading.id = 'guard-dog-dialog-title';panel.setAttribute('aria-labelledby', heading.id);
    const error = node('p', '', 'guard-dog-error');error.setAttribute('role', 'alert');
    const actions = node('div', null, 'guard-dog-actions');
    const cancel = node('button', '取消');cancel.type = 'button';
    let busy = false, closed = false, teardown = () => {};
    const close = () => { if (closed) return;closed = true;root.remove();document.removeEventListener('keydown', keys);teardown();if(previous?.isConnected)previous.focus(); };
    const keys = event => {
        if(event.key === 'Escape' && !busy) close();
        if(event.key === 'Tab') {
            const items = [...panel.querySelectorAll('button,input')].filter(item => !item.disabled);
            if(event.shiftKey && document.activeElement === items[0]) {event.preventDefault();items.at(-1).focus();}
            else if(!event.shiftKey && document.activeElement === items.at(-1)) {event.preventDefault();items[0].focus();}
        }
    };
    cancel.addEventListener('click', () => { if(!busy)close(); });
    panel.append(heading,error,actions);actions.append(cancel);root.append(panel);document.body.append(root);
    document.addEventListener('keydown', keys);scene.guardDogDialog = { close, root };teardown=onSceneExit(scene,close);
    const submit = (label, run) => {
        const button = node('button',label,'guard-dog-primary');button.type = 'button';actions.append(button);
        button.addEventListener('click',async()=>{
            if(busy)return;busy=true;button.disabled=true;cancel.disabled=true;error.textContent='';
            try {await run();close();}
            catch(failure){error.textContent=failure.message||'操作失敗，請稍後重試';}
            finally{busy=false;button.disabled=false;cancel.disabled=false;}
        });return button;
    };
    return {root,panel,error,actions,submit,body:element=>panel.insertBefore(element,error),close};
}

export function openGuardDogRental(scene, breedId) {
    const breed=GUARD_DOG_BREEDS[breedId];if(!breed)return;
    const dialog=modal(scene,`租用${breed.name}`);
    dialog.body(node('p',`攔截小偷 ${Math.round(breed.biteChance*100)}% · 對該雞舍禁偷 ${breed.blockMs/3600000} 小時`));
    const label=node('label','租用天數');label.htmlFor='guard-rental-days';
    const input=node('input');input.id='guard-rental-days';input.type='number';input.min='1';input.step='1';input.inputMode='numeric';input.value='1';
    dialog.body(label);dialog.body(input);
    const presets=node('div',null,'guard-dog-presets');
    for(const days of [1,7]){const button=node('button',`${days} 天`);button.type='button';button.addEventListener('click',()=>{input.value=String(days);update();});presets.append(button);}
    dialog.body(presets);const price=node('p','','guard-dog-price');dialog.body(price);
    dialog.body(node('p',`自動採最省組合：${breed.dayPrice} 金幣／天、${breed.weekPrice} 金幣／週。先放入倉庫，第一次開始護衛才計時。每品種最多一隻，且同時只能一隻護衛。`));
    dialog.body(node('p','攔截成功會通知村落已設定的廣播頻道，並保留主人農場通知。'));
    const submit=dialog.submit('確認租用',async()=>{await rentDog(breedId,Number(input.value));if(scene.sys.isActive())scene.showMsg('租用成功！請到倉庫「護衛犬」開始護衛。','#4CAF50');});
    function update(){try{const amount=rentalPrice(breedId,Number(input.value));price.textContent=`${input.value} 天 · ${amount} 金幣`;submit.disabled=false;dialog.error.textContent='';}catch(error){price.textContent='';dialog.error.textContent=error.message;submit.disabled=true;}}
    input.addEventListener('input',update);update();input.focus();
}

export function openGuardDogAction(scene, breedId) {
    const dog=guardDogLeases(scene.farmData).find(item=>item.breedId===breedId);if(!dog){scene.renderWarehouseItems();return;}
    const breed=GUARD_DOG_BREEDS[breedId],dialog=modal(scene,breed.name);
    dialog.root.dataset.guardDogLeaseId=dog.id;
    dialog.body(node('p',guardDogStatus(dog)));
    if(Number.isFinite(dog.startedAt)) {
        dialog.body(node('p','解除後本犬會立即離開倉庫，剩餘租期作廢且不退還金幣，無法暫停或存回倉庫。確定要解除嗎？'));
        dialog.submit('解除護衛並放棄租期',async()=>{await releaseDog(dog.id);if(scene.sys.isActive())scene.showMsg('已解除護衛，本犬已離開。','#FFD54F');});
    }else{
        dialog.body(node('p',`開始後會連續護衛 ${dog.days} 天，離線仍計時，不能暫停；到期會自動離開倉庫。`));
        const occupied=activeGuardDog(scene.farmData);
        const button=dialog.submit('開始護衛',async()=>{await activateDog(dog.id);if(scene.sys.isActive())scene.showMsg(`${breed.name}開始護衛雞舍！`,'#4CAF50');});
        if(occupied){button.disabled=true;dialog.error.textContent='請先解除目前護衛中的犬隻；解除會放棄該犬剩餘租期。';}
    }
    dialog.actions.querySelector('button')?.focus();
}

export function watchGuardDogInventory(scene, getFarm, refresh) {
    let signature='',pending=false;
    const tick=()=>{
        const farm=getFarm();if(!farm)return;
        const dogs=guardDogLeases(farm),next=dogs.map(dog=>`${dog.id}:${Number.isFinite(dog.startedAt)?Math.ceil((dog.expiresAt-Date.now())/60000):'waiting'}`).join('|');
        if(next!==signature){signature=next;refresh();}
        if(!pending&&dogs.length!==(farm.guardDogs||[]).length){pending=true;expireDogs().catch(()=>{}).finally(()=>{pending=false;});}
    };
    const timer=scene.time.addEvent({delay:1000,loop:true,callback:tick});onSceneExit(scene,()=>timer.remove());tick();
}
