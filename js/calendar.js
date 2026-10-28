import { icon as uiIcon } from './ui-icons.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { 
    getFirestore, collection, addDoc, updateDoc, deleteDoc, doc, 
    onSnapshot, serverTimestamp, query, where 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCj3XrBxi1c3RokMzCIhEB3hjJB-BPuO9Y",
    authDomain: "homebasedb.firebaseapp.com",
    projectId: "homebasedb",
    storageBucket: "homebasedb.firebasestorage.app",
    messagingSenderId: "476832900272",
    appId: "1:476832900272:web:443bacb7cbc3113e9f8775"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let currentUser = null;
let currentGroupId = localStorage.getItem('lastGroupId');

// 視圖狀態管理
let currentView = 'month'; // 'month', 'week', 'day'
let enabledViews = ['month', 'week', 'day']; // 儲存設定中啟用的視圖

let viewDate = new Date(); // 用於月、週、日視圖的基準時間
let selectedDateKey = '';
let allFetchedEvents = [];
let editingEventId = null;

const categoryIcons = { school: 'school', company: 'briefcase', restaurant: 'food', birthday: 'cake', personal: 'user', other: 'pin' };

const publicHolidays = {
    "01-01": "元旦", "02-28": "和平紀念日", "04-04": "兒童節", 
    "04-05": "清明節", "05-01": "勞動節", "10-10": "國慶日"
};

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
if (!savedUserStr || !currentGroupId) {
    alert('找不到登入狀態或群組資訊，請重新登入！'); 
    window.location.href = 'index.html';
} else {
    currentUser = JSON.parse(savedUserStr);
    initCalendar();
    listenToEvents();
}

async function recordLog(actionType, detailsText) {
    try {
        const now = new Date();
        const datetimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        await addDoc(collection(db, "logs"), { 
            groupId: currentGroupId, 
            datetime: datetimeStr, 
            operator: currentUser.name, 
            actionType, 
            details: detailsText, 
            timestamp: serverTimestamp() 
        });
    } catch (e) { 
        console.error("寫入 Log 失敗:", e); 
    }
}
window.onload = async function() { await recordLog('功能瀏覽', '進入〈家庭行事曆〉'); };

function listenToEvents() {
    const q = query(
        collection(db, "events"), 
        where("groupId", "==", currentGroupId)
    );

    // 當資料庫有更新時觸發
    onSnapshot(q, (snapshot) => {
        allFetchedEvents = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.visibility === 'public' || data.operator === currentUser.name) {
                allFetchedEvents.push({ id: docSnap.id, ...data });
            }
        });
        
        // 資料更新後，重新渲染當前視圖，不改變 viewDate
        renderCurrentView();

        const targetDate = localStorage.getItem('calendar_target_date');
        if (targetDate) {
            localStorage.removeItem('calendar_target_date');
            const [tYear, tMonth] = targetDate.split('-');
            viewDate = new Date(parseInt(tYear), parseInt(tMonth) - 1, 1);
            currentView = 'month'; // 導向過去通常以月視圖為主
            renderCurrentView();
            openEventModal(targetDate);
        }

        if (document.getElementById('eventModal').style.display === 'flex' && !editingEventId) {
            renderDayEvents(selectedDateKey);
        }
    });
}

// 初始化與滑動事件
function initCalendar() {
    const swipeContainer = document.getElementById('calendarSwipeContainer');
    let touchStartX = 0;
    let touchEndX = 0;

    swipeContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    }, { passive: true });

    swipeContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipeGesture();
    }, { passive: true });

    function handleSwipeGesture() {
        const threshold = 50; 
        if (touchEndX - touchStartX > threshold) {
            // 向右滑 (前一個)
            if(currentView === 'month') viewDate.setMonth(viewDate.getMonth() - 1);
            if(currentView === 'week') viewDate.setDate(viewDate.getDate() - 7);
            if(currentView === 'day') viewDate.setDate(viewDate.getDate() - 1);
            renderCurrentView();
        } else if (touchStartX - touchEndX > threshold) {
            // 向左滑 (下一個)
            if(currentView === 'month') viewDate.setMonth(viewDate.getMonth() + 1);
            if(currentView === 'week') viewDate.setDate(viewDate.getDate() + 7);
            if(currentView === 'day') viewDate.setDate(viewDate.getDate() + 1);
            renderCurrentView();
        }
    }
    
    // 載入儲存的視圖設定
    loadSettings();
    renderCurrentView();
}

