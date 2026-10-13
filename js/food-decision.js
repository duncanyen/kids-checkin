import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc, query, where, onSnapshot } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

// 讀取當前使用者與群組資料
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : { accountId: 'unknown', name: '訪客' };
const currentGroupId = localStorage.getItem('lastGroupId') || 'wJOpq0uAnXvO4ezZ1IK9';

let restaurants = [];
let currentMeal = '';
let currentEmoji = '';

// 日期狀態
let selectedDate = new Date();
let calendarDate = new Date();

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

function getVoteDocId(meal) {
    const dateStr = formatDateStr(selectedDate);
    return `${currentGroupId}_${dateStr}_${meal}`;
}

// ================= 資料載入與渲染 =================

async function loadRestaurants() {
    try {
        // 修正：正確的集合名稱為 food_restaurants
        const q = query(collection(db, "food_restaurants"), where("groupId", "==", currentGroupId));
        const snap = await getDocs(q);
        restaurants = [];
        snap.forEach(d => restaurants.push({id: d.id, ...d.data()}));
        renderRestaurantList('全部');
    } catch (error) {
        console.error("載入餐廳失敗:", error);
    }
}

window.foodApp.filterRestaurants = function(type, btn) {
    if(btn) {
        document.querySelectorAll('#manage .chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
    }
    renderRestaurantList(type);
};

function renderRestaurantList(type = '全部') {
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
        const mealStr = (r.meal || []).join(', '); // 修正防呆
        list.innerHTML += `
            <div class="list-item">
                <div class="list-info">
                    <b>${r.name}</b>
                    <small>${r.type} · ${r.price || '未定價'} · ${r.food}</small>
                    <small style="color:var(--green2)">適用: ${mealStr}</small>
                </div>
            </div>
        `;
    });
}

// ================= 導覽與流程控制 =================

window.foodApp.go = function(viewId, btn) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
    
    if(btn) {
        document.querySelectorAll('.nav button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    
    if(viewId === 'stats') {
        loadVotes(currentMeal || '晚餐');
    }
};

window.foodApp.chooseMeal = function(meal, emoji) {
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

    // 修正：改用 r.meal
    const candidates = restaurants.filter(r => {
        const mealArr = r.meal || [];
        return mealArr.includes(currentMeal) || mealArr.includes('不限');
    });

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
        
        labelDiv.innerText = cand.name;
        labelDiv.style.transform = `translateY(-50%) rotate(${textAngle - 90}deg) translateX(50px)`; 
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
        count--;
        if(count > 0) {
            cNum.innerText = count;
            cNum.style.animation = 'none';
            void cNum.offsetWidth;
            cNum.style.animation = 'pop 0.8s ease';
        } else {
            clearInterval(timer);
            document.getElementById('countdown').classList.remove('show');
            executeSpin(candidates);
        }
    }, 1000);
};

function executeSpin(candidates) {
    const wheel = document.getElementById('wheel');
    const segmentAngle = 360 / candidates.length;
    
    const winIndex = Math.floor(Math.random() * candidates.length);
    const winner = candidates[winIndex];
    
    const baseRotations = 5 * 360; 
    const targetAngle = baseRotations + (360 - (winIndex * segmentAngle + segmentAngle / 2));
    
    wheel.style.transition = 'transform 4s cubic-bezier(0.1, 0.7, 0.1, 1)';
    wheel.style.transform = `rotate(${targetAngle}deg)`;
    
    setTimeout(() => {
        document.getElementById('winner').classList.add('show');
        document.getElementById('winnerFood').innerText = '🎉'; 
        document.getElementById('winnerName').innerText = winner.name;
        document.getElementById('winnerMeta').innerText = `${winner.type} · ${winner.food} · ${winner.price || ''}`;
        document.getElementById('spinBtn').disabled = false;
        
        saveVote(winner.name, 'wheel');
    }, 4000);
}

window.foodApp.acceptWheelWinner = function() {
    window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

// ================= 投票清單邏輯 =================

function renderVoteList() {
    const list = document.getElementById('voteList');
    list.innerHTML = '';
    
    // 修正：改用 r.meal
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
                <b>${cand.name}</b>
                <small>${cand.type} · ${cand.food}</small>
            </div>
            <button class="vote" onclick="window.foodApp.castVote('${cand.name}')">投給它</button>
        `;
        list.appendChild(div);
    });
}

// 投票儲存 (綁定 accountId)
let mockVotesMap = {};
async function saveVote(restaurantName, source = 'manual') {
    const docId = getVoteDocId(currentMeal);
    const accountId = currentUser.accountId || currentUser.id || currentUser.uid || 'unknown';
    
    try {
        const docSnap = await getDocs(query(collection(db, 'food_votes'), where('__name__', '==', docId)));
        
        let votesMap = {};
        if (!docSnap.empty) {
            votesMap = docSnap.docs[0].data().votes || {};
        }
        
        votesMap[accountId] = {
            name: currentUser.name,
            avatar: currentUser.avatar || null,
            choice: restaurantName,
            time: new Date().toISOString()
        };
        
        if (docSnap.empty) {
            await addDoc(collection(db, 'food_votes'), {
                _id: docId,
                groupId: currentGroupId,
                date: formatDateStr(selectedDate),
                meal: currentMeal,
                votes: votesMap
            });
        }
    } catch(e) {
        console.log("Mock Save Vote error:", e);
    }
    
    // 本地預覽即時更新
    mockVotesMap[accountId] = {
        name: currentUser.name,
        avatar: null,
        choice: restaurantName
    };
    renderStats(mockVotesMap);
}

window.foodApp.castVote = function(name) {
    saveVote(name);
    window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

window.foodApp.switchStatsTab = function(meal, btn) {
    document.querySelectorAll('#statsTabs .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentMeal = meal;
    loadVotes(meal);
};

function loadVotes(meal) {
    document.getElementById('statsMealName').innerText = meal;
    renderStats(mockVotesMap); // 實際環境需改為 onSnapshot 即時監聽
}

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
                <div class="rank"><strong>${name}</strong><span>${count} 票 (${pct}%)</span></div>
                <div class="bar"><i style="width:${pct}%"></i></div>
            </div>
        `;
    });
    
    const membersDiv = document.getElementById('memberVotes');
    membersDiv.innerHTML = '';
    Object.values(votesMap).forEach(v => {
        membersDiv.innerHTML += `
            <div class="member-vote-row">
                <div class="face">${v.name[0]}</div>
                <div class="mv-name">${v.name}</div>
                <div class="mv-choice">${v.choice}</div>
            </div>
        `;
    });
}

// ================= 管理：新增餐廳功能 =================

window.foodApp.openRestaurant = function() {
    document.getElementById('modalTitle').innerText = '新增餐廳';
    document.getElementById('editId').value = '';
    document.getElementById('rName').value = '';
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

    try {
        const payload = {
            groupId: currentGroupId,
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
        loadRestaurants(); // 重新讀取清單
    } catch(e) {
        console.error("儲存餐廳失敗", e);
        alert("發生錯誤，請稍後再試。");
    }
};

// ================= 初始化 =================

updateDateDisplay();
renderCalendar();
loadRestaurants();
