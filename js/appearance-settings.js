import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { icon } from './ui-icons.js';

export function mountAppearanceSettings({ db, user, root }) {
    const theme=window.NexusTheme;
    if(!root||!user?.accountId||!theme)return {hydrate(){}};
    theme.refresh();
    let saved=theme.current,selected=saved,busy=false,revision=0;
    const group=root.querySelector('[data-theme-options]'),status=root.querySelector('[data-theme-status]');
    const save=root.querySelector('[data-theme-save]'),cancel=root.querySelector('[data-theme-cancel]');
    for(const t of theme.themes){
        const button=document.createElement('button');button.type='button';button.className='theme-option';button.dataset.themeId=t.id;
        button.setAttribute('role','radio');button.setAttribute('aria-label',`${t.name}，${t.dark?'深色':'淺色'}主題`);
        for(const [name,value] of Object.entries({bg:t.bg,text:t.text,muted:t.muted,primary:t.primary,soft:t.soft,border:t.border}))button.style.setProperty(`--preview-${name}`,value);
        button.innerHTML=`<span class="theme-option-check">${icon('check')}</span><span class="theme-swatches" aria-hidden="true"><i style="background:${t.primary}"></i><i style="background:${t.soft}"></i><i style="background:${t.text}"></i></span><strong>${t.name}</strong><small>${t.description}</small>`;
        button.addEventListener('click',()=>choose(t.id));
        button.addEventListener('keydown',event=>{
            const index=theme.themes.findIndex(t=>t.id===selected),count=theme.themes.length;
            const steps={ArrowRight:1,ArrowLeft:-1,ArrowDown:2,ArrowUp:-2};
            if(!(event.key in steps)&&!['Home','End'].includes(event.key))return;
            event.preventDefault();
            const next=event.key==='Home'?0:event.key==='End'?count-1:(index+steps[event.key]+count)%count;
            choose(theme.themes[next].id);group.children[next].focus();
        });
        group.append(button);
    }
    function render(){
        for(const button of group.children){const active=button.dataset.themeId===selected;button.setAttribute('aria-checked',String(active));button.tabIndex=active?0:-1;button.disabled=busy;}
        root.querySelector('[data-theme-name]').textContent=theme.themes.find(t=>t.id===selected).name;
        save.disabled=busy||selected===saved;cancel.disabled=busy||selected===saved;
        save.textContent=busy?'儲存中…':'儲存主題';
    }
    function choose(id){if(busy)return;revision++;selected=id;theme.apply(id);status.textContent=selected===saved?'目前使用此主題。':'正在預覽，按「儲存主題」即可保留。';render();}
    cancel.addEventListener('click',()=>{if(busy)return;revision++;selected=saved;theme.apply(saved);status.textContent='已還原目前儲存的主題。';render();});
    save.addEventListener('click',async()=>{
        if(busy||selected===saved)return;
        const id=selected;busy=true;status.textContent='正在儲存主題…';render();
        try{
            if(theme.user()?.accountId!==user.accountId)throw new Error('account changed');
            await setDoc(doc(db,'userSettings',user.accountId),{accountId:user.accountId,appearance:{theme:id,version:1},updatedAt:serverTimestamp()},{merge:true});
            const cached=theme.remember(user.accountId,id);
            if(theme.user()?.accountId!==user.accountId)return;
            saved=id;status.textContent=cached?'主題已儲存，下次登入也會套用。':'已儲存至帳號；此瀏覽器無法保留本機偏好。';
        }catch(error){status.textContent='主題尚未儲存，請檢查連線後重試，或還原原本主題。';}
        finally{busy=false;render();}
    });
    window.addEventListener('pageshow',event=>{if(event.persisted&&!busy){selected=saved=theme.current;revision++;status.textContent='目前使用此主題。';render();}});
    render();
    return {hydrate(appearance){if(revision||busy)return;theme.hydrate(user.accountId,appearance);selected=saved=theme.current;render();}};
}
