import {doc,setDoc,serverTimestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
export function mountFontSizeSettings({db,user,root}) {
    const api=window.NexusFontSize;
    if(!root||!api||!user?.accountId)return {hydrate(){}};
    api.refresh();
    let saved=api.current, selected=saved, busy=false, revision=0;
    const range=root.querySelector('input'),group=root.querySelector('[data-font-options]'),status=root.querySelector('[data-font-status]');
    const save=root.querySelector('[data-font-save]'),cancel=root.querySelector('[data-font-cancel]');
    const labels=['特小','小','標準','大','特大'];
    for(const [index,value] of api.values.entries()) {
        const button=document.createElement('button');button.type='button';button.className='font-size-option';button.dataset.fontSize=value;
        button.setAttribute('role','radio');button.setAttribute('aria-label',`${labels[index]}，${value}%`);
        button.innerHTML=`<span>${labels[index]}</span><span>${value}%</span><i aria-hidden="true"></i>`;
        button.addEventListener('click',()=>choose(value));
        button.addEventListener('keydown',e=>{
            const steps={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1};
            if(!(e.key in steps)&&!['Home','End'].includes(e.key))return;
            e.preventDefault();const n=e.key==='Home'?0:e.key==='End'?4:(api.values.indexOf(selected)+(steps[e.key]||0)+5)%5;
            choose(api.values[n]);group.children[n].focus();
        });group.append(button);
    }
    function render(){
        range.value=selected;range.disabled=busy;range.setAttribute('aria-valuetext',`${selected}%`);
        for(const button of group.children){const active=Number(button.dataset.fontSize)===selected;button.setAttribute('aria-checked',String(active));button.tabIndex=active?0:-1;button.disabled=busy;button.querySelector('i').textContent=active?'✓':'';}
        root.querySelector('[data-font-name]').textContent=root.querySelector('[data-font-value]').textContent=`${selected}%`;
        save.disabled=cancel.disabled=busy||selected===saved;save.textContent=busy?'儲存中…':'儲存字體大小';
    }
    function choose(value){if(busy||!api.valid(value))return;revision++;selected=value;api.apply(value);status.textContent=value===saved?'目前使用此字體大小。':'正在預覽，按「儲存字體大小」即可保留。';render();}
    range.addEventListener('input',()=>choose(Number(range.value)));
    cancel.addEventListener('click',()=>{if(busy)return;revision++;selected=saved;api.apply(saved);status.textContent='已還原儲存的字體大小。';render();});
    save.addEventListener('click',async()=>{
        if(busy||selected===saved)return;const value=selected;busy=true;render();
        try{
            if(api.user()?.accountId!==user.accountId)throw Error('account changed');
            await setDoc(doc(db,'userSettings',user.accountId),{accountId:user.accountId,appearance:{fontScale:value},updatedAt:serverTimestamp()},{merge:true});
            const cached=api.remember(user.accountId,value);
            if(api.user()?.accountId!==user.accountId)return;
            saved=value;status.textContent=cached?'字體大小已儲存，下次登入也會套用。':'已儲存至帳號；此瀏覽器無法保留本機偏好。';
        }catch{status.textContent='尚未儲存，請檢查連線後重試，或還原原本大小。';}
        finally{busy=false;render();}
    });
    window.addEventListener('pageshow',event=>{if(event.persisted&&!busy){revision++;selected=saved=api.current;render();}});
    render();
    return {hydrate(appearance){if(revision||busy)return;api.hydrate(user.accountId,appearance);selected=saved=api.current;render();}};
}
