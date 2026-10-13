import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { 
    getFirestore, collection, addDoc, getDocs, query, where, 
    deleteDoc, doc, serverTimestamp, updateDoc
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

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
let currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;
if (!currentUser) { alert('請先登入！'); window.location.href = 'index.html'; }

// 修正：優先取得 users 集合中真正的 accountId，並移除 name 避免存錯
const currentAccountId = currentUser.accountId || currentUser.id || currentUser.uid || currentUser.account || "unknown";
const currentGroupId = localStorage.getItem('lastGroupId') || 'wJOpq0uAnXvO4ezZ1IK9';

// ================= 權限判斷邏輯 =================
const roleStr = String(currentUser.role || '').toLowerCase();
const nameStr = String(currentUser.name || '').toLowerCase(); 
const canViewIncome = 
    roleStr.includes('家長') || roleStr.includes('管理') || roleStr.includes('admin') || roleStr.includes('parent') ||
    nameStr.includes('爸') || nameStr.includes('媽') || nameStr.includes('admin');

if (!canViewIncome) {
    document.getElementById('statBoxIncome').style.display = 'none';
    document.getElementById('btnTypeIncome').style.display = 'none';
    document.querySelectorAll('.require-income').forEach(el => el.style.display = 'none');
    document.getElementById('revThisMonthExpense').parentElement.classList.add('full-width');
}

// --- 全域變數 ---
let currentDate = new Date(); 
let selectedDateStr = "";     
let monthData = [];            
let pieChartInstance = null;      
let barChartInstance = null;

let currentModalType = 'expense';
let currentChartType = 'expense'; 
let selectedCategory = "";

let currentScope = 'group'; // 'group' 或 'personal'
let selectedPersonalAccountId = null; // 當前選取的個人ID

let hasLoadedAllData = false;
let allExpensesData = [];
let allAvailableYears = new Set(); 

// 預設分類
const defaultExpenseCategories = [
    { id: '早餐', icon: '🥪', color: '#FFB74D' }, { id: '午餐', icon: '🍱', color: '#FF8A65' },
    { id: '晚餐', icon: '🍲', color: '#E57373' }, { id: '日用品', icon: '🛒', color: '#4DB6AC' },
    { id: '交通', icon: '⛽', color: '#90A4AE' }, { id: '水電瓦斯', icon: '⚡', color: '#4FC3F7' },
    { id: '學習娛樂', icon: '📚', color: '#9575CD' }, { id: '其他支出', icon: '📦', color: '#A1887F' }
];
const defaultIncomeCategories = [
    { id: '薪資', icon: '💼', color: '#4CAF50' }, { id: '獎金', icon: '🎊', color: '#66BB6A' },
    { id: '投資', icon: '📈', color: '#81C784' }, { id: '兼職', icon: '🧑‍💻', color: '#2E7D32' },
    { id: '零用錢', icon: '💰', color: '#FBC02D' }, { id: '其他收入', icon: '📥', color: '#B0BEC5' }
];
let customCategories = []; 
let currentCatModalType = 'expense';

function formatK(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return num;
}

async function initApp() {
    await loadCustomCategories(); 
    loadMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
}
initApp();

async function loadCustomCategories() {
    try {
        const q = query(collection(db, "customCategories"), where("groupId", "==", currentGroupId));
        const snap = await getDocs(q);
        customCategories = [];
        snap.forEach(docSnap => customCategories.push({ id: docSnap.id, ...docSnap.data() }));
    } catch (error) {
        console.error("載入自訂類別失敗：", error);
    }
}

window.switchMainView = function(view) {
    document.getElementById('tabCalendar').classList.remove('active');
    document.getElementById('tabReview').classList.remove('active');
    document.getElementById('calendarView').style.display = 'none';
    document.getElementById('reviewView').style.display = 'none';

    if (view === 'calendar') {
        document.getElementById('tabCalendar').classList.add('active');
        document.getElementById('calendarView').style.display = 'flex';
    } else {
        document.getElementById('tabReview').classList.add('active');
        document.getElementById('reviewView').style.display = 'flex';
        fetchAndRenderReviewData(); 
    }
};

async function loadMonthData(year, month) {
    const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
    const endStr = `${year}-${String(month).padStart(2,'0')}-31`; 
    
    document.getElementById('calendarMonthTitle').innerText = '讀取中...';
    
    try {
        const q = query(
            collection(db, "expenses"),
            where("groupId", "==", currentGroupId),
            where("date", ">=", startStr),
            where("date", "<=", endStr)
        );
        const snapshot = await getDocs(q);
        monthData = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.type) data.type = 'expense';
            monthData.push({ id: docSnap.id, ...data });
        });

        document.getElementById('calendarMonthTitle').innerText = `${year}年 ${month}月`;
        renderCalendar(year, month);
        renderPersonalAvatars(); 
        renderPieChart();
    } catch (error) {
        console.error("讀取資料失敗：", error);
        alert("讀取資料失敗，請檢查網路。");
    }
}

