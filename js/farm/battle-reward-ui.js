import { createFarmDialog } from './farm-dialog.js';
import { prepareFarmResultAssets } from './egg-result-ui.js';
import { battleRewardView, BATTLE_REWARDS } from './battle-reward.js';
const base='assets/farm/battle-reward/v1/battle_reward_';
const assets=Object.fromEntries(['panel','plaque','close','row','storage_banner','confirm','feather'].map(key=>[key,base+key+'.png']));
export const prepareBattleRewardAssets=()=>prepareFarmResultAssets(assets);
assets.chest='assets/farm/chest/v1/chest_inventory_icon.png';
const pending=new Map(),shown=new Set();
function spriteImage(scene,key,frame){
    try{if(scene.textures.exists(key))return scene.textures.getBase64(key,frame);}catch{/* Missing art never changes the reward. */}
    return null;
}
function stunnedImage(scene,kind){
    const frame=String(BATTLE_REWARDS[kind]?.stunnedFrame);
    // Explicitly reviewed dizzy/star frames; never substitute an entire sprite sheet.
    try{if(scene.textures.exists(kind)&&scene.textures.get(kind).has(frame))return spriteImage(scene,kind,frame);}catch{}
    return null;
}
export async function openBattleReward(scene,result,kind,options={}){
    const view=battleRewardView(result,kind,options);
    if(!view)return null;
    const scope=JSON.stringify([scene.registry.get('currentGroupId')||options.groupId||'',options.accountId||'']);
    const key=scope+':'+view.id,storageKey='gugu.battle-reward.shown:'+scope;
    let history=[];
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'[]');if(Array.isArray(saved))history=saved.filter(id=>typeof id==='string');}catch{}
    if(shown.has(key)||history.includes(view.id))return {duplicate:true};
    if(pending.has(key))return pending.get(key);
    const work=(async()=>{
        if(scene.eggResultDialog)return null;
        const dialog=createFarmDialog(scene,{kind:'battle',panelClass:'farm-battle-reward-panel',label:'戰鬥勝利'});
        try{
            await prepareBattleRewardAssets();
            if(!dialog.isCurrent()){dialog.close();return null;}
            const {root,panel,close}=dialog;
            const el=(tag,cls,text)=>{const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=text;return node;};
            const art=(src,cls,alt='')=>{const image=el('img',cls);image.src=src;image.alt=alt;image.draggable=false;image.onerror=()=>{image.remove();};return image;};
            const button=(file,cls,label)=>{const node=el('button',cls);node.type='button';node.setAttribute('aria-label',label);node.append(art(assets[file],''));node.onclick=close;return node;};
            const heading=el('header','farm-battle-reward-title');heading.append(art(assets.plaque,''),el('h2','','戰鬥勝利'));
            const dismiss=button('close','farm-battle-reward-close','關閉戰鬥勝利'),confirm=button('confirm','farm-battle-reward-confirm','確定');
            const monster=el('div','farm-battle-reward-monster');
            const portrait=stunnedImage(scene,kind);if(portrait)monster.append(art(portrait,'',view.monsterName+'被打昏'));
            const defeated=el('h3','farm-battle-reward-defeated','擊退 '+view.monsterName);
            const section=el('h4','farm-battle-reward-section','本次戰利品');
            const rows=el('div','farm-battle-reward-rows');rows.setAttribute('aria-label','本次戰利品');rows.tabIndex=0;
            // One shared renderer for filled and reserved rows; no placeholder labels/icons.
            for(let index=0;index<Math.max(3,view.loot.length);index++){
                const positioned=view.loot.some(item=>item.slot!==undefined);
                const item=positioned?view.loot.find((item,i)=>(item.slot??i)===index):view.loot[index],row=el('div','farm-battle-reward-row');
                if(item){
                    const icon=item.itemId==='unopenedChest'?assets.chest:item.itemId==='eagleFeathers'?assets.feather:spriteImage(scene,item.icon);
                    if(icon)row.append(art(icon,'farm-battle-reward-icon'));
                    row.append(el('span','farm-battle-reward-item',item.name),el('strong','farm-battle-reward-quantity','× '+item.quantity.toLocaleString('zh-TW')));
                }else{row.classList.add('is-empty');row.setAttribute('aria-hidden','true');}
                rows.append(row);
            }
            const storage=view.inventoryUpdated?art(assets.storage_banner,'farm-battle-reward-storage','已放入倉庫'):el('p','farm-battle-reward-storage-note','倉庫已滿，戰利品未入庫');
            panel.append(heading,dismiss,monster,defeated,section,rows,storage,confirm);
            root.addEventListener('keydown',event=>{
                if(event.key==='Escape'){event.preventDefault();close();}
                if(event.key==='Tab'){const nodes=[dismiss,rows,confirm],index=nodes.indexOf(document.activeElement);event.preventDefault();nodes[index<0?(event.shiftKey?2:0):(index+(event.shiftKey?2:1))%3].focus();}
            });
            dialog.protectScroll(rows);
            if(!dialog.mount())return null;
            shown.add(key);
            try{sessionStorage.setItem(storageKey,JSON.stringify([...history,view.id].slice(-128)));}catch{}
            return dialog;
        }catch(error){dialog.close();throw error;}
    })();
    pending.set(key,work);
    try{return await work;}finally{pending.delete(key);}
}
