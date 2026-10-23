import { db } from './firebase-config.js';
import { collection, addDoc, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getSelectedGameGroupId, watchGameContext } from './game-context.js';
import { loadGameGroupMembers } from './game-members.js';
import { createFoodStore, MEALS } from './food-store.js';

// 讀取當前使用者與群組資料
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : {};
const currentGroupId = getSelectedGameGroupId(currentUser);
const context = { groupId: currentGroupId, accountId: currentUser.accountId };
const store = createFoodStore(db, context);
let ready = false, saving = false, members = new Map(), votes = {}, decision = null;
let unsubscribe = null, loadVersion = 0, spinVersion = 0;
const selection = () => ({ date: formatDateStr(selectedDate), meal: currentMeal });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message, error = false) {
    const el = document.getElementById('foodSyncStatus');
    el.textContent = message;
    el.style.color = error ? '#b42318' : 'var(--green2)';
}
function cancelSpin() {
    spinVersion++;
    document.getElementById('countdown').classList.remove('show');
    document.getElementById('winner').classList.remove('show');
    document.getElementById('spinBtn').disabled = false;
    document.getElementById('wheel').dataset.candidates = '';
}

let restaurants = [];
let currentMeal = '';
let currentEmoji = '';

// 日期狀態
let selectedDate = new Date();
let calendarDate = new Date();

// ================= 初始化身份資料 =================

function initIdentity() {
    const nameEl = document.getElementById('voteMemberName');
    const faceEl = document.getElementById('voteFaceContainer');
    const headerAvatar = document.getElementById('headerAvatarBtn');

    // 取得頭像或備用字元
    const avatarUrl = currentUser.avatar || currentUser.photoURL || currentUser.avatarUrl;
    const fallbackChar = (currentUser.name || '訪').charAt(0);

    // 更新投票身份名稱
    if (nameEl) nameEl.innerText = currentUser.name || '訪客';

    // 更新投票身份頭像
    const faceHtml = avatarUrl
        ? `<img src="${escapeHtml(avatarUrl)}" class="face real-avatar">`
        : `<div class="face">${fallbackChar}</div>`;
    if (faceEl) faceEl.innerHTML = faceHtml;

    // 更新頂部 Header 頭像
    if (headerAvatar) {
        headerAvatar.innerHTML = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" class="real-avatar">`
            : `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:16px;background:#edf6f1;color:var(--green2);font-weight:bold;">${fallbackChar}</div>`;
    }
}

// ================= 日期與月曆邏輯 =================

function formatDateStr(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function updateDateDisplay() {
    const dateStr = formatDateStr(selectedDate);
    const todayStr = formatDateStr(new Date());
    let displayText = dateStr;

    if (dateStr === todayStr) {
        displayText = '今天';
    } else {
        const days = ['日', '一', '二', '三', '四', '五', '六'];
        displayText = `${selectedDate.getMonth()+1}/${selectedDate.getDate()} (${days[selectedDate.getDay()]})`;
    }

    document.getElementById('currentSelectedDateDisplay').innerText = displayText;
    document.getElementById('homeDateText').innerText = displayText;
    document.getElementById('statsDateText').innerText = displayText === '今天' ? '今日' : displayText;
}

window.foodApp.changeMonth = function(offset) {
    calendarDate.setDate(1);
    calendarDate.setMonth(calendarDate.getMonth() + offset);
    renderCalendar();
};

function renderCalendar() {
    const monthYear = document.getElementById('calendarMonthYear');
    monthYear.innerText = `${calendarDate.getFullYear()}年 ${calendarDate.getMonth() + 1}月`;

    const daysContainer = document.getElementById('calendarDays');
    daysContainer.innerHTML = '';

    const firstDay = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1).getDay();
    const daysInMonth = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 0).getDate();

    for(let i=0; i<firstDay; i++) {
        daysContainer.innerHTML += `<div></div>`;
    }

    for(let i=1; i<=daysInMonth; i++) {
        const d = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), i);
        const dateStr = formatDateStr(d);
        const selStr = formatDateStr(selectedDate);

        const isSelected = dateStr === selStr;
        const div = document.createElement('div');
        div.className = `calendar-day ${isSelected ? 'active' : ''}`;
        div.innerText = i;
        div.onclick = () => {
            cancelSpin();
            selectedDate = new Date(d);
            updateDateDisplay();
            renderCalendar();
            document.getElementById('calendarModal').classList.remove('show');
            if(currentMeal) {
                loadVotes(currentMeal);
            }
        };
        daysContainer.appendChild(div);
    }
}