function renderCalendar(year, month) {
    const grid = document.getElementById('calendarGrid');
    while (grid.children.length > 7) { grid.removeChild(grid.lastChild); }
    const firstDayIndex = new Date(year, month - 1, 1).getDay();
    const totalDays = new Date(year, month, 0).getDate();
    const today = new Date();

    const dailyStats = {};
    monthData.forEach(item => {
        if (!dailyStats[item.date]) dailyStats[item.date] = { expense: 0, income: 0 };
        if (item.type === 'income') dailyStats[item.date].income += Number(item.amount);
        else dailyStats[item.date].expense += Number(item.amount);
    });

    for (let i = 0; i < firstDayIndex; i++) grid.appendChild(document.createElement('div'));

    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        const isToday = (day === today.getDate() && month - 1 === today.getMonth() && year === today.getFullYear());
        const stats = dailyStats[dateStr] || { expense: 0, income: 0 };

        const dayDiv = document.createElement('div');
        dayDiv.className = `day-cell ${isToday ? 'today' : ''}`;
        dayDiv.onclick = () => openModal('expenseModal', dateStr);

        let html = `<div class="date-num">${day}</div>`;
        if (stats.expense > 0) html += `<div class="day-expense">-${formatK(stats.expense)}</div>`;
        if (canViewIncome && stats.income > 0) html += `<div class="day-income">+${formatK(stats.income)}</div>`;
        
        dayDiv.innerHTML = html;
        grid.appendChild(dayDiv);
    }
}

window.changeMonth = function(offset) {
    currentDate.setMonth(currentDate.getMonth() + offset);
    loadMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
};

window.switchScope = function(scope) {
    currentScope = scope;
    document.getElementById('btnScopeGroup').classList.toggle('active', scope === 'group');
    document.getElementById('btnScopePersonal').classList.toggle('active', scope === 'personal');
    
    const avatarDiv = document.getElementById('avatarContainer');
    if(scope === 'personal') {
        avatarDiv.style.display = 'block';
    } else {
        avatarDiv.style.display = 'none';
    }
    renderPieChart();
};

function renderPersonalAvatars() {
    const avatarDiv = document.getElementById('avatarContainer');
    avatarDiv.innerHTML = '';
    
    const usersMap = {};
    monthData.forEach(item => {
        const uid = item.accountId || item.operator || '未知ID';
        const uname = item.operator || '未知';
        
        let userAvatar = null;
        if(uid === currentAccountId || uname === currentUser.name) {
            userAvatar = currentUser.avatar || currentUser.photoURL || currentUser.avatarUrl || null;
        }
        if(!usersMap[uid]) usersMap[uid] = { id: uid, name: uname, avatar: userAvatar };
    });
    const users = Object.values(usersMap);
    
    if(users.length === 0) {
        avatarDiv.innerHTML = '<div style="font-size:13px; color:#999;">當月尚無紀錄</div>';
        return;
    }

    if(!selectedPersonalAccountId && users.length > 0) {
        selectedPersonalAccountId = users[0].id;
    }
    
    users.forEach(u => {
        const btn = document.createElement('div');
        btn.className = `avatar-btn ${selectedPersonalAccountId === u.id ? 'active' : ''}`;
        
        if (u.avatar) {
            btn.innerHTML = `<img src="${u.avatar}" style="width:100%; height:100%; object-fit:cover; border-radius:50%; pointer-events:none;">`;
            btn.style.padding = '0';
            btn.style.lineHeight = '0';
        } else {
            btn.innerText = u.name.substring(0, 1);
        }
        
        btn.onclick = () => {
            selectedPersonalAccountId = u.id;
            renderPersonalAvatars(); 
            renderPieChart();
        };
        avatarDiv.appendChild(btn);
    });
}

