window.foodApp = (function() {
    // 預設/暫存資料區 (未來可替換為 Firestore onSnapshot 監聽)
    let currentCategory = 'lunch';
    let currentMode = 'vote'; // 'vote' 或 'wheel'
    let isSpinning = false;
    
    // 取得當前使用者 (銜接 Nexus 架構)
    const currentUser = JSON.parse(sessionStorage.getItem('familyCheckInUser')) || { name: '測試員', avatar: 'https://ui-avatars.com/api/?name=T' };
    
    // 模擬資料庫儲存的餐廳結構
    let foodDatabase = [
        { id: '1', store: '麥當勞', item: '大麥克套餐', price: '2', types: ['lunch', 'dinner', 'latenight'], votes: ['爸爸'] },
        { id: '2', store: '巷口麵攤', item: '麻醬麵+貢丸湯', price: '1', types: ['breakfast', 'lunch', 'dinner'], votes: ['媽媽', '俊俊'] },
        { id: '3', store: '鼎泰豐', item: '小籠包', price: '3', types: ['lunch', 'dinner'], votes: [] },
        { id: '4', store: '美而美', item: '鐵板麵加蛋', price: '1', types: ['breakfast'], votes: ['爸爸', '媽媽'] }
    ];

    // 初始化
    function init() {
        setCategory('lunch', 1);
        bindTagEvents();
    }

    // 切換餐期 (早/中/晚/宵夜)
    function setCategory(cat, index) {
        currentCategory = cat;
        // 滑動底線動畫
        document.getElementById('foodTabIndicator').style.transform = `translateX(${index * 100}%)`;
        // 更新 Tab 顏色
        document.querySelectorAll('.f-tab').forEach((tab, i) => {
            tab.classList.toggle('active', i === index);
        });
        refreshView();
    }

    // 切換 票選/輪盤 模式
    function switchMode(mode) {
        currentMode = mode;
        document.getElementById('viewVote').classList.toggle('active', mode === 'vote');
        document.getElementById('viewWheel').classList.toggle('active', mode === 'wheel');
        refreshView();
    }

    // 根據當前設定重新渲染畫面
    function refreshView() {
        const filteredData = foodDatabase.filter(f => f.types.includes(currentCategory));
        
        if (currentMode === 'vote') {
            renderVoteList(filteredData);
        } else {
            renderWheel(filteredData);
        }
    }

    // ================= 票選模式邏輯 =================
    function renderVoteList(data) {
        const container = document.getElementById('voteListContainer');
        if (data.length === 0) {
            container.innerHTML = `<div style="text-align:center; padding:40px; color:var(--f-text-sub);">這餐還沒有候選名單喔！<br>趕快提議一個吧🤤</div>`;
            return;
        }

        // 找出最高票數做為 100% 的比例基準
        const maxVotes = Math.max(...data.map(d => d.votes.length), 1);
        // 按票數排序
        data.sort((a, b) => b.votes.length - a.votes.length);

        container.innerHTML = data.map(food => {
            const hasVoted = food.votes.includes(currentUser.name);
            const progressPct = (food.votes.length / maxVotes) * 100;
            const priceStr = food.price === '1' ? '💰 平價' : food.price === '2' ? '💰💰 中等' : '💰💰💰 昂貴';
            
            // 繪製頭像堆疊 (Facepile)
            const avatarsHtml = food.votes.map(voterName => {
                const avatarUrl = window.userAvatarMap?.[voterName] || `https://ui-avatars.com/api/?name=${voterName}&background=e5e7eb`;
                return `<img src="${avatarUrl}" title="${voterName}">`;
            }).join('');

            return `
            <div class="vote-card ${hasVoted ? 'voted' : ''}" onclick="window.foodApp.toggleVote('${food.id}')">
                <div class="vote-bg-progress" style="width: ${progressPct}%;"></div>
                <div class="vote-card-content">
                    <div class="vc-left">
                        <h4>${food.store} - ${food.item}</h4>
                        <p><span class="price-tag">${priceStr}</span> ${food.votes.length} 人想吃</p>
                    </div>
                    <div class="vc-right">
                        <div class="facepile">${avatarsHtml}</div>
                        <div class="vote-count-badge">${hasVoted ? '✓ 已投' : '投票'}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
    }

    function toggleVote(foodId) {
        // [對接 Firestore 點] : 這裡應改為 updateDoc 更新陣列
        const food = foodDatabase.find(f => f.id === foodId);
        if (!food) return;

        const idx = food.votes.indexOf(currentUser.name);
        if (idx > -1) {
            food.votes.splice(idx, 1); // 已經投過，取消
        } else {
            food.votes.push(currentUser.name); // 投票
        }
        refreshView();
    }

    // ================= 輪盤模式邏輯 =================
    const wheelColors = ["#10b981", "#3b82f6", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316"];
    let currentAngle = 0;
    let activeWheelData = [];

    function renderWheel(data) {
        activeWheelData = data;
        const canvas = document.getElementById('foodWheelCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (data.length === 0) {
            ctx.font = "16px sans-serif"; ctx.fillStyle = "#999"; ctx.textAlign = "center";
            ctx.fillText("尚無美食，請先新增", 160, 160); return;
        }

        const numOptions = data.length;
        const arcSize = (2 * Math.PI) / numOptions;
        const centerX = 160, centerY = 160, radius = 150;

        for (let i = 0; i < numOptions; i++) {
            const angle = currentAngle + i * arcSize;
            
            // 畫扇形
            ctx.beginPath();
            ctx.fillStyle = wheelColors[i % wheelColors.length];
            ctx.moveTo(centerX, centerY);
            ctx.arc(centerX, centerY, radius, angle, angle + arcSize);
            ctx.lineTo(centerX, centerY);
            ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();

            // 畫文字
            ctx.save();
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 16px sans-serif";
            ctx.translate(centerX, centerY);
            ctx.rotate(angle + arcSize / 2);
            ctx.textAlign = "right";
            // 截斷過長文字
            let text = data[i].store;
            if(text.length > 6) text = text.substring(0,5)+'...';
            ctx.fillText(text, radius - 15, 6);
            ctx.restore();
        }
    }

    function spinWheel() {
        if (isSpinning || activeWheelData.length === 0) return;
        isSpinning = true;

        const spinRounds = 6 + Math.floor(Math.random() * 4); // 6~10圈
        const randomDegree = Math.random() * 360;
        const totalDegrees = spinRounds * 360 + randomDegree;
        
        let start = null;
        const duration = 4500; // 4.5秒

        function animate(timestamp) {
            if (!start) start = timestamp;
            const progress = Math.min((timestamp - start) / duration, 1);
            // EaseOutQuart
            const easeOut = 1 - Math.pow(1 - progress, 4);
            const currentDegree = easeOut * totalDegrees;
            
            currentAngle = (currentDegree * Math.PI) / 180;
            renderWheel(activeWheelData);

            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                isSpinning = false;
                showWinner(currentDegree % 360);
            }
        }
        requestAnimationFrame(animate);
    }

    function showWinner(finalDegree) {
        const numOptions = activeWheelData.length;
        const degreesPerSlice = 360 / numOptions;
        // 指針在正上方 (270度 = -90度)
        let normalizedDegree = (270 - (finalDegree % 360) + 360) % 360;
        const selectedIndex = Math.floor(normalizedDegree / degreesPerSlice);
        const winner = activeWheelData[selectedIndex];
        
        // 觸發彩帶動畫與提示
        fireConfetti();
        setTimeout(() => alert(`🎉 今晚就決定吃：\n【${winner.store} - ${winner.item}】！`), 300);
    }

    // ================= 新增/管理 邏輯 =================
    function openManageModal() { document.getElementById('foodManageModal').classList.add('active'); }
    function closeManageModal() { document.getElementById('foodManageModal').classList.remove('active'); }
    
    function bindTagEvents() {
        document.querySelectorAll('.type-tag').forEach(tag => {
            tag.addEventListener('click', (e) => {
                e.target.classList.toggle('active');
            });
        });
    }

    function submitFood() {
        const store = document.getElementById('foodStoreName').value.trim();
        const item = document.getElementById('foodItemName').value.trim();
        const price = document.getElementById('foodPrice').value;
        const types = Array.from(document.querySelectorAll('.type-tag.active')).map(t => t.dataset.type);

        if (!store || types.length === 0) return alert('請填寫店名並至少選擇一個餐期！');

        // [對接 Firestore 點] : 這裡改為 addDoc
        foodDatabase.push({
            id: Date.now().toString(),
            store, item: item || '招牌餐點', price, types, votes: [currentUser.name] // 提議者預設投一票
        });

        // 清空表單
        document.getElementById('foodStoreName').value = '';
        document.getElementById('foodItemName').value = '';
        closeManageModal();
        refreshView();
    }

    // 簡易彩帶煙火特效 (Confetti)
    function fireConfetti() {
        const canvas = document.getElementById('confettiCanvas');
        canvas.style.display = 'block';
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        let particles = [];
        for(let i=0; i<100; i++) {
            particles.push({
                x: canvas.width/2, y: canvas.height/2,
                vx: (Math.random()-0.5)*20, vy: (Math.random()-1)*20,
                color: wheelColors[Math.floor(Math.random()*wheelColors.length)],
                size: Math.random()*8+4
            });
        }
        function draw() {
            ctx.clearRect(0,0,canvas.width,canvas.height);
            particles.forEach((p, i) => {
                p.x += p.vx; p.y += p.vy; p.vy += 0.5; // 重力
                ctx.fillStyle = p.color;
                ctx.fillRect(p.x, p.y, p.size, p.size);
                if(p.y > canvas.height) particles.splice(i, 1);
            });
            if(particles.length > 0) requestAnimationFrame(draw);
            else canvas.style.display = 'none';
        }
        draw();
    }

    // 將外部需呼叫的方法暴露出去
    return {
        init, setCategory, switchMode, toggleVote, spinWheel,
        openManageModal, closeManageModal, submitFood
    };
})();

// DOM 載入後啟動
document.addEventListener('DOMContentLoaded', () => {
    window.foodApp.init();
});