// ================= 資料載入與清單渲染 =================

window.foodApp.renderRestaurantList = function(type = '全部') {
    const list = document.getElementById('restaurantList');
    if (!list) return;
    list.innerHTML = '';

    let filtered = restaurants;
    if (type !== '全部') {
        filtered = restaurants.filter(r => r.type === type);
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="empty">目前沒有餐廳資料</div>';
        return;
    }

    filtered.forEach(r => {
        const mealStr = (r.meal || []).join(', ');
        list.innerHTML += `
            <div class="list-item">
                <div class="list-info">
                    <b>${escapeHtml(r.name)}</b>
                    <small>${escapeHtml(r.type)} · ${escapeHtml(r.price || '未定價')} · ${escapeHtml(r.food)}</small>
                    <small style="color:var(--green2)">適用: ${escapeHtml(mealStr)}</small>
                </div>
            </div>
        `;
    });
};

// Legacy restaurants may store one meal (or a delimited list) as text.
// Normalize at the read boundary so every renderer/filter receives an array.
function normalizeRestaurantMeals(value) {
    const entries = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,，、;；|/\s]+/) : [];
    return [...new Set(entries.filter(item => typeof item === 'string').map(item => item.trim()).filter(item => item === '不限' || MEALS.includes(item)))];
}

async function loadRestaurants() {
    try {
        const q = query(collection(db, "food_restaurants"), where("groupId", "==", currentGroupId));
        const snap = await getDocs(q);
        restaurants = [];
        snap.forEach(d => {
            const data = d.data();
            restaurants.push({ ...data, id: d.id, meal: normalizeRestaurantMeals(data.meal) });
        });

        window.foodApp.renderRestaurantList('全部');
    } catch (error) {
        console.error("載入餐廳失敗:", error);
        status("餐廳載入失敗，請重新整理後重試。", true);
        throw error;
    }
}