window.switchChartType = function(type) {
    if (type === 'income' && !canViewIncome) return;
    currentChartType = type;
    document.getElementById('statBoxExpense').className = `stat-box ${type === 'expense' ? 'active-expense' : ''}`;
    document.getElementById('statBoxIncome').className = `stat-box ${type === 'income' ? 'active-income' : ''}`;
    renderPieChart();
}

function renderPieChart() {
    let totalExpense = 0, totalIncome = 0;
    const categorySums = {};
    
    const targetData = (currentScope === 'personal' && selectedPersonalAccountId) 
        ? monthData.filter(item => (item.accountId || item.operator || '未知ID') === selectedPersonalAccountId)
        : monthData;
    
    targetData.forEach(item => {
        const amt = Number(item.amount);
        if (item.type === 'income') totalIncome += amt;
        else totalExpense += amt;
        
        if (item.type === currentChartType) {
            categorySums[item.category] = (categorySums[item.category] || 0) + amt;
        }
    });

    document.getElementById('monthTotalExpense').innerText = `$${totalExpense.toLocaleString()}`;
    document.getElementById('monthTotalIncome').innerText = `$${totalIncome.toLocaleString()}`;

    const labels = [], data = [], bgColors = [];
    const baseList = currentChartType === 'expense' ? defaultExpenseCategories : defaultIncomeCategories;
    const fullList = [...baseList, ...customCategories.filter(c => c.type === currentChartType)];

    fullList.forEach(cat => {
        if (categorySums[cat.name || cat.id]) {
            labels.push(cat.name || cat.id);
            data.push(categorySums[cat.name || cat.id]);
            bgColors.push(cat.color || '#607D8B'); 
        }
    });

    const ctx = document.getElementById('expensePieChart').getContext('2d');
    if (pieChartInstance) pieChartInstance.destroy();

    if (data.length === 0) {
        pieChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: ['無紀錄'], datasets: [{ data: [1], backgroundColor: ['#eeeeee'] }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { tooltip: { enabled: false } } }
        });
        return;
    }

    pieChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ data: data, backgroundColor: bgColors, borderWidth: 2, borderColor: '#ffffff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 12 } } } } }
    });
}

async function fetchAndRenderReviewData() {
    if (!hasLoadedAllData) {
        try {
            const q = query(collection(db, "expenses"), where("groupId", "==", currentGroupId));
            const snapshot = await getDocs(q);
            allExpensesData = [];
            allAvailableYears.clear();
            
            snapshot.forEach(docSnap => {
                const data = docSnap.data();
                if (!data.type) data.type = 'expense';
                allExpensesData.push({ id: docSnap.id, ...data });
                
                if(data.date) {
                    allAvailableYears.add(data.date.substring(0, 4));
                }
            });
            allAvailableYears.add(currentDate.getFullYear().toString());
            
            hasLoadedAllData = true;
            
            const yearSelect = document.getElementById('reviewYearFilter');
            yearSelect.innerHTML = '';
            const sortedYears = Array.from(allAvailableYears).sort((a,b)=> b - a); 
            sortedYears.forEach(y => {
                const opt = document.createElement('option');
                opt.value = y;
                opt.text = y + " 年";
                yearSelect.appendChild(opt);
            });
            yearSelect.value = currentDate.getFullYear().toString(); 

        } catch (error) {
            console.error("讀取歷史資料失敗：", error);
            alert("歷史資料讀取失敗！");
            return;
        }
    }
    processReviewData();
    window.renderReviewYearData(); 
}

