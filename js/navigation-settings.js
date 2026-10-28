import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { allowedNavigation, resolveNavigation, cachedNavigation, cacheNavigation, MAX_NAV_FEATURES } from './navigation-config.js';
import { icon } from './ui-icons.js';

export function mountNavigationSettings({db,user,root}){
    if(!root||!user?.accountId)return {hydrate(){}};
    const available=allowedNavigation(user);
    let selected=resolveNavigation(user,{navigation:{items:cachedNavigation(user.accountId)}}),saved=[...selected],revision=0,busy=false;
    const list=root.querySelector('[data-nav-options]'),order=root.querySelector('[data-nav-order]'),status=root.querySelector('[data-nav-status]'),save=root.querySelector('[data-nav-save]');
    const same=()=>JSON.stringify(selected)===JSON.stringify(saved);
    function render(){
        const focused=list.contains(document.activeElement)?document.activeElement.value:null;
        root.querySelector('[data-nav-count]').textContent=`${selected.length} / ${MAX_NAV_FEATURES}`;
        list.replaceChildren(...available.map(item=>{
            const label=document.createElement('label');label.className='navigation-choice';
            const input=document.createElement('input');input.type='checkbox';input.value=item.id;input.checked=selected.includes(item.id);input.disabled=busy||(!input.checked&&selected.length>=MAX_NAV_FEATURES);
            const glyph=document.createElement('span');glyph.innerHTML=icon(item.id);const text=document.createElement('span');text.textContent=item.label;
            label.append(input,glyph,text);
            input.addEventListener('change',()=>{revision++;if(input.checked){if(selected.length>=MAX_NAV_FEATURES){input.checked=false;return;}selected.push(item.id);}else selected=selected.filter(id=>id!==item.id);status.textContent='尚未儲存，勾選順序就是導覽順序，也可在下方調整。';render();});
            return label;
        }));
        order.replaceChildren(...selected.map((id,index)=>{
            const item=available.find(item=>item.id===id),row=document.createElement('div');row.className='navigation-order-row';
            const text=document.createElement('span');text.textContent=`${index+1}. ${item.label}`;row.append(text);
            for(const [step,label]of [[-1,'上移'],[1,'下移']]){
                const button=document.createElement('button');button.type='button';button.textContent=step<0?'↑':'↓';button.setAttribute('aria-label',`${item.label}${label}`);button.disabled=busy||index+step<0||index+step>=selected.length;
                button.addEventListener('click',()=>{revision++;[selected[index],selected[index+step]]=[selected[index+step],selected[index]];status.textContent='順序已調整，請儲存設定。';render();});row.append(button);
            }
            return row;
        }));
        if(focused)list.querySelector(`input[value="${focused}"]`)?.focus();
        save.disabled=busy||same();save.textContent=busy?'儲存中…':'儲存導覽列';root.querySelector('[data-nav-reset]').disabled=busy||same();
    }
    root.querySelector('[data-nav-reset]').addEventListener('click',()=>{revision++;selected=[...saved];status.textContent='已還原儲存的導覽設定。';render();});
    save.addEventListener('click',async()=>{
        if(busy||same()||selected.length>MAX_NAV_FEATURES)return;
        busy=true;const items=[...selected];status.textContent='正在儲存…';render();
        try{
            if(window.NexusTheme?.user()?.accountId!==user.accountId)throw Error('account changed');
            await setDoc(doc(db,'userSettings',user.accountId),{accountId:user.accountId,navigation:{version:1,items},updatedAt:serverTimestamp()},{merge:true});
            const cached=cacheNavigation(user.accountId,items);saved=items;status.textContent=cached?'導覽列已儲存，返回主頁即可使用。':'已儲存至帳號，請回主頁重新載入設定。';
        }catch{status.textContent='儲存失敗，請檢查連線後重試。';}
        finally{busy=false;render();}
    });
    render();return {hydrate(settings){if(revision||busy)return;selected=resolveNavigation(user,settings);saved=[...selected];cacheNavigation(user.accountId,selected);render();}};
}
