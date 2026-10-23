import { db } from './firebase-config.js';
import { doc, query, where, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { getSelectedGameGroupId, watchGameContext as watchGroupContext } from './game-context.js';
import { WishWallStore } from './wishwall-store.js';
import { DEFAULT_SETTINGS, normalizeSettings, calculatePoints, ownerId, belongsToGroup, sortRecords, isAdminRole } from './wishwall-core.js';
import { dateKey } from './todo-core.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
let user;
try { user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null'); } catch {}
const groupId = getSelectedGameGroupId(user);
if (!user?.accountId || !groupId) {
    alert('請先登入帳號並選擇群組，再進入許願牆。');
    window.location.replace('index.html');
    throw new Error('許願牆缺少 groupId 或 accountId');
}
const context = { user, groupId, accountId: user.accountId };
watchGroupContext(context);
const store = new WishWallStore(context);

const app = {
    ready: false, busy: false, failed: false, members: new Map(), settings: normalizeSettings(DEFAULT_SETTINGS), scores: [], redeems: [],
    loaded: new Set(), unsubscribes: [], memberUnsubscribes: [], memberGeneration: 0,
    get admin() { return isAdminRole(this.members.get(context.accountId)); },
    label(record) { return this.members.get(ownerId(record))?.name || (ownerId(record) ? `帳號 ${record.accountId}` : `${record.operator || '未知'}（舊資料未綁定帳號）`); },
    async init() {
        try {
            await this.refreshMembers();
            if (this.admin) await store.ensureSettings();
            const settingsListen = onSnapshot(store.settingsRef, snapshot => {
                this.settings = normalizeSettings(snapshot.exists() ? snapshot.data() : DEFAULT_SETTINGS);
                this.loaded.add('settings'); this.render();
            }, error => this.fail(error));
            this.unsubscribes.push(settingsListen);
            for (const kind of ['scores', 'redeems']) {
                // Group-scoped reads; account-scoped views for ordinary members.
                const ref = this.admin ? store.collection(kind) : query(store.collection(kind), where('accountId', '==', context.accountId));
                this.unsubscribes.push(onSnapshot(ref, snapshot => {
                    this[kind] = sortRecords(snapshot.docs.map(document => ({ ...document.data(), id: document.id })).filter(record => belongsToGroup(record, groupId)));
                    this.loaded.add(kind); this.render();
                }, error => this.fail(error)));
            }
            this.unsubscribes.push(onSnapshot(store.groupRef, snapshot => {
                const group = snapshot.exists() ? snapshot.data() : null;
                if (!group || !(group.members || []).includes(context.accountId)) return this.fail(new Error('你已不在目前群組，請返回首頁重新選擇。'));
                $('wishGroupLabel').textContent = `${group.name || '目前群組'} · 許願牆`;
                const signature = JSON.stringify([...new Set(group.members || [])].sort());
                if (signature !== this.memberSignature) this.refreshMembers().then(() => this.render()).catch(error => this.fail(error));
            }, error => this.fail(error)));
        } catch (error) { this.fail(error); }
    },
    async refreshMembers() {
        const generation = ++this.memberGeneration;
        const result = await store.loadMembers();
        if (generation !== this.memberGeneration || this.failed) return;
        this.memberSignature = JSON.stringify([...result.ids].sort());
        this.members = result.members;
        this.memberUnsubscribes.forEach(unsubscribe => unsubscribe()); this.memberUnsubscribes = [];
        for (const member of this.members.values()) {
            this.memberUnsubscribes.push(onSnapshot(doc(db, 'users', member.docId), snapshot => {
                const profile = snapshot.exists() ? snapshot.data() : null;
                if (generation !== this.memberGeneration || this.failed) return;
                if (!profile || profile.accountId !== member.accountId || profile.role === 'removed') {
                    if (member.accountId === context.accountId) return this.fail(new Error('目前帳號已無法使用許願牆。'));
                    this.members.delete(member.accountId);
                } else {
                    const wasAdmin = this.admin;
                    this.members.set(member.accountId, { ...profile, docId: member.docId });
                    // Reload so ordinary-member subscriptions cannot retain an old admin view.
                    if (this.loaded.size && member.accountId === context.accountId && wasAdmin !== this.admin) { window.location.reload(); return; }
                }
                this.render();
            }, error => this.fail(error)));
        }
        $('wishGroupLabel').textContent = `${result.group.name || '目前群組'} · 許願牆`;
        $('examDate').value = $('examDate').value || dateKey();
    },
    fail(error) {
        this.failed = true; this.ready = false;
        this.unsubscribes.splice(0).forEach(unsubscribe => unsubscribe()); this.memberUnsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
        $('wishSyncStatus').textContent = error.message || '同步失敗，請重新開啟許願牆。';
        this.updateButtons();
        $('childView').style.display = 'none'; $('adminView').style.display = 'none'; $('redeemListContainer').replaceChildren();
    },
    updateButtons() {
        document.querySelectorAll('[data-wish-write], .btn-submit, .btn-small.btn-admin, .btn-exchange').forEach(button => { button.disabled = !this.ready || this.busy || (button.dataset.unaffordable === 'true'); });
    },
    async perform(action, message) {
        if (!this.ready || this.busy) return;
        this.busy = true; this.updateButtons();
        try { const result = await action(); if (message) alert(message); return result ?? true; }
        catch (error) { alert(error.message || '儲存失敗，請稍後重試。'); return false; }
        finally { this.busy = false; this.render(); }
    },
    render() {
        if (this.failed) return;
        this.ready = this.loaded.size === 3;
        const own = this.members.get(context.accountId);
        $('userNameDisplay').textContent = own?.name || context.accountId;
        $('childView').style.display = this.admin ? 'none' : 'block'; $('adminView').style.display = this.admin ? 'block' : 'none';
        $('adminNotice').textContent = '(管理者模式：顯示目前群組紀錄)';
        $('wishSyncStatus').textContent = this.ready ? '已同步 · 以帳號識別，改名不影響積分' : '同步中…';
        const ledger = calculatePoints(this.scores, this.redeems, this.settings, groupId);
        const balance = ledger.balances.get(context.accountId) || 0;
        if (this.admin) {
            $('memberPointsContainer').innerHTML = [...this.members.values()].map(member => `<div class="member-score-badge" data-account-id="${escape(member.accountId)}">👤 ${escape(member.name || member.accountId)}：${ledger.balances.get(member.accountId) || 0} 點<br><small>${escape(member.accountId)}</small></div>`).join('');
            const currentOrUnbound = record => !ownerId(record) || this.members.has(ownerId(record));
            this.renderScores(this.scores.filter(currentOrUnbound), 'adminScoreListContainer', ledger.earned);
            this.renderSettings();
            this.renderRedeems(this.redeems.filter(currentOrUnbound));
        } else {
            $('userPointsDisplay').textContent = `✨ ${own?.name || context.accountId} 可用積分：${balance} 點`;
            this.renderScores(this.scores.filter(record => ownerId(record) === context.accountId), 'scoreListContainer', ledger.earned);
            this.renderRedeems(this.redeems.filter(record => ownerId(record) === context.accountId));
            const chosen = $('choreSelect').value;
            $('choreSelect').innerHTML = '<option value="">-- 請選擇家事/表現項目 --</option>' + this.settings.choreRules.map(rule => `<option value="${escape(rule.id)}">${escape(rule.name)}（${escape(rule.points)} 點）</option>`).join('');
            $('choreSelect').value = chosen;
            $('giftShopGrid').innerHTML = this.settings.gifts.map(gift => `<div class="gift-card"><div><div class="gift-icon">${escape(gift.icon || '🎁')}</div><div class="gift-title">${escape(gift.name)}</div><div class="gift-cost">需要 ${escape(gift.points)} 積分</div></div><button class="btn-exchange" data-wish-write data-action="redeem" data-id="${escape(gift.id)}" data-unaffordable="${balance < gift.points}">兌換獎品</button></div>`).join('') || '<p>目前群組尚未設定獎品。</p>';
        }
        this.updateButtons();
    },
    legacy(record, kind) {
        if (ownerId(record) || !this.admin) return '';
        return `<div class="legacy-binding"><p>此筆舊資料未計入積分，請確認歸屬帳號。</p><select aria-label="舊資料歸屬帳號" data-bind-for="${escape(kind + ':' + record.id)}"><option value="">選擇目前群組成員</option>${[...this.members.values()].map(member => `<option value="${escape(member.accountId)}">${escape(member.name)}（${escape(member.accountId)}）</option>`).join('')}</select><button data-wish-write data-action="bind" data-kind="${kind}" data-id="${escape(record.id)}">確認歸屬</button></div>`;
    },
    renderScores(records, container, earned) {
        $(container).innerHTML = [...records].reverse().map(record => {
            const title = record.category === 'exam' ? `📝 ${record.examType} - ${record.subject}（${record.score} 分）` : `🧹 ${record.choreName || record.subject || '積分紀錄'}`;
            return `<div class="list-item" style="flex-wrap:wrap" data-record-id="${escape(record.id)}"><div class="list-item-details"><b>${escape(title)}</b> <span>（+${earned.get(record.id) || 0} 點）</span><div class="list-item-meta">${escape(this.label(record))} · ${escape(record.date)}</div>${this.legacy(record, 'scores')}</div><button class="btn-delete" data-wish-write data-action="delete-score" data-id="${escape(record.id)}">刪除</button></div>`;
        }).join('') || '<p>目前沒有任何紀錄。</p>';
    },
    renderRedeems(records) {
        $('redeemListContainer').innerHTML = [...records].reverse().map(record => {
            const status = record.status || '申請中';
            const action = (text, value) => `<button class="btn-action" style="background:#687b5e" data-wish-write data-action="status" data-status="${value}" data-id="${escape(record.id)}">${text}</button>`;
            let actions = '';
            if (ownerId(record)) {
                if (status === '申請中') actions += action('取消申請', '已取消');
                if (this.admin && ['申請中', '執行中'].includes(status)) {
                    if (status === '申請中') actions += action('準備中', '執行中');
                    actions += action('已發放', '已完成') + action('駁回', '已駁回');
                }
            }
            const statusClass = ({ '申請中': 'pending', '執行中': 'processing', '已完成': 'done', '已取消': 'cancelled', '已駁回': 'rejected' })[status] || 'pending';
            return `<div class="list-item" style="display:block" data-record-id="${escape(record.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${escape(record.item)}</b> <span class="status-badge status-${statusClass}">${escape(status)}</span></div><p>${escape(record.detail)}</p><div class="list-item-meta">申請人：${escape(this.label(record))} · ${escape(record.date)} · ${escape(record.cost)} 點</div>${record.reason ? `<p>${escape(record.reason)}${['已取消', '已駁回'].includes(status) ? '（積分已退還）' : ''}</p>` : ''}<div class="admin-actions">${actions}</div>${this.legacy(record, 'redeems')}</div>`;
        }).join('') || '<p>目前沒有兌換紀錄。</p>';
    },
    renderSettings() {
        for (const [kind, element] of [['examRules', 'examRulesList'], ['choreRules', 'choreRulesList'], ['gifts', 'giftsList']]) {
            $(element).innerHTML = this.settings[kind].map(rule => `<div class="list-item"><div>${escape(kind === 'examRules' ? `${rule.type}：${rule.minScore} 分，滿 ${rule.reqCount || 1} 次 → ${rule.points} 點` : `${rule.name} → ${rule.points} 點`)}</div><button class="btn-delete" data-wish-write data-action="remove-setting" data-kind="${kind}" data-id="${escape(rule.id)}">刪除</button></div>`).join('');
        }
    },
};

window.NexusWishWall = app;
window.addSetting = async type => {
    const inputs = type === 'examRules' ? ['setExamType', 'setExamMinScore', 'setExamReqCount', 'setExamPoints'] : type === 'choreRules' ? ['setChoreName', 'setChorePoints'] : ['setGiftName', 'setGiftPoints'];
    const values = inputs.map(id => $(id).value);
    if (values.slice(type === 'examRules' ? 1 : 0).some(value => !value.trim())) { alert('請完整輸入設定欄位。'); return; }
    const entry = type === 'examRules' ? { type: values[0], minScore: Number(values[1]), reqCount: Number(values[2]), points: Number(values[3]) } : { name: values[0], points: Number(values[1]) };
    if (await app.perform(() => store.changeSetting(type, entry))) inputs.filter(id => id !== 'setExamType').forEach(id => { $(id).value = ''; });
};
window.removeSetting = (kind, id) => { if (confirm('確定要刪除這項設定嗎？')) return app.perform(() => store.changeSetting(kind, null, id)); };
$('btnSubmitScore').addEventListener('click', async () => {
    const raw = $('examScore').value;
    if (!raw.trim()) { alert('請輸入考試分數。'); return; }
    if (await app.perform(() => store.createScore({ category: 'exam', date: $('examDate').value, examType: $('examType').value, subject: $('examSubject').value, score: Number(raw) }), '成績已登記，依目前群組規則結算積分。')) $('examScore').value = '';
});
$('btnSubmitChore').addEventListener('click', async () => {
    const id = $('choreSelect').value;
    if (!id) { alert('請先選擇家事項目。'); return; }
    if (await app.perform(() => store.createScore({ category: 'chore', choreId: id }), '表現已登記。')) $('choreSelect').value = '';
});
document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const { action, id, kind, status } = button.dataset;
    if (action === 'delete-score' && confirm('確定要刪除紀錄並重新結算積分嗎？')) await app.perform(() => store.deleteScore(id));
    if (action === 'remove-setting') await window.removeSetting(kind, id);
    if (action === 'redeem') {
        const gift = app.settings.gifts.find(gift => gift.id === id);
        const detail = prompt(`兌換【${gift?.name || '獎品'}】，請輸入詳細內容：`);
        if (detail !== null && confirm('確定送出兌換申請嗎？')) await app.perform(() => store.redeem(id, detail), '兌換申請已送出。');
    }
    if (action === 'status') {
        const reason = ['已取消', '已駁回'].includes(status) ? prompt(`請輸入${status}的理由：`) : '';
        if (reason !== null && confirm(`確定將狀態改為「${status}」嗎？`)) await app.perform(() => store.updateRedeem(id, status, reason));
    }
    if (action === 'bind') {
        const select = [...document.querySelectorAll('[data-bind-for]')].find(element => element.dataset.bindFor === kind + ':' + id);
        if (!select?.value) { alert('請選擇目前群組的歸屬帳號。'); return; }
        if (confirm('確定此筆舊紀錄屬於選定帳號嗎？確認後會重新結算積分。')) await app.perform(() => store.bindLegacy(kind, id, select.value));
    }
});
$('btnBack').addEventListener('click', () => { window.location.href = 'index.html'; });
for (const [title, wrapper, icon] of [['scoreListTitle', 'scoreListWrapper', 'scoreToggleIcon'], ['adminScoreListTitle', 'adminScoreListWrapper', 'adminScoreToggleIcon']]) {
    $(title)?.addEventListener('click', () => { const closed = $(wrapper).style.display === 'none'; $(wrapper).style.display = closed ? 'block' : 'none'; $(icon).textContent = closed ? '▲ 收合' : '▼ 點此展開'; });
}
window.addEventListener('pagehide', () => { app.unsubscribes.splice(0).forEach(unsubscribe => unsubscribe()); app.memberUnsubscribes.splice(0).forEach(unsubscribe => unsubscribe()); });
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
app.updateButtons();
app.init();
