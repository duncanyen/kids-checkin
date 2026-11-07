import { farmView } from './viewport.js';
import { BREEDS, poultryState } from './poultry.js';
import { outdoorCounts, outdoorHens, MIN_OUTDOOR_HENS, housingPatch } from './poultry-housing.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function farmDialog(scene,title){
    scene.housingDialog?.close();
    const root=el('div');root.className='farm-mail-overlay';const panel=el('section');panel.className='farm-mail-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label',title);
    const heading=el('h2',title),message=el('p');message.setAttribute('role','status');
    // Keep the global manager active so touchend releases the canvas pointer.
    // Only this scene is blocked while the DOM overlay owns interaction.
    const input=scene.input,before=input.enabled;input.enabled=false;
    let closed=false;
    const close=()=>{if(closed)return;closed=true;root.remove();input.enabled=before;if(scene.housingDialog?.root===root)scene.housingDialog=null;scene.events.off('shutdown',close);scene.events.off('destroy',close);};
    const btn=(label,action)=>{const b=el('button',label);b.type='button';b.className='farm-mail-button';b.onclick=action;panel.append(b);return b;};
    panel.append(heading,message);root.append(panel);document.body.append(root);scene.events.once('shutdown',close);scene.events.once('destroy',close);
    root.addEventListener('keydown',event=>{if(event.key==='Escape')close();if(event.key==='Tab'){const buttons=[...panel.querySelectorAll('button:not(:disabled)')];if(!buttons.length)return;const first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    scene.housingDialog={root,panel,message,close,button:btn};return scene.housingDialog;
}
export function openHousing(scene,save,breed){
    scene.housingDialog?.close();
    const farm=scene.farmData,hens=poultryState(farm).hens,counts=outdoorCounts(farm);
    const owned=hens.filter(h=>h.breed===breed).length,minimum=Math.min(MIN_OUTDOOR_HENS,hens.length);
    let quantity=counts[breed],busy=false,closed=false;
    const container=scene.add.container(0,0).setDepth(100),view=farmView(scene);
    const shade=scene.add.rectangle(195,422,view.width,view.height,0x000000,.8).setInteractive();
    const paper=scene.add.rectangle(195,422,320,220,0xffffff);
    const title=scene.add.text(195,335,`${BREEDS[breed].name}放風設定`,{fontSize:'18px',color:'#000',fontStyle:'bold'}).setOrigin(.5);
    const hint=scene.add.text(195,365,`本品種共 ${owned} 隻・全場至少 ${minimum} 隻在外面`,{fontSize:'13px',color:'#666'}).setOrigin(.5);
    const qty=scene.add.text(170,410,String(quantity),{fontSize:'20px',color:'#000',fontStyle:'bold'}).setOrigin(.5);
    const message=scene.add.text(195,460,'',{fontSize:'14px',color:'#735038',align:'center'}).setOrigin(.5);
    container.add([shade,paper,title,hint,qty,message]);
    const controls=[];
    const control=(x,y,width,label,color,action)=>{
        const bg=scene.add.rectangle(x,y,width,36,color).setStrokeStyle(1,0xcccccc).setInteractive({cursor:'pointer'});
        const text=scene.add.text(x,y,label,{fontSize:label==='MAX'?'13px':'15px',color:color===0xffffff?'#000':'#fff',fontStyle:'bold'}).setOrigin(.5);
        bg.on('pointerdown',()=>{if(!busy)action();});container.add([bg,text]);controls.push(bg);return bg;
    };
    const refresh=()=>{
        counts[breed]=quantity;qty.setText(String(quantity));
        const total=Object.values(counts).reduce((a,b)=>a+b,0);
        message.setColor('#735038').setText(`全場放風 ${total}／飼養 ${hens.length} 隻\n雞舍內外皆照常產蛋`);
        controls.forEach(bg=>{bg.input.enabled=!busy;bg.setAlpha(busy?.5:1);});
        minus.input.enabled=!busy&&quantity>0;minus.setAlpha(quantity>0?1:.4);
        plus.input.enabled=!busy&&quantity<owned;plus.setAlpha(quantity<owned?1:.4);
    };
    const setQuantity=value=>{if(busy)return;quantity=Math.max(0,Math.min(owned,value));refresh();};
    const minus=control(110,410,40,'−',0xffffff,()=>setQuantity(quantity-1));
    const plus=control(230,410,40,'+',0xffffff,()=>setQuantity(quantity+1));
    const max=control(280,410,45,'MAX',0xff9800,()=>setQuantity(owned));
    const close=()=>{
        if(closed)return;closed=true;container.destroy();scene.input.keyboard?.off('keydown-ESC',escape);scene.events.off('shutdown',close);scene.events.off('destroy',close);
        if(scene.housingDialog?.container===container)scene.housingDialog=null;
    };
    const confirm=control(130,505,100,'確認',0x4caf50,async()=>{
        try{housingPatch(farm,counts);}catch(error){message.setColor('#e53935').setText(error.message);return;}
        busy=true;refresh();message.setText('儲存中…');
        try{await save({...counts});close();}
        catch(error){if(!closed){busy=false;refresh();message.setColor('#e53935').setText(error.message||'儲存失敗，請重試');}}
    });
    const cancel=control(260,505,100,'取消',0xf44336,close);
    const escape=()=>{if(!busy)close();};scene.input.keyboard?.on('keydown-ESC',escape);
    scene.events.once('shutdown',close);scene.events.once('destroy',close);
    scene.housingDialog={container,qty,message,minus,plus,max,confirm,cancel,close,setQuantity};refresh();
}
export function openCoopActions(scene) {
    const dialog = farmDialog(scene, '雞舍管理');
    const count = el('p');
    count.dataset.coopSickCount = '';
    count.setAttribute('aria-live', 'polite');
    const medicines = el('p');
    medicines.dataset.coopMedicineCount = '';
    dialog.panel.insertBefore(count, dialog.message);
    dialog.panel.insertBefore(medicines, dialog.message);
    const clean = dialog.button('清理雞舍', () => {
        dialog.close();
        scene.askCleanMyFarm(true);
    });
    const treat = dialog.button('餵食咕咕活力飲', async () => {
        if (dialog.busy) return;
        dialog.busy = true;
        treat.disabled = clean.disabled = true;
        dialog.message.textContent = '治療中…';
        try {
            await scene.treatRandomSickHen();
            if (dialog.root.isConnected) dialog.message.textContent = scene.treatmentMessage || '已處理';
        } catch (error) {
            if (dialog.root.isConnected) dialog.message.textContent = error.message || '治療失敗，請重試';
        } finally {
            dialog.busy = false;
            if (dialog.root.isConnected) {
                treat.disabled = clean.disabled = false;
                dialog.refresh();
            }
        }
    });
    treat.title = '每次消耗現有治療藥品 1 個，隨機治療一隻病雞';
    const close = dialog.button('關閉', dialog.close);
    dialog.refresh = () => {
        const farm = scene.farmData;
        const sick = poultryState(farm).hens.filter(hen => hen.isSick);
        const outside = new Set(outdoorHens(farm).map(hen => hen.id));
        const outdoorSick = sick.filter(hen => outside.has(hen.id)).length;
        count.textContent = `生病雞隻：共 ${sick.length} 隻（雞舍內 ${sick.length - outdoorSick} 隻、放風中 ${outdoorSick} 隻）`;
        medicines.textContent = `可用藥品：${farm.medicines || 0} 份，每次治療 1 隻`;
        if (sick.length) {
            if (!treat.isConnected) close.before(treat);
        } else {
            treat.remove();
        }
    };
    dialog.refresh();
    close.focus();
}
