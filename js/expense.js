/**
 * 記帳本入口：清單用游標分頁與聚合統計，日曆載入當月，回顧資料延後讀取。
 * 群組帳沿用 groupId；個人帳使用 Auth／Rules 保護的 personalLedgers/{accountId}；monthRequestVersion 防止切換月份後舊結果覆蓋。
 * @module
 */
import { icon } from './ui-icons.js';
import { CATEGORY_ICON_OPTIONS, categoryIconKey, categoryIconHTML } from './expense-category-icons.js';
import { loadChart } from './chart-loader.js';
import { loadScopedProfiles, profileAvatarMap } from './scoped-profiles.js';
import { db } from './firebase-config.js';
import { personalLedgerDatabase, readLedgerPreferences, saveLedgerPreferences, DEFAULT_LEDGER_PREFERENCES } from './personal-ledger.js';
import {
    collection, addDoc, getDocs, query, where,
    deleteDoc, doc, serverTimestamp, updateDoc, runTransaction, orderBy, documentId, startAfter, limit, getAggregateFromServer, sum, count
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
let currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;
if (!currentUser) { alert('請先登入！'); window.location.href = 'index.html'; }

// 修正：優先取得 users 集合中真正的 accountId，並移除 name 避免存錯
const currentAccountId = currentUser.accountId || currentUser.id || currentUser.uid || currentUser.account || "unknown";
const currentGroupId = localStorage.getItem('lastGroupId') || 'wJOpq0uAnXvO4ezZ1IK9';

// ================= 權限判斷邏輯 =================
const roleStr = String(currentUser.role || '').toLowerCase();
const nameStr = String(currentUser.name || '').toLowerCase(); 
const groupCanViewIncome =
    roleStr.includes('家長') || roleStr.includes('管理') || roleStr.includes('admin') || roleStr.includes('parent') ||
    nameStr.includes('爸') || nameStr.includes('媽') || nameStr.includes('admin');

let canViewIncome = groupCanViewIncome;
let ledgerMode = 'group';
let ledgerDatabase = db;
let ledgerGeneration = 0;
let changingLedger = true;
let ledgerAvailable = false;
let categorySaving = false;
let ledgerPreferences = { ...DEFAULT_LEDGER_PREFERENCES };
let preferencesReady = false;
const ledgerCollection = name => ledgerMode === 'personal'
    ? collection(ledgerDatabase, 'personalLedgers', currentAccountId, name) : collection(db, name);
const ledgerDoc = (name, id) => ledgerMode === 'personal'
    ? doc(ledgerDatabase, 'personalLedgers', currentAccountId, name, id) : doc(db, name, id);
const ledgerFilters = () => ledgerMode === 'personal' ? [] : [where('groupId', '==', currentGroupId)];
const ledgerOwner = () => ledgerMode === 'personal' ? { accountId: currentAccountId } : { groupId: currentGroupId };
const belongsToLedger = item => ledgerMode === 'personal' ? item.accountId === currentAccountId : item.groupId === currentGroupId;

function applyLedgerUI() {
    canViewIncome = ledgerMode === 'personal' || groupCanViewIncome;
    document.getElementById('statBoxIncome').style.display = canViewIncome ? '' : 'none';
    document.getElementById('btnTypeIncome').style.display = canViewIncome ? '' : 'none';
    document.querySelectorAll('.require-income').forEach(el => el.style.display = canViewIncome ? '' : 'none');
    document.getElementById('revThisMonthExpense').parentElement.classList.toggle('full-width', !canViewIncome);
    for (const mode of ['group', 'personal']) {
        const button = document.getElementById('ledgerMode-' + mode);
        button.classList.toggle('active', ledgerMode === mode);
        button.setAttribute('aria-pressed', String(ledgerMode === mode));
    }
    document.querySelector('.ledger-scope-note').textContent = `${ledgerMode === 'personal' ? '我的個人帳' : '所屬群組帳'}的當月紀錄 · 點選明細查看當日紀錄`;
    document.getElementById('categoryScopeLabel').textContent = ledgerMode === 'personal' ? '個人帳自訂類別' : '群組帳自訂類別';
    document.getElementById('chartGroupLabel').textContent = ledgerMode === 'personal' ? '個人帳全部' : '群組全部';
}

/** 切換帳本前清空資料與游標，取消舊非同步結果；寫入期間不允許切換。 */
window.switchLedgerMode = async function(mode, force = false) {
    if (!['group', 'personal'].includes(mode) || changingLedger || savingEntry || categorySaving || (!force && mode === ledgerMode && monthReady)) return;
    changingLedger = true;
    ++ledgerGeneration; ++monthRequestVersion; ++pieRenderVersion; ++reviewRenderVersion;
    const status = document.getElementById('ledgerStatus');
    status.textContent = '正在開啟帳本…';
    document.querySelectorAll('[data-ledger-mode]').forEach(button => button.disabled = true);
    // 不讓切換前的資料、圖表或表單留在新帳本畫面。
    document.querySelectorAll('.modal').forEach(el => el.style.display = 'none');
    monthReady = false; monthData = []; customCategories = []; allExpensesData = []; allAvailableYears.clear();
    hasLoadedAllData = false; allUsersMap = {}; selectedPersonalAccountId = null; currentScope = 'group';
    currentListType = 'expense'; currentChartType = 'expense'; resetExpenseEditor(); resetListData();
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    if (barChartInstance) { barChartInstance.destroy(); barChartInstance = null; }
    document.getElementById('avatarContainer').innerHTML = '';
    document.getElementById('avatarContainer').style.display = 'none';
    document.getElementById('btnScopeGroup').classList.add('active');
    document.getElementById('btnScopePersonal').classList.remove('active');
    document.querySelectorAll('#reviewView .summary-val').forEach(el => el.textContent = '讀取中…');
    document.getElementById('reviewYearFilter').replaceChildren();
    document.getElementById('chartAnalysisText').textContent = '分析載入中…';
    ledgerAvailable = false;
    ledgerMode = mode;
    applyLedgerUI();
    document.getElementById('statBoxExpense').className = 'stat-box active-expense';
    document.getElementById('statBoxIncome').className = 'stat-box';
    renderLedgerList();
    const calendar = document.getElementById('calendarGrid');
    while (calendar.children.length > 7) calendar.removeChild(calendar.lastChild);
    document.getElementById('monthTotalExpense').textContent = '讀取中…';
    document.getElementById('monthTotalIncome').textContent = '讀取中…';
    try {
        ledgerDatabase = mode === 'personal' ? await personalLedgerDatabase(currentUser, currentGroupId) : db;
        ledgerAvailable = true;
        categoriesReady = loadCustomCategories();
        if (currentMainView === 'review') await fetchAndRenderReviewData();
        else await loadMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
        status.textContent = monthError ? '帳本讀取失敗，請確認連線及資料權限後重試。' : '';
    } catch (error) {
        status.textContent = '無法開啟個人帳，請確認連線及個人帳權限設定。可重新點選個人帳重試。';
        monthReady = false; listBusy = false; monthError = true;
        renderLedgerList();
        console.error('開啟帳本失敗', error.code || 'unknown');
    } finally {
        changingLedger = false;
        document.querySelectorAll('[data-ledger-mode]').forEach(button => button.disabled = false);
    }
};

// --- 全域變數 ---
let currentDate = new Date();
currentDate.setDate(1);
let currentListType = 'expense';
let currentMainView = 'list';
const LIST_PAGE_SIZE = 10;
let listPageIndex = 0;
let listRequestedPage = 0;
let listPages = [];
let listTotals = null;
let listBusy = false;
let listProfiles = {};

let monthError = false;
let savingEntry = false;
let editingExpenseId = null;
let editingExpenseOriginal = null;
let selectedDateStr = "";     
let monthRequestVersion = 0;
let monthReady = false;
let categoriesReady = Promise.resolve();
let monthData = [];            
let pieChartInstance = null;      
let barChartInstance = null;
let pieRenderVersion = 0;
let reviewRenderVersion = 0;

let currentModalType = 'expense';
let currentChartType = 'expense'; 
let selectedCategory = "";

let currentScope = 'group'; // 'group' 或 'personal'
let selectedPersonalAccountId = null; // 當前選取的個人ID

let hasLoadedAllData = false;
let allExpensesData = [];
let allAvailableYears = new Set(); 
let allUsersMap = {}; // 存放所有使用者的頭像對應表

// 預設分類
const defaultExpenseCategories = [
    { id: '早餐', icon: 'sandwich', color: '#FFB74D' }, { id: '午餐', icon: 'lunchbox', color: '#FF8A65' },
    { id: '晚餐', icon: 'soup', color: '#E57373' }, { id: '日用品', icon: 'cart', color: '#4DB6AC' },
    { id: '交通', icon: 'bus', color: '#90A4AE' }, { id: '水電瓦斯', icon: 'bolt', color: '#4FC3F7' },
    { id: '學習娛樂', icon: 'book', color: '#9575CD' }, { id: '其他支出', icon: 'package', color: '#A1887F' }
];
const defaultIncomeCategories = [
    { id: '薪資', icon: 'briefcase', color: '#4CAF50' }, { id: '獎金', icon: 'gift', color: '#66BB6A' },
    { id: '投資', icon: 'chart', color: '#81C784' }, { id: '兼職', icon: 'laptop', color: '#2E7D32' },
    { id: '零用錢', icon: 'coins', color: '#FBC02D' }, { id: '其他收入', icon: 'inbox', color: '#B0BEC5' }
];
let customCategories = []; 
let currentCatModalType = 'expense';
let useSvgCategoryIcon = false;

function formatK(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return num;
}

async function initApp() {
    try {
        ledgerPreferences = await readLedgerPreferences(currentUser, currentGroupId);
        preferencesReady = true;
    } catch (error) {
        document.getElementById('preferencesStatus').textContent = '設定讀取失敗，暫用預設群組帳；設定與個人帳需要啟用私有資料權限。';
    }
    document.getElementById('homepageLedgerSource').value = ledgerPreferences.homepageSource;
    document.getElementById('defaultLedgerMode').value = ledgerPreferences.defaultMode;
    changingLedger = false;
    await window.switchLedgerMode(ledgerPreferences.defaultMode, true);
}
// 預設群組；先確認個人設定，避免顯示錯誤的帳本。
applyLedgerUI();
void initApp();

// 只查目前群組當月記錄引用的身分，選填頭像不得阻塞金額或改成掃描 users。
async function loadMonthProfiles(records, version) {
    try {
        const [accounts, legacy] = await Promise.all([
            loadScopedProfiles(db, records.filter(item => item.accountId).map(item => item.accountId), { allowLegacyNames: false }),
            loadScopedProfiles(db, records.filter(item => !item.accountId).map(item => item.operator))
        ]);
        const profiles = [...accounts, ...legacy];
        if (version !== monthRequestVersion) return;
        allUsersMap = profileAvatarMap(profiles);
        renderPersonalAvatars();
        renderLedgerList();
    } catch (error) {
        console.error("載入使用者頭像失敗：", error);
    }
}

async function loadCustomCategories() {
    const generation = ledgerGeneration;
    try {
        const q = query(ledgerCollection('customCategories'), ...ledgerFilters());
        const snap = await getDocs(q);
        if (generation !== ledgerGeneration) return;
        customCategories = [];
        snap.forEach(docSnap => customCategories.push({ id: docSnap.id, ...docSnap.data() }));
    } catch (error) {
        console.error("載入自訂類別失敗：", error);
    }
}

window.switchMainView = function(view) {
    if (changingLedger || !ledgerAvailable || savingEntry || categorySaving || view === currentMainView) return;
    currentMainView = view;
    ++monthRequestVersion;
    for (const [name, tab] of [['calendar', 'Calendar'], ['list', 'List'], ['review', 'Review']]) {
        document.getElementById('tab' + tab).classList.toggle('active', view === name);
        document.getElementById(name + 'View').style.display = view === name ? 'flex' : 'none';
    }
    if (view === 'review') fetchAndRenderReviewData();
    if (view !== 'review') loadMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
};

function syncListPeriod() {
    document.getElementById('listPeriod').value = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('listPeriodText').textContent = `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月`;
}

window.selectListMonth = function() {
    if (changingLedger || savingEntry || !ledgerAvailable) { syncListPeriod(); return; }
    const match = /^(\d{4})-(\d{2})$/.exec(document.getElementById('listPeriod').value);
    if (!match || Number(match[1]) < 1900 || Number(match[2]) < 1 || Number(match[2]) > 12) { syncListPeriod(); return; }
    currentDate = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    closeModal('expenseModal');
    loadMonthData(currentDate.getFullYear(), currentDate.getMonth() + 1);
};
window.retryListMonth = () => {
    if (changingLedger || savingEntry || listBusy || !ledgerAvailable) return;
    listPages = listPages.slice(0, listRequestedPage);
    loadListPage(listRequestedPage, true);
};
window.switchListType = function(type) {
    if (changingLedger || savingEntry || type === currentListType || (type === 'income' && !canViewIncome)) return;
    currentListType = type;
    resetListData();
    loadListPage(0);
};

function resetListData() {
    listPages = []; listPageIndex = 0; listTotals = null; listProfiles = {};
    monthData = []; monthReady = false;
}

function listMonthFilters() {
    const prefix = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
    return [...ledgerFilters(), where('date', '>=', prefix + '-01'), where('date', '<=', prefix + '-31')];
}

/**
 * 載入指定清單頁及必要的當月統計；不為統計下載整月文件。
 * @param {number} [pageIndex=0] - 從零起算的頁碼，依前頁游標前進。
 * @param {boolean} [refreshTotals=false] - 是否重新取得伺服器聚合統計。
 * @returns {Promise<void>} 更新清單與按需頭像；錯誤保留可重新讀取的狀態。
 * @description 每次文件查詢 limit(10)；缺 type 的歷史記錄依舊規則當支出。
 */
async function loadListPage(pageIndex = 0, refreshTotals = false) {
    const version = ++monthRequestVersion;
    listRequestedPage = pageIndex;
    const type = currentListType;
    listBusy = true; monthReady = false; monthError = false;
    renderLedgerList();
    try {
        const filters = listMonthFilters();
        // 伺服器聚合只回傳總額與筆數，不下載整月文件。
        if (!listTotals || refreshTotals) {
            const [all, income, expense] = await Promise.all([
                getAggregateFromServer(query(ledgerCollection('expenses'), ...filters), { amount: sum('amount'), records: count() }),
                getAggregateFromServer(query(ledgerCollection('expenses'), ...filters, where('type', '==', 'income')), { amount: sum('amount'), records: count() }),
                getAggregateFromServer(query(ledgerCollection('expenses'), ...filters, where('type', '==', 'expense')), { amount: sum('amount'), records: count() })
            ]);
            if (version !== monthRequestVersion) return;
            listTotals = { income: income.data(), expense: { amount: all.data().amount - income.data().amount, records: all.data().records - income.data().records }, legacy: all.data().records - income.data().records - expense.data().records };
        }
        if (!listPages[pageIndex]) {
            const previous = listPages[pageIndex - 1];
            let cursor = previous?.cursor || null;
            let buffer = [...(previous?.buffer || [])];
            let exhausted = previous?.exhausted || false;
            const records = [];
            const needed = Math.min(LIST_PAGE_SIZE, Math.max(0, listTotals[type].records - pageIndex * LIST_PAGE_SIZE));
            // 有界讀取也相容缺 type 的舊支出；每次文件查詢 limit(10)，僅按要求推進頁面。
            while (records.length < needed) {
                if (!buffer.length) {
                    if (exhausted) break;
                    const constraints = [...filters];
                    if (type === 'income' || !listTotals.legacy) constraints.push(where('type', '==', type));
                    constraints.push(orderBy('date', 'desc'), orderBy(documentId(), 'desc'));
                    if (cursor) constraints.push(startAfter(cursor));
                    const snapshot = await getDocs(query(ledgerCollection('expenses'), ...constraints, limit(LIST_PAGE_SIZE)));
                    if (version !== monthRequestVersion) return;
                    exhausted = snapshot.docs.length < LIST_PAGE_SIZE;
                    cursor = snapshot.docs.at(-1) || cursor;
                    buffer = snapshot.docs.map(row => ({ ...row.data(), id: row.id }));
                    if (!buffer.length) break;
                }
                const item = buffer.shift();
                if ((item.type || 'expense') === type) records.push(item);
            }
            if (version !== monthRequestVersion) return;
            listPages[pageIndex] = { records, cursor, buffer, exhausted };
        }
        if (version !== monthRequestVersion) return;
        listPageIndex = pageIndex;
        monthData = listPages[pageIndex].records;
        await categoriesReady;
        if (version !== monthRequestVersion) return;
        monthReady = true; listBusy = false;
        renderLedgerList();
        const [accounts, legacy] = await Promise.all([
            loadScopedProfiles(db, monthData.filter(item => item.accountId).map(item => item.accountId), { allowLegacyNames: false }),
            loadScopedProfiles(db, monthData.filter(item => !item.accountId).map(item => item.operator))
        ]);
        if (version !== monthRequestVersion) return;
        listProfiles = profileAvatarMap([...accounts, ...legacy]);
        renderLedgerList();
    } catch (error) {
        if (version !== monthRequestVersion) return;
        console.error('讀取清單失敗：', error);
        listBusy = false; monthError = true;
        // 頭像讀取失敗不能讓已成功取得的帳務資料失效。
        if (monthReady) { monthError = false; renderLedgerList(); return; }
        renderLedgerList();
    }
}

window.changeListPage = function(offset) {
    if (changingLedger || listBusy || savingEntry || !monthReady) return;
    const next = listPageIndex + offset;
    const pages = Math.ceil((listTotals?.[currentListType].records || 0) / LIST_PAGE_SIZE);
    if (next >= 0 && next < pages) loadListPage(next);
};

function renderLedgerList() {
    syncListPeriod();
    const income = currentListType === 'income';
    const label = income ? '收入' : '支出';
    for (const [id, type] of [['listExpenseTab', 'expense'], ['listIncomeTab', 'income']]) {
        const tab = document.getElementById(id);
        tab.className = `type-btn ${type === 'income' ? 'require-income' : ''} ${type === currentListType ? 'active ' + type : ''}`;
        tab.setAttribute('aria-pressed', String(type === currentListType));
    }
    document.getElementById('listTotalLabel').textContent = `當月總${label}`;
    const total = document.getElementById('listTotal');
    total.className = currentListType;
    const container = document.getElementById('ledgerList');
    container.replaceChildren();
    document.getElementById('listCount').textContent = '';
    document.getElementById('retryListMonth').hidden = !monthError;
    const count = listTotals?.[currentListType]?.records || 0;
    const pages = Math.max(1, Math.ceil(count / LIST_PAGE_SIZE));
    document.getElementById('listPageStatus').textContent = `第 ${listPageIndex + 1} / ${pages} 頁`;
    document.getElementById('listPrevious').disabled = listBusy || !monthReady || listPageIndex === 0;
    document.getElementById('listNext').disabled = listBusy || !monthReady || listPageIndex + 1 >= pages;
    document.getElementById('addListExpense').hidden = income;
    document.getElementById('addListIncome').hidden = !income || !canViewIncome;
    for (const id of ['addListExpense', 'addListIncome']) document.getElementById(id).disabled = !monthReady;
    if (!monthReady) {
        total.textContent = listTotals ? `NT$ ${listTotals[currentListType].amount.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}` : (monthError ? '暫時無法取得' : '讀取中...');
        container.textContent = monthError ? '讀取失敗，請檢查網路後重試。' : '正在載入當月紀錄…';
        return;
    }
    const records = monthData;
    const amount = listTotals?.[currentListType]?.amount || 0;
    total.textContent = `NT$ ${amount.toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
    document.getElementById('listCount').textContent = `共 ${count} 筆紀錄 · 每頁 10 筆`;
    if (!records.length) {
        container.textContent = `這個月還沒有${label}紀錄，點選下方「+」開始記帳。`;
        return;
    }
    for (const item of records) {
        const row = document.createElement('button');
        row.type = 'button'; row.className = 'ledger-row';
        const date = document.createElement('time');
        date.dateTime = item.date;
        date.textContent = item.date.split('-').slice(1).map(Number).join('/');
        const details = document.createElement('span'); details.className = 'ledger-row-details';
        const category = document.createElement('strong'); category.className = 'ledger-row-category'; category.textContent = item.category || '未分類';
        const name = document.createElement('span'); name.className = 'ledger-row-name'; name.textContent = expenseName(item);
        details.append(category, name);
        const avatar = document.createElement('span'); avatar.className = 'ledger-row-avatar';
        const operator = item.operator || '未知使用者';
        avatar.title = operator; avatar.setAttribute('aria-label', operator);
        const own = item.accountId === currentAccountId || (!item.accountId && operator === currentUser.name);
        const url = listProfiles[item.accountId || operator] || (own && (currentUser.avatar || currentUser.photoURL || currentUser.avatarUrl));
        avatar.textContent = operator.slice(0, 1);
        let safeAvatar = false;
        try { safeAvatar = !!url && /^(https?:|data:image\/)/i.test(new URL(url, location.href).href); } catch {}
        if (safeAvatar) {
            const image = document.createElement('img'); image.src = url; image.alt = operator;
            image.onerror = () => avatar.replaceChildren(document.createTextNode(operator.slice(0, 1)));
            avatar.replaceChildren(image);
        }
        const money = document.createElement('strong'); money.className = `ledger-row-amount ${currentListType}`;
        money.textContent = `${income ? '+' : '−'}$${Number(item.amount).toLocaleString('zh-TW', { maximumFractionDigits: 2 })}`;
        row.append(date, details, avatar, money);
        row.onclick = () => window.editExpense(item.id);
        container.append(row);
    }
}

window.openListEntry = function(type) {
    if (changingLedger || !monthReady || savingEntry || (type === 'income' && !canViewIncome)) return;
    const today = new Date();
    const day = today.getFullYear() === currentDate.getFullYear() && today.getMonth() === currentDate.getMonth() ? today.getDate() : 1;
    const date = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    openModal('expenseModal', date);
    switchModalType(type);
};
window.changeEntryDate = function() {
    if (savingEntry) { document.getElementById('expenseDate').value = selectedDateStr; return; }
    const input = document.getElementById('expenseDate');
    if (!validEntryDate(input.value) || (input.min && input.value < input.min) || (input.max && input.value > input.max)) {
        input.value = selectedDateStr; return;
    }
    selectedDateStr = input.value;
    document.getElementById('modalDateTitle').textContent = `${selectedDateStr.replaceAll('-', '/')} ${editingExpenseId ? '修改紀錄' : '記帳'}`;
    renderDayList();
};

/**
 * 依目前模式分流至清單，或查詢指定群組的當月日曆資料。
 * @param {number} year - 西元年。
 * @param {number} month - 1 至 12 月。
 * @returns {Promise<void>} 記帳金額先呈現，分類與頭像依既有相依順序補上。
 */
async function loadMonthData(year, month) {
    if (currentMainView === 'list') { resetListData(); return loadListPage(0); }
    const version = ++monthRequestVersion;
    monthReady = false;
    monthError = false;
    // 載入中代表未知，不能先顯示看似合理但錯誤的零元或舊月份總額。
    document.getElementById('monthTotalExpense').innerText = '讀取中...';
    document.getElementById('monthTotalIncome').innerText = '讀取中...';
    if (pieChartInstance) { pieChartInstance.destroy(); pieChartInstance = null; }
    const grid = document.getElementById('calendarGrid');
    grid.dataset.loading = '';
    document.documentElement.style.setProperty('--ledger-week-count', Math.ceil((new Date(year, month - 1, 1).getDay() + new Date(year, month, 0).getDate()) / 7));
    while (grid.children.length > 7) grid.removeChild(grid.lastChild);
    document.getElementById('avatarContainer').innerHTML = '';
    document.getElementById('expenseModal').style.display = 'none';
    const startStr = `${year}-${String(month).padStart(2,'0')}-01`;
    const endStr = `${year}-${String(month).padStart(2,'0')}-31`; 
    
    document.getElementById('calendarMonthTitle').innerText = '讀取中...';
    
    try {
        const q = query(
            ledgerCollection('expenses'),
            ...ledgerFilters(),
            where("date", ">=", startStr),
            where("date", "<=", endStr)
        );
        const snapshot = await getDocs(q);
        if (version !== monthRequestVersion) return;
        monthData = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (!data.type) data.type = 'expense';
            monthData.push({ id: docSnap.id, ...data });
        });

        document.getElementById('calendarMonthTitle').innerText = `${year}年 ${month}月`;
        delete grid.dataset.loading;
        renderCalendar(year, month);
        allUsersMap = {};
        renderPersonalAvatars();
        void loadMonthProfiles(monthData, version);
        await categoriesReady;
        if (version !== monthRequestVersion) return;
        monthReady = true;
        renderLedgerList();
        renderPieChart();
    } catch (error) {
        if (version !== monthRequestVersion) return;
        monthError = true;
        renderLedgerList();
        document.getElementById('calendarMonthTitle').innerText = '讀取失敗，請切換月份重試';
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
    if (changingLedger || !ledgerAvailable || savingEntry) return;
    currentDate.setDate(1);
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
        
        // 修正：優先從剛剛抓下來的全域使用者清單 (allUsersMap) 配對頭像
        let userAvatar = allUsersMap[item.accountId || uname] || null;

        // 保底：如果是當前操作者且沒配對到，用暫存檔裡的
        if(!userAvatar && (uid === currentAccountId || (!item.accountId && uname === currentUser.name))) {
            userAvatar = currentUser.avatar || currentUser.photoURL || currentUser.avatarUrl || null;
        }
        
        if(!usersMap[uid]) usersMap[uid] = { id: uid, name: uname, avatar: userAvatar };
    });
    
    const users = Object.values(usersMap);
    
    if(users.length === 0) {
        avatarDiv.innerHTML = '<div style="font-size:calc(13px * var(--n-font-scale, 1)); color:#999;">當月尚無紀錄</div>';
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

// 此提示只佔原圖表區域，不影響金額獨立呈現。
async function chartConstructor(canvasId, retry) {
    const canvas = document.getElementById(canvasId);
    let status = document.getElementById(canvasId + 'Status');
    if (!status) {
        status = document.createElement('div');
        status.id = canvasId + 'Status'; status.className = 'chart-load-status';
        status.setAttribute('role', 'status'); canvas.parentElement.append(status);
    }
    status.hidden = !!window.Chart;
    if (!window.Chart) status.textContent = '圖表載入中...';
    try {
        const Chart = await loadChart();
        status.hidden = true;
        return Chart;
    } catch (error) {
        status.hidden = false;
        status.textContent = '圖表暫時無法載入，記帳金額仍可使用。 ';
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = '重試載入圖表';
        button.addEventListener('click', retry); status.append(button);
        return null;
    }
}

async function renderPieChart() {
    if (currentMainView === 'list') return;
    const version = ++pieRenderVersion;
    if (!monthReady) return;
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

    const Chart = await chartConstructor('expensePieChart', renderPieChart);
    if (!Chart || version !== pieRenderVersion || !monthReady) return;
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
    const generation = ledgerGeneration;
    const version = monthRequestVersion;
    if (!hasLoadedAllData) {
        try {
            const q = query(ledgerCollection('expenses'), ...ledgerFilters());
            const snapshot = await getDocs(q);
            if (generation !== ledgerGeneration || version !== monthRequestVersion) return;
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

async function processReviewData() {
    const version = ++reviewRenderVersion;
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

    const Chart = await chartConstructor('sixMonthBarChart', processReviewData);
    if (!Chart || version !== reviewRenderVersion) return;
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
    if (changingLedger || categorySaving || (savingEntry && modalId === 'expenseModal')) return;
    if (modalId === 'customCatModal' && !ledgerAvailable) return;
    if (modalId === 'expenseModal') resetExpenseEditor();
    if(dateStr) {
        if (!monthReady) return;
        selectedDateStr = dateStr;
        const dateInput = document.getElementById('expenseDate');
        dateInput.min = dateStr.slice(0, 7) + '-01';
        dateInput.max = dateStr.slice(0, 7) + '-' + new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();
        dateInput.value = dateStr;
        document.getElementById('entryStatus').textContent = '';
        const [y, m, d] = dateStr.split('-');
        document.getElementById('modalDateTitle').innerText = `${y}年${parseInt(m)}月${parseInt(d)}日`;
        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseNote').value = '';
        switchModalType('expense');
        renderDayList();
    }
    if (modalId === 'expenseModal') document.querySelector('.day-list-title').textContent = currentMainView === 'list' ? '本頁當日明細' : '當日明細';
    if(modalId === 'settingsModal') {
        renderManageCategories();
    }
    if(modalId === 'customCatModal') {
        document.getElementById('editCatId').value = '';
        document.getElementById('newCatName').value = '';
        renderCategoryIconPicker('package');
        useSvgCategoryIcon = false;
        document.getElementById('newCatImage').value = '';
        document.getElementById('catModalTitle').innerText = '新增自訂類別';
        switchCatModalType('expense');
    }
    document.getElementById(modalId).style.display = 'flex';
};

window.closeModal = function(modalId) {
    if (changingLedger || categorySaving || (savingEntry && modalId === 'expenseModal')) return;
    document.getElementById(modalId).style.display = 'none';
    if (modalId === 'expenseModal') resetExpenseEditor();
};

window.onclick = function(event) {
    if (event.target.classList.contains('modal')) { 
        closeModal(event.target.id);
    }
};

window.switchModalType = function(type) {
    if (changingLedger || savingEntry) return;
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
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cat-btn';
        btn.id = `cat-${cat.name || cat.id}`; 
        btn.onclick = () => selectCategory(cat.name || cat.id);
        
        const iconHtml = `<span class="cat-icon">${categoryIconHTML(cat)}</span>`;
        btn.innerHTML = `${iconHtml}<span class="cat-name">${ledgerText(cat.name || cat.id)}</span>`;
        grid.appendChild(btn);
    });

    if(fullList.length > 0) selectCategory(fullList[0].name || fullList[0].id); 
}

function selectCategory(catName) {
    if (changingLedger || savingEntry) return;
    selectedCategory = catName;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('selected', 'expense', 'income'));
    const target = document.getElementById(`cat-${catName}`);
    if(target) target.classList.add('selected', currentModalType);
}

// ================= 設定: 管理類別 =================
function renderCategoryIconPicker(value) {
    const key = categoryIconKey(value);
    const picker = document.getElementById('newCatIconPicker');
    document.getElementById('newCatIcon').value = key;
    picker.replaceChildren(...CATEGORY_ICON_OPTIONS.map((option, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'category-svg-choice';
        button.dataset.categoryIcon = option.key;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-label', option.label);
        button.setAttribute('aria-checked', String(option.key === key));
        button.tabIndex = option.key === key ? 0 : -1;
        button.title = option.label;
        button.innerHTML = icon(option.key);
        button.onclick = () => {
            useSvgCategoryIcon = true;
            document.getElementById('newCatImage').value = '';
            renderCategoryIconPicker(option.key);
            picker.querySelector(`[data-category-icon="${option.key}"]`).focus();
        };
        button.onkeydown = event => {
            const columns = getComputedStyle(picker).gridTemplateColumns.split(' ').length;
            const steps = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
            if (!(event.key in steps) && !['Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? CATEGORY_ICON_OPTIONS.length - 1
                : (index + steps[event.key] + CATEGORY_ICON_OPTIONS.length) % CATEGORY_ICON_OPTIONS.length;
            picker.querySelector(`[data-category-icon="${CATEGORY_ICON_OPTIONS[next].key}"]`).click();
        };
        return button;
    }));
    document.getElementById('newCatIconPreview').innerHTML = categoryIconHTML({ icon: key });
}

function renderManageCategories() {
    const container = document.getElementById('manageCategoryList');
    container.replaceChildren();
    if (!customCategories.length) {
        container.textContent = '尚未新增任何自訂類別';
        return;
    }
    for (const cat of customCategories) {
        const row = document.createElement('div');
        row.className = 'managed-category';
        const info = document.createElement('div');
        info.className = 'managed-category-info';
        const image = document.createElement('span');
        image.className = 'managed-category-icon';
        image.innerHTML = categoryIconHTML(cat);
        const label = document.createElement('strong');
        label.textContent = cat.name + '（' + (cat.type === 'income' ? '收入' : '支出') + '）';
        info.append(image, label);
        const actions = document.createElement('div');
        actions.className = 'managed-category-actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.innerHTML = icon('edit');
        edit.setAttribute('aria-label', '編輯' + cat.name);
        edit.onclick = () => editCategory(cat.id);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.innerHTML = icon('trash');
        remove.setAttribute('aria-label', '刪除' + cat.name);
        remove.onclick = () => deleteCategory(cat.id);
        actions.append(edit, remove);
        row.append(info, actions);
        container.append(row);
    }
}

window.editCategory = function(catId) {
    const cat = customCategories.find(c => c.id === catId);
    if (!cat) return;
    // 先開啟表單，避免新增分類的初始化清掉正在編輯的既有欄位。
    openModal('customCatModal');
    document.getElementById('editCatId').value = cat.id;
    document.getElementById('newCatName').value = cat.name;
    renderCategoryIconPicker(cat.icon);
    useSvgCategoryIcon = false;
    document.getElementById('newCatIconPreview').innerHTML = categoryIconHTML(cat);
    document.getElementById('catModalTitle').innerText = '修改自訂類別';
    switchCatModalType(cat.type);
}

window.deleteCategory = async function(catId) {
    if (changingLedger || categorySaving || !ledgerAvailable) return;
    if(!confirm('確定要刪除此類別嗎？')) return;
    categorySaving = true;
    try {
        await deleteDoc(ledgerDoc('customCategories', catId));
        customCategories = customCategories.filter(c => c.id !== catId);
        renderManageCategories();
        renderCategoryGrid();
        renderPieChart();
    } catch(e) {
        alert('刪除失敗');
        console.error(e);
    } finally { categorySaving = false; }
}

// ================= 自訂類別儲存邏輯 =================
document.getElementById('btnSaveCustomCat').addEventListener('click', async () => {
    if (changingLedger || categorySaving || !ledgerAvailable) return;
    const nameInput = document.getElementById('newCatName').value.trim();
    const iconKey = categoryIconKey(document.getElementById('newCatIcon').value);
    const fileInput = document.getElementById('newCatImage').files[0];
    const editCatId = document.getElementById('editCatId').value;

    if(!nameInput || nameInput.length > 100) { alert("類別名稱請填寫 1–100 個字！"); return; }


    const btn = document.getElementById('btnSaveCustomCat');
    categorySaving = true;
    btn.disabled = true;
    btn.innerText = '儲存中...';

    try {
        let imgBase64 = null;
        if(fileInput) {
            imgBase64 = await resizeImageToBase64(fileInput);
        } else if (editCatId && !useSvgCategoryIcon) {
            const existing = customCategories.find(c => c.id === editCatId);
            if(existing) imgBase64 = existing.imgBase64;
        }

        const catData = {
            ...ledgerOwner(),
            type: currentCatModalType,
            name: nameInput,
            icon: iconKey,
            imgBase64: imgBase64,
            color: currentCatModalType === 'expense' ? '#e53935' : '#43a047'
        };

        if(editCatId) {
            await updateDoc(ledgerDoc('customCategories', editCatId), catData);
            const index = customCategories.findIndex(c => c.id === editCatId);
            if(index !== -1) customCategories[index] = { id: editCatId, ...catData };
        } else {
            const docRef = await addDoc(ledgerCollection('customCategories'), catData);
            customCategories.push({ id: docRef.id, ...catData });
        }
        
        document.getElementById('newCatName').value = '';
        renderCategoryIconPicker('package');
        useSvgCategoryIcon = false;
        document.getElementById('newCatImage').value = '';
        categorySaving = false;
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
        categorySaving = false;
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
            img.onerror = () => reject(new Error('無法讀取分類圖片'));
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

document.getElementById('btnSaveExpense').addEventListener('click', async () => {
    const amountStr = document.getElementById('expenseAmount').value;
    const note = document.getElementById('expenseNote').value.trim();
    if (changingLedger || savingEntry || !monthReady) return;
    const status = document.getElementById('entryStatus');
    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) {
        status.textContent = '請輸入大於 0、最多兩位小數的金額（上限 999,999,999）。'; return;
    }
    if (!selectedCategory || !selectedDateStr || (currentModalType === 'income' && !canViewIncome)) {
        status.textContent = '請確認日期與分類。'; return;
    }
    const date = document.getElementById('expenseDate').value;
    if (!validEntryDate(date)) { status.textContent = '請選擇有效日期。'; return; }
    if (note.length > 100) { status.textContent = '名稱最多 100 個字。'; return; }
    if (!['income', 'expense'].includes(currentModalType)) return;
    selectedDateStr = date;
    const editingId = editingExpenseId;
    const original = editingExpenseOriginal;
    savingEntry = true;
    document.querySelectorAll('#expenseModal input, #expenseModal button').forEach(control => control.disabled = true);
    status.textContent = '';
    const entryVersion = monthRequestVersion;

    const btn = document.getElementById('btnSaveExpense');
    btn.disabled = true;
    btn.innerText = '儲存中...';

    try {
        if (editingId) {
            // 只更新表單的五個欄位；交易重讀確認歸屬，不覆寫作者、群組或建立時間。
            const patch = { date, type: currentModalType, category: selectedCategory, amount, note };
            await runTransaction(ledgerDatabase, async transaction => {
                const ref = ledgerDoc('expenses', editingId);
                const snapshot = await transaction.get(ref);
                if (!snapshot.exists()) throw new Error('這筆紀錄已刪除，請重新載入。');
                const latest = snapshot.data();
                if (!belongsToLedger(latest)) throw new Error('這筆紀錄不屬於目前帳本，無法修改。');
                if (latest.type === 'income' && !canViewIncome) throw new Error('目前無法修改收入紀錄。');
                const current = { date: latest.date, type: latest.type || 'expense', category: latest.category, amount: latest.amount, note: expenseName(latest) };
                if (!original || Object.keys(current).some(key => current[key] !== original[key])) {
                    const error = new Error('這筆紀錄已由其他人修改，請重新點選明細後再儲存。');
                    error.code = 'expense/changed';
                    throw error;
                }
                transaction.update(ref, patch);
            });
            editingExpenseOriginal = { ...patch };
            hasLoadedAllData = false;
            if (entryVersion !== monthRequestVersion) return;
            const month = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;
            monthData = monthData.map(item => item.id === editingId ? { ...item, ...patch } : item).filter(item => item.date.startsWith(month + '-'));
            if (currentMainView === 'list') { resetListData(); await loadListPage(0); }
            renderDayList();
            if (currentMainView === 'calendar') renderCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
            renderPersonalAvatars();
            if (currentMainView === 'calendar') renderPieChart();
            status.textContent = '紀錄已更新。';
            return;
        }
        const newItem = {
            ...ledgerOwner(),
            accountId: currentAccountId, 
            date: selectedDateStr,
            amount: amount,
            category: selectedCategory,
            type: currentModalType, 
            note: note,
            operator: currentUser.name,
            timestamp: serverTimestamp()
        };

        const docRef = await addDoc(ledgerCollection('expenses'), newItem);
        if (entryVersion === monthRequestVersion) monthData.push({ id: docRef.id, ...newItem, timestamp: new Date() });
        
        hasLoadedAllData = false; 

        document.getElementById('expenseAmount').value = '';
        document.getElementById('expenseNote').value = '';
        status.textContent = '已儲存，可繼續新增。';
        if (currentMainView === 'list') { resetListData(); await loadListPage(0); }
        renderDayList();
        if (currentMainView === 'calendar') renderCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
        renderPersonalAvatars(); 
        if (currentMainView === 'calendar') renderPieChart();

    } catch (e) {
        console.error("儲存失敗：", e);
        status.textContent = e.code === 'expense/changed' ? e.message : '儲存失敗，內容已保留，請檢查網路後重試。';
    } finally {
        savingEntry = false;
        document.querySelectorAll('#expenseModal input, #expenseModal button').forEach(control => control.disabled = false);
        btn.disabled = false;
        btn.innerText = editingExpenseId ? '儲存修改' : '儲存紀錄';
    }
});

function expenseName(item) {
    return String(Object.hasOwn(item, 'note') ? (item.note ?? '') : (item.name ?? ''));
}

function ledgerText(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function renderDayList() {
    const container = document.getElementById('dayExpenseList');
    container.innerHTML = '';
    let dayRecords = monthData.filter(e => e.date === selectedDateStr);
    if (!canViewIncome) dayRecords = dayRecords.filter(e => e.type !== 'income');

    if (dayRecords.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa; font-size:calc(13px * var(--n-font-scale, 1));">當日尚無紀錄</div>';
        return;
    }

    dayRecords.forEach(item => {
        const isIncome = (item.type === 'income');
        const baseList = isIncome ? defaultIncomeCategories : defaultExpenseCategories;
        const fullList = [...baseList, ...customCategories.filter(c => c.type === item.type)];
        
        const catObj = fullList.find(c => (c.name || c.id) === item.category) || { icon: 'package', color: '#999' };
        
        const iconHtml = categoryIconHTML(catObj);

        const div = document.createElement('div');
        div.className = 'expense-item';
        div.innerHTML = `
            <div class="exp-cat-info">
                <div class="exp-icon-box" style="color: ${catObj.color}">${iconHtml}</div>
                <div class="exp-details">
                    <span class="exp-cat-name">${ledgerText(item.category)}</span>
                    <button type="button" class="exp-note" style="border:0;background:none;padding:0;text-align:left;cursor:pointer" aria-label="修改整筆紀錄" onclick="editExpense('${item.id}')">${ledgerText(expenseName(item))}</button>
                </div>
            </div>
            <div style="display:flex; align-items:center;">
                <span class="exp-amount ${isIncome ? 'income' : 'expense'}">${isIncome ? '+' : '-'}$${item.amount.toLocaleString()}</span>
                <button class="btn-del-exp" onclick="deleteExpense('${item.id}')">✕</button>
            </div>
        `;
        div.addEventListener('click', event => {
            if (!event.target.closest('button')) window.editExpense(item.id);
        });
        container.appendChild(div);
    });
}

function validEntryDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function resetExpenseEditor() {
    editingExpenseId = null;
    editingExpenseOriginal = null;
    document.getElementById('btnSaveExpense').textContent = '儲存紀錄';
}

/**
 * 將明細帶入現有表單，允許修改日期、收支、分類、金額與選填名稱。
 * @param {string} docId - 目前已載入且屬於所選帳本的記帳文件 ID。
 * @returns {void} 不建立新文件、不自動聚焦；關閉表單即放棄未儲存內容。
 */
window.editExpense = function(docId) {
    if (changingLedger || savingEntry || !monthReady) return;
    const item = monthData.find(entry => entry.id === docId && belongsToLedger(entry));
    if (!item || (item.type === 'income' && !canViewIncome)) return;
    openModal('expenseModal', item.date);
    switchModalType(item.type || 'expense');
    selectCategory(item.category);
    editingExpenseId = item.id;
    editingExpenseOriginal = { date: item.date, type: item.type || 'expense', category: item.category, amount: item.amount, note: expenseName(item) };
    document.getElementById('expenseDate').removeAttribute('min');
    document.getElementById('expenseDate').removeAttribute('max');
    document.getElementById('expenseAmount').value = item.amount;
    document.getElementById('expenseNote').value = expenseName(item);
    document.getElementById('modalDateTitle').textContent = `${item.date.replaceAll('-', '/')} 修改紀錄`;
    document.getElementById('btnSaveExpense').textContent = '儲存修改';
};
// 保留既有呼叫入口，統一進入完整編輯流程。
window.editExpenseName = window.editExpense;

window.deleteExpense = async function(docId) {
    if (changingLedger || savingEntry) return;
    if (!confirm("確定要刪除這筆紀錄嗎？")) return;
    savingEntry = true;
    try {
        await deleteDoc(ledgerDoc('expenses', docId));
        monthData = monthData.filter(e => e.id !== docId);
        if (editingExpenseId === docId) {
            resetExpenseEditor();
            document.getElementById('expenseAmount').value = '';
            document.getElementById('expenseNote').value = '';
        }
        if (currentMainView === 'list') { resetListData(); await loadListPage(0); }
        
        hasLoadedAllData = false; 

        renderDayList();
        if (currentMainView === 'calendar') renderCalendar(currentDate.getFullYear(), currentDate.getMonth() + 1);
        renderPersonalAvatars();
        renderPieChart();
    } catch (e) {
        console.error("刪除失敗：", e);
        alert("刪除失敗，請檢查網路。");
    } finally { savingEntry = false; }
};


let preferencesSaving = false;
document.getElementById('saveLedgerPreferences').addEventListener('click', async () => {
    if (preferencesSaving) return;
    const button = document.getElementById('saveLedgerPreferences');
    const status = document.getElementById('preferencesStatus');
    preferencesSaving = true; button.disabled = true; status.textContent = '儲存中…';
    try {
        // 讀取失敗時先重讀確認權限恢復，再依使用者目前選擇儲存。
        if (!preferencesReady) { await readLedgerPreferences(currentUser, currentGroupId); preferencesReady = true; }
        ledgerPreferences = await saveLedgerPreferences(currentUser, currentGroupId, {
            homepageSource: document.getElementById('homepageLedgerSource').value,
            defaultMode: document.getElementById('defaultLedgerMode').value
        });
        status.textContent = '已儲存；首頁與下次進入記帳本時套用。';
    } catch (error) { status.textContent = '設定儲存失敗，請檢查連線與個人帳權限後重試。'; }
    finally { preferencesSaving = false; button.disabled = false; }
});
window.addEventListener('pagehide', () => { ++ledgerGeneration; ++monthRequestVersion; ++pieRenderVersion; ++reviewRenderVersion; });
