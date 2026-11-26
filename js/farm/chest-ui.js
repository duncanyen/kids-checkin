import { createFarmDialog } from './farm-dialog.js';
import { farmCommand } from './backend-client.js';
import { readGameContext } from '../game-context.js';
import { playChestFrames } from './chest-animation.js';
const BASE='assets/farm/chest/v1/';
const NAMES={wolf:'大野狼',tiger:'老虎',gorilla:'金剛',mole:'地鼠',dragon:'烈火龍',eagle:'巨飛鷹',cobra:'眼鏡蛇王',giant:'遠古巨人',hornet:'虎頭蜂'};
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
    const {root,panel,close}=dialog;let generation=0,animation=null,busy=false,cursor=null;
    const pendingKey='nexus.chest.selection:'+JSON.stringify([context.groupId,context.accountId]);
    let pendingOpen=null;try{const value=JSON.parse(sessionStorage.getItem(pendingKey));if(Array.isArray(value?.ids)&&value.ids.length>0&&value.ids.length<=20&&value.ids.every(id=>typeof id==='string'))pendingOpen=value;}catch{}
    const savePending=value=>{pendingOpen=value;try{if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);}catch{}};
    const oldClose=dialog.onClose;dialog.onClose=()=>{generation++;animation?.stop();oldClose?.();document.removeEventListener('visibilitychange',hidden);};
    const hidden=()=>{if(document.hidden)animation?.skip();};document.addEventListener('visibilitychange',hidden);
    const shell=title=>{
        animation?.stop();animation=null;panel.replaceChildren();
        const heading=el('header','farm-chest-title');heading.append(image('assets/farm/battle-reward/v1/battle_reward_plaque.png',''),el('h2','',title));
        const dismiss=button('',close,'farm-chest-dismiss');dismiss.setAttribute('aria-label','關閉');panel.append(heading,dismiss);
    };
    root.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();close();}
        if(event.key==='Tab'){const nodes=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];if(!nodes.length)return;const i=nodes.indexOf(document.activeElement);event.preventDefault();nodes[i<0?(event.shiftKey?nodes.length-1:0):(i+(event.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}
    });
    const showResult=async(result,{animate=false}={})=>{
        if(!dialog.isCurrent())return;
        const token=++generation;shell('開箱結果');busy=false;
        if(result.chestCount)panel.append(el('p','farm-chest-summary',`已確認開啟 ${result.chestCount} 個寶箱`));
        const stage=el('div','farm-chest-stage'),sprite=image(BASE+'chest_open_static.png','farm-chest-sprite','已開啟寶箱');
        stage.append(sprite);panel.append(stage);
        const rows=el('div','farm-chest-rewards');rows.setAttribute('aria-label','本次寶箱獎勵');rows.tabIndex=0;rows.hidden=animate;
        const row=(name,quantity,src)=>{const n=el('div','farm-chest-reward');if(src)n.append(image(src,''));n.append(el('span','',name),el('strong','','× '+quantity.toLocaleString('zh-TW')));rows.append(n);};
        if(result.coins>0||!result.items?.length)row('金幣',result.coins||0,icon(scene,{icon:'coin'}));
        for(const item of result.items||[])row(item.name,item.quantity,icon(scene,item));
        const notices=[];if(result.coins>0)notices.push('金幣已加入餘額');if(result.items?.some(item=>item.kind==='stock'))notices.push('物品已放入倉庫');if(result.items?.some(item=>item.kind==='chicken'))notices.push('雞隻已送入雞舍');
        const note=el('p','farm-chest-note',notices.join('，')||'已完成開箱，本次金幣為 0');note.hidden=animate;
        const footer=el('footer','farm-chest-footer'),skip=button('跳過動畫',()=>{if(animation)animation.skip();sprite.src=BASE+'chest_open_static.png';reveal();}),confirm=button('確定',close);
        footer.append(skip,confirm,button('返回寶箱',()=>{cursor=null;void list();},'secondary'));panel.append(rows,note,footer);
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
    const open=async(chests,b,multiple=false)=>{
        if(busy)return;busy=true;
        const controls=[...panel.querySelectorAll('button,input')].filter(node=>!node.classList.contains('farm-chest-dismiss')).map(node=>({node,disabled:node.disabled}));
        for(const {node}of controls)node.disabled=true;b.textContent='開箱確認中…';
        const token=generation,attempt={ids:chests.map(chest=>chest.id).sort(),multiple};savePending(attempt);
        try{
            // A retry retains the exact IDs and requestId, even after closing/reloading.
            const result=await farmCommand(multiple?'openChests':'openChest',multiple?{chestIds:attempt.ids}:{chestId:attempt.ids[0]});
            savePending(null);
            const current=readGameContext();
            if(!dialog.isCurrent()||generation!==token)return;
            if(result.farm&&current.groupId===context.groupId&&current.accountId===context.accountId)scene.registry.set('myFarmData',result.farm);
            await showResult(result,{animate:!result.replayed});
        }catch(error){
            const uncertain=!error.code||['ops/timeout','functions/deadline-exceeded','functions/unavailable','functions/internal','functions/unknown','functions/unauthenticated','functions/cancelled'].includes(error.code);
            if(!uncertain)savePending(null);
            if(!dialog.isCurrent()||generation!==token)return;
            busy=false;
            if(!uncertain)for(const {node,disabled}of controls)node.disabled=disabled;
            b.disabled=false;b.textContent=multiple?'確認／重試這批寶箱':'確認／重試此寶箱';
            let message=panel.querySelector('.farm-chest-error');if(!message){message=el('p','farm-chest-error');panel.append(message);}message.textContent=uncertain?'結果確認中，請重試原本選取的寶箱；不會再次發獎。':error.message||'開箱尚未完成，寶箱保留。';
        }
    };
    async function list(){
        if(!dialog.isCurrent()||busy)return;const token=++generation;shell('我的寶箱');root.dataset.animationState='inventory';
        // This is recovery for an unresolved request, not an opened-box history.
        if(pendingOpen){
            const attempt=pendingOpen;
            panel.append(el('p','farm-chest-summary','上次開箱結果確認中，請先確認原本選取的寶箱。'),button('確認上次開箱結果',event=>void open(attempt.ids.map(id=>({id})),event.currentTarget,attempt.multiple)));
            return;
        }
        const hint=el('p','farm-chest-summary','勾選寶箱可一起開啟，每次最多 20 個。');panel.append(hint);
        const tools=el('div','farm-chest-selection'),selected=new Set();let checkboxes=[];
        const all=button('全選本頁',()=>{const select=selected.size!==checkboxes.length;selected.clear();for(const input of checkboxes){input.checked=select;if(select)selected.add(input.value);}updateSelection();},'secondary');
        const batch=button('開啟選取（0）',event=>void open([...selected].map(id=>({id})),event.currentTarget,true));batch.disabled=true;tools.append(all,batch);panel.append(tools);
        const updateSelection=()=>{batch.textContent=`開啟選取（${selected.size}）`;batch.disabled=!selected.size;all.textContent=selected.size&&selected.size===checkboxes.length?'取消全選':'全選本頁';};
        const rows=el('div','farm-chest-inventory');rows.tabIndex=0;rows.textContent='正在讀取寶箱…';panel.append(rows);dialog.protectScroll(rows);
        all.disabled=true;
        try{
            const result=await farmCommand('listChests',{status:'unopened',...(cursor?{cursor}:{})});if(!dialog.isCurrent()||generation!==token)return;
            rows.replaceChildren();
            for(const [index,chest]of result.rows.entries()){
                const row=el('article','farm-chest-box'),input=el('input','farm-chest-check');input.type='checkbox';input.value=chest.id;input.setAttribute('aria-label',`選取寶箱 ${index+1}（${NAMES[chest.monster]||chest.monster}）`);
                input.onchange=()=>{if(input.checked)selected.add(chest.id);else selected.delete(chest.id);updateSelection();};checkboxes.push(input);
                row.append(input,image(BASE+'chest_inventory_icon.png','','未開啟寶箱'));const label=el('div','');label.append(el('strong','','寶箱'),el('span','',NAMES[chest.monster]||chest.monster));row.append(label,button('開啟',event=>void open([chest],event.currentTarget)));rows.append(row);
            }
            all.disabled=!result.rows.length;
            if(!result.rows.length){rows.append(el('p','','目前沒有待開啟寶箱'));tools.hidden=true;hint.hidden=true;}
            if(result.nextCursor)rows.append(button('下一頁',()=>{cursor=result.nextCursor;void list();},'secondary'));
            if(cursor)rows.append(button('回第一頁',()=>{cursor=null;void list();},'secondary'));
        }catch(error){if(dialog.isCurrent()&&generation===token){tools.hidden=true;rows.replaceChildren(el('p','',error.message||'寶箱讀取失敗'),button('重新讀取',()=>{cursor=null;void list();}));}}
    }
    if(!dialog.mount())return null;
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)void prepareChestArt().catch(()=>{});
    void preload(BASE+'chest_open_static.png').catch(()=>{});void list();return dialog;
}
