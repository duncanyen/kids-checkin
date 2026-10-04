import { db } from "./firebase-config.js";
import { collection, query, where, onSnapshot, getDoc, updateDoc, doc, orderBy, limit } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let unreadUnsubscribe = null;
let galleryUnsubscribe = null;
let calendarUnsubscribe = null;
let groupNameUnsubscribe = null; 
let todoUnsubscribe = null;
let financeUnsubscribe = null;

let cachedCalendarEvents = [];
let calendarUIRenderInterval = null;

// 【新增】切換群組的全域函數
window.switchGroup = function() {
    sessionStorage.removeItem('nexus_active_group_id'); // 清除記憶的群組
    window.location.reload(); // 重新載入網頁，讓 main.js 重新導向至群組列表
};

window.showDashboard = async function() {
    window.hideAllSections();
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    document.getElementById('dashboardView').style.display = 'block';
    
    if (groupNameUnsubscribe) { groupNameUnsubscribe(); groupNameUnsubscribe = null; }
    if (unreadUnsubscribe) { unreadUnsubscribe(); unreadUnsubscribe = null; }
    if (galleryUnsubscribe) { galleryUnsubscribe(); galleryUnsubscribe = null; }
    if (calendarUnsubscribe) { calendarUnsubscribe(); calendarUnsubscribe = null; }
    if (calendarUIRenderInterval) { clearInterval(calendarUIRenderInterval); calendarUIRenderInterval = null; }
    if (todoUnsubscribe) { todoUnsubscribe(); todoUnsubscribe = null; }
    if (financeUnsubscribe) { financeUnsubscribe(); financeUnsubscribe = null; }

    if (window.currentGroup) {
        // 【修改點】將目前的群組 ID 記錄下來，這樣從其他頁面返回時才知道要進哪個群組
        sessionStorage.setItem('nexus_active_group_id', window.currentGroup.id);

        groupNameUnsubscribe = onSnapshot(doc(db, "groups", window.currentGroup.id), (docSnap) => {
            if (docSnap.exists()) {
                window.currentGroup = { id: docSnap.id, ...docSnap.data() };
            }
        });
    }
    
    document.getElementById('dashUserAvatar').src = user.avatar;
    document.getElementById('dashUserName').innerText = user.name;
    document.getElementById('sideAvatar').src = user.avatar;
    document.getElementById('sideUserName').innerText = user.name;
    document.getElementById('sideUserRole').innerText = (user.role === 'admin' || user.role === 'parent') ? '管理員' : '一般成員';

    await window.renderDynamicModules(user);
    await window.fetchAndRenderGroupMembers();
    
    window.checkUnreadMessages(user);
    window.checkGalleryUnreads(user);
    window.checkCalendarAlerts(user); 
    window.checkWidgetData(user); 
    
    const allowedMenus = user.menus || ['chat', 'calendar', 'finance', 'photodump', 'gamezone', 'todo'];
    if (allowedMenus.includes('photodump')) window.fetchAndRenderPhotoCarousel(user);
};