window.foodApp.filterRestaurants = function(type, btn) {
    if(btn) {
        document.querySelectorAll('#manage .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
    }
    window.foodApp.renderRestaurantList(type);
};

// ================= 導覽與流程控制 =================

window.foodApp.go = function(viewId, btn) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');

    if(btn) {
        document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    if (viewId === 'vote' && !currentMeal) window.foodApp.chooseMeal('晚餐', '🍲');
    if(viewId === 'stats') {
        currentMeal ||= '晚餐';
        loadVotes(currentMeal);
    }
};

window.foodApp.chooseMeal = function(meal, emoji) {
    cancelSpin();
    currentMeal = meal;
    currentEmoji = emoji;
    document.getElementById('mealEyebrow').innerText = `${emoji} ${meal}`;
    window.foodApp.go('vote', document.querySelector('[data-view=vote]'));

    const tabs = document.querySelectorAll('#statsTabs .chip');
    tabs.forEach(t => {
        if(t.innerText === meal) {
            window.foodApp.switchStatsTab(meal, t);
        }
    });
};

window.foodApp.showWheel = function() {
    document.getElementById('wheelPanel').style.display = 'block';
    document.getElementById('listPanel').style.display = 'none';
    document.getElementById('winner').classList.remove('show');
    setupWheel();
};

window.foodApp.showList = function() {
    document.getElementById('wheelPanel').style.display = 'none';
    document.getElementById('listPanel').style.display = 'block';
    renderVoteList();
};

// ================= 命運輪盤邏輯 =================

const wheelColors = ['#ffd77a', '#9fdcc2', '#b9d0fa', '#ffb6a9', '#c6b7f1', '#a8dce9'];

function setupWheel() {
    const wheel = document.getElementById('wheel');
    Array.from(wheel.children).forEach(c => {
        if(!c.classList.contains('wheel-label')) c.remove();
    });

    const candidates = restaurants.filter(r => {
        const mealArr = r.meal || [];
        return mealArr.includes(currentMeal) || mealArr.includes('不限');
    });

    wheel.dataset.candidates = '';
    document.getElementById('wheelHint').innerText = '';
    if(candidates.length === 0) {
        document.getElementById('wheelHint').innerText = '尚無適合此時段的餐廳';
        wheel.style.background = '#eee';
        return;
    }

    const numSegments = candidates.length;
    const angle = 360 / numSegments;
    let gradientParts = [];

    candidates.forEach((cand, i) => {
        const startAngle = i * angle;
        const endAngle = (i + 1) * angle;
        const color = wheelColors[i % wheelColors.length];

        gradientParts.push(`${color} ${startAngle}deg ${endAngle}deg`);

        const labelDiv = document.createElement('div');
        labelDiv.className = 'wheel-text';

        const textAngle = startAngle + (angle / 2);

        // 限制字數，避免超長店名撐破排版
        let displayName = cand.name;
        if(displayName.length > 7) displayName = displayName.substring(0, 6) + '...';
        labelDiv.innerText = displayName;

        // 推移距離改為 75px 往外推
        labelDiv.style.transform = `translateY(-50%) rotate(${textAngle - 90}deg) translateX(75px)`;
        labelDiv.style.left = '50%';
        labelDiv.style.top = '50%';
        labelDiv.style.transformOrigin = '0 0';

        wheel.appendChild(labelDiv);
    });

    wheel.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    wheel.style.transform = 'rotate(0deg)';
    wheel.dataset.candidates = JSON.stringify(candidates);
}

window.foodApp.startSpin = function() {
    if (!ready || saving || document.getElementById('spinBtn').disabled) return;
    const version = ++spinVersion;
    const wheel = document.getElementById('wheel');
    const candidatesStr = wheel.dataset.candidates;
    if(!candidatesStr) return;
    const candidates = JSON.parse(candidatesStr);

    const spinBtn = document.getElementById('spinBtn');
    spinBtn.disabled = true;

    document.getElementById('countdown').classList.add('show');
    let count = 3;
    const cNum = document.getElementById('countNumber');
    cNum.innerText = count;

    const timer = setInterval(() => {
        if (version !== spinVersion) { clearInterval(timer); return; }
        count--;
        if(count > 0) {
            cNum.innerText = count;
            cNum.style.animation = 'none';
            void cNum.offsetWidth;
            cNum.style.animation = 'pop 0.8s ease';
        } else {
            clearInterval(timer);
            document.getElementById('countdown').classList.remove('show');
            executeSpin(candidates, version);
        }
    }, 1000);
};

function executeSpin(candidates, version) {
    const wheel = document.getElementById('wheel');
    const segmentAngle = 360 / candidates.length;

    const winIndex = Math.floor(Math.random() * candidates.length);
    const winner = candidates[winIndex];

    const baseRotations = 5 * 360;
    const targetAngle = baseRotations + (360 - (winIndex * segmentAngle + segmentAngle / 2));

    wheel.style.transition = 'transform 4s cubic-bezier(0.1, 0.7, 0.1, 1)';
    wheel.style.transform = `rotate(${targetAngle}deg)`;

    setTimeout(async () => {
        if (version !== spinVersion) return;
        if (!await saveVote(winner, 'wheel')) { document.getElementById('spinBtn').disabled = false; return; }
        if (version !== spinVersion) return;
        document.getElementById('winner').classList.add('show');
        document.getElementById('winnerFood').innerText = '🎉';
        document.getElementById('winnerName').innerText = winner.name;
        document.getElementById('winnerMeta').innerText = `${winner.type} · ${winner.food} · ${winner.price || ''}`;
        document.getElementById('spinBtn').disabled = false;


    }, 4000);
}

window.foodApp.acceptWheelWinner = function() {
    window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

// ================= 投票清單與儲存邏輯 =================

function renderVoteList() {
    const list = document.getElementById('voteList');
    list.innerHTML = '';

    const candidates = restaurants.filter(r => {
        const mealArr = r.meal || [];
        return mealArr.includes(currentMeal) || mealArr.includes('不限');
    });

    if(candidates.length === 0) {
        list.innerHTML = '<div class="empty">目前沒有適合此時段的餐廳</div>';
        return;
    }

    candidates.forEach(cand => {
        const div = document.createElement('div');
        div.className = 'restaurant';
        div.innerHTML = `
            <div class="list-info">
                <b>${escapeHtml(cand.name)}</b>
                <small>${escapeHtml(cand.type)} · ${escapeHtml(cand.food)}</small>
            </div>
            <button class="vote" >投給它</button>
        `;
        div.querySelector("button").onclick = () => window.foodApp.castVote(cand.id);
        list.appendChild(div);
    });
}

async function saveVote(restaurant, source = 'manual') {
    if (!ready || saving || !currentMeal) return false;
    const target = selection(), version = loadVersion;
    saving = true;
    status('正在儲存投票…');
    try {
        await store.vote(target, restaurant, currentUser, source);
        if (version === loadVersion) status('投票已儲存');
        return true;
    } catch (error) {
        console.error(error);
        status('投票儲存失敗：' + error.message, true);
        return false;
    } finally { saving = false; }
}

window.foodApp.castVote = async function(id) {
    const restaurant = restaurants.find(r => r.id === id);
    const version = loadVersion;
    if (restaurant && await saveVote(restaurant) && version === loadVersion) window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

window.foodApp.switchStatsTab = function(meal, btn) {
    if (meal !== currentMeal) cancelSpin();
    document.querySelectorAll('#statsTabs .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentMeal = meal;
    document.getElementById('mealEyebrow').innerText = ({早餐:'🌤️',午餐:'🍱',晚餐:'🍲',宵夜:'🌙'}[meal] || '') + ' ' + meal;
    loadVotes(meal);
};

async function loadVotes(meal) {
    const version = ++loadVersion;
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    votes = {}; decision = null;
    renderStats(votes);
    document.getElementById('statsMealName').innerText = meal;
    document.querySelectorAll('#statsTabs .chip').forEach(c => c.classList.toggle('active', c.textContent === meal));
    if (!ready) return;
    status('正在查詢 ' + formatDateStr(selectedDate) + ' ' + meal + '…');
    try {
        const stop = await store.watch(selection(), data => {
            if (version !== loadVersion) return;
            votes = Object.fromEntries(Object.entries(data.votes || {}).filter(([id]) => members.has(id)).map(([id, vote]) => [id, { ...vote, name: members.get(id).name, avatar: members.get(id).avatar || members.get(id).photoURL || members.get(id).avatarUrl || null }]));
            decision = data.decision;
            renderStats(votes);
            status(decision ? '已決定：' + decision.choice : '已同步 ' + formatDateStr(selectedDate) + ' ' + meal);
        }, error => { if (version === loadVersion) status('投票查詢失敗：' + error.message, true); });
        if (version !== loadVersion) stop(); else unsubscribe = stop;
    } catch (error) { if (version === loadVersion) status('投票查詢失敗：' + error.message, true); }
}

window.foodApp.finishDecision = async function() {
    if (!ready || saving) return;
    const winner = Object.entries(Object.values(votes).reduce((counts, v) => { counts[v.choice] = (counts[v.choice] || 0) + 1; return counts; }, {})).sort((a,b) => b[1]-a[1])[0];
    if (!winner) return status('請先投票再儲存決定', true);
    saving = true;
    try { await store.decide(selection(), winner[0]); status('決定已儲存：' + winner[0]); }
    catch (error) { status('決定儲存失敗：' + error.message, true); }
    finally { saving = false; }
};
window.foodApp.shareResult = async function() {
    const text = formatDateStr(selectedDate) + ' ' + currentMeal + '：' + document.getElementById('winnerStatName').textContent;
    if (!Object.keys(votes).length) return status('請先投票再分享', true);
    try {
        if (navigator.share) await navigator.share({ title: '吃什麼？', text });
        else { await navigator.clipboard.writeText(text); status('結果已複製，可貼到群組分享'); }
    } catch (error) { if (error.name !== 'AbortError') status('無法分享，請手動複製結果', true); }
};

function renderStats(votesMap) {
    const totalVotes = Object.keys(votesMap).length;
    document.getElementById('totalVotes').innerText = totalVotes;

    const countMap = {};
    Object.values(votesMap).forEach(v => {
        countMap[v.choice] = (countMap[v.choice] || 0) + 1;
    });

    const sorted = Object.entries(countMap).sort((a,b) => b[1]-a[1]);

    if(sorted.length > 0) {
        document.getElementById('winnerStatName').innerText = sorted[0][0];
        document.getElementById('winnerStatScore').innerText = `${sorted[0][1]} 票領先`;
    } else {
        document.getElementById('winnerStatName').innerText = '尚未有人投票';
        document.getElementById('winnerStatScore').innerText = '投下第一票吧';
    }

    const rankingDiv = document.getElementById('ranking');
    rankingDiv.innerHTML = '';
    sorted.forEach(([name, count]) => {
        const pct = Math.round((count / totalVotes) * 100);
        rankingDiv.innerHTML += `
            <div style="margin-bottom:12px">
                <div class="rank"><strong>${escapeHtml(name)}</strong><span>${count} 票 (${pct}%)</span></div>
                <div class="bar"><i style="width:${pct}%"></i></div>
            </div>
        `;
    });

    const membersDiv = document.getElementById('memberVotes');
    membersDiv.innerHTML = '';
    Object.values(votesMap).forEach(v => {
        const fallbackChar = (v.name || '訪').charAt(0);
        const faceHtml = v.avatar
            ? `<img src="${escapeHtml(v.avatar)}" class="face real-avatar">`
            : `<div class="face">${fallbackChar}</div>`;

        membersDiv.innerHTML += `
            <div class="member-vote-row">
                ${faceHtml}
                <div class="mv-name">${escapeHtml(v.name)}</div>
                <div class="mv-choice">${escapeHtml(v.choice)}</div>
            </div>
        `;
    });

    const currentAccountId = currentUser.accountId || currentUser.id || currentUser.uid || 'unknown';
    const myVote = votesMap[currentAccountId];
    const voteStatusEl = document.getElementById('voteStatus');
    if (voteStatusEl) {
        if (myVote) {
            voteStatusEl.innerText = '已完成投票 ✓';
            voteStatusEl.classList.add('done');
        } else {
            voteStatusEl.innerText = '尚未投票';
            voteStatusEl.classList.remove('done');
        }
    }
}

// ================= 管理：新增餐廳功能 =================

window.foodApp.openRestaurant = function() {
    document.getElementById('modalTitle').innerText = '新增餐廳';
    document.getElementById('editId').value = '';
    document.getElementById('rName').value = '';
    document.getElementById('rType').selectedIndex = 0;
    document.getElementById('rPrice').selectedIndex = 0;
    document.getElementById('rFood').value = '';
    document.getElementById('rTags').value = '';
    document.getElementById('rNote').value = '';

    document.querySelectorAll('input[name="rMeal"]').forEach(chk => chk.checked = false);

    document.getElementById('modal').classList.add('show');
};

window.foodApp.closeModal = function() {
    document.getElementById('modal').classList.remove('show');
};

window.foodApp.saveRestaurant = async function() {
    if (!ready || saving) return;
    const name = document.getElementById('rName').value.trim();
    const type = document.getElementById('rType').value;
    const price = document.getElementById('rPrice').value;
    const food = document.getElementById('rFood').value.trim();
    const tags = document.getElementById('rTags').value.trim();
    const note = document.getElementById('rNote').value.trim();

    const mealCheckboxes = document.querySelectorAll('input[name="rMeal"]:checked');
    const meal = Array.from(mealCheckboxes).map(cb => cb.value);

    if(!name || !food || meal.length === 0) {
        alert("店名、代表食物、適合時段為必填項目！");
        return;
    }

    saving = true;
    try {
        await loadGameGroupMembers(currentGroupId, currentUser.accountId);
        const payload = {
            groupId: currentGroupId,
            accountId: currentUser.accountId,
            name,
            type,
            price,
            food,
            meal,
            tags,
            note,
            updatedAt: new Date().toISOString()
        };

        await addDoc(collection(db, "food_restaurants"), payload);
        alert("新增成功！");
        window.foodApp.closeModal();
        await loadRestaurants();
    } catch(e) {
        console.error("儲存餐廳失敗", e);
        alert("儲存餐廳失敗：" + e.message);
    } finally { saving = false; }
};

// ================= 啟動初始化 =================

initIdentity();
updateDateDisplay();
renderCalendar();
async function initialize() {
    try {
        if (!currentUser.accountId || !currentGroupId) throw new Error('請先登入並選擇群組');
        const profiles = await loadGameGroupMembers(currentGroupId, currentUser.accountId);
        members = new Map(profiles.map(profile => [profile.accountId, profile]));
        if (!members.has(currentUser.accountId)) throw new Error('找不到目前群組的個人資料');
        Object.assign(currentUser, members.get(currentUser.accountId));
        initIdentity();
        watchGameContext(context);
        await loadRestaurants();
        ready = true;
        if (currentMeal) await loadVotes(currentMeal); else status('請選擇日期與餐別');
    } catch (error) { status(error.message, true); }
}
initialize();
