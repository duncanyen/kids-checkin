import { GUARD_DOG_BREEDS, rentalPrice, guardDogLeases, activeGuardDog, guardDogStatus } from './guard-dog-core.js';
import { rentDog, activateDog, releaseDog, expireDogs } from './guard-dog-store.js';
import { onSceneExit } from './scene-cleanup.js';

function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
}
function refreshFarm(scene){Promise.resolve().then(()=>scene.game.retryFarmSave?.()).catch(()=>{});}
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

export async function openGuardDogRental(scene, breedId) {
    try{await scene.loadGuardDogCatalogue?.(true);}catch{if(scene.sys.isActive())scene.showMsg('無法確認最新租用價格，請稍後重試','#F44336');return;}
    if(!scene.sys.isActive())return;
    const catalog=scene.guardDogCatalogue||GUARD_DOG_BREEDS,breed=catalog[breedId];
    if(!breed){scene.showMsg('護衛犬商品尚未同步至伺服器，請稍後再試','#F44336');return;}
    const dialog=modal(scene,`租用${breed.name}`);
    dialog.body(node('p',`攔截小偷 ${Math.round(breed.biteChance*100)}% · 對該雞舍禁偷 ${breed.blockMs/3600000} 小時`));
    if(breed.herding)dialog.body(node('p',breedId==='corgi'?'柯基犬放慢 30% 奔跑，活動約 60 秒，期間坐下賣萌兩次；回雞舍後睡滿 60 秒再出來。休息時仍有 40% 防偷蛋能力，雞群會自動避讓。':'活潑的牧羊犬，約 60% 時間在雞群旁奔跑巡邏；雞群會自動避讓。'));
    const label=node('label','租用天數');label.htmlFor='guard-rental-days';
    const input=node('input');input.id='guard-rental-days';input.type='number';input.min='1';input.step='1';input.inputMode='numeric';input.value='1';
    dialog.body(label);dialog.body(input);
    const presets=node('div',null,'guard-dog-presets');
    for(const days of [1,7]){const button=node('button',breed.rentable===false?'尚未開放':`${days} 天`);button.type='button';button.disabled=breed.rentable===false;if(breed.rentable===false)button.setAttribute('aria-label',`${days===1?'日租':'週租'}尚未開放`);button.addEventListener('click',()=>{input.value=String(days);update();});presets.append(button);}
    dialog.body(presets);const price=node('p','','guard-dog-price');dialog.body(price);
    dialog.body(node('p',`自動採最省組合：${breed.dayPrice} 金幣／天、${breed.weekPrice} 金幣／週。先放入倉庫，第一次開始護衛才計時。每品種最多一隻，且同時只能一隻護衛。`));
    dialog.body(node('p','攔截成功會通知村落已設定的廣播頻道，並保留主人農場通知。'));
    const submit=dialog.submit(breed.rentable===false?'尚未開放':'確認租用',async()=>{await rentDog(breedId,Number(input.value),rentalPrice(breedId,Number(input.value),catalog));refreshFarm(scene);if(scene.sys.isActive())scene.showMsg('租用成功！請到倉庫「護衛犬」開始護衛。','#4CAF50');});
    function update(){try{const amount=rentalPrice(breedId,Number(input.value),catalog);price.textContent=`${input.value} 天 · ${amount} 金幣`;submit.disabled=breed.rentable===false;dialog.error.textContent=breed.rentable===false?'尚未開放租用，目前僅供展示。':'';}catch(error){price.textContent='';dialog.error.textContent=error.message;submit.disabled=true;}}
    input.disabled=breed.rentable===false;input.addEventListener('input',update);update();if(!input.disabled)input.focus();
}

export function openGuardDogAction(scene, breedId) {
    const dog=guardDogLeases(scene.farmData).find(item=>item.breedId===breedId);if(!dog){scene.renderWarehouseItems();return;}
    const breed=GUARD_DOG_BREEDS[breedId],dialog=modal(scene,breed.name);
    dialog.root.dataset.guardDogLeaseId=dog.id;
    dialog.body(node('p',guardDogStatus(dog)));
    if(Number.isFinite(dog.startedAt)) {
        dialog.body(node('p','解除後本犬會回到倉庫，剩餘租用時間完整保留且停止扣時。可以改派其他護衛犬，下次再啟用時繼續使用剩餘時間。'));
        dialog.submit('解除護衛並保留時間',async()=>{await releaseDog(dog.id);refreshFarm(scene);if(scene.sys.isActive())scene.showMsg('已回到倉庫，剩餘租用時間已保留。','#4CAF50');});
    }else{
        dialog.body(node('p','啟用後從剩餘時間繼續計時，值勤期間離線仍計時；解除護衛可回到倉庫暫停。剩餘時間用完後會離開倉庫。'));
        const occupied=activeGuardDog(scene.farmData);
        const button=dialog.submit('開始護衛',async()=>{await activateDog(dog.id);refreshFarm(scene);if(scene.sys.isActive())scene.showMsg(`${breed.name}開始護衛雞舍！`,'#4CAF50');});
        if(occupied){button.disabled=true;dialog.error.textContent='請先解除目前護衛中的犬隻回到倉庫，剩餘時間會保留。';}
    }
    dialog.actions.querySelector('button')?.focus();
}

export function watchGuardDogInventory(scene, getFarm, refresh) {
    let signature='',pending=false;
    const tick=()=>{
        const farm=getFarm();if(!farm)return;
        const dogs=guardDogLeases(farm),next=dogs.map(dog=>`${dog.id}:${Number.isFinite(dog.startedAt)?Math.ceil((dog.expiresAt-Date.now())/60000):`waiting:${dog.remainingMs??'full'}`}`).join('|');
        if(next!==signature){signature=next;refresh();}
        if(!pending&&dogs.length!==(farm.guardDogs||[]).length){pending=true;expireDogs().catch(()=>{}).finally(()=>{pending=false;});}
    };
    const timer=scene.time.addEvent({delay:1000,loop:true,callback:tick});onSceneExit(scene,()=>timer.remove());tick();
}