// 依據目前設定渲染畫面 (統一入口，避免多餘撈資料)
function renderCurrentView() {
    document.getElementById('monthViewContainer').style.display = 'none';
    document.getElementById('weekViewContainer').style.display = 'none';
    document.getElementById('dayViewContainer').style.display = 'none';

    const year = viewDate.getFullYear();
    const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

    if (currentView === 'month') {
        document.getElementById('calendarTitle').innerText = `${year} 年 ${monthNames[viewDate.getMonth()]}`;
        document.getElementById('monthViewContainer').style.display = 'flex';
        renderMonthView();
    } else if (currentView === 'week') {
        // 週視圖標題以 viewDate 的月份為主
        document.getElementById('calendarTitle').innerText = `${year} 年 ${monthNames[viewDate.getMonth()]}`;
        document.getElementById('weekViewContainer').style.display = 'flex';
        renderWeekView();
    } else if (currentView === 'day') {
        const dayStr = `${year}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(viewDate.getDate()).padStart(2, '0')}`;
        document.getElementById('calendarTitle').innerText = dayStr;
        document.getElementById('dayViewContainer').style.display = 'flex';
        renderDayView();
    }
}

/* ----- 1. 月視圖 ----- */
function renderMonthView() {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const weekdays = [
        { name: '週日', className: 'weekend' }, { name: '週一', className: '' },
        { name: '週二', className: '' }, { name: '週三', className: '' },
        { name: '週四', className: '' }, { name: '週五', className: '' },
        { name: '週六', className: 'weekend' }
    ];
    weekdays.forEach(w => {
        const div = document.createElement('div'); 
        div.className = `weekday ${w.className}`; div.innerText = w.name; grid.appendChild(div);
    });

    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = getFormattedDate(new Date());

    for (let i = 0; i < firstDayIndex; i++) {
        const div = document.createElement('div');
        // 補齊前方的空白格子邊框，維持整體美觀
        div.style.borderRight = "1px solid var(--border-color)";
        div.style.borderBottom = "1px solid var(--border-color)";
        grid.appendChild(div);
    }

    for (let day = 1; day <= totalDays; day++) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const cell = createDayCell(dateKey, year, month, day, todayStr);
        grid.appendChild(cell);
    }
}

/* ----- 2. 週視圖 ----- */
function renderWeekView() {
    const grid = document.getElementById('weekGrid');
    grid.innerHTML = '';
    
    // 找出本週的週日
    const currentDay = viewDate.getDay(); 
    const startOfWeek = new Date(viewDate);
    startOfWeek.setDate(viewDate.getDate() - currentDay);
    
    const todayStr = getFormattedDate(new Date());

    const weekdays = [
        { name: '週日', className: 'weekend' }, { name: '週一', className: '' },
        { name: '週二', className: '' }, { name: '週三', className: '' },
        { name: '週四', className: '' }, { name: '週五', className: '' },
        { name: '週六', className: 'weekend' }
    ];
    weekdays.forEach(w => {
        const div = document.createElement('div'); 
        div.className = `weekday ${w.className}`; div.innerText = w.name; grid.appendChild(div);
    });

    // 產出7天
    for (let i = 0; i < 7; i++) {
        const cellDate = new Date(startOfWeek);
        cellDate.setDate(startOfWeek.getDate() + i);
        const year = cellDate.getFullYear();
        const month = cellDate.getMonth();
        const day = cellDate.getDate();
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        
        const cell = createDayCell(dateKey, year, month, day, todayStr);
        cell.classList.add('week-day-cell'); // 套用置中樣式
        grid.appendChild(cell);
    }
}

