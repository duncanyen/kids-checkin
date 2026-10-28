// Local, consistent 24px outline icons. No font/CDN dependency; never alter user content.
const paths = {
    chat:'<path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9 9 0 0 1-4-.9L3 21l1.8-5A8.5 8.5 0 1 1 21 11.5Z"/>',
    calendar:'<rect x="4" y="5" width="16" height="16" rx="3"/><path d="M8 3v4m8-4v4M4 11h16"/>',
    todo:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8 12 3 3 5-6"/>',
    finance:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6m-6 4h6m-6 4h3"/>',
    photodump:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 3-3 6 5"/>',
    gamezone:'<path d="M7 7h10c3 0 4 4 4 8s-3 4-6 1H9c-3 3-6 3-6-1s1-8 4-8Z"/><path d="M8 10v5m-2.5-2.5h5M16 11h.01M18 14h.01"/>',
    checkin:'<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    wishlist:'<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3L12 17.6l-5.7 3 1.1-6.4L3 9.7l6.2-.9Z"/>',
    food:'<path d="M5 3v7m4-7v7M3 6h8m-8 4c0 3 8 3 8 0M7 13v8m12-18c-4 3-4 9 0 9m0-9v18"/>',
    settings:'<path d="m9 3-.5 2-2 .9L4.7 5 3 8l1.5 1.5v3L3 14l1.7 3 1.8-.9 2 .9.5 2h4l.5-2 2-.9 1.8.9 1.7-3-1.5-1.5v-3L20 8l-1.7-3-1.8.9-2-.9L14 3Z"/><circle cx="11.5" cy="11" r="3"/>',
    notification:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
    home:'<path d="m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10"/>',
    switch:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
    admin:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
    palette:'<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    arrow:'<path d="m9 5 7 7-7 7"/>',
    logout:'<path d="M9 4H4v16h5m0-8h12m-4-4 4 4-4 4"/>',
    edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
    heart:'<path d="M20 5c-3-3-6-1-8 1C10 4 7 2 4 5c-5 5 8 15 8 15S25 10 20 5Z"/>',
    share:'<path d="M12 16V3m-5 5 5-5 5 5M5 13v8h14v-8"/>',
    warning:'<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3h.01"/>'
};
export function icon(key, extra='') {
    return `<svg class="nexus-icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[key]||paths.home}</svg>`;
}
export function mountIcons(root=document){root.querySelectorAll('[data-ui-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.uiIcon);});}
mountIcons();
const navigationSelector='.sidebar-item,.dock-item,.quick-action-btn,.mini-widget,.agenda-card,.current-user-badge,.hamburger-btn';
export function enhanceNavigation(root=document){
    root.querySelectorAll(navigationSelector).forEach(el=>{
        if(!el.hasAttribute('onclick'))return;
        el.setAttribute('role','button');el.tabIndex=0;
        if(el.title)el.setAttribute('aria-label',el.title);
    });
}
enhanceNavigation();
document.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ')&&event.target.matches(navigationSelector)){
        event.preventDefault();event.target.click();
    }
    if(event.key==='Escape'&&document.getElementById('sidebar')?.classList.contains('active'))window.toggleSidebar?.();
});
