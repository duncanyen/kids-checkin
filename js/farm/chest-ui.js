import { createFarmDialog } from './farm-dialog.js';
import { farmCommand } from './backend-client.js';
import { readGameContext } from '../game-context.js';
import { playChestFrames } from './chest-animation.js';
const BASE='assets/farm/chest/v1/';
const NAMES={wolf:'大野狼',tiger:'老虎',gorilla:'金剛',mole:'地鼠',dragon:'烈火龍',eagle:'巨飛鷹',cobra:'眼鏡蛇王',giant:'遠古巨人'};
let art;
function preload(url){return new Promise((resolve,reject)=>{const image=new Image(),timer=setTimeout(()=>finish(Error('寶箱動畫載入逾時')),8000);function finish(error){clearTimeout(timer);image.onload=image.onerror=null;error?reject(error):resolve();}image.onload=()=>finish();image.onerror=()=>finish(Error('寶箱動畫載入失敗'));image.src=url;});}
export function prepareChestArt(){
    return art||=fetch(BASE+'manifest.json',{cache:'force-cache'}).then(r=>{if(!r.ok)throw Error('寶箱動畫設定載入失敗');return r.json();}).then(async manifest=>{
        if(manifest.frame_width!==512||manifest.frame_height!==512||manifest.columns!==4||manifest.rows!==2||JSON.stringify(manifest.origin_normalized_xy)!=='[0.5,0.78125]'||manifest.frames?.length!==8||manifest.reveal_frame!==4||manifest.hold_frame!==7||manifest.repeat!==0||manifest.frames.reduce((n,f)=>n+f.duration_ms,0)!==900||manifest.frames.some((f,i)=>f.index!==i||!Number.isFinite(f.duration_ms)||f.duration_ms<=0||!/^frames\/chest_\d\d_[a-z]+\.png$/.test(f.file)))throw Error('寶箱動畫設定格式不正確');
        await Promise.all(manifest.frames.map(f=>preload(BASE+f.file)));return manifest;
    }).catch(error=>{art=null;throw error;});
}
const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const image=(src,cls,alt='')=>{const n=el('img',cls);n.src=src;n.alt=alt;n.draggable=false;return n;};
const button=(text,fn,cls='')=>{const n=el('button','farm-chest-button '+cls,text);n.type='button';n.onclick=fn;return n;};
function icon(scene,item){try{if(scene.textures.exists(item.icon)){const texture=scene.textures.get(item.icon);return scene.textures.getBase64(item.icon,texture.has('0')?'0':undefined);}}catch{}return null;}
export function openChestInventory(scene){
    if(scene.eggResultDialog)return scene.eggResultDialog;
    const context=readGameContext(),dialog=createFarmDialog(scene,{kind:'chest',panelClass:'farm-chest-panel',label:'我的寶箱',valid:()=>{const now=readGameContext();return now.groupId===context.groupId&&now.accountId===context.accountId;}});
    const {root,panel,close}=dialog;let generation=0,animation=null,busy=false,status='unopened',cursor=null;
    const oldClose=dialog.onClose;dialog.onClose=()=>{generation++;animation?.stop();oldClose?.();document.removeEventListener('visibilitychange',hidden);};
    const hidden=()=>{if(document.hidden)animation?.skip();};document.addEventListener('visibilitychange',hidden);
    const shell=title=>{
        animation?.stop();animation=null;panel.replaceChildren();
        const heading=el('header','farm-chest-title');heading.append(image('assets/farm/battle-reward/v1/battle_reward_plaque.png',''),el('h2','',title));
        const dismiss=button('',close,'farm-chest-dismiss');dismiss.setAttribute('aria-label','關閉');panel.append(heading,dismiss);
    };
    root.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();close();}
        if(event.key==='Tab'){const nodes=[...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')];if(!nodes.length)return;const i=nodes.indexOf(document.activeElement);event.preventDefault();nodes[i<0?(event.shiftKey?nodes.length-1:0):(i+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}
    });
    const showResult=async(result,{animate=false}={})=>{
        if(!dialog.isCurrent())return;
        const token=++generation;shell('開箱結果');busy=false;
        const stage=el('div','farm-chest-stage'),sprite=image(BASE+'chest_open_static.png','farm-chest-sprite','已開啟寶箱');
        stage.append(sprite);panel.append(stage);
        const rows=el('div','farm-chest-rewards');rows.setAttribute('aria-label','本次寶箱獎勵');rows.tabIndex=0;rows.hidden=animate;
        const row=(name,quantity,src)=>{const n=el('div','farm-chest-reward');if(src)n.append(image(src,''));n.append(el('span','',name),el('strong','','× '+quantity.toLocaleString('zh-TW')));rows.append(n);};
        if(result.coins>0||!result.items?.length)row('金幣',result.coins||0,icon(scene,{icon:'coin'}));
        for(const item of result.items||[])row(item.name,item.quantity,icon(scene,item));
        const notices=[];if(result.coins>0)notices.push('金幣已加入餘額');if(result.items?.some(item=>item.kind==='stock'))notices.push('物品已放入倉庫');if(result.items?.some(item=>item.kind==='chicken'))notices.push('雞隻已送入雞舍');
        const note=el('p','farm-chest-note',notices.join('，')||'已完成開箱，本次金幣為 0');note.hidden=animate;
        const footer=el('footer','farm-chest-footer'),skip=button('跳過動畫',()=>{if(animation)animation.skip();sprite.src=BASE+'chest_open_static.png';reveal();}),confirm=button('確定',close);
        footer.append(skip,confirm,button('查看寶箱紀錄',()=>{status='opened';cursor=null;void list();},'secondary'));panel.append(rows,note,footer);
        dialog.protectScroll(rows);
        const reveal=()=>{if(!dialog.isCurrent()||generation!==token)return;rows.hidden=false;note.hidden=false;skip.hidden=true;};
        if(!animate||matchMedia('(prefers-reduced-motion: reduce)').matches){root.dataset.animationState='static';root.dataset.chestFrame='7';reveal();return;}
        sprite.src=BASE+'chest_inventory_icon.png';root.dataset.animationState='preparing';
        const manifest=await Promise.race([prepareChestArt().catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),500))]);
        if(!dialog.isCurrent()||generation!==token)return;
        if(!manifest||!rows.hidden){sprite.src=BASE+'chest_open_static.png';reveal();root.dataset.animationState='static';return;}
        const [x,y]=manifest.origin_normalized_xy;sprite.style.transform=`translate(${-x*100}%,${-y*100}%)`;sprite.style.left=(x*100)+'%';sprite.style.top=(y*100)+'%';
        sprite.onerror=()=>{animation?.stop();sprite.onerror=null;sprite.src=BASE+'chest_open_static.png';reveal();root.dataset.animationState='static';};
        animation=playChestFrames(manifest,{frame:item=>{sprite.src=BASE+item.file;root.dataset.chestFrame=String(item.index);},reveal,finish:()=>{root.dataset.animationState='complete';}});
        root.dataset.animationState='playing';
    };
    const open=async(chest,b)=>{
        if(busy)return;busy=true;b.disabled=true;b.textContent='開箱確認中…';
        const token=generation;
        try{
            // The existing command retains requestId on uncertain failure; all retries
            // target this same chest ID, even after refresh or on another device.
            const result=await farmCommand('openChest',{chestId:chest.id});
            const current=readGameContext();
            if(!dialog.isCurrent()||generation!==token)return;
            if(result.farm&&current.groupId===context.groupId&&current.accountId===context.accountId)scene.registry.set('myFarmData',result.farm);
            await showResult(result,{animate:!result.replayed});
        }catch(error){
            if(!dialog.isCurrent()||generation!==token)return;
            busy=false;b.disabled=false;b.textContent='確認／重試此寶箱';
            let message=panel.querySelector('.farm-chest-error');if(!message){message=el('p','farm-chest-error');panel.append(message);}message.textContent=['ops/timeout','functions/deadline-exceeded','functions/unavailable','functions/internal'].includes(error.code)?'結果確認中，請重試同一個寶箱；不會再次發獎。':error.message||'開箱尚未完成，寶箱保留。';
        }
    };
    async function list(){
        if(!dialog.isCurrent())return;busy=false;const token=++generation;shell('我的寶箱');root.dataset.animationState='inventory';
        const tabs=el('nav','farm-chest-tabs');for(const [key,label]of [['unopened','待開啟'],['opened','開箱紀錄']]){const b=button(label,()=>{if(busy)return;status=key;cursor=null;void list();},'secondary');b.setAttribute('aria-pressed',String(status===key));tabs.append(b);}panel.append(tabs);
        const rows=el('div','farm-chest-inventory');rows.tabIndex=0;rows.textContent='正在讀取寶箱…';panel.append(rows);dialog.protectScroll(rows);
        try{
            const result=await farmCommand('listChests',{status,...(cursor?{cursor}:{})});if(!dialog.isCurrent()||generation!==token)return;
            rows.replaceChildren();
            for(const chest of result.rows){const row=el('article','farm-chest-box');row.append(image(BASE+'chest_inventory_icon.png','',chest.status==='opened'?'寶箱紀錄':'未開啟寶箱'));const label=el('div','');label.append(el('strong','','寶箱'),el('span','',NAMES[chest.monster]||chest.monster));row.append(label,button(status==='opened'?'查看結果':'開啟',event=>{if(status==='opened')void showResult(chest.result);else void open(chest,event.currentTarget);}));rows.append(row);}
            if(!result.rows.length)rows.append(el('p','',status==='opened'?'尚無開箱紀錄':'目前沒有待開啟寶箱'));
            if(result.nextCursor)rows.append(button('下一頁',()=>{cursor=result.nextCursor;void list();},'secondary'));
            if(cursor)rows.append(button('回第一頁',()=>{cursor=null;void list();},'secondary'));
        }catch(error){if(dialog.isCurrent()&&generation===token){rows.replaceChildren(el('p','',error.message||'寶箱讀取失敗'),button('重新讀取',()=>{cursor=null;void list();}));}}
    }
    if(!dialog.mount())return null;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)void prepareChestArt().catch(()=>{});
    void preload(BASE+'chest_open_static.png').catch(()=>{});void list();return dialog;
}