window.renderReviewYearData = function() {
    const selectedYear = document.getElementById('reviewYearFilter').value;
    let yearExp = 0, yearInc = 0;
    
    allExpensesData.forEach(item => {
        const amt = Number(item.amount);
        const isInc = item.type === 'income';
        if (item.date && item.date.substring(0, 4) === selectedYear) {
            if (isInc) yearInc += amt; else yearExp += amt;
        }
    });

    document.getElementById('revYearTitle').innerText = `${selectedYear}年度累計`;
    document.getElementById('revYearExpense').innerText = `支: $${yearExp.toLocaleString()}`;
    document.getElementById('revYearIncome').innerText = `收: $${yearInc.toLocaleString()}`;
    document.getElementById('revYearBalance').innerText = `$${(yearInc - yearExp).toLocaleString()}`;
}

function processReviewData() {
    const now = new Date();
    const currentY = now.getFullYear();
    const currentM = String(now.getMonth() + 1).padStart(2, '0');
    const currentYM = `${currentY}-${currentM}`;

    let thisMonthExp = 0, thisMonthInc = 0;
    const monthlyStats = {};

    allExpensesData.forEach(item => {
        const amt = Number(item.amount);
        const isInc = item.type === 'income';
        const dateStr = item.date || ""; 
        const itemYM = dateStr.substring(0, 7);
        const itemY = dateStr.substring(0, 4);
        
        if (itemYM === currentYM) {
            if (isInc) thisMonthInc += amt; else thisMonthExp += amt;
        }

        if (!monthlyStats[itemYM]) monthlyStats[itemYM] = { income: 0, expense: 0, year: itemY, month: itemYM.substring(5,7) };
        if (isInc) monthlyStats[itemYM].income += amt; else monthlyStats[itemYM].expense += amt;
    });

    document.getElementById('revThisMonthExpense').innerText = `NT$ ${thisMonthExp.toLocaleString()}`;
    document.getElementById('revThisMonthIncome').innerText = `NT$ ${thisMonthInc.toLocaleString()}`;
    document.getElementById('revThisMonthBalance').innerText = `NT$ ${(thisMonthInc - thisMonthExp).toLocaleString()}`;

    const sortedYMs = Object.keys(monthlyStats).sort((a, b) => b.localeCompare(a));
    const listContainer = document.getElementById('monthlyHistoryList');
    listContainer.innerHTML = '';
    
    if (sortedYMs.length === 0) {
        listContainer.innerHTML = '<div style="text-align:center; color:#999;">尚無歷史資料</div>';
    } else {
        sortedYMs.forEach(ym => {
            const d = monthlyStats[ym];
            const balance = d.income - d.expense;
            
            let badgeClass = 'neutral';
            if (balance > 0) badgeClass = 'positive';
            else if (balance < 0) badgeClass = 'negative';

            let balanceHtml = '';
            let incHtml = '';
            if (canViewIncome) {
                incHtml = `<div class="ml-row" style="color:var(--income-color)">收入 <span>$${d.income.toLocaleString()}</span></div>`;
                balanceHtml = `<div class="ml-balance-badge ${badgeClass}">${balance > 0 ? '+' : ''}$${balance.toLocaleString()}</div>`;
            }

            listContainer.innerHTML += `
                <div class="month-list-card">
                    <div class="ml-left">
                        <div class="ml-year">${d.year}年</div>
                        <div class="ml-month">${parseInt(d.month)}<span>月</span></div>
                    </div>
                    <div class="ml-right">
                        ${incHtml}
                        <div class="ml-row" style="color:var(--expense-color)">支出 <span>$${d.expense.toLocaleString()}</span></div>
                        ${balanceHtml}
                    </div>
                </div>
            `;
        });
    }

    const last6YMs = sortedYMs.slice(0, 6).reverse(); 
    const chartLabels = [];
    const chartExpData = [];
    
    last6YMs.forEach(ym => {
        chartLabels.push(`${parseInt(monthlyStats[ym].month)}月`);
        chartExpData.push(monthlyStats[ym].expense);
    });

    const ctxBar = document.getElementById('sixMonthBarChart').getContext('2d');
    if (barChartInstance) barChartInstance.destroy();
    barChartInstance = new Chart(ctxBar, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [{ label: '月度總支出', data: chartExpData, backgroundColor: '#ef9a9a', hoverBackgroundColor: '#e53935', borderRadius: 6 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: '#f0f0f0' } }, x: { grid: { display: false } } } }
    });

    const analysisBox = document.getElementById('chartAnalysisText');
    if (sortedYMs.length >= 2) {
        const diff = monthlyStats[sortedYMs[0]].expense - monthlyStats[sortedYMs[1]].expense;
        if (diff > 0) {
            analysisBox.className = 'chart-analysis warn';
            analysisBox.innerHTML = `💡 本月支出較上月 <b>增加了 NT$ ${diff.toLocaleString()}</b>，要注意控制預算哦！`;
        } else if (diff < 0) {
            analysisBox.className = 'chart-analysis good';
            analysisBox.innerHTML = `🎉 太棒了！本月支出較上月 <b>節省了 NT$ ${Math.abs(diff).toLocaleString()}</b>。`;
        } else {
            analysisBox.className = 'chart-analysis';
            analysisBox.innerHTML = `平穩發揮！本月支出與上個月持平。`;
        }
    } else {
        analysisBox.className = 'chart-analysis';
        analysisBox.innerHTML = `剛開始記帳嗎？持續記錄，這裡會為您分析每月的收支趨勢。`;
    }
}