window.renderDynamicModules = async function(user) {
    const sideList = document.getElementById('sideMenuFeatureList');
    const chatContainer = document.getElementById('chatMainCardContainer');
    const miniCardsContainer = document.getElementById('miniCardsContainer'); 
    const dockContainer = document.getElementById('bottomDockContainer');
    
    sideList.innerHTML = ''; 
    chatContainer.innerHTML = ''; 
    
    const defaultAllowed = ['chat', 'calendar', 'finance', 'photodump', 'gamezone', 'todo']; 
    const allowedMenus = user.menus || defaultAllowed;
    let modules = {}, order = [];
    try {
        const userConfigDoc = await getDoc(doc(db, "userSettings", user.name));
        if (userConfigDoc.exists()) {
            const data = userConfigDoc.data();
            if (data.modules) modules = data.modules;
            if (data.order && Array.isArray(data.order)) order = data.order.filter(k => allowedMenus.includes(k));
        }
        allowedMenus.forEach(k => { if (!order.includes(k)) order.push(k); });
    } catch (e) { order = [...allowedMenus]; }

    const sideMenuTemplates = {
        chat: `<div class="sidebar-item" onclick="window.navTo('chat.html', '聊天室')"><span class="sidebar-icon">💬</span>聊天室</div>`,
        checkin: `<div class="sidebar-item" onclick="window.navTo('checkin.html', '到家打卡')"><span class="sidebar-icon">📍</span>到家打卡</div>`,
        calendar: `<div class="sidebar-item" onclick="window.navTo('calendar.html', '行事曆')"><span class="sidebar-icon">📅</span>行事曆</div>`,
        photodump: `<div class="sidebar-item" onclick="window.navTo('gallery.html', 'Photo Dump')"><span class="sidebar-icon">📸</span>Photo Dump <span id="sideGalleryBadge" style="margin-left:auto; background:var(--danger); color:white; font-size:11px; padding:2px 8px; border-radius:10px; display:none;"></span></div>`,
        gamezone: `<div class="sidebar-item" onclick="window.navTo('games.html', '遊戲區')"><span class="sidebar-icon">🎮</span>遊戲區</div>`,
        wishlist: `<div class="sidebar-item" onclick="window.navTo('wishwall.html', '許願牆')"><span class="sidebar-icon">✨</span>許願牆</div>`,
        finance: `<div class="sidebar-item" onclick="window.navTo('expense.html', '記帳本')"><span class="sidebar-icon">💰</span>記帳本</div>`,
        todo: `<div class="sidebar-item" onclick="window.navTo('todo.html', '待辦事項')"><span class="sidebar-icon">📋</span>待辦事項</div>`
    };
    
    order.forEach(modKey => { if (allowedMenus.includes(modKey) && sideMenuTemplates[modKey]) sideList.innerHTML += sideMenuTemplates[modKey]; });
    
    if (user.role === 'admin' || user.role === 'parent') {
        sideList.innerHTML += `<div class="sidebar-item" onclick="window.navTo('admin.html', '管理者後台')" style="color:#1d4ed8;"><span class="sidebar-icon">🛡️</span>管理者後台</div>`;
    }

    // 【新增修改】在功能導覽最後面，加上「切換群組」的按鈕
    sideList.innerHTML += `<div class="sidebar-item" onclick="window.switchGroup()" style="color:#f59e0b;"><span class="sidebar-icon">🔄</span>切換群組</div>`;

    if (miniCardsContainer) {
        let miniCardsHtml = '';
        
        if (allowedMenus.includes('todo')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('todo.html', '待辦事項')" style="grid-column: 1 / -1; min-height: auto; padding-bottom: 16px;">
                    <div class="mini-widget-icon-bg">📋</div>
                    <div class="mini-widget-header" style="margin-bottom: 12px;">
                        <div class="mini-widget-icon">📋</div>
                        <div class="mini-widget-title">待辦清單</div>
                    </div>
                    <div id="todoWidgetContent" style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto; padding-right:4px;">
                        <div style="font-size: 13px; color: var(--text-sub);">連線取得中...</div>
                    </div>
                </div>
            `;
        }
        
        if (allowedMenus.includes('finance')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('expense.html', '記帳本')">
                    <div class="mini-widget-icon-bg">💰</div>
                    <div class="mini-widget-header">
                        <div class="mini-widget-icon">💰</div>
                        <div class="mini-widget-title">記帳本</div>
                    </div>
                    <div class="mini-widget-value" id="financeWidgetValue">載入中...</div>
                    <div class="mini-widget-sub" id="financeWidgetSub">連線取得中</div>
                </div>
            `;
        }
        
        if (allowedMenus.includes('chat') && modules.chat !== false) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('chat.html', '聊天室')">
                    <div class="mini-widget-icon-bg">💬</div>
                    <div class="mini-widget-header">
                        <div class="mini-widget-icon">💬</div>
                        <div class="mini-widget-title">聊天室</div>
                        <div class="notification-badge" id="chatBadge" style="position:absolute; top:12px; right:12px; left:auto; display:none;">0</div>
                    </div>
                    <div class="mini-widget-value">進入群聊</div>
                    <div class="mini-widget-sub">與成員保持聯繫</div>
                </div>
            `;
        }

        if (miniCardsHtml) {
            miniCardsContainer.innerHTML = miniCardsHtml;
            miniCardsContainer.style.display = 'grid';
        } else {
            miniCardsContainer.style.display = 'none';
        }
    }

    let dockHtml = `<div class="dock-item" onclick="window.scrollTo({top:0, behavior:'smooth'});" title="主頁">🏠</div>`;
    const dockMap = {
        calendar: `<div class="dock-item" onclick="window.navTo('calendar.html', '行事曆')" title="行事曆">📅</div>`,
        chat: `<div class="dock-item" onclick="window.navTo('chat.html', '聊天室')" title="聊天室">💬</div>`,
        photodump: `<div class="dock-item" onclick="window.navTo('gallery.html', 'Photo Dump')" title="Photo Dump">📸</div>`,
        todo: `<div class="dock-item" onclick="window.navTo('todo.html', '待辦事項')" title="待辦">📋</div>`,
        finance: `<div class="dock-item" onclick="window.navTo('expense.html', '記帳本')" title="記帳本">💰</div>`,
        checkin: `<div class="dock-item" onclick="window.navTo('checkin.html', '到家打卡')" title="打卡">📍</div>`,
        gamezone: `<div class="dock-item" onclick="window.navTo('games.html', '遊戲區')" title="遊戲區">🎮</div>`,
        wishlist: `<div class="dock-item" onclick="window.navTo('wishwall.html', '許願牆')" title="許願牆">⭐</div>`
    };
    
    order.forEach(modKey => {
        if (allowedMenus.includes(modKey) && dockMap[modKey]) {
            dockHtml += dockMap[modKey];
        }
    });
    dockContainer.innerHTML = dockHtml;
};

// ... 底下包含您原來的 checkWidgetData, checkUnreadMessages, checkGalleryUnreads 等所有函數均無需更改 ...
window.checkWidgetData = function(user) { /* ... 原本的程式碼 ... */ };
window.checkUnreadMessages = function(user) { /* ... 原本的程式碼 ... */ };
window.checkGalleryUnreads = function(user) { /* ... 原本的程式碼 ... */ };
window.checkCalendarAlerts = function(user) { /* ... 原本的程式碼 ... */ };
window.renderAgendaUI = function() { /* ... 原本的程式碼 ... */ };
window.fetchAndRenderPhotoCarousel = function(user) { /* ... 原本的程式碼 ... */ };
window.togglePhotoLike = async function(photoId) { /* ... 原本的程式碼 ... */ };