/* ----- 產生格子的共用邏輯 (移除圖示只留字) ----- */
function createDayCell(dateKey, year, month, day, todayStr) {
    const dayCell = document.createElement('div');
    dayCell.className = 'day-cell';
    
    const cellDate = new Date(year, month, day);
    const dayOfWeek = cellDate.getDay(); 
    const mmdd = `${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const holidayName = publicHolidays[mmdd];

    if (dayOfWeek === 0 || dayOfWeek === 6) dayCell.classList.add('is-weekend');
    if (holidayName) dayCell.classList.add('is-holiday');
    if (dateKey === todayStr) dayCell.classList.add('today');
    else if (new Date(dateKey) < new Date(todayStr)) dayCell.classList.add('past-day');

    const headerRow = document.createElement('div');
    headerRow.className = 'day-header-row';

    const numSpan = document.createElement('span');
    numSpan.className = 'date-num'; numSpan.innerText = day;
    headerRow.appendChild(numSpan);

    if (holidayName) {
        const tag = document.createElement('span');
        tag.className = 'holiday-tag'; tag.innerText = holidayName; headerRow.appendChild(tag);
    }

    dayCell.appendChild(headerRow);

    const dayEvts = allFetchedEvents.filter(e => e.date === dateKey);
    
    // 需求：只保留字，移除分類圖示
    dayEvts.slice(0, 3).forEach(evt => {
        const badge = document.createElement('span');
        const isExpired = isEventExpired(evt, dateKey);
        badge.className = `event-badge ${evt.visibility || 'public'} ${isExpired ? 'expired' : ''}`;
        // 這裡只放入 title
        badge.innerText = `${evt.title}`;
        dayCell.appendChild(badge);
    });

    if (dayEvts.length > 3) {
        const moreBadge = document.createElement('div');
        moreBadge.className = 'more-badge';
        moreBadge.innerText = `+${dayEvts.length - 3}`;
        dayCell.appendChild(moreBadge);
    }

    dayCell.addEventListener('click', () => openEventModal(dateKey));
    return dayCell;
}

/* ----- 3. 日視圖 ----- */
function renderDayView() {
    const timeline = document.getElementById('dayTimeline');
    timeline.innerHTML = '';
    
    const dateKey = getFormattedDate(viewDate);
    const dayEvts = allFetchedEvents.filter(e => e.date === dateKey);

    // 產生 0 到 23 時的時間軸
    for (let i = 0; i < 24; i++) {
        const slot = document.createElement('div');
        slot.className = 'time-slot';
        
        const label = document.createElement('div');
        label.className = 'time-label';
        label.innerText = `${i === 0 ? '12 AM' : i < 12 ? i + ' AM' : i === 12 ? '12 PM' : (i - 12) + ' PM'}`;
        
        const content = document.createElement('div');
        content.className = 'time-content';
        
        // 填入行程 (非全天且在此小時，或全天行程放頂部)
        dayEvts.forEach(evt => {
            if (evt.isAllDay !== false && i === 0) {
                // 全天行程放在 0點
                const evDiv = document.createElement('div');
                evDiv.className = `day-view-event ${evt.visibility || 'public'}`;
                evDiv.innerText = `[全天] ${evt.title}`;
                evDiv.onclick = () => openEventModal(dateKey);
                content.appendChild(evDiv);
            } else if (evt.isAllDay === false && evt.startTime) {
                const evtHour = parseInt(evt.startTime.split(':')[0]);
                if (evtHour === i) {
                    const evDiv = document.createElement('div');
                    evDiv.className = `day-view-event ${evt.visibility || 'public'}`;
                    evDiv.innerText = `${evt.startTime} ${evt.title}`;
                    evDiv.onclick = () => openEventModal(dateKey);
                    content.appendChild(evDiv);
                }
            }
        });

        slot.appendChild(label);
        slot.appendChild(content);
        timeline.appendChild(slot);
    }

    // 檢查是否為「今天」，是的話畫紅線並捲動
    if (dateKey === getFormattedDate(new Date())) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        
        // 每個 slot 假設高度為 60px (對應CSS .time-slot min-height)
        const topPos = (currentHour * 60) + currentMin; 
        
        const line = document.createElement('div');
        line.className = 'current-time-line';
        line.style.top = `${topPos}px`;
        timeline.appendChild(line);

        // 自動捲動到現在時間附近 (置中對齊)
        setTimeout(() => {
            timeline.scrollTop = topPos - (timeline.clientHeight / 2);
        }, 100);
    } else {
         timeline.scrollTop = 0;
    }
}

/* --- 視圖切換邏輯 --- */
document.getElementById('btnToggleView').addEventListener('click', () => {
    if (enabledViews.length === 0) {
        alert('請至設定勾選至少一種視圖'); return;
    }
    
    // 找下一個有啟用的視圖
    const order = ['month', 'week', 'day'];
    let currentIndex = order.indexOf(currentView);
    
    let found = false;
    for(let i = 1; i <= 3; i++) {
        let nextIndex = (currentIndex + i) % 3;
        if (enabledViews.includes(order[nextIndex])) {
            currentView = order[nextIndex];
            found = true;
            break;
        }
    }
    
    if(found) renderCurrentView();
});

/* --- 視圖設定邏輯 --- */
function loadSettings() {
    const saved = localStorage.getItem('calendar_views');
    if (saved) {
        enabledViews = JSON.parse(saved);
        document.getElementById('settingViewMonth').checked = enabledViews.includes('month');
        document.getElementById('settingViewWeek').checked = enabledViews.includes('week');
        document.getElementById('settingViewDay').checked = enabledViews.includes('day');
    }
}

document.getElementById('btnSettings').addEventListener('click', () => {
    document.getElementById('settingsModal').style.display = 'flex';
});

document.getElementById('btnSaveSettings').addEventListener('click', () => {
    enabledViews = [];
    if(document.getElementById('settingViewMonth').checked) enabledViews.push('month');
    if(document.getElementById('settingViewWeek').checked) enabledViews.push('week');
    if(document.getElementById('settingViewDay').checked) enabledViews.push('day');
    
    if (enabledViews.length === 0) {
        alert('請至少保留一個視圖模式！');
        return;
    }
    
    localStorage.setItem('calendar_views', JSON.stringify(enabledViews));
    document.getElementById('settingsModal').style.display = 'none';
    
    // 若當前視圖被取消勾選，則切換到陣列第一個啟用的視圖
    if (!enabledViews.includes(currentView)) {
        currentView = enabledViews[0];
    }
    renderCurrentView();
});


/* --- 其他輔助與原本的方法 --- */
function getFormattedDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isEventExpired(evt, dateKey) {
    const now = new Date();
    const evtDate = new Date(dateKey);
    if (evt.isAllDay !== false) { 
        evtDate.setHours(23, 59, 59); return now > evtDate;
    } else {
        if(!evt.endTime) return false;
        const [h, m] = evt.endTime.split(':');
        evtDate.setHours(h, m, 0); return now > evtDate;
    }
}

function openEventModal(dateKey) {
    selectedDateKey = dateKey;
    document.getElementById('modalDateTitle').innerText = `${dateKey} 行程`;
    showListView();
    document.getElementById('eventModal').style.display = 'flex';
}

function showListView() {
    editingEventId = null;
    document.getElementById('listView').style.display = 'block';
    document.getElementById('formView').style.display = 'none';
    document.getElementById('btnCloseModal').style.display = 'block';
    document.getElementById('btnCancelForm').style.display = 'none';
    document.getElementById('btnSaveEvent').style.display = 'none';
    renderDayEvents(selectedDateKey);
}

function showFormView(evtData = null) {
    document.getElementById('listView').style.display = 'none';
    document.getElementById('formView').style.display = 'block';
    document.getElementById('btnCloseModal').style.display = 'none';
    document.getElementById('btnCancelForm').style.display = 'block';
    document.getElementById('btnSaveEvent').style.display = 'block';

    if (evtData) {
        editingEventId = evtData.id;
        document.getElementById('evTitle').value = evtData.title || '';
        document.getElementById('evDesc').value = evtData.desc || '';
        document.getElementById('evCategory').value = evtData.category || 'other';
        document.getElementById('evVisibility').value = evtData.visibility || 'public';
        document.getElementById('evIsAllDay').checked = evtData.isAllDay !== false;
        document.getElementById('evStartTime').value = evtData.startTime || '09:00';
        document.getElementById('evEndTime').value = evtData.endTime || '10:00';
        
        const rUnit = evtData.reminderUnit || 'none';
        document.getElementById('evReminderUnit').value = rUnit;
        document.getElementById('evReminderVal').value = evtData.reminderValue || '';
        document.getElementById('evReminderVal').disabled = (rUnit === 'none');
    } else {
        editingEventId = null;
        document.getElementById('evTitle').value = '';
        document.getElementById('evDesc').value = '';
        document.getElementById('evCategory').value = 'other';
        document.getElementById('evVisibility').value = 'public';
        document.getElementById('evIsAllDay').checked = true;
        document.getElementById('evStartTime').value = '09:00';
        document.getElementById('evEndTime').value = '10:00';
        document.getElementById('evReminderUnit').value = 'none';
        document.getElementById('evReminderVal').value = '';
        document.getElementById('evReminderVal').disabled = true;
    }
    toggleTimeInputs();
}

function renderDayEvents(dateKey) {
    const container = document.getElementById('dayEventsContainer');
    container.innerHTML = '';
    const dayEvts = allFetchedEvents.filter(e => e.date === dateKey);

    if (dayEvts.length === 0) {
        container.innerHTML = '<div style="color:var(--text-sub); text-align:center; padding:20px 0; font-weight:600;">當日無待辦事項</div>';
        return;
    }

    dayEvts.forEach(evt => {
        const item = document.createElement('div');
        item.className = `event-item ${evt.visibility || 'public'}`;
        
        const isOwnerOrAdmin = (evt.operator === currentUser.name || currentUser.role === 'admin' || currentUser.role === '家長');
        const categoryIcon = uiIcon(categoryIcons[evt.category] || 'pin');
        const timeStr = (evt.isAllDay !== false) ? '全天' : `${evt.startTime} - ${evt.endTime}`;
        
        let reminderStr = '無提醒';
        if (evt.reminderUnit === 'minutes') reminderStr = `提前 ${evt.reminderValue} 分鐘提醒`;
        if (evt.reminderUnit === 'hours') reminderStr = `提前 ${evt.reminderValue} 小時提醒`;
        const expired = isEventExpired(evt, dateKey);
        if (expired) reminderStr = '已結束';

        item.innerHTML = `
            <div class="event-item-main">
                <div class="event-item-title">
                    ${evt.visibility === 'private' ? uiIcon('lock') : ''} ${categoryIcon} ${evt.title}
                </div>
                <div class="event-item-meta">
                    <span>${uiIcon('clock')}${timeStr}</span> | <span>${uiIcon(expired ? 'check' : 'bell')}${reminderStr}</span>
                </div>
                ${evt.desc ? `<div style="font-size:calc(12px * var(--n-font-scale, 1)); color:var(--text-sub); margin-top:6px;">${evt.desc}</div>` : ''}
            </div>
            ${isOwnerOrAdmin ? `
            <div class="event-actions">
                <button class="btn-icon edit" data-id="${evt.id}" title="編輯行程" aria-label="編輯行程">${uiIcon('edit')}</button>
                <button class="btn-icon del" data-id="${evt.id}" title="刪除行程" aria-label="刪除行程">${uiIcon('trash')}</button>
            </div>` : ''}
        `;
        container.appendChild(item);
    });

    container.querySelectorAll('.btn-icon.edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const targetEvt = allFetchedEvents.find(ev => ev.id === id);
            if(targetEvt) showFormView(targetEvt);
        });
    });
    container.querySelectorAll('.btn-icon.del').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            deleteEvent(id);
        });
    });
}

const evIsAllDay = document.getElementById('evIsAllDay');
const timeInputsGroup = document.getElementById('timeInputsGroup');
const evReminderUnit = document.getElementById('evReminderUnit');
const evReminderVal = document.getElementById('evReminderVal');

function toggleTimeInputs() { timeInputsGroup.style.display = evIsAllDay.checked ? 'none' : 'flex'; }
if(evIsAllDay) evIsAllDay.addEventListener('change', toggleTimeInputs);

if(evReminderUnit) evReminderUnit.addEventListener('change', (e) => {
    if (e.target.value === 'none') {
        evReminderVal.disabled = true; evReminderVal.value = '';
    } else {
        evReminderVal.disabled = false;
        if (!evReminderVal.value) evReminderVal.value = '30';
    }
});

const btnShowAddForm = document.getElementById('btnShowAddForm');
if(btnShowAddForm) btnShowAddForm.addEventListener('click', () => showFormView(null));

const btnCancelForm = document.getElementById('btnCancelForm');
if(btnCancelForm) btnCancelForm.addEventListener('click', showListView);

window.addEventListener('click', (e) => {
    const eventModal = document.getElementById('eventModal');
    const settingsModal = document.getElementById('settingsModal');
    if (e.target === eventModal) eventModal.style.display = 'none';
    if (e.target === settingsModal) settingsModal.style.display = 'none';
});

const btnCloseModal = document.getElementById('btnCloseModal');
if(btnCloseModal) btnCloseModal.addEventListener('click', () => { document.getElementById('eventModal').style.display = 'none'; });

async function saveEvent() {
    const title = document.getElementById('evTitle').value.trim();
    if (!title) return alert('請輸入行程標題！');

    const isAllDay = document.getElementById('evIsAllDay').checked;
    const startTime = document.getElementById('evStartTime').value;
    const endTime = document.getElementById('evEndTime').value;
    
    if (!isAllDay && startTime >= endTime) return alert('結束時間必須晚於開始時間！');

    // 加入 accountId 到存入資料庫的物件
    const accountId = currentUser.id || currentUser.accountId || currentUser.uid || '';

    const evtData = {
        groupId: currentGroupId,
        date: selectedDateKey,
        title: title,
        desc: document.getElementById('evDesc').value.trim(),
        category: document.getElementById('evCategory').value,
        visibility: document.getElementById('evVisibility').value,
        isAllDay: isAllDay,
        startTime: isAllDay ? null : startTime,
        endTime: isAllDay ? null : endTime,
        reminderValue: parseInt(document.getElementById('evReminderVal').value) || 0,
        reminderUnit: document.getElementById('evReminderUnit').value,
        operator: currentUser.name,
        accountId: accountId, // 在此處加入
        timestamp: serverTimestamp()
    };

    try {
        document.getElementById('btnSaveEvent').disabled = true;
        if (editingEventId) {
            await updateDoc(doc(db, "events", editingEventId), evtData);
        } else {
            await addDoc(collection(db, "events"), evtData);
        }
        showListView(); 
    } catch (error) {
        alert("儲存失敗，請檢查網路。");
    } finally {
        document.getElementById('btnSaveEvent').disabled = false;
    }
}

const btnSaveEvent = document.getElementById('btnSaveEvent');
if(btnSaveEvent) btnSaveEvent.addEventListener('click', saveEvent);

async function deleteEvent(id) {
    if (confirm('確定要刪除此待辦事項嗎？')) {
        try { await deleteDoc(doc(db, "events", id)); } 
        catch (error) { alert("刪除失敗，請檢查網路。"); }
    }
}

const btnBack = document.getElementById('btnBack');
if(btnBack) btnBack.addEventListener('click', () => window.location.href = 'index.html');
