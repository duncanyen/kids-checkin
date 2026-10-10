import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// 引入其他模組確保他們的功能綁定在 window 上
import "./auth.js";
import "./group.js";
import "./dashboard.js";

// 定義全域狀態變數
window.currentGroup = null; 
window.selectedPresetIcon = '🏠';
window.userAvatarMap = {};
window.groupMembers = []; 

// 側邊選單控制
window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('sidebarOverlay').classList.toggle('active');
};

// 頭像上傳相關
window.triggerAvatarUpload = function() { document.getElementById('avatarUploadInput').click(); };
document.getElementById('avatarUploadInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('loadingView').style.display = 'flex';
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 300; 
            let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } 
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            try {
                const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
                if (user.docId) {
                    await updateDoc(doc(db, "users", user.docId), { avatar: dataUrl });
                    user.avatar = dataUrl;
                    sessionStorage.setItem('familyCheckInUser', JSON.stringify(user));
                    document.getElementById('dashUserAvatar').src = user.avatar;
                    document.getElementById('sideAvatar').src = user.avatar;
                    alert("頭像更新成功！");
                }
            } catch (err) {}
            document.getElementById('loadingView').style.display = 'none';
            document.getElementById('avatarUploadInput').value = '';
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// 【核心修改】抓取群組成員改以 accountId 查詢
window.fetchAndRenderGroupMembers = async function() {
    try {
        if (!window.currentGroup || !window.currentGroup.members || !Array.isArray(window.currentGroup.members) || window.currentGroup.members.length === 0) return;
        const memberIdentifiers = window.currentGroup.members; // 此處現在裝的是 accountId
        window.groupMembers = [];
        
        for (let i = 0; i < memberIdentifiers.length; i += 10) {
            const chunk = memberIdentifiers.slice(i, i + 10);
            
            // 雙重防護查詢：優先用 accountId 查，若舊資料有混用 name 也能兼容查詢
            const qId = query(collection(db, "users"), where("accountId", "in", chunk));
            const snapId = await getDocs(qId);
            snapId.forEach(docSnap => {
                let u = docSnap.data();
                window.userAvatarMap[u.accountId] = u.avatar;
                window.userAvatarMap[u.name] = u.avatar; // 相容舊對應
                if (!window.groupMembers.some(m => m.accountId === u.accountId)) {
                    window.groupMembers.push(u);
                }
            });

            const qName = query(collection(db, "users"), where("name", "in", chunk));
            const snapName = await getDocs(qName);
            snapName.forEach(docSnap => {
                let u = docSnap.data();
                window.userAvatarMap[u.accountId] = u.avatar;
                window.userAvatarMap[u.name] = u.avatar;
                if (!window.groupMembers.some(m => m.accountId === u.accountId)) {
                    window.groupMembers.push(u);
                }
            });
        }

        const sideList = document.getElementById('sideMembersList');
        if (sideList) {
            sideList.innerHTML = window.groupMembers.map(u => `
                <div class="member-avatar-container">
                    <img class="member-avatar" src="${u.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${u.name}&background=10b981&color=fff'">
                    <div class="member-name">${u.name}</div>
                </div>
            `).join('');
        }
    } catch (e) { console.error("抓取群組成員失敗: ", e); }
};

// 聯絡表單
window.openContactModal = function() { window.toggleSidebar(); document.getElementById('contactModal').style.display = 'flex'; };
window.closeContactModal = function() { document.getElementById('contactModal').style.display = 'none'; };
window.submitContact = async function() {
    const type = document.getElementById('contactType').value;
    const email = document.getElementById('contactEmail').value.trim();
    const content = document.getElementById('contactContent').value.trim();
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    if (!email || !content) { alert("請完整填寫資訊！"); return; }
    document.getElementById('loadingView').style.display = 'flex';
    try {
        await addDoc(collection(db, "feedbacks"), { userName: user.name, type: type, email: email, content: content, timestamp: serverTimestamp() });
        alert("感謝您的回饋！"); window.closeContactModal();
    } catch (e) { alert("送出失敗。"); }
    document.getElementById('loadingView').style.display = 'none';
};