window.openModal = function(modalId, dateStr = null) {
    if(dateStr) {
        selectedDateStr = dateStr;
        const [y, m, d] = dateStr.split('-');
        document.getElementById('modalDateTitle').innerText = `${y}年${parseInt(m)}月${parseInt(d)}日`;
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseNote').value = '';
        switchModalType('expense');
        renderDayList();
    }
    if(modalId === 'settingsModal') {
        renderManageCategories();
    }
    if(modalId === 'customCatModal') {
        document.getElementById('editCatId').value = '';
        document.getElementById('newCatName').value = '';
        document.getElementById('newCatEmoji').value = '';
        document.getElementById('newCatImage').value = '';
        document.getElementById('catModalTitle').innerText = '新增自訂類別';
        switchCatModalType('expense');
    }
    document.getElementById(modalId).style.display = 'flex';
};

window.closeModal = function(modalId) {
    document.getElementById(modalId).style.display = 'none';
};

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) { 
        event.target.style.display = "none"; 
    }
};

window.switchModalType = function(type) {
    if (type === 'income' && !canViewIncome) return;
    currentModalType = type;
    document.getElementById('btnTypeExpense').className = `type-btn ${type === 'expense' ? 'active expense' : ''}`;
    document.getElementById('btnTypeIncome').className = `type-btn ${type === 'income' ? 'active income' : ''}`;
    document.getElementById('amountWrapper').className = `amount-input-wrapper ${type}`;
    document.getElementById('btnSaveExpense').className = `btn-save ${type}`;
    renderCategoryGrid();
}

window.switchCatModalType = function(type) {
    currentCatModalType = type;
    document.getElementById('btnCatTypeExpense').className = `type-btn ${type === 'expense' ? 'active expense' : ''}`;
    document.getElementById('btnCatTypeIncome').className = `type-btn ${type === 'income' ? 'active income' : ''}`;
    const catSaveBtn = document.getElementById('btnSaveCustomCat');
    catSaveBtn.className = `btn-save ${type}`;
}

function renderCategoryGrid() {
    const grid = document.getElementById('categoryGrid');
    grid.innerHTML = '';
    const baseList = currentModalType === 'expense' ? defaultExpenseCategories : defaultIncomeCategories;
    const myCustoms = customCategories.filter(c => c.type === currentModalType);
    const fullList = [...baseList, ...myCustoms];

    fullList.forEach(cat => {
        const btn = document.createElement('div');
        btn.className = 'cat-btn';
        btn.id = `cat-${cat.name || cat.id}`; 
        btn.onclick = () => selectCategory(cat.name || cat.id);
        
        let iconHtml = `<span class="cat-icon">${cat.icon}</span>`;
        if(cat.imgBase64) {
            iconHtml = `<span class="cat-icon"><img src="${cat.imgBase64}"></span>`;
        }

        btn.innerHTML = `${iconHtml}<span class="cat-name">${cat.name || cat.id}</span>`;
        grid.appendChild(btn);
    });

    if(fullList.length > 0) selectCategory(fullList[0].name || fullList[0].id); 
}

