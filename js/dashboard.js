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

    if (miniCardsContainer) {
        let miniCardsHtml = '';
        if (allowedMenus.includes('todo')) {
            miniCardsHtml += `
                <div class="mini-widget" onclick="window.navTo('todo.html', '待辦事項')">
                    <div class="mini-widget-icon-bg">📋</div>
                    <div class="mini-widget-header">
                        <div class="mini-widget-icon">📋</div>
                        <div class="mini-widget-title">待辦清單</div>
                    </div>
                    <div class="mini-widget-value" id="todoWidgetValue">載入中...</div>
                    <div class="mini-widget-sub" id="todoWidgetSub">連線取得中</div>
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
        if (miniCardsHtml) {
            miniCardsContainer.innerHTML = miniCardsHtml;
            miniCardsContainer.style.display = 'grid';
        } else {
            miniCardsContainer.style.display = 'none';
        }
    }
    
    if (allowedMenus.includes('chat') && modules.chat !== false) {
        chatContainer.innerHTML = `
            <div class="card-hero" onclick="window.navTo('chat.html', '聊天室')" style="margin-top: 12px;">
                <div class="notification-badge" id="chatBadge">0</div>
                <div>
                    <div style="font-size: 18px; font-weight: 800; margin-bottom: 4px; letter-spacing: 0.5px;">聊天室</div>
                    <div style="font-size: 13px; color: var(--text-sub); font-weight: 500;">隨時隨地與群組保持聯絡</div>
                </div>
                <div class="dash-icon">💬</div>
            </div>
        `;
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

window.checkWidgetData = function(user) {
    if (!window.currentGroup) return;
    const groupId = window.currentGroup.id;

    // 1. 抓取待辦事項
    if (document.getElementById('todoWidgetValue')) {
        const todoQ = query(collection(db, "todos"), where("groupId", "==", groupId));
        todoUnsubscribe = onSnapshot(todoQ, (snap) => {
            let incompleteTodos = [];
            snap.forEach(docSnap => {
                const d = docSnap.data();
                const isDone = (d.isCompleted === true || d.completed === true);
                if (!isDone) incompleteTodos.push(d);
            });
            let count = incompleteTodos.length;
            let firstTodo = count > 0 ? (incompleteTodos[0].title || incompleteTodos[0].text || incompleteTodos[0].task || "未命名任務") : "";
            
            const valEl = document.getElementById('todoWidgetValue');
            const subEl = document.getElementById('todoWidgetSub');
            if (valEl) {
                if (count > 0) {
                    valEl.innerText = `${count} 項待辦`;
                    subEl.innerText = `${firstTodo}`;
                } else {
                    valEl.innerText = `太棒了！`;
                    subEl.innerText = `目前無待辦事項`;
                }
            }
        }, (err) => { console.log("待辦讀取錯誤", err); });
    }

    // 2. 抓取本月記帳總計 (修正為 expenses)
    if (document.getElementById('financeWidgetValue')) {
        const now = new Date();
        const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        
        // 修正：從 "records" 改為 "expenses"
        const expQ = query(collection(db, "expenses"), where("groupId", "==", groupId));
        
        financeUnsubscribe = onSnapshot(expQ, (snap) => {
            let totalExpense = 0;
            snap.forEach(docSnap => {
                const data = docSnap.data();
                const dateStr = String(data.date || data.createdAt || '');
                const typeVal = String(data.type || 'expense');
                
                const isThisMonth = dateStr.includes(currentYearMonth) || !dateStr;
                if (isThisMonth) {
                    // 只統計支出項目
                    if (typeVal === 'expense' || typeVal === '支出' || !data.type) {
                        // 修正：以 data.amount 為主，如果有其他命名也可相容
                        totalExpense += Number(data.amount || data.price || 0);
                    }
                }
            });
            
            const valEl = document.getElementById('financeWidgetValue');
            const subEl = document.getElementById('financeWidgetSub');
            
            if (valEl) {
                valEl.innerText = `$${totalExpense.toLocaleString()}`;
                subEl.innerText = `本月累計支出`;
            }
        }, (err) => { console.log("記帳讀取錯誤", err); });
    }
};

window.checkUnreadMessages = function(user) {
    try {
        if (!window.currentGroup) return;
        const q = query(collection(db, "rooms"), where("groupId", "==", window.currentGroup.id), where("participants", "array-contains", user.name));
        unreadUnsubscribe = onSnapshot(q, (querySnapshot) => {
            let totalUnreadMessages = 0;
            querySnapshot.forEach(docSnap => {
                const room = docSnap.data();
                if (room.unreadCount && room.unreadCount[user.name]) totalUnreadMessages += room.unreadCount[user.name];
                else {
                    let lastMsgTime = room.lastMessageTime?.toDate?.()?.getTime() || 0;
                    let myReadTime = room.readTimestamps?.[user.name] || 0;
                    const hasLastMessage = room.lastMessage && room.lastMessage.trim() !== '';
                    const isLastMsgMine = hasLastMessage && room.lastMessage.startsWith(`${user.name}:`);
                    if (hasLastMessage && lastMsgTime > myReadTime && !isLastMsgMine) totalUnreadMessages++;
                }
            });
            const badge = document.getElementById('chatBadge');
            if (badge) { if (totalUnreadMessages > 0) { badge.style.display = 'block'; badge.innerText = totalUnreadMessages > 99 ? '99+' : totalUnreadMessages; } else badge.style.display = 'none'; }
        });
    } catch (e) {}
};

window.checkGalleryUnreads = function(user) {
    try {
        if (!window.currentGroup) return;
        let lastReadTime = parseInt(localStorage.getItem('homebase_photodump_last_read') || '0', 10);
        if (lastReadTime === 0) lastReadTime = Date.now() - (7 * 24 * 60 * 60 * 1000); 
        const lastReadDate = new Date(lastReadTime);
        const q = query(collection(db, "photos"), where("groupId", "==", window.currentGroup.id), where("timestamp", ">", lastReadDate));
        galleryUnsubscribe = onSnapshot(q, (snapshot) => {
            let unreadCount = 0;
            snapshot.forEach(docSnap => {
                const photo = docSnap.data();
                if (photo.uploader !== user.name) unreadCount++;
            });
            const sideBadge = document.getElementById('sideGalleryBadge');
            if (sideBadge) { if (unreadCount > 0) { sideBadge.style.display = 'inline-block'; sideBadge.innerText = `+${unreadCount}`; } else sideBadge.style.display = 'none'; }
        });
    } catch (e) {}
};

window.checkCalendarAlerts = function(user) {
    if (!window.currentGroup) return;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    try {
        const q = query(collection(db, "events"), where("groupId", "==", window.currentGroup.id), where("date", "==", todayStr));
        calendarUnsubscribe = onSnapshot(q, (snapshot) => {
            cachedCalendarEvents = [];
            snapshot.forEach(docSnap => {
                const evt = docSnap.data();
                if (evt.visibility === 'public' || evt.operator === user.name) cachedCalendarEvents.push(evt);
            });
            window.renderAgendaUI();
        });
        calendarUIRenderInterval = setInterval(window.renderAgendaUI, 60000); 
    } catch (e) { console.error("行事曆錯誤:", e) }
};

window.renderAgendaUI = function() {
    const categoryIcons = { school: '🏫', company: '💼', restaurant: '🍽', birthday: '🎂', personal: '👤', other: '📌' };
    const now = new Date();
    const weekDays = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    const dateTitle = `${now.getMonth()+1}月${now.getDate()}日 (${weekDays[now.getDay()]})`;
    
    let activeIcons = [], validEvents = [];
    
    cachedCalendarEvents.forEach(evt => {
        let start = new Date(now), end = new Date(now), isExpired = false;
        if (evt.isAllDay !== false) { start.setHours(0,0,0,0); end.setHours(23,59,59,999); } 
        else {
            if(evt.startTime) { const [sh, sm] = evt.startTime.split(':'); start.setHours(sh, sm, 0, 0); }
            if(evt.endTime) { const [eh, em] = evt.endTime.split(':'); end.setHours(eh, em, 0, 0); if (now > end) isExpired = true; }
        }
        if (!isExpired) {
            validEvents.push(evt);
            let triggerTime = new Date(start);
            if (evt.reminderUnit === 'minutes') triggerTime.setMinutes(triggerTime.getMinutes() - (evt.reminderValue || 0));
            else if (evt.reminderUnit === 'hours') triggerTime.setHours(triggerTime.getHours() - (evt.reminderValue || 0));
            if (now >= triggerTime && now <= end) activeIcons.push(categoryIcons[evt.category] || '📌');
        }
    });

    const agendaContainer = document.getElementById('todayAgendaContainer');
    if (!agendaContainer) return;

    let listHtml = '';
    if (validEvents.length > 0) {
        validEvents.sort((a, b) => {
            if (a.isAllDay && !b.isAllDay) return -1; if (!a.isAllDay && b.isAllDay) return 1;
            if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime); return 0;
        });
        listHtml = validEvents.map(evt => {
            let timeStr = (evt.isAllDay !== false) ? '全天' : `${evt.startTime} - ${evt.endTime}`;
            const avatar = window.userAvatarMap[evt.operator] || `https://ui-avatars.com/api/?name=${evt.operator}&background=e5e7eb`;
            return `<div class="agenda-item"><div class="agenda-time">${timeStr}</div><div class="agenda-divider"></div><div class="agenda-title">${evt.title}</div><img class="agenda-avatar" src="${avatar}"></div>`;
        }).join('');
        
        agendaContainer.innerHTML = `
            <div class="agenda-card" onclick="localStorage.setItem('calendar_target_date', '${todayStr}'); window.navTo('calendar.html', '行事曆');">
                <div class="agenda-header">
                    <div class="agenda-date">${dateTitle}</div>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <div style="font-size:16px;">${activeIcons.map(icon => `<span>${icon}</span>`).join('')}</div>
                        <div class="agenda-count">今天有 ${validEvents.length} 個行程</div>
                    </div>
                </div>
                <div class="agenda-list">${listHtml}</div>
            </div>`;
    } else {
        agendaContainer.innerHTML = `
            <div class="agenda-card" style="padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;" onclick="localStorage.setItem('calendar_target_date', '${todayStr}'); window.navTo('calendar.html', '行事曆');">
                <div>
                    <div class="agenda-date" style="font-size: 15px;">${dateTitle}</div>
                    <div style="font-size: 13px; color: var(--text-sub); margin-top: 4px; font-weight:600;">今日無行程安排 ☕</div>
                </div>
                <div class="dash-icon" style="background: var(--bg-body); border:1px solid var(--border-color); width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 20px; color:var(--text-main);">📅</div>
            </div>`;
    }
};

