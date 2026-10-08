import { db } from "./firebase-config.js"; 
import { collection, doc, getDoc, getDocs, updateDoc, onSnapshot, query, where, addDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

window.foodApp = (function() {
    
    // ================= 狀態變數 =================
    let currentUser = null;
    let currentGroupId = null;
    let groupMembers = []; 
    let restaurants = [];
    
    // 【修改 1, 3】跨日重置與全局統整
    // 一次性儲存今日四個時段的投票結果與對應的 Firebase Document ID
    let todayVotes = { '早餐': {}, '午餐': {}, '晚餐': {}, '宵夜': {} };
    let voteDocIds = { '早餐': null, '午餐': null, '晚餐': null, '宵夜': null };

    let selectedMeal = '晚餐'; // 投票頁面選擇的餐期
    let statsCurrentTab = '晚餐'; // 結果頁面正在查看的餐期
    let filter = '全部';
    
    let wheelBusy = false;
    let wheelRotation = 0;
    let lastWinner = null;
    
    let unsubscribeRestaurants = null;
    let unsubscribeVotes = null;

    // 取得「當地」時區的今日日期字串 YYYY-MM-DD
    function getLocalTodayDateString() {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    // ================= 1. 初始化 =================
    async function init() {
        try {
            currentUser = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
            currentGroupId = sessionStorage.getItem('nexus_active_group_id');

            if (!currentUser || !currentGroupId) {
                console.warn('尚未登入或遺失群組 ID');
                return;
            }

            // 【修改 2】管理員權限檢查，顯示清除按鈕
            const isAdmin = (currentUser.role === 'admin' || currentUser.role === 'parent');
            if (isAdmin && document.getElementById('adminClearBtn')) {
                document.getElementById('adminClearBtn').style.display = 'block';
            }

            await fetchGroupMembers();
            listenRestaurants();
            listenTodayVotes(); // 監聽今天的全部投票
            go('home');
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
            if(document.getElementById('groupMemberCount')) {
                document.getElementById('groupMemberCount').innerText = `${groupMembers.length} 位成員`;
            }
            updateMemberUI();
        } catch (e) {
            console.error("讀取成員失敗", e);
        }
    }

    function listenRestaurants() {
        const q = query(collection(db, "food_restaurants"), where("groupId", "==", currentGroupId));
        unsubscribeRestaurants = onSnapshot(q, (snapshot) => {
            restaurants = [];
            snapshot.forEach(doc => { restaurants.push({ id: doc.id, ...doc.data() }); });
            renderRestaurants();
            if (document.getElementById('vote')?.classList.contains('active')) renderVoteList();
            if (document.getElementById('stats')?.classList.contains('active')) renderStats();
        });
    }

    // 監聽今日「所有時段」的投票，達到跨日自動重置
    function listenTodayVotes() {
        if (unsubscribeVotes) unsubscribeVotes();
        
        const todayStr = getLocalTodayDateString();
        const q = query(
            collection(db, "food_votes"), 
            where("groupId", "==", currentGroupId),
            where("date", "==", todayStr)
        );

        unsubscribeVotes = onSnapshot(q, (snapshot) => {
            // 重置暫存
            todayVotes = { '早餐': {}, '午餐': {}, '晚餐': {}, '宵夜': {} };
            voteDocIds = { '早餐': null, '午餐': null, '晚餐': null, '宵夜': null };
            
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (todayVotes[data.meal] !== undefined) {
                    todayVotes[data.meal] = data.votes || {};
                    voteDocIds[data.meal] = docSnap.id;
                }
            });

            updateMemberUI();
            if (document.getElementById('vote')?.classList.contains('active')) renderVoteList();
            if (document.getElementById('stats')?.classList.contains('active')) renderStats();
        });
    }

    // ================= 2. UI 互動與渲染 =================
    function go(id, btn) {
        document.querySelectorAll('.view').forEach(x => x.classList.remove('active'));
        document.getElementById(id)?.classList.add('active');
        document.querySelectorAll('.nav button').forEach(x => x.classList.remove('active'));
        if (btn) btn.classList.add('active');
        
        // 進入統計頁時，預設顯示剛剛在投票頁選擇的餐期
        if (id === 'stats') {
            switchStatsTab(selectedMeal);
        }
        
        if (id === 'manage') renderRestaurants();
        if (id === 'vote') { updateMemberUI(); renderVoteList(); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // 結果頁 (Stats) 的頁籤切換
    function switchStatsTab(meal, btnEl = null) {
        statsCurrentTab = meal;
        document.querySelectorAll('#statsTabs .chip').forEach(el => el.classList.remove('active'));
        
        if (btnEl) {
            btnEl.classList.add('active');
        } else {
            // 自動尋找對應的按鈕加 active
            document.querySelectorAll('#statsTabs .chip').forEach(el => {
                if (el.innerText === meal) el.classList.add('active');
            });
        }
        renderStats();
    }

    function getAvatarHtml(userObj, cssClass = "face real-avatar") {
        const url = userObj?.avatar || `https://ui-avatars.com/api/?name=${userObj?.name || 'User'}&background=e5e7eb`;
        return `<img src="${url}" class="${cssClass}" alt="${userObj?.name}" />`;
    }

    function generateMemberFaces(containerId, activeVotesMap) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        container.innerHTML = groupMembers.map((m) => {
            const isMe = m.name === currentUser.name;
            const hasVoted = !!activeVotesMap[m.name];
            return `
            <button class="member ${isMe ? 'current' : ''}" style="pointer-events: none;">
                ${getAvatarHtml(m, "face real-avatar")}
                <span>${m.name}</span>
                ${hasVoted ? '<span style="color:var(--green2); margin-left:4px;">✓</span>' : ''}
            </button>`;
        }).join('');
    }

    function updateMemberUI() {
        if (!currentUser) return;
        const myName = currentUser.name;
        
        if(document.getElementById('currentMemberName')) document.getElementById('currentMemberName').textContent = myName;
        const headerBtn = document.getElementById('headerAvatarBtn');
        if(headerBtn) headerBtn.innerHTML = getAvatarHtml(currentUser, "real-avatar");
        if(document.getElementById('voteMemberName')) document.getElementById('voteMemberName').textContent = myName;
        
        const voteFaceContainer = document.getElementById('voteFaceContainer');
        if(voteFaceContainer) voteFaceContainer.innerHTML = getAvatarHtml(currentUser, "face real-avatar");
        
        const currentMealVotes = todayVotes[selectedMeal] || {};
        generateMemberFaces('homeMemberStrip', {});
        generateMemberFaces('voteMemberStrip', currentMealVotes);

        const hasVote = !!currentMealVotes[myName];
        const s = document.getElementById('voteStatus');
        if(s) {
            s.textContent = hasVote ? '已投票 · ' + getRestaurantName(currentMealVotes[myName]) : '尚未投票';
            s.classList.toggle('done', hasVote);
        }
    }

    function chooseMeal(meal, emoji) {
        selectedMeal = meal;
        if(document.getElementById('mealEyebrow')) document.getElementById('mealEyebrow').textContent = emoji + ' ' + meal;
        go('vote', document.querySelector('[data-view=vote]'));
        showList();
    }

    // ================= 3. 管理員功能 =================
    async function clearCurrentStats() {
        if (!confirm(`確定要清除今日「${statsCurrentTab}」的所有投票結果嗎？\n此動作無法還原。`)) return;
        
        const docId = voteDocIds[statsCurrentTab];
        if (docId) {
            try {
                await deleteDoc(doc(db, "food_votes", docId));
                toast(`已清除 ${statsCurrentTab} 投票結果`);
            } catch (e) {
                toast('清除失敗，請檢查權限');
            }
        } else {
            toast('此時段目前沒有投票紀錄');
        }
    }

    // ================= 4. 核心邏輯 (投票、餐廳管理、渲染) =================
    async function vote(restId) {
        const myName = currentUser.name;
        const currentMealVotes = todayVotes[selectedMeal] || {};
        const previous = currentMealVotes[myName];
        
        let docId = voteDocIds[selectedMeal];
        
        try {
            if (!docId) {
                // 如果這個時段今天還沒人投過，先建立 Document
                const todayStr = getLocalTodayDateString();
                const newDocRef = await addDoc(collection(db, "food_votes"), {
                    groupId: currentGroupId,
                    date: todayStr,
                    meal: selectedMeal,
                    votes: { [myName]: restId }
                });
                // Snapshot 會自動更新 voteDocIds，但這裡先賦值確保順暢
                voteDocIds[selectedMeal] = newDocRef.id;
            } else {
                // 已有 Document，更新欄位
                await updateDoc(doc(db, "food_votes", docId), { [`votes.${myName}`]: restId });
            }
            
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
        
        const currentMealVotes = todayVotes[selectedMeal] || {};
        
        el.innerHTML = c.map(r => {
            const selected = currentMealVotes[currentUser.name] === r.id;
            const count = Object.values(currentMealVotes).filter(x => x === r.id).length;
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
        const targetVotes = todayVotes[statsCurrentTab] || {};
        
        if(document.getElementById('statsMealName')) document.getElementById('statsMealName').textContent = statsCurrentTab;
        const total = Object.keys(targetVotes).length;
        if(document.getElementById('totalVotes')) document.getElementById('totalVotes').textContent = total;
        
        const counts = {}; 
        Object.values(targetVotes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        
        const rows = Object.entries(counts).map(([id, n]) => ({ r: restaurants.find(x => x.id == id), n })).filter(x => x.r).sort((a, b) => b.n - a.n);
        const winner = rows[0];
        
        if(document.getElementById('winnerStatName')) document.getElementById('winnerStatName').textContent = winner ? winner.r.name : '尚未有人投票';
        if(document.getElementById('winnerStatScore')) document.getElementById('winnerStatScore').textContent = winner ? `${winner.n} 票 · ${Math.round(winner.n / Math.max(total, 1) * 100)}%` : '投下第一票吧';
        if(document.getElementById('peopleLabel')) document.getElementById('peopleLabel').textContent = `${total} / ${groupMembers.length} 人已完成投票`;
        
        if(document.getElementById('peopleFaces')) {
            document.getElementById('peopleFaces').innerHTML = groupMembers.map(m => {
                if (targetVotes[m.name]) {
                    return `<img src="${m.avatar || `https://ui-avatars.com/api/?name=${m.name}`}" class="face real-avatar" title="${m.name}" style="border: 2px solid #fff;" />`;
                }
                return '';
            }).join('');
        }
        
        if(document.getElementById('ranking')) document.getElementById('ranking').innerHTML = rows.length ? rows.map((x, i) => `
            <div style="margin-bottom:18px">
                <div class="rank"><strong>${i + 1}. ${x.r.name}</strong><span>${x.n} 票 · ${Math.round(x.n / total * 100)}%</span></div>
                <div class="bar"><i style="width:${x.n / total * 100}%"></i></div>
            </div>`).join('') : '<div class="empty">還沒有投票紀錄。<br>先去投一票吧！</div>';
        
        if(document.getElementById('memberVotes')) document.getElementById('memberVotes').innerHTML = groupMembers.map(m => {
            const id = targetVotes[m.name];
            const r = restaurants.find(x => x.id === id);
            return `
            <div class="member-vote-row">
                ${getAvatarHtml(m, "face real-avatar")}
                <span class="mv-name">${m.name}</span>
                <span class="mv-choice">${r ? foodEmoji(r.food) + ' ' + r.name : '尚未投票'}</span>
            </div>`;
        }).join('');
    }

    async function saveRestaurant() {
        const name = document.getElementById('rName').value.trim();
        const food = document.getElementById('rFood').value.trim();
        const editId = document.getElementById('editId').value;
        if (!name || !food) { toast('店名與代表食物一定要填喔'); return; }

        const data = {
            groupId: currentGroupId, name, type: document.getElementById('rType').value,
            price: document.getElementById('rPrice').value, food, meal: document.getElementById('rMeal').value,
            tags: document.getElementById('rTags').value.trim(), note: document.getElementById('rNote').value.trim(),
            updatedAt: serverTimestamp()
        };

        try {
            if (editId) { await updateDoc(doc(db, "food_restaurants", editId), data); toast('已更新餐廳 ✨'); } 
            else { await addDoc(collection(db, "food_restaurants"), data); toast('已加入餐廳 🎉'); }
            closeModal();
        } catch (e) { toast('儲存失敗，請重試'); }
    }

    async function removeRestaurant(id) {
        if (!confirm('確定要刪除這間餐廳嗎？')) return;
        try { await deleteDoc(doc(db, "food_restaurants", id)); toast('餐廳已刪除'); } 
        catch(e) { toast('刪除失敗'); }
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

    async function acceptWheelWinner() {
        if (!lastWinner) return;
        await vote(lastWinner.id); 
        setTimeout(() => go('stats', document.querySelector('[data-view=stats]')), 350);
    }

    // ================= 5. 其他輔助與動畫 =================
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
            setTimeout(() => { showWinner(winner); wheelBusy = false; document.getElementById('spinBtn').disabled = false; }, 4100);
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
    function filterRestaurants(type, el) { filter = type; document.querySelectorAll('.chips .chip').forEach(x => x.classList.remove('active')); el.classList.add('active'); renderRestaurants(); }

    function shareResult() {
        const targetVotes = todayVotes[statsCurrentTab] || {};
        const rows = Object.entries(targetVotes).map(([name, rid]) => restaurants.find(r => r.id === rid)?.name).filter(Boolean);
        const counts = {}; rows.forEach(n => counts[n] = (counts[n] || 0) + 1);
        const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const text = winner ? `🍽️ 今日【${statsCurrentTab}】吃什麼？\n🏆 ${winner[0]}\n${winner[1]} 票\n\n吃什麼，不用再吵 😆` : `🍽️ 今日【${statsCurrentTab}】還沒有決定吃什麼！`;
        if (navigator.share) navigator.share({ title: '吃什麼｜投票結果', text }).catch(() => { });
        else navigator.clipboard?.writeText(text).then(() => toast('結果已複製 📋')).catch(() => toast(text));
    }

    function finishDecision() {
        const targetVotes = todayVotes[statsCurrentTab] || {};
        const counts = {}; Object.values(targetVotes).forEach(id => counts[id] = (counts[id] || 0) + 1);
        const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
        const r = restaurants.find(x => x.id === winnerId);
        if (!r) { toast('還沒有足夠的投票結果'); return; }
        makeConfetti(); playWinSound(); toast('好！就決定是 ' + r.name + ' 🎉');
    }

    function getRestaurantName(id) { return restaurants.find(r => r.id === id)?.name || '已刪除的餐廳'; }
    function candidates() { return restaurants.filter(r => r.meal === '不限' || r.meal === selectedMeal); }
    function showWheel() { document.getElementById('wheelPanel').style.display = 'block'; document.getElementById('listPanel').style.display = 'none'; document.getElementById('wheelState').textContent = '準備好了嗎？'; window.scrollTo({ top: document.getElementById('wheelPanel').offsetTop - 80, behavior: 'smooth' }); }
    function showList() { document.getElementById('wheelPanel').style.display = 'none'; document.getElementById('listPanel').style.display = 'block'; renderVoteList(); }
    function foodEmoji(food) { if (/麵|拉麵/.test(food)) return '🍜'; if (/飯|丼/.test(food)) return '🍚'; if (/壽司/.test(food)) return '🍣'; if (/牛排/.test(food)) return '🥩'; if (/披薩/.test(food)) return '🍕'; if (/漢堡/.test(food)) return '🍔'; if (/火鍋/.test(food)) return '🍲'; if (/蛋餅|早餐/.test(food)) return '🥞'; if (/咖啡/.test(food)) return '☕'; return '🍽️'; }

    function toast(msg) { const t = document.getElementById('toast'); if(!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(window.__toast); window.__toast = setTimeout(() => t.classList.remove('show'), 1900); }
    function beep(freq) { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(), o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = freq; o.type = 'sine'; g.gain.setValueAtTime(.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.08, ctx.currentTime + .02); g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + .18); o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + .2); } catch (e) { } }
    function playSpinSound() { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); [220, 280, 340, 420, 520, 650].forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = f; o.type = 'triangle'; g.gain.value = .025; o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + i * .28); o.stop(ctx.currentTime + i * .28 + .12); }); } catch (e) { } }
    function playWinSound() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f), i * 90)) }
    function makeConfetti() { const box = document.getElementById('confetti'); if(!box) return; box.innerHTML = ''; for (let i = 0; i < 70; i++) { const p = document.createElement('i'); p.style.left = Math.random() * 100 + '%'; p.style.setProperty('--x', (Math.random() * 240 - 120) + 'px'); p.style.animationDelay = (Math.random() * .35) + 's'; p.style.background = ['#10aa78', '#ffd977', '#ffab4c', '#9fc8ff', '#c7b8f4', '#ed6a62'][Math.floor(Math.random() * 6)]; p.style.transform = `rotate(${Math.random() * 360}deg)`; box.appendChild(p); } setTimeout(() => box.innerHTML = '', 2400); }

    return {
        init, go, chooseMeal, showWheel, showList, vote, 
        startSpin, acceptWheelWinner, filterRestaurants, openRestaurant, 
        closeModal, saveRestaurant, removeRestaurant, shareResult, 
        finishDecision, switchStatsTab, clearCurrentStats
    };

})();

document.addEventListener("DOMContentLoaded", () => {
    if(window.foodApp && typeof window.foodApp.init === 'function') {
        window.foodApp.init();
    }
});
