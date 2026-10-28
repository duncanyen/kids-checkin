import { icon } from './ui-icons.js';
import { NAV_FEATURES, resolveNavigation, cachedNavigation, cacheNavigation } from './navigation-config.js';

let feedbackFrame=null;
function resetPendingNavigation(){
    if(feedbackFrame!==null){cancelAnimationFrame(feedbackFrame);feedbackFrame=null;}
    document.querySelectorAll('.app-nav-link[aria-busy]').forEach(link=>link.removeAttribute('aria-busy'));
}
// These are document-lifetime handlers, independent of repeated nav rendering.
window.addEventListener('pagehide',resetPendingNavigation);
window.addEventListener('pageshow',resetPendingNavigation);
function currentUser(){try{return JSON.parse(sessionStorage.getItem('familyCheckInUser')||localStorage.getItem('familyCheckInUser')||'null');}catch{return null;}}
export function mountAppNavigation({user=currentUser(),settings,container}={}){
    const page=document.body.dataset.appPage;
    if(!user?.accountId||page==='gamezone')return;
    const items=settings?resolveNavigation(user,settings):resolveNavigation(user,{navigation:{items:cachedNavigation(user.accountId)}});
    if(settings)cacheNavigation(user.accountId,items);
    const nav=container||document.getElementById('appNavigation')||document.createElement('nav');
    if(!nav.isConnected)document.body.append(nav);
    nav.hidden=false;nav.id=container?.id||'appNavigation';nav.className='app-bottom-navigation';nav.setAttribute('aria-label','主要功能導覽');
    const entries=[{id:'home',label:'首頁',url:'index.html'},...items.map(id=>NAV_FEATURES.find(item=>item.id===id))];
    nav.replaceChildren(...entries.map(item=>{
        const link=document.createElement('a');link.href=item.url+'?nav=1';link.className='app-nav-link';
        link.dataset.navFeature=item.id;link.setAttribute('aria-label',item.label);
        if(item.id===(page||'home'))link.setAttribute('aria-current','page');
        link.addEventListener('click',event=>{
            if(event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||currentUser()?.accountId!==user.accountId)return;
            // Reselecting this exact URL should preserve the current view and
            // subscriptions instead of downloading/reinitializing the same page.
            if(link.href===location.href){event.preventDefault();return;}
            resetPendingNavigation();link.setAttribute('aria-busy','true');
            feedbackFrame=requestAnimationFrame(()=>{feedbackFrame=null;if(event.defaultPrevented)resetPendingNavigation();});
            if(item.id==='home')return;
            // Preserve the existing deferred activity log without blocking native/PWA navigation.
            try{
                const existing=JSON.parse(localStorage.getItem('nexus_pending_logs')||'[]');
                const logs=Array.isArray(existing)?existing:[];
                logs.push({operator:user.name,accountId:user.accountId,actionType:'系統操作',details:`進入了 ${item.label} 模組`,groupId:sessionStorage.getItem('nexus_active_group_id')||localStorage.getItem('lastGroupId')||user.groupId,timestamp:Date.now()});
                localStorage.setItem('nexus_pending_logs',JSON.stringify(logs));
            }catch{} // Storage failure must not prevent opening the selected feature.
        });
        link.innerHTML=icon(item.id)+'<span></span>';link.querySelector('span').textContent=item.label;
        return link;
    }));
    document.documentElement.classList.add('has-app-navigation');
    // Preserve Food's meal/vote/results/admin controls as in-page tabs, above the content.
    if(page==='food'){
        const local=document.querySelector('.app > nav.nav'),main=document.querySelector('.app > main');
        if(local&&main)main.before(local);
    }
    return nav;
}
const page=document.body.dataset.appPage;
if(page&&page!=='home'&&page!=='gamezone'&&new URLSearchParams(location.search).get('nav')==='1'){
    if(mountAppNavigation())document.documentElement.dataset.navigationEntry='nav';
}
