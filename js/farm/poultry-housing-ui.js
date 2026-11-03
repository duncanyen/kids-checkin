import { BREEDS, poultryState } from './poultry.js';
import { outdoorCounts, MIN_OUTDOOR_HENS, housingPatch } from './poultry-housing.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function farmDialog(scene,title){
    scene.housingDialog?.close();
    const root=el('div');root.className='farm-mail-overlay';const panel=el('section');panel.className='farm-mail-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
    const heading=el('h2',title),message=el('p');message.setAttribute('role','status');
    const before=scene.game.input.enabled;scene.game.input.enabled=false;
    let closed=false;
    const close=()=>{if(closed)return;closed=true;root.remove();scene.game.input.enabled=before;if(scene.housingDialog?.root===root)scene.housingDialog=null;scene.events.off('shutdown',close);scene.events.off('destroy',close);};
    const btn=(label,action)=>{const b=el('button',label);b.type='button';b.className='farm-mail-button';b.onclick=action;panel.append(b);return b;};
    panel.append(heading,message);root.append(panel);document.body.append(root);scene.events.once('shutdown',close);scene.events.once('destroy',close);
    root.addEventListener('keydown',event=>{if(event.key==='Escape'&&!scene.housingDialog?.busy)close();if(event.key==='Tab'){const buttons=[...panel.querySelectorAll('button:not(:disabled)')];if(!buttons.length)return;const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    scene.housingDialog={root,panel,message,close,button:btn};return scene.housingDialog;
}
export function openHousing(scene,save,breed){
    const dialog=farmDialog(scene,breed?`${BREEDS[breed].name}放風設定`:'雞隻放風設定'),farm=scene.farmData,hens=poultryState(farm).hens,counts=outdoorCounts(farm),status=el('p');dialog.panel.append(status);
    dialog.panel.append(el('p',`至少放出 ${Math.min(MIN_OUTDOOR_HENS,hens.length)} 隻；雞舍內外都照常產蛋，生病仍需治療。`));
    const controls=[];
    const refresh=()=>{const total=Object.values(counts).reduce((a,b)=>a+b,0);status.textContent=`放風 ${total}／飼養 ${hens.length} 隻`;for(const c of controls){c.label.textContent=`${BREEDS[c.key].name}：放風 ${counts[c.key]}／${c.owned}`;c.minus.disabled=counts[c.key]<=0;c.plus.disabled=counts[c.key]>=c.owned;}};
    for(const key of Object.keys(BREEDS)){
        const owned=hens.filter(h=>h.breed===key).length;if(!owned||(breed&&key!==breed))continue;
        const row=el('div');row.className='poultry-housing-row';const label=el('span'),minus=el('button','－'),plus=el('button','＋');minus.type=plus.type='button';minus.setAttribute('aria-label',`減少${BREEDS[key].name}放風`);plus.setAttribute('aria-label',`增加${BREEDS[key].name}放風`);
        minus.onclick=()=>{counts[key]--;refresh();};plus.onclick=()=>{counts[key]++;refresh();};row.append(label,minus,plus);dialog.panel.append(row);controls.push({key,owned,label,minus,plus});
    }
    refresh();let busy=false;
    const submit=dialog.button('確認',async()=>{if(busy)return;try{housingPatch(farm,counts);}catch(error){dialog.message.textContent=error.message;return;}busy=true;dialog.busy=true;dialog.panel.querySelectorAll('button').forEach(b=>b.disabled=true);try{await save(counts);dialog.close();}catch(error){dialog.message.textContent=error.message||'儲存失敗，請重試';}finally{busy=false;dialog.busy=false;dialog.panel.querySelectorAll('button').forEach(b=>b.disabled=false);refresh();}});
    dialog.button('取消',dialog.close);submit.focus();
}
export function openCoopActions(scene){
    const dialog=farmDialog(scene,'雞舍管理');
    dialog.button('清理雞舍',()=>{dialog.close();scene.askCleanMyFarm(true);});
    if(poultryState(scene.farmData).hens.some(h=>h.isSick)){
        const treat=dialog.button('餵食咕咕活力飲',async()=>{treat.disabled=true;await scene.treatRandomSickHen();if(!scene.sys.isActive())return;if(poultryState(scene.farmData).hens.some(h=>h.isSick)){dialog.message.textContent=scene.treatmentMessage||'已處理';treat.disabled=false;}else{dialog.close();}});
        treat.title='每次消耗現有治療藥品 1 個，隨機治療一隻病雞';
        dialog.refresh=()=>{if(!poultryState(scene.farmData).hens.some(h=>h.isSick))treat.remove();};
    }
    dialog.button('關閉',dialog.close).focus();
}
