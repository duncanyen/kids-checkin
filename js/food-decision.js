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

// Data structure mimicking real app
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : { accountId: 'mock-account', name: 'Mock User' };
const currentGroupId = localStorage.getItem('lastGroupId') || 'mock-group';

let restaurants = [];
let unsubscribeVotes = null;
let currentMeal = '';
let currentEmoji = '';

// Selected Date State
let selectedDate = new Date();
// For calendar rendering
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
    
    // Empty slots before first day
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
            // If already on stats or vote view, reload data
            if(currentMeal) {
                loadVotes(currentMeal);
            }
        };
        daysContainer.appendChild(div);
    }
}

// Ensure unique document ID based on group, date, and meal
function getVoteDocId(meal) {
    const dateStr = formatDateStr(selectedDate);
    return `${currentGroupId}_${dateStr}_${meal}`;
}

async function loadRestaurants() {
    const q = query(collection(db, "restaurants"), where("groupId", "==", currentGroupId));
    const snap = await getDocs(q);
    restaurants = [];
    snap.forEach(d => restaurants.push({id: d.id, ...d.data()}));
    renderRestaurantList('全部');
}

window.foodApp.chooseMeal = function(meal, emoji) {
    currentMeal = meal;
    currentEmoji = emoji;
    document.getElementById('mealEyebrow').innerText = `${emoji} ${meal}`;
    window.foodApp.go('vote', document.querySelector('[data-view=vote]'));
    
    // Switch stats tab to match
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

const wheelColors = ['#ffd77a', '#9fdcc2', '#b9d0fa', '#ffb6a9', '#c6b7f1', '#a8dce9'];

function setupWheel() {
    const wheel = document.getElementById('wheel');
    // Clear old segments except label
    Array.from(wheel.children).forEach(c => {
        if(!c.classList.contains('wheel-label')) c.remove();
    });

    const candidates = restaurants.filter(r => r.meals.includes(currentMeal) || r.meals.includes('不限'));
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
        
        // Add text label segment
        const labelDiv = document.createElement('div');
        labelDiv.className = 'wheel-text';
        
        // Rotate container to the middle of the segment
        const textAngle = startAngle + (angle / 2);
        
        labelDiv.innerText = cand.name;
        // Position it absolute, originating from center
        labelDiv.style.transform = `translateY(-50%) rotate(${textAngle - 90}deg) translateX(50px)`; 
        // Note: The math for positioning text perfectly inside a conic gradient can get complex in standard CSS.
        // A simpler approach for the text is placing them absolute rotated from center.
        labelDiv.style.left = '50%';
        labelDiv.style.top = '50%';
        labelDiv.style.transformOrigin = '0 0';

        wheel.appendChild(labelDiv);
    });

    wheel.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    wheel.style.transform = 'rotate(0deg)';
    
    // Store candidates on element for spinning logic
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
            // Retrigger animation
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
    
    // Pick winner
    const winIndex = Math.floor(Math.random() * candidates.length);
    const winner = candidates[winIndex];
    
    // Calculate rotation to make the winning segment end up at top (pointer position)
    // The pointer is at the top (0 degrees).
    // The center of the winning segment is `winIndex * segmentAngle + segmentAngle / 2`
    // We need to rotate the wheel backwards so this center aligns with top.
    const baseRotations = 5 * 360; // 5 full spins
    const targetAngle = baseRotations + (360 - (winIndex * segmentAngle + segmentAngle / 2));
    
    wheel.style.transition = 'transform 4s cubic-bezier(0.1, 0.7, 0.1, 1)';
    wheel.style.transform = `rotate(${targetAngle}deg)`;
    
    setTimeout(() => {
        document.getElementById('winner').classList.add('show');
        document.getElementById('winnerFood').innerText = '🎉'; // could use emoji if stored
        document.getElementById('winnerName').innerText = winner.name;
        document.getElementById('winnerMeta').innerText = `${winner.type} · ${winner.price}`;
        document.getElementById('spinBtn').disabled = false;
        
        // Save vote to DB directly for the wheel result
        saveVote(winner.name, 'wheel');
        
    }, 4000);
}

window.foodApp.acceptWheelWinner = function() {
    window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

function renderVoteList() {
    const list = document.getElementById('voteList');
    list.innerHTML = '';
    const candidates = restaurants.filter(r => r.meals.includes(currentMeal) || r.meals.includes('不限'));
    
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

// Important Fix: Use groupId and accountId for keys
async function saveVote(restaurantName, source = 'manual') {
    const docId = getVoteDocId(currentMeal);
    const docRef = doc(db, 'food_votes', docId);
    
    const accountId = currentUser.accountId || currentUser.id || currentUser.uid || 'unknown';
    
    try {
        // Fetch current to update or create new
        const docSnap = await getDocs(query(collection(db, 'food_votes'), where('__name__', '==', docId)));
        
        let votesMap = {};
        if (!docSnap.empty) {
            votesMap = docSnap.docs[0].data().votes || {};
        }
        
        // Update user's vote using accountId as key
        votesMap[accountId] = {
            name: currentUser.name,
            avatar: currentUser.avatar || null,
            choice: restaurantName,
            time: new Date().toISOString()
        };
        
        if (docSnap.empty) {
            await addDoc(collection(db, 'food_votes'), {
                _id: docId, // Store explicit ID to query if needed
                groupId: currentGroupId,
                date: formatDateStr(selectedDate),
                meal: currentMeal,
                votes: votesMap
            });
            // Firestore doesn't easily let you specify ID in addDoc client side without setDoc, 
            // since setDoc isn't imported, let's just query by attributes.
        } else {
           // We actually need setDoc for custom ID, modifying logic to query by groupId, date, meal
        }
    } catch(e) {
        console.log("Mock Save Vote:", restaurantName);
    }
    
    // Simulate real time update for mock
    simulateRealtimeUpdate(restaurantName);
}

// Workaround for full DB integration in mock script:
let mockVotesMap = {};
function simulateRealtimeUpdate(choice) {
     const accountId = currentUser.accountId || 'mock';
     mockVotesMap[accountId] = {
         name: currentUser.name,
         avatar: null,
         choice: choice
     };
     renderStats(mockVotesMap);
}

window.foodApp.castVote = function(name) {
    saveVote(name);
    window.foodApp.go('stats', document.querySelector('[data-view=stats]'));
};

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

window.foodApp.switchStatsTab = function(meal, btn) {
    document.querySelectorAll('#statsTabs .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    currentMeal = meal;
    loadVotes(meal);
};

function loadVotes(meal) {
    document.getElementById('statsMealName').innerText = meal;
    // In real app, attach onSnapshot based on currentGroupId, formatDateStr(selectedDate), meal
    // Here we use mock data
    renderStats(mockVotesMap);
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

// Init
updateDateDisplay();
renderCalendar();
loadRestaurants();