function selectCategory(catName) {
    selectedCategory = catName;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected', 'expense', 'income'));
    const target = document.getElementById(`cat-${catName}`);
    if(target) target.classList.add('selected', currentModalType);
}

// ================= 設定: 管理類別 =================
function renderManageCategories() {
    const container = document.getElementById('manageCategoryList');
    container.innerHTML = '';
    if(customCategories.length === 0) {
        container.innerHTML = '<div style="color:#999; font-size:13px; text-align:center; padding:10px;">尚未新增任何自訂類別</div>';
        return;
    }
    
    customCategories.forEach(cat => {
        const div = document.createElement('div');
        div.style = "display:flex; justify-content:space-between; align-items:center; background:#f9f9f9; padding:10px; border-radius:8px;";
        let iconHtml = cat.imgBase64 ? `<img src="${cat.imgBase64}" style="width:24px;border-radius:4px;">` : `<span style="font-size:20px;">${cat.icon}</span>`;
        
        div.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                ${iconHtml}
                <span style="font-weight:bold;">${cat.name} <span style="font-size:11px; color:#888;">(${cat.type==='income'?'收入':'支出'})</span></span>
            </div>
            <div style="display:flex; gap:10px;">
                <button onclick="editCategory('${cat.id}')" style="background:none; border:none; color:var(--primary-color); cursor:pointer;">✏️</button>
                <button onclick="deleteCategory('${cat.id}')" style="background:none; border:none; color:var(--expense-color); cursor:pointer;">✕</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.editCategory = function(catId) {
    const cat = customCategories.find(c => c.id === catId);
    if(!cat) return;
    document.getElementById('editCatId').value = cat.id;
    document.getElementById('newCatName').value = cat.name;
    document.getElementById('newCatEmoji').value = cat.icon || '';
    document.getElementById('catModalTitle').innerText = '修改自訂類別';
    switchCatModalType(cat.type);
    openModal('customCatModal');
}

window.deleteCategory = async function(catId) {
    if(!confirm('確定要刪除此類別嗎？')) return;
    try {
        await deleteDoc(doc(db, "customCategories", catId));
        customCategories = customCategories.filter(c => c.id !== catId);
        renderManageCategories();
        renderCategoryGrid();
        renderPieChart();
    } catch(e) {
        alert('刪除失敗');
        console.error(e);
    }
}

// ================= 自訂類別儲存邏輯 =================
document.getElementById('btnSaveCustomCat').addEventListener('click', async () => {
    const nameInput = document.getElementById('newCatName').value.trim();
    const emojiInput = document.getElementById('newCatEmoji').value.trim();
    const fileInput = document.getElementById('newCatImage').files[0];
    const editCatId = document.getElementById('editCatId').value;

    if(!nameInput) { alert("請輸入類別名稱！"); return; }
    if(!emojiInput && !fileInput && !editCatId) { alert("請輸入 Emoji 或選擇一張圖片！"); return; }

    const btn = document.getElementById('btnSaveCustomCat');
    btn.disabled = true;
    btn.innerText = '儲存中...';

    try {
        let imgBase64 = null;
        if(fileInput) {
            imgBase64 = await resizeImageToBase64(fileInput);
        } else if (editCatId) {
            const existing = customCategories.find(c => c.id === editCatId);
            if(existing) imgBase64 = existing.imgBase64;
        }

        const catData = {
            groupId: currentGroupId,
            type: currentCatModalType,
            name: nameInput,
            icon: emojiInput || '✨',
            imgBase64: imgBase64,
            color: currentCatModalType === 'expense' ? '#e53935' : '#43a047'
        };

        if(editCatId) {
            await updateDoc(doc(db, "customCategories", editCatId), catData);
            const index = customCategories.findIndex(c => c.id === editCatId);
            if(index !== -1) customCategories[index] = { id: editCatId, ...catData };
        } else {
            const docRef = await addDoc(collection(db, "customCategories"), catData);
            customCategories.push({ id: docRef.id, ...catData });
        }
        
        document.getElementById('newCatName').value = '';
        document.getElementById('newCatEmoji').value = '';
        document.getElementById('newCatImage').value = '';
        closeModal('customCatModal');
        
        renderManageCategories();
        renderCategoryGrid();
        renderPieChart();
    } catch(e) {
        console.error("儲存類別失敗:", e);
        alert("儲存類別發生錯誤");
    } finally {
        btn.disabled = false;
        btn.innerText = '儲存類別';
    }
});

function resizeImageToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const MAX_SIZE = 64; 
                let width = img.width;
                let height = img.height;
                if (width > height && width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; }
                else if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; }
                
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/webp', 0.8)); 
            };
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

document.getElementById('btnSaveExpense').addEventListener('click', async () => {
    const amountStr = document.getElementById('expenseAmount').value;
    const note = document.getElementById('expenseNote').value.trim();
    const amount = parseInt(amountStr);

    if (!amount || amount <= 0) { alert('請輸入有效金額！'); return; }

    const btn = document.getElementById('btnSaveExpense');
    btn.disabled = true;
    btn.innerText = '儲存中...';

    try {
        const newItem = {
            groupId: currentGroupId,
            accountId: currentAccountId, 
            date: selectedDateStr,
            amount: amount,
            category: selectedCategory,
            type: currentModalType, 
            note: note,
            operator: currentUser.name,
            timestamp: serverTimestamp()
        };

        const docRef = await addDoc(collection(db, "expenses"), newItem);
        monthData.push({ id: docRef.id, ...newItem, timestamp: new Date() });
        
        hasLoadedAllData = false; 

        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseNote').value = '';
        
        renderDayList();
        renderCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
        renderPersonalAvatars(); 
        renderPieChart();

    } catch (e) {
        console.error("儲存失敗：", e);
        alert("儲存失敗，請檢查網路！");
    } finally {
        btn.disabled = false;
        btn.innerText = '儲存紀錄';
    }
});

function renderDayList() {
    const container = document.getElementById('dayExpenseList');
    container.innerHTML = '';
    let dayRecords = monthData.filter(e => e.date === selectedDateStr);
    if (!canViewIncome) dayRecords = dayRecords.filter(e => e.type !== 'income');

    if (dayRecords.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa; font-size:13px;">當日尚無紀錄</div>';
        return;
    }

    dayRecords.forEach(item => {
        const isIncome = (item.type === 'income');
        const baseList = isIncome ? defaultIncomeCategories : defaultExpenseCategories;
        const fullList = [...baseList, ...customCategories.filter(c => c.type === item.type)];
        
        const catObj = fullList.find(c => (c.name || c.id) === item.category) || { icon: '📦', color: '#999' };
        
        let iconHtml = catObj.imgBase64 ? `<img src="${catObj.imgBase64}" style="width:24px;border-radius:4px;">` : catObj.icon;

        const div = document.createElement('div');
        div.className = 'expense-item';
        div.innerHTML = `
            <div class="exp-cat-info">
                <div class="exp-icon-box" style="color: ${catObj.color}">${iconHtml}</div>
                <div class="exp-details">
                    <span class="exp-cat-name">${item.category}</span>
                    <span class="exp-note">${item.note ? item.note : `<span style="opacity:0.5">${item.operator}記帳</span>`}</span>
                </div>
            </div>
            <div style="display:flex; align-items:center;">
                <span class="exp-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '-'}$${item.amount.toLocaleString()}</span>
                <button class="btn-del-exp" onclick="deleteExpense('${item.id}')">✕</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.deleteExpense = async function(docId) {
    if (!confirm("確定要刪除這筆紀錄嗎？")) return;
    try {
        await deleteDoc(doc(db, "expenses", docId));
        monthData = monthData.filter(e => e.id !== docId);
        
        hasLoadedAllData = false; 

        renderDayList();
        renderCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
        renderPersonalAvatars();
        renderPieChart();
    } catch (e) {
        console.error("刪除失敗：", e);
        alert("刪除失敗，請檢查網路。");
    }
};
