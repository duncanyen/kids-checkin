// ⚠️ 確保這裡的路徑與您的 firebase-config.js 位置相符
import { db } from "./firebase-config.js"; 
import { collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// 將所有功能綁定到 HTML 可讀取的 window.foodApp
window.foodApp = (function() {
    
    // ================= 狀態變數 =================
    let currentUser = null;
    let currentGroupId = null;
    let groupMembers = []; 
    
    let restaurants = [];
    let voteDocId = null; 
    let votes = {}; 

    let selectedMeal = '晚餐';
    let filter = '全部';
    let wheelBusy = false;
    let wheelRotation = 0;
    let lastWinner = null;
    let unsubscribeRestaurants = null;
    let unsubscribeVotes = null;

    // ================= 初始化 =================
    async function init() {
        try {
            currentUser = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
            currentGroupId = sessionStorage.getItem('nexus_active_group_id');

            if (!currentUser || !currentGroupId) {
                console.warn('尚未登入或遺失群組 ID');
                return;
            }

            await fetchGroupMembers();
            listenRestaurants();
            go('home');
            await initVoteSession(selectedMeal);
        } catch (error) {
            console.error("模組初始化失敗:", error);
        }
    }

    async function fetchGroupMembers() {
        try {
            const groupSnap = await getDoc(doc(db, "groups", currentGroupId));
            if (groupSnap.exists() && groupSnap.data().members) {
                const memberNames = groupSnap.data().members;
                groupMembers = [];
                for (let i = 0; i < memberNames.length; i += 10) {
                    const chunk = memberNames.slice(i, i + 10);
                    const q = query(collection(db, "users"), where("name", "in", chunk));
                    const snap = await getDocs(q);
                    snap.forEach(d => groupMembers.push(d.data()));
                }
            } else {
                groupMembers = [currentUser];
            }
            document.getElementById('groupMemberCount').innerText = `${groupMembers.length} 位成員`;
            updateMemberUI();
        } catch (e) {
            console.error("讀取成員失敗", e);
        }
    }

    function listenRestaurants() {
        const q = query(collection(db, "food_restaurants"), where("groupId", "==", currentGroupId));
        unsubscribeRestaurants = onSnapshot(q, (snapshot) => {
            restaurants = [];
            snapshot.forEach(doc => {
                restaurants.push({ id: doc.id, ...doc.data() });
            });
            renderRestaurants();
            if (document.getElementById('vote')?.classList.contains('active')) renderVoteList();
            if (document.getElementById('stats')?.classList.contains('active')) renderStats();
        });
    }

    async function initVoteSession(mealType) {
        if (unsubscribeVotes) unsubscribeVotes();
        
        const todayStr = new Date().toISOString().split('T')[0];
        const q = query(
            collection(db, "food_votes"), 
            where("groupId", "==", currentGroupId),
            where("date", "==", todayStr),
            where("meal", "==", mealType)
        );

        const snap = await getDocs(q);
        if (snap.empty) {
            const newDoc = await addDoc(collection(db, "food_votes"), {
                groupId: currentGroupId, date: todayStr, meal: mealType, votes: {}
            });
            voteDocId = newDoc.id;
        } else {
            voteDocId = snap.docs[0].id;
        }

        unsubscribeVotes = onSnapshot(doc(db, "food_votes", voteDocId), (docSnap) => {
            if (docSnap.exists()) {
                votes = docSnap.data().votes || {};
                updateMemberUI();
                renderVoteList();
                if (document.getElementById('stats')?.classList.contains('active')) renderStats();
            }
        });
    }

    function go(id, btn) {
        document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
        document.getElementById(id)?.classList.add('active');
        document.querySelectorAll('.nav button').forEach(x => x.classList.remove('active'));
        if (btn) btn.classList.add('active');
        
        if (id === 'manage') renderRestaurants();
        if (id === 'stats') renderStats();
        if (id === 'vote') { updateMemberUI(); renderVoteList(); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function generateMemberFaces(containerId, isClickable = false) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = groupMembers.map((m) => {
            const isMe = m.name === currentUser.name;
            const emojiFace = getFaceEmoji(m.name);
            const clickEvent = isClickable ? `onclick="window.foodApp.selectMember('${m.name}')"` : '';
            return `<button class="member ${isMe ? 'current' : ''}" ${clickEvent}><span class="face">${emojiFace}</span>${m.name}</button>`;
        }).join('');
    }

    function updateMemberUI() {
        if (!currentUser) return;
        const myName = currentUser.name;
        if(document.getElementById('currentMemberName')) document.getElementById('currentMemberName').textContent = myName;
        if(document.getElementById('headerAvatar')) document.getElementById('headerAvatar').textContent = getFaceEmoji(myName);
        if(document.getElementById('voteMemberName')) document.getElementById('voteMemberName').textContent = myName;
        if(document.getElementById('voteFace')) document.getElementById('voteFace').textContent = getFaceEmoji(myName);
        
        generateMemberFaces('homeMemberStrip', true);
        generateMemberFaces('voteMemberStrip', true);

        const hasVote = !!votes[myName];
        const s = document.getElementById('voteStatus');
        if(s) {
            s.textContent = hasVote ? '已投票 · ' + getRestaurantName(votes[myName]) : '尚未投票';
            s.classList.toggle('done', hasVote);
        }
    }

    function selectMember(name) {
        const targetUser = groupMembers.find(m => m.name === name);
        if (targetUser) currentUser = targetUser;
        updateMemberUI();
        closeMemberPicker();
        toast('已切換成 ' + name + ' 👋');
    }

    function chooseMeal(meal, emoji) {
        selectedMeal = meal;
        if(document.getElementById('mealEyebrow')) document.getElementById('mealEyebrow').textContent = emoji + ' ' + meal;
        if(document.getElementById('statsMeal')) document.getElementById('statsMeal').textContent = meal;
        initVoteSession(meal); 
        go('vote', document.querySelector('[data-view=vote]'));
        showList();
    }

    async function saveRestaurant() {
        const name = document.getElementById('rName').value.trim();
        const food = document.getElementById('rFood').value.trim();
        const editId = document.getElementById('editId').value;

        if (!name || !food) { toast('店名與代表食物一定要填喔'); return; }

        const data = {
            groupId: currentGroupId,
            name,
            type: document.getElementById('rType').value,
            price: document.getElementById('rPrice').value,
            food,
            meal: document.getElementById('rMeal').value,
            tags: document.getElementById('rTags').value.trim(),
            note: document.getElementById('rNote').value.trim(),
            updatedAt: serverTimestamp()
        };

        try {
            if (editId) {
                await updateDoc(doc(db, "food_restaurants", editId), data);
                toast('已更新餐廳 ✨');
            } else {
                await addDoc(collection(db, "food_restaurants"), data);
                toast('已加入餐廳 🎉');
            }
            closeModal();
        } catch (e) { toast('儲存失敗，請重試'); }
    }

    async function removeRestaurant(id) {
        if (!confirm('確定要刪除這間餐廳嗎？')) return;
        try {
            await deleteDoc(doc(db, "food_restaurants", id));
            toast('餐廳已刪除');
        } catch(e) { toast('刪除失敗'); }
    }

    function renderRestaurants() {
        const list = restaurants.filter(r => filter === '全部' || r.type === filter);
        const el = document.getElementById('restaurantList');
        if (!el) return;
        el.innerHTML = list.length ? list.map(r => `
            <div class="list-item">
                <div class="foodpic">${foodEmoji(r.food)}</div>
                <div class="list-info"><b>${r.name}</b><small>${r.type} · ${r.food} · ${r.price} · ${r.meal}</small></div>
                <button class="action" onclick="window.foodApp.openRestaurant('${r.id}')">✎</button>
                <button class="action danger" onclick="window.foodApp.removeRestaurant('${r.id}')">×</button>
            </div>`).join('') : '<div class="empty">還沒有餐廳</div>';
    }

    async function vote(restId) {
        if (!voteDocId) return;
        const myName = currentUser.name;
        const previous = votes[myName];
        
        votes[myName] = restId;
        renderVoteList();
        updateMemberUI();

        try {
            await updateDoc(doc(db, "food_votes", voteDocId), { [`votes.${myName}`]: restId });
            if(previous === restId) toast('你已經投過這間囉 👍');
            else if(previous) toast('已把票改投給 '+getRestaurantName(restId)+' 🔄');
            else toast(myName+' 已投票！ '+getRestaurantName(restId)+' 🍽️');
        } catch (e) { toast('投票失敗，請檢查網路'); }
    }

    function renderVoteList() {
        const c = candidates();
        const el = document.getElementById('voteList');
        if (!el) return;
        if (!c.length) { el.innerHTML = '<div class="empty">這個時段還沒有候選餐廳。<br>到「管理」新增一間吧！</div>'; return; }
        
        el.innerHTML = c.map(r => {
            const selected = votes[currentUser.name] === r.id;
            const count = Object.values(votes).filter(x => x === r.id).length;
            return `<div class="restaurant">
                <div class="foodpic">${foodEmoji(r.food)}</div>
                <div style="min-width:0">
                    <h3>${r.name}</h3>
                    <div class="meta">${r.type} · ${r.food} · ${r.price}</div>
                    <div class="change-note">${count ? `目前 ${count} 票` : '目前 0 票'}</div>
                </div>
                <button class="vote ${selected ? 'voted' : ''}" onclick="window.foodApp.vote('${r.id}')">${selected ? '✓ 已投' : '投票'}</button>
            </div>`;
        }).join('');
    }

    function renderStats() {
        if(document.getElementById('statsMeal')) document.getElementById('statsMeal').textContent = selectedMeal;
        const total = Object.keys(votes).length;
        if(document.getElementById('totalVotes')) document.getElementById('totalVotes').textContent = total;
        
        const counts = {}; 
        Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        
        const rows = Object.entries(counts).map(([id, n]) => ({ r: restaurants.find(x => x.id == id), n })).filter(x => x.r).sort((a, b) => b.n - a.n);
        const winner = rows[0];
        
        if(document.getElementById('winnerStatName')) document.getElementById('winnerStatName').textContent = winner ? winner.r.name : '尚未有人投票';
        if(document.getElementById('winnerStatScore')) document.getElementById('winnerStatScore').textContent = winner ? `${winner.n} 票 · ${Math.round(winner.n / Math.max(total, 1) * 100)}%` : '投下第一票吧';
        if(document.getElementById('peopleLabel')) document.getElementById('peopleLabel').textContent = `${total} / ${groupMembers.length} 人已完成投票`;
        if(document.getElementById('peopleFaces')) document.getElementById('peopleFaces').innerHTML = groupMembers.map(m => votes[m.name] ? `<span class="face" title="${m.name}">${getFaceEmoji(m.name)}</span>` : '').join('');
        
        if(document.getElementById('ranking')) document.getElementById('ranking').innerHTML = rows.length ? rows.map((x, i) => `
            <div style="margin-bottom:18px">
                <div class="rank"><strong>${i + 1}. ${x.r.name}</strong><span>${x.n} 票 · ${Math.round(x.n / total * 100)}%</span></div>
                <div class="bar"><i style="width:${x.n / total * 100}%"></i></div>
            </div>`).join('') : '<div class="empty">還沒有投票紀錄。<br>先回去投一票吧！</div>';
        
        if(document.getElementById('memberVotes')) document.getElementById('memberVotes').innerHTML = groupMembers.map(m => {
            const id = votes[m.name];
            const r = restaurants.find(x => x.id === id);
            return `<div class="member-vote-row"><span class="face">${getFaceEmoji(m.name)}</span><span class="mv-name">${m.name}</span><span class="mv-choice">${r ? foodEmoji(r.food) + ' ' + r.name : '尚未投票'}</span></div>`;
        }).join('');
    }

    async function acceptWheelWinner() {
        if (!lastWinner) return;
        await vote(lastWinner.id); 
        toast(currentUser.name + ' 已選擇 ' + lastWinner.name + ' 🎉');
        setTimeout(() => go('stats', document.querySelector('[data-view=stats]')), 350);
    }

    // ================= 輔助功能 =================
    function startSpin() {
        if (wheelBusy) return;
        const c = candidates();
        if (!c.length) { toast('這個時段還沒有候選餐廳'); return; }
        wheelBusy = true;
        document.getElementById('spinBtn').disabled = true;
        document.getElementById('winner').classList.remove('show');
        runCountdown(() => {
            const winner = c[Math.floor(Math.random() * c.length)];
            lastWinner = winner;
            const index = c.indexOf(winner);
            const segment = 360 / c.length;
            const target = 360 - (index * segment + segment / 2);
            wheelRotation += 1440 + target;
            document.getElementById('wheel').style.transform = `rotate(${wheelRotation}deg)`;
            document.getElementById('wheelState').textContent = '命運正在選擇……';
            playSpinSound();
            if (navigator.vibrate) navigator.vibrate([30, 40, 30, 40, 70]);
            setTimeout(() => {
                showWinner(winner);
                wheelBusy = false;
                document.getElementById('spinBtn').disabled = false;
            }, 4100);
        });
    }

    function runCountdown(done) {
        const overlay = document.getElementById('countdown');
        const num = document.getElementById('countNumber');
        overlay.classList.add('show');
        let n = 3; num.textContent = n; beep(420);
        const timer = setInterval(() => {
            n--;
            if (n > 0) { num.textContent = n; num.style.animation = 'none'; void num.offsetWidth; num.style.animation = 'pop .8s ease'; beep(n === 1 ? 620 : 500); }
            else { clearInterval(timer); overlay.classList.remove('show'); done(); }
        }, 850);
    }

    function showWinner(r) {
        document.getElementById('winnerFood').textContent = foodEmoji(r.food);
        document.getElementById('winnerName').textContent = r.name;
        document.getElementById('winnerMeta').textContent = `${r.type} · ${r.food} · ${r.price}`;
        document.getElementById('wheelState').textContent = '命運已經決定好了 ✨';
        document.getElementById('winner').classList.add('show');
        document.getElementById('spinBtn').textContent = '再轉一次';
        document.getElementById('spinBtn').disabled = false;
        if (navigator.vibrate) navigator.vibrate([80, 50, 100, 50, 180]);
        playWinSound(); makeConfetti();
    }

    function openRestaurant(id = null) {
        document.getElementById('modal').classList.add('show');
        document.getElementById('modalTitle').textContent = id ? '編輯餐廳' : '新增餐廳';
        document.getElementById('editId').value = id || '';
        const r = restaurants.find(x => x.id === id);
        document.getElementById('rName').value = r?.name || '';
        document.getElementById('rType').value = r?.type || '中式';
        document.getElementById('rPrice').value = r?.price || '$$';
        document.getElementById('rFood').value = r?.food || '';
        document.getElementById('rMeal').value = r?.meal || '晚餐';
        document.getElementById('rTags').value = r?.tags || '';
        document.getElementById('rNote').value = r?.note || '';
    }
    function closeModal() { document.getElementById('modal').classList.remove('show'); }
    
    function openMemberPicker() {
        const list = document.getElementById('memberPickerList');
        list.innerHTML = groupMembers.map((m) => `
            <button onclick="window.foodApp.selectMember('${m.name}')" style="width:100%;display:flex;align-items:center;gap:12px;background:${m.name === currentUser.name ? '#e4f8ef' : '#f7f9f8'};border:1px solid ${m.name === currentUser.name ? '#a9e3cc' : '#e7ece9'};padding:13px;border-radius:17px;margin-bottom:9px;text-align:left">
                <span class="face" style="width:38px;height:38px">${getFaceEmoji(m.name)}</span>
                <span style="flex:1"><b>${m.name}</b><small style="display:block;color:#7b8781;margin-top:3px">${votes[m.name] ? '已投票' : '尚未投票'}</small></span>
                ${m.name === currentUser.name ? '<b style="color:#087957">✓</b>' : ''}
            </button>`).join('');
        document.getElementById('memberModal').classList.add('show');
    }
    function closeMemberPicker() { document.getElementById('memberModal').classList.remove('show'); }

    function filterRestaurants(type, el) {
        filter = type;
        document.querySelectorAll('.chips .chip').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
        renderRestaurants();
    }

    function shareResult() {
        const rows = Object.entries(votes).map(([name, rid]) => restaurants.find(r => r.id === rid)?.name).filter(Boolean);
        const counts = {}; rows.forEach(n => counts[n] = (counts[n] || 0) + 1);
        const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const text = winner ? `🍽️ 今天吃什麼？\n🏆 ${winner[0]}\n${winner[1]} 票\n\n吃什麼，不用再吵 😆` : `🍽️ 今天還沒有決定吃什麼！`;
        if (navigator.share) navigator.share({ title: '吃什麼｜投票結果', text }).catch(() => { });
        else navigator.clipboard?.writeText(text).then(() => toast('結果已複製，可以貼到群組 📋')).catch(() => toast(text));
    }

    function finishDecision() {
        const counts = {}; Object.values(votes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const r = restaurants.find(x => x.id === winnerId);
        if (!r) { toast('還沒有足夠的投票結果'); return; }
        makeConfetti(); playWinSound(); toast('好！今晚就吃 ' + r.name + ' 🎉');
    }

    function getRestaurantName(id) { return restaurants.find(r => r.id === id)?.name || '已刪除的餐廳'; }
    function candidates() { return restaurants.filter(r => r.meal === '不限' || r.meal === selectedMeal); }
    function showWheel() { document.getElementById('wheelPanel').style.display = 'block'; document.getElementById('listPanel').style.display = 'none'; document.getElementById('wheelState').textContent = '準備好了嗎？'; window.scrollTo({ top: document.getElementById('wheelPanel').offsetTop - 80, behavior: 'smooth' }); }
    function showList() { document.getElementById('wheelPanel').style.display = 'none'; document.getElementById('listPanel').style.display = 'block'; renderVoteList(); }

    function getFaceEmoji(name) {
        if (/爸|哥|公/.test(name)) return '👨';
        if (/媽|姐|妹/.test(name)) return '👩';
        if (/明/.test(name)) return '🧒';
        return '🧑'; 
    }

    function foodEmoji(food) {
        if (/麵|拉麵/.test(food)) return '🍜'; if (/飯|丼/.test(food)) return '🍚'; if (/壽司/.test(food)) return '🍣'; if (/牛排/.test(food)) return '🥩'; if (/披薩/.test(food)) return '🍕'; if (/漢堡/.test(food)) return '🍔'; if (/火鍋/.test(food)) return '🍲'; if (/蛋餅|早餐/.test(food)) return '🥞'; if (/咖啡/.test(food)) return '☕'; return '🍽️';
    }

    function toast(msg) {
        const t = document.getElementById('toast'); 
        if(!t) return;
        t.textContent = msg; t.classList.add('show'); 
        clearTimeout(window.__toast); 
        window.__toast = setTimeout(() => t.classList.remove('show'), 1900);
    }
    function beep(freq) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.08, ctx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .18); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .2); } catch (e) { } }
    function playSpinSound() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); [220, 280, 340, 420, 520, 650].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.type = 'triangle'; g.gain.value = .025; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + i * .28); o.stop(ctx.currentTime + i * .28 + .12); }); } catch (e) { } }
    function playWinSound() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f), i * 90)) }
    function makeConfetti() {
        const box = document.getElementById('confetti'); 
        if(!box) return;
        box.innerHTML = '';
        for (let i = 0; i < 70; i++) {
            const p = document.createElement('i'); p.style.left = Math.random() * 100 + '%'; p.style.setProperty('--x', (Math.random() * 240 - 120) + 'px'); p.style.animationDelay = (Math.random() * .35) + 's'; p.style.background = ['#10aa78', '#ffd977', '#ffab4c', '#9fc8ff', '#c7b8f4', '#ed6a62'][Math.floor(Math.random() * 6)]; p.style.transform = `rotate(${Math.random() * 360}deg)`; box.appendChild(p);
        }
        setTimeout(() => box.innerHTML = '', 2400);
    }

    return {
        init, go, chooseMeal, selectMember, showWheel, showList, vote, 
        startSpin, acceptWheelWinner, filterRestaurants, openRestaurant, 
        closeModal, saveRestaurant, removeRestaurant, shareResult, 
        finishDecision, openMemberPicker, closeMemberPicker
    };

})();

document.addEventListener("DOMContentLoaded", () => {
    if(window.foodApp && typeof window.foodApp.init === 'function') {
        window.foodApp.init();
    }
});