window.rateApp = function() { window.toggleSidebar(); alert("感謝您的支持！"); };
window.shareApp = async function() {
    window.toggleSidebar();
    try {
        if (navigator.share) await navigator.share({ title: 'Nexus', url: window.location.href });
        else { await navigator.clipboard.writeText(window.location.href); alert("已複製連結！"); }
    } catch (err) {}
};

// 動態模組渲染邏輯，導入 Bento Box 網格系統
window.renderDynamicModules = async function(user) {
    const sideList = document.getElementById('sideMenuFeatureList');
    const chatContainer = document.getElementById('chatMainCardContainer');
    const miniCardsContainer = document.getElementById('miniCardsContainer'); 
    const dockContainer = document.getElementById('bottomDockContainer');
    
    sideList.innerHTML = ''; 
    chatContainer.innerHTML = ''; 
    
    const defaultAllowed = ['chat', 'calendar', 'finance', 'photodump', 'gamezone', 'todo', 'food']; 
    const allowedMenus = user.menus || defaultAllowed;
    let modules = {}, order = [];
    try {
        const userConfigDoc = await getDoc(doc(db, "userSettings", user.accountId || user.name));
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
        todo: `<div class="sidebar-item" onclick="window.navTo('todo.html', '待辦事項')"><span class="sidebar-icon">📋</span>待辦事項</div>`,
        food: `<div class="sidebar-item" onclick="window.navTo('food-decision.html', '吃什麼？')"><span class="sidebar-icon">🍽️</span>吃什麼？</div>`
    };
    
    order.forEach(modKey => { if (allowedMenus.includes(modKey) && sideMenuTemplates[modKey]) sideList.innerHTML += sideMenuTemplates[modKey]; });
    
    if (user.role === 'admin' || user.role === 'parent') {
        sideList.innerHTML += `<div class="sidebar-item" onclick="window.navTo('admin.html', '管理者後台')" style="color:#1d4ed8;"><span class="sidebar-icon">🛡️</span>管理者後台</div>`;
    }
    sideList.innerHTML += `<div class="sidebar-item" onclick="window.switchGroup()" style="color:#f59e0b; font-weight: bold;"><span class="sidebar-icon">🔄</span>切換群組</div>`;

    if (miniCardsContainer) {
        let miniCardsHtml = '';
        
        if (allowedMenus.includes('chat') && modules.chat !== false) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('chat.html', '聊天室')" style="grid-column: 1 / -1; display: flex; flex-direction: row; align-items: center; justify-content: space-between; min-height: 80px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div class="mini-widget-icon" style="background: #e0f2fe; color: #0284c7;">💬</div>
                        <div>
                            <div class="mini-widget-title" style="font-size: 16px;">群組聊天室</div>
                            <div class="mini-widget-sub" style="margin-top: 2px;">點擊進入與成員保持聯繫</div>
                        </div>
                    </div>
                    <div class="notification-badge" id="chatBadge" style="position: relative; top: auto; right: auto; left: auto; display: none;">0</div>
                </div>
            `;
        }

        if (allowedMenus.includes('finance')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('expense.html', '記帳本')">
                    <div class="mini-widget-header">
                        <div class="mini-widget-icon" style="background: #dcfce7; color: #16a34a;">💰</div>
                        <div class="mini-widget-title">記帳本</div>
                    </div>
                    <div>
                        <div class="mini-widget-value" id="financeWidgetValue">...</div>
                        <div class="mini-widget-sub" id="financeWidgetSub">本月累計支出</div>
                    </div>
                </div>
            `;
        }
        
        if (allowedMenus.includes('food')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('food-decision.html', '吃什麼？')">
                    <div class="mini-widget-header">
                        <div class="mini-widget-icon" style="background: #fef08a; color: #ca8a04;">🍽️</div>
                        <div class="mini-widget-title">吃什麼？</div>
                    </div>
                    <div>
                        <div class="mini-widget-value" style="font-size: 16px;">票選進行中</div>
                        <div class="mini-widget-sub">點擊決定下一餐</div>
                    </div>
                </div>
            `;
        }

        if (allowedMenus.includes('todo')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('todo.html', '待辦事項')" style="grid-column: 1 / -1; min-height: auto; padding-bottom: 20px;">
                    <div class="mini-widget-header" style="margin-bottom: 16px;">
                        <div class="mini-widget-icon" style="background: #f3f4f6; color: #4b5563;">📋</div>
                        <div class="mini-widget-title">待辦清單</div>
                    </div>
                    <div id="todoWidgetContent" style="display:flex; flex-direction:column; gap:10px; max-height:220px; overflow-y:auto; padding-right:4px;">
                        <div style="font-size: 13px; color: var(--text-sub);">連線取得中...</div>
                    </div>
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
        wishlist: `<div class="dock-item" onclick="window.navTo('wishwall.html', '許願牆')" title="許願牆">⭐</div>`,
        food: `<div class="dock-item" onclick="window.navTo('food-decision.html', '吃什麼？')" title="吃什麼">🍽️</div>`
    };
    
    order.forEach(modKey => {
        if (allowedMenus.includes(modKey) && dockMap[modKey]) {
            dockHtml += dockMap[modKey];
        }
    });
    dockContainer.innerHTML = dockHtml;
};

// 初始化主流程
async function initializeAppFlow() {
    if (typeof window.processPendingLogs === 'function') {
        window.processPendingLogs();
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('code');
    if (inviteCode) {
        localStorage.setItem('pendingInviteCode', inviteCode);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    
    const savedUserStr = sessionStorage.getItem('familyCheckInUser');
    if (savedUserStr) {
        document.getElementById('loadingView').style.display = 'flex';
        try {
            const savedUser = JSON.parse(savedUserStr);
            // 優先透過 accountId 進行校驗，若無則相容用 name 查詢
            let q;
            if (savedUser.accountId) {
                q = query(collection(db, "users"), where("accountId", "==", savedUser.accountId));
            } else {
                q = query(collection(db, "users"), where("name", "==", savedUser.name));
            }
            
            const snap = await getDocs(q);
            
            if (snap.empty) {
                alert("此帳號已失效或被刪除，請重新登入。");
                sessionStorage.removeItem('familyCheckInUser');
                sessionStorage.removeItem('nexus_active_group_id');
                if (typeof window.showAuthSection === 'function') window.showAuthSection();
            } else {
                const latestUser = snap.docs[0].data();
                latestUser.docId = snap.docs[0].id;
                sessionStorage.setItem('familyCheckInUser', JSON.stringify(latestUser));

                const savedGroupId = sessionStorage.getItem('nexus_active_group_id');
                if (savedGroupId) {
                    window.currentGroup = { id: savedGroupId };
                    if (typeof window.showDashboard === 'function') {
                        await window.showDashboard();
                    }
                } else {
                    if (typeof window.evaluateUserGroups === 'function') {
                        await window.evaluateUserGroups(latestUser); 
                    }
                }
            }
        } catch (e) { 
            console.error("初始化失敗: ", e);
            if (typeof window.showAuthSection === 'function') window.showAuthSection(); 
        } finally {
            document.getElementById('loadingView').style.display = 'none';
        }
    } else { 
        document.getElementById('loadingView').style.display = 'none';
        if (typeof window.showAuthSection === 'function') window.showAuthSection(); 
    }
}

if (document.readyState === 'loading') { 
    document.addEventListener('DOMContentLoaded', initializeAppFlow); 
} else { 
    initializeAppFlow(); 
}