window.fetchAndRenderPhotoCarousel = function(user) {
    if (!window.currentGroup) return;
    const q = query(collection(db, "photos"), where("groupId", "==", window.currentGroup.id), orderBy("timestamp", "desc"), limit(5));
    onSnapshot(q, (snapshot) => {
        const section = document.getElementById('photoCarouselSection');
        const container = document.getElementById('photoCarouselContainer');
        if (snapshot.empty) { section.style.display = 'none'; return; }
        section.style.display = 'block'; let html = '';
        snapshot.forEach(docSnap => {
            const photo = docSnap.data(); const photoId = docSnap.id;
            const dateObj = photo.timestamp ? photo.timestamp.toDate() : new Date();
            const dateStr = `${dateObj.getMonth()+1}/${dateObj.getDate()} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;
            const uploaderAvatar = window.userAvatarMap[photo.uploader] || `https://ui-avatars.com/api/?name=${photo.uploader}&background=e5e7eb`;
            let displayImageUrl = '';
            if (photo.imageUrls && Array.isArray(photo.imageUrls) && photo.imageUrls.length > 0) displayImageUrl = photo.imageUrls[0]; 
            else displayImageUrl = photo.url || photo.imageUrl || photo.image || photo.photoUrl || '';
            const likes = photo.likes || []; const isLiked = likes.includes(user.name); const likeCount = likes.length;
            if (displayImageUrl) {
                html += `
                    <div class="carousel-item">
                        <img class="carousel-img" src="${displayImageUrl}" onerror="this.style.display='none';" onclick="localStorage.setItem('target_photo_id', '${photoId}'); window.navTo('gallery.html', 'Photo Dump');">
                        <div class="carousel-info">
                            <div class="carousel-author">
                                <img class="carousel-author-img" src="${uploaderAvatar}">
                                <div>
                                    <div class="carousel-author-name">${photo.uploader}</div>
                                    <div class="carousel-date">${dateStr}</div>
                                </div>
                            </div>
                            <div class="carousel-actions">
                                <button class="like-btn ${isLiked ? 'liked' : ''}" onclick="togglePhotoLike('${photoId}')">${isLiked ? '❤️' : '♡'} <span class="like-count">${likeCount > 0 ? likeCount : '讚'}</span></button>
                            </div>
                        </div>
                    </div>`;
            }
        });
        container.innerHTML = html;
    });
};

window.togglePhotoLike = async function(photoId) {
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    try {
        const photoRef = doc(db, "photos", photoId);
        const photoSnap = await getDoc(photoRef);
        if (photoSnap.exists()) {
            let likes = photoSnap.data().likes || [];
            if (likes.includes(user.name)) likes = likes.filter(n => n !== user.name); else likes.push(user.name); 
            await updateDoc(photoRef, { likes: likes });
        }
    } catch(e) {}
};
