import { db } from './firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where, runTransaction, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { TIME_ZONE, dateKey, validDate, normalizeState, completionDay, deadlineDate, occurrenceTodo, materializeRecurring } from './todo-core.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const button = (action, text, extra = '') => '<button type="button" data-action="' + action + '" ' + extra + '>' + escapeHTML(text) + '</button>';
const sameId = (a, b) => String(a) === String(b);
const frequencyNames = { daily: '每天', weekly: '每週', monthly: '每月', yearly: '每年' };

function fallbackAvatar(name) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#d1fae5"/><text x="32" y="42" text-anchor="middle" font-size="30" fill="#047857">' + escapeHTML(String(name || '?').slice(0, 1)) + '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function avatarURL(member) {
    // Personal uploads in js/main.js are persisted as users.avatar (JPEG data URL).
    const value = member?.avatar || '';
    if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(value)) return value;
    try {
        const url = new URL(value, location.href);
        if (value && ['http:', 'https:'].includes(url.protocol)) return url.href;
    } catch {}
    return fallbackAvatar(member?.name);
}
function avatar(member, sizeClass = '') {
    return '<img class="person-avatar ' + sizeClass + '" src="' + escapeHTML(avatarURL(member)) + '" alt="' + escapeHTML(member.name) + '" title="' + escapeHTML(member.name + (member.accountId ? '（' + member.accountId + '）' : '')) + '">';
}

const NexusTodoApp = {
    currentGroupId: null, currentUser: null, groupMembers: [], ready: false, busy: false,
    state: normalizeState(), currentFilter: 'all', editingTodoId: null,
    completedTab: 'today', completedPage: 1, pageSize: 10,
    forms: {
        normal: { scope: 'all', ids: [], category: '', deadline: '今天', unresolved: [] },
        recurring: { scope: 'all', ids: [], category: '', frequency: 'daily', unresolved: [] }
    },

    async init(groupId) {
        try {
            this.currentUser = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
            this.currentGroupId = groupId || localStorage.getItem('lastGroupId') || this.currentUser?.groupId;
            $('nexus-todo-container').dataset.groupId = this.currentGroupId || '';
            if (!this.currentUser || !this.currentGroupId) throw new Error('找不到登入狀態或群組，請先返回主頁登入並選擇群組。');
            if (!this.currentUser.accountId && this.currentUser.docId) {
                const profile = await getDoc(doc(db, 'users', this.currentUser.docId));
                if (profile.exists()) this.currentUser = { ...this.currentUser, ...profile.data() };
            }
            if (!this.currentUser.accountId) throw new Error('登入資料缺少 accountId，請重新登入。');
            $('todo-loading-status').textContent = '同步中…';
            await this.loadMembers();
            const ref = doc(db, 'todos', this.currentGroupId);
            const snapshot = await getDoc(ref);
            this.applyState(snapshot.exists() ? snapshot.data() : {});
            this.ready = true;
            this.updateButtons();
            $('todo-loading-status').textContent = '已同步';
            this.unsubscribe = onSnapshot(ref, snapshot => {
                this.applyState(snapshot.exists() ? snapshot.data() : {});
                this.refreshRecurring();
            }, error => {
                console.error(error);
                $('todo-loading-status').textContent = '即時同步中斷，儲存時會重新檢查';
            });
            await this.refreshRecurring();
            this.recurringTimer = setInterval(() => this.refreshRecurring(), 60000);
        } catch (error) {
            console.error(error);
            $('todo-loading-status').textContent = error.message;
            $('todo-list-container').textContent = error.message;
        }
    },

    async loadMembers() {
        const group = await getDoc(doc(db, 'groups', this.currentGroupId));
        if (!group.exists()) throw new Error('群組不存在，請返回主頁重新選擇。');
        const ids = [...new Set((group.data().members || []).filter(id => typeof id === 'string'))];
        if (!ids.includes(this.currentUser.accountId)) throw new Error('你目前不在這個群組內，請返回主頁重新選擇群組。');
        const members = new Map();
        for (let index = 0; index < ids.length; index += 10) {
            const snapshot = await getDocs(query(collection(db, 'users'), where('accountId', 'in', ids.slice(index, index + 10))));
            snapshot.forEach(profile => {
                const member = profile.data();
                if (ids.includes(member.accountId)) members.set(member.accountId, { ...member, name: member.name || member.accountId });
            });
        }
        this.groupMembers = ids.map(id => members.get(id)).filter(Boolean);
        this.missingMembers = ids.filter(id => !members.has(id)).length;
        const profile = members.get(this.currentUser.accountId);
        if (profile) this.currentUser = { ...this.currentUser, ...profile };
        this.renderAssigneeChips();
        if (this.ready) this.renderTodoList();
    },

    applyState(data) {
        this.state = normalizeState(data);
        localStorage.setItem('nexus_todo_' + this.currentGroupId, JSON.stringify(this.state));
        this.render();
    },

    updateButtons() {
        document.querySelectorAll('[data-write]').forEach(element => { element.disabled = !this.ready || this.busy; });
    },

    async commit(change, quiet = false) {
        if (!this.ready || this.busy) return false;
        this.busy = true;
        this.updateButtons();
        if (!quiet) $('loadingView').style.display = 'flex';
        try {
            const next = await runTransaction(db, async transaction => {
                const group = await transaction.get(doc(db, 'groups', this.currentGroupId));
                const snapshot = await transaction.get(doc(db, 'todos', this.currentGroupId));
                const allowed = new Set(group.exists() ? group.data().members || [] : []);
                if (!allowed.has(this.currentUser.accountId)) throw new Error('你已不在此群組，無法儲存。');
                const data = normalizeState(snapshot.exists() ? snapshot.data() : {});
                change(data, allowed);
                data.groupId = this.currentGroupId;
                data.accountId ||= this.currentUser.accountId;
                data.updatedByAccountId = this.currentUser.accountId;
                data.updatedAt = new Date().toISOString();
                transaction.set(doc(db, 'todos', this.currentGroupId), {
                    categories: data.categories, todos: data.todos, recurringTemplates: data.recurringTemplates,
                    groupId: data.groupId, accountId: data.accountId,
                    updatedByAccountId: data.updatedByAccountId, updatedAt: data.updatedAt
                }, { merge: true });
                return data;
            });
            this.applyState(next);
            $('todo-loading-status').textContent = '已同步';
            return true;
        } catch (error) {
            console.error(error);
            $('todo-loading-status').textContent = '儲存失敗，資料尚未變更';
            if (!quiet) alert(error.message || '儲存失敗，請檢查網路後重試。');
            return false;
        } finally {
            this.busy = false;
            this.updateButtons();
            if (!quiet) $('loadingView').style.display = 'none';
        }
    },

    async refreshRecurring() {
        if (!this.ready || this.busy) return;
        if (this.lastRenderedDay !== dateKey()) this.renderTodoList();
        const preview = structuredClone(this.state);
        if (!materializeRecurring(preview)) return;
        const saved = await this.commit(data => materializeRecurring(data), true);
        if (saved) queueMicrotask(() => this.refreshRecurring());
    },

    render() {
        this.renderCategories();
        this.renderCategoryButtons();
        this.renderAssigneeChips();
        this.renderTodoList();
        this.renderRecurringTemplates();
    },

    renderCategories() {
        $('category-container').innerHTML = button('filter', '全部', 'class="cat-btn ' + (this.currentFilter === 'all' ? 'active' : '') + '" data-value="all"') +
            this.state.categories.map(category =>
                '<div class="category-filter">' + button('filter', category, 'class="cat-btn ' + (this.currentFilter === category ? 'active' : '') + '" data-value="' + escapeHTML(category) + '"') +
                button('delete-category', '×', 'class="delete-category" aria-label="刪除分類 ' + escapeHTML(category) + '" data-value="' + escapeHTML(category) + '"') + '</div>').join('');
    },

    renderCategoryButtons() {
        for (const [context, container] of [['normal', 'new-todo-category-container'], ['recurring', 'recurring-category-container']]) {
            const form = this.forms[context];
            if (!form.category) form.category = this.state.categories[0] || '一般';
            const options = [...new Set([...this.state.categories, form.category])];
            $(container).innerHTML = options.map(category =>
                button('choose-category', category, 'class="category-btn ' + (form.category === category ? 'active' : '') + '" data-context="' + context + '" data-value="' + escapeHTML(category) + '"')).join('') +
                button('add-category', '+ 新增分類', 'class="category-btn category-btn-add" data-context="' + context + '"');
        }
    },

    renderAssigneeChips() {
        for (const [context, container] of [['normal', 'assigneeAvatarContainer'], ['recurring', 'recurringAssigneeContainer']]) {
            const form = this.forms[context];
            const all = '<span class="everyone-avatar" aria-hidden="true">👥</span><span>所有人員</span>';
            let html = '<button type="button" class="assignee-chip ' + (form.scope === 'all' ? 'selected' : '') + '" aria-pressed="' + (form.scope === 'all') + '" data-action="assign-all" data-context="' + context + '">' + all + '</button>';
            for (const member of this.groupMembers) {
                const selected = form.scope === 'members' && form.ids.includes(member.accountId);
                html += '<button type="button" class="assignee-chip ' + (selected ? 'selected' : '') + '" aria-pressed="' + selected + '" data-action="assign-member" data-context="' + context + '" data-value="' + escapeHTML(member.accountId) + '">' + avatar(member) + '<span>' + escapeHTML(member.name) + '</span></button>';
            }
            if (form.scope === 'members') {
                for (const id of form.ids.filter(id => !this.groupMembers.some(member => member.accountId === id))) {
                    html += button('assign-member', id + '（已離開，點此移除）', 'class="assignee-chip selected" data-context="' + context + '" data-value="' + escapeHTML(id) + '"');
                }
            }
            if (this.missingMembers) html += '<p class="form-hint">部分成員資料暫時無法載入，請重新整理後再指派。</p>';
            if (form.unresolved.length) html += '<p class="form-error">舊指派姓名無法確認帳號，請重新選擇負責人：' + escapeHTML(form.unresolved.join('、')) + '</p>';
            $(container).innerHTML = html;
        }
    },

    assignment(form, allowed) {
        if (form.unresolved.length) throw new Error('請重新選擇舊待辦的負責人。');
        if (form.scope === 'all') return { assigneeScope: 'all', assigneeAccountIds: [], assignees: ['所有人員'] };
        if (!form.ids.length || form.ids.some(id => !allowed.has(id))) throw new Error('負責人已離開群組或尚未選擇，請重新指派。');
        return {
            assigneeScope: 'members', assigneeAccountIds: [...form.ids],
            assignees: form.ids.map(id => this.groupMembers.find(member => member.accountId === id)?.name || id)
        };
    },

    assigneeHTML(item) {
        let members = [];
        const all = item.assigneeScope === 'all' || (!item.assigneeScope && (item.assignees || []).some(name => ['所有人員', '所有人'].includes(name)));
        if (all) members = this.groupMembers;
        else if (Array.isArray(item.assigneeAccountIds)) {
            members = item.assigneeAccountIds.map((id, index) => this.groupMembers.find(member => member.accountId === id) || { accountId: id, name: item.assignees?.[index] || id });
        } else {
            members = (item.assignees || []).map(name => {
                const matches = this.groupMembers.filter(member => member.name === name);
                return matches.length === 1 ? matches[0] : { name };
            });
        }
        return '<span class="todo-assignees" aria-label="負責人">' +
            (all ? '<span class="badge">所有人員</span>' : '') +
            members.slice(0, 4).map(member => avatar(member)).join('') +
            (members.length > 4 ? '<span class="avatar-overflow" title="' + escapeHTML(members.slice(4).map(member => member.name).join('、')) + '" aria-label="另有 ' + (members.length - 4) + ' 位負責人">+' + (members.length - 4) + '</span>' : '') +
            (!members.length && !all ? '<span class="badge">未指派</span>' : '') + '</span>';
    },

    renderTodoItemHTML(item) {
        let completed = '';
        if (item.completedAt) {
            const parsed = /^\d{4}-/.test(item.completedAt) ? new Date(item.completedAt) : null;
            completed = parsed && Number.isFinite(parsed.getTime())
                ? new Intl.DateTimeFormat('zh-TW', { timeZone: TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
                : item.completedAt;
        }
        return '<div class="todo-item ' + (item.completed ? 'completed' : '') + '" data-todo-id="' + escapeHTML(item.id) + '">' +
            '<div class="todo-item-content"><input type="checkbox" aria-label="完成 ' + escapeHTML(item.title) + '" data-action="toggle" data-id="' + escapeHTML(item.id) + '" ' + (item.completed ? 'checked' : '') + '>' +
            '<div class="todo-copy"><div class="todo-title">' + escapeHTML(item.title) + '</div><div class="todo-details">' +
            '<span class="badge">📁 ' + escapeHTML(item.category) + '</span><span class="badge">⏰ ' + escapeHTML(item.deadline) + (item.dueTime ? ' ' + escapeHTML(item.dueTime) : '') + '</span>' +
            (item.recurringTemplateId ? '<span class="badge">↻ 循環待辦</span>' : '') +
            '</div>' + this.assigneeHTML(item) +
            (item.note ? '<div class="todo-note">📝 ' + escapeHTML(item.note) + '</div>' : '') +
            (item.completed ? '<div class="completed-time">✓ ' + (completed ? escapeHTML(completed) : '完成時間未記錄') + '</div>' : '') +
            '</div></div><div class="todo-actions">' +
            button('edit', '✏️', 'class="action-btn edit" title="編輯" data-id="' + escapeHTML(item.id) + '"') +
            button('delete', '×', 'class="action-btn delete" title="刪除" data-id="' + escapeHTML(item.id) + '"') + '</div></div>';
    },

    renderTodoList() {
        const todos = this.currentFilter === 'all' ? this.state.todos : this.state.todos.filter(todo => todo.category === this.currentFilter);
        const active = todos.filter(todo => !todo.completed);
        const done = todos.filter(todo => todo.completed);
        const today = dateKey();
        this.lastRenderedDay = today;
        const todayDone = done.filter(todo => completionDay(todo) === today);
        const history = done.filter(todo => completionDay(todo) !== today);
        $('todo-list-container').innerHTML = active.length ? active.map(todo => this.renderTodoItemHTML(todo)).join('') : '<div class="empty-state">目前尚無未完成待辦</div>';
        $('completed-total').textContent = done.length;
        for (const [tab, items] of [['today', todayDone], ['history', history]]) {
            const element = $('completed-tab-' + tab);
            element.textContent = (tab === 'today' ? '今日完成' : '過往完成') + '（' + items.length + '）';
            element.setAttribute('aria-selected', String(this.completedTab === tab));
        }
        $('completed-list-container').setAttribute('aria-labelledby', 'completed-tab-' + this.completedTab);
        const selected = (this.completedTab === 'today' ? todayDone : history).slice().sort((a, b) => String(completionDay(b) || '').localeCompare(String(completionDay(a) || '')) || String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
        const pages = Math.max(1, Math.ceil(selected.length / this.pageSize));
        this.completedPage = Math.max(1, Math.min(pages, this.completedPage));
        $('completed-list-container').innerHTML = selected.length
            ? selected.slice((this.completedPage - 1) * this.pageSize, this.completedPage * this.pageSize).map(todo => this.renderTodoItemHTML(todo)).join('')
            : '<div class="empty-state">' + (this.completedTab === 'today' ? '今天還沒有完成的待辦' : '目前沒有過往完成紀錄') + '</div>';
        $('completed-pagination').innerHTML = pages > 1
            ? button('completed-page', '上一頁', 'data-value="-1" ' + (this.completedPage === 1 ? 'disabled' : '')) + '<span>' + this.completedPage + ' / ' + pages + '</span>' + button('completed-page', '下一頁', 'data-value="1" ' + (this.completedPage === pages ? 'disabled' : '')) : '';
    },

    async handleAddCustomCategory(context = 'normal') {
        const value = prompt('請輸入新的分類名稱：')?.trim();
        if (!value) return;
        const saved = await this.commit(data => { if (!data.categories.includes(value)) data.categories.push(value); });
        if (saved) { this.forms[context].category = value; this.renderCategoryButtons(); }
    },

    async deleteCategory(category) {
        if (!confirm('確定刪除分類「' + category + '」？既有待辦仍保留原分類。')) return;
        await this.commit(data => { data.categories = data.categories.filter(value => value !== category); });
        if (this.currentFilter === category) { this.currentFilter = 'all'; this.render(); }
    },

    async openAddModal() {
        this.editingTodoId = null;
        this.forms.normal = { scope: 'all', ids: [], category: this.state.categories[0] || '一般', deadline: '今天', unresolved: [] };
        $('modal-title').textContent = '新增待辦事項';
        $('modal-submit-btn').textContent = '確認新增';
        $('new-todo-title').value = '';
        $('new-todo-note').value = '';
        this.setDeadlineUI('今天');
        this.renderCategoryButtons();
        this.renderAssigneeChips();
        $('addTodoModal').style.display = 'flex';
        $('addTodoModal').querySelector('.modal-content').scrollTop = 0;
        $('new-todo-title').focus({ preventScroll: true });
        await this.refreshMembersForForm();
    },

    async refreshMembersForForm() {
        if (this.memberRefresh) return this.memberRefresh;
        this.memberRefresh = (async () => {
            try { await this.loadMembers(); }
            catch (error) { $('todo-loading-status').textContent = error.message; }
        })();
        try { await this.memberRefresh; }
        finally { this.memberRefresh = null; }
    },

    async openEditModal(id) {
        const todo = this.state.todos.find(item => sameId(item.id, id));
        if (!todo) return;
        await this.refreshMembersForForm();
        this.editingTodoId = todo.id;
        const form = { scope: 'all', ids: [], category: todo.category, deadline: todo.deadline, unresolved: [] };
        if (todo.assigneeScope === 'members' || (!todo.assigneeScope && !(todo.assignees || []).some(name => ['所有人', '所有人員'].includes(name)))) {
            form.scope = 'members';
            if (Array.isArray(todo.assigneeAccountIds)) form.ids = [...todo.assigneeAccountIds];
            else for (const name of todo.assignees || []) {
                const matches = this.groupMembers.filter(member => member.name === name);
                if (matches.length === 1) form.ids.push(matches[0].accountId);
                else form.unresolved.push(name);
            }
        }
        this.forms.normal = form;
        $('modal-title').textContent = todo.recurringTemplateId ? '編輯這一次的循環待辦' : '編輯待辦事項';
        $('modal-submit-btn').textContent = '儲存修改';
        $('new-todo-title').value = todo.title;
        $('new-todo-note').value = todo.note || '';
        this.setDeadlineUI(todo.deadline);
        this.renderCategoryButtons();
        this.renderAssigneeChips();
        $('addTodoModal').style.display = 'flex';
        $('addTodoModal').querySelector('.modal-content').scrollTop = 0;
    },

    closeAddModal() { $('addTodoModal').style.display = 'none'; this.editingTodoId = null; },
    setDeadlineUI(label) {
        this.forms.normal.deadline = label;
        document.querySelectorAll('.deadline-btn').forEach(element => element.classList.remove('active'));
        const ids = { '今天': 'dl-today', '明天': 'dl-tomorrow', '週末': 'dl-weekend' };
        $(ids[label] || 'dl-custom').classList.add('active');
        $('dl-custom').textContent = ids[label] ? '日期' : label;
    },
    selectDeadline(type, label) { this.setDeadlineUI(label); },
    triggerCustomDate() {
        const picker = $('hidden-date-picker');
        picker.style.display = 'block';
        picker.showPicker?.();
        picker.focus();
    },
    handleCustomDateChange(value) {
        if (validDate(value)) this.setDeadlineUI(value);
        $('hidden-date-picker').style.display = 'none';
    },

    async saveTodo() {
        const title = $('new-todo-title').value.trim(), note = $('new-todo-note').value.trim();
        if (!title) return alert('請輸入待辦內容。');
        const editingId = this.editingTodoId;
        const form = structuredClone(this.forms.normal);
        const newId = crypto.randomUUID();
        const saved = await this.commit((data, allowed) => {
            const assignment = this.assignment(form, allowed);
            const fields = { title, note, category: form.category, deadline: deadlineDate(form.deadline), ...assignment };
            if (editingId !== null) {
                const todo = data.todos.find(item => sameId(item.id, editingId));
                if (!todo) throw new Error('這筆待辦已被刪除，請重新整理。');
                Object.assign(todo, fields, { updatedByAccountId: this.currentUser.accountId, updatedAt: new Date().toISOString() });
            } else data.todos.unshift({
                id: newId, ...fields, groupId: this.currentGroupId,
                accountId: this.currentUser.accountId, operator: this.currentUser.name || this.currentUser.accountId,
                createdAt: new Date().toISOString(), completed: false, completedAt: null, completedDate: null
            });
        });
        if (saved) this.closeAddModal();
    },

    async toggleTodo(id) {
        await this.commit(data => {
            const todo = data.todos.find(item => sameId(item.id, id));
            if (!todo) throw new Error('這筆待辦已被刪除。');
            todo.completed = !todo.completed;
            todo.completedAt = todo.completed ? new Date().toISOString() : null;
            todo.completedDate = todo.completed ? dateKey() : null;
            todo.completedByAccountId = todo.completed ? this.currentUser.accountId : null;
        });
    },

    async deleteTodo(id) {
        const todo = this.state.todos.find(item => sameId(item.id, id));
        if (!confirm(todo?.recurringTemplateId ? '只刪除這一次待辦？後續仍會依循環設定產生。' : '確定刪除此待辦？')) return;
        await this.commit(data => { data.todos = data.todos.filter(item => !sameId(item.id, id)); });
    },

    async openRecurringModal() {
        this.forms.recurring = { scope: 'all', ids: [], category: this.state.categories[0] || '一般', frequency: 'daily', unresolved: [] };
        $('recurring-title').value = '';
        $('recurring-note').value = '';
        $('recurring-start-date').value = dateKey();
        $('recurring-start-time').value = '09:00';
        $('recurring-end-date').value = '';
        $('recurring-interval').value = '1';
        this.renderCategoryButtons();
        this.renderAssigneeChips();
        this.selectFrequency('daily');
        this.renderRecurringTemplates();
        $('recurringTodoModal').style.display = 'flex';
        $('recurringTodoModal').querySelector('.modal-content').scrollTop = 0;
        await this.refreshMembersForForm();
    },

    selectFrequency(value) {
        if (!frequencyNames[value]) return;
        this.forms.recurring.frequency = value;
        document.querySelectorAll('[data-action="frequency"]').forEach(element => {
            element.classList.toggle('active', element.dataset.value === value);
            element.setAttribute('aria-pressed', String(element.dataset.value === value));
        });
        $('recurring-interval').disabled = value !== 'daily';
        $('recurring-frequency-hint').textContent = value === 'daily'
            ? '每隔 1–30 天重複一次；1 表示每天。'
            : value === 'weekly' ? '每週於開始日期的同一星期重複。'
            : value === 'monthly' ? '每月同一天；當月無該日期時安排在月底。'
            : '每年同月同日；閏日遇平年時安排在 2 月底。';
    },

    async saveRecurring() {
        const title = $('recurring-title').value.trim(), note = $('recurring-note').value.trim();
        const startDate = $('recurring-start-date').value, startTime = $('recurring-start-time').value;
        const endDate = $('recurring-end-date').value;
        const form = structuredClone(this.forms.recurring);
        const intervalDays = Number($('recurring-interval').value);
        if (!title) return alert('請輸入待辦名稱。');
        if (!validDate(startDate) || !/^\d{2}:\d{2}$/.test(startTime)) return alert('請選擇有效的開始日期與時間。');
        if (endDate && (!validDate(endDate) || endDate < startDate)) return alert('結束日期不能早於開始日期。');
        if (form.frequency === 'daily' && (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 30)) return alert('間隔天數必須為 1–30 天。');
        const id = crypto.randomUUID();
        const saved = await this.commit((data, allowed) => {
            const template = {
                id, title, note, category: form.category, ...this.assignment(form, allowed),
                frequency: form.frequency, intervalDays: form.frequency === 'daily' ? intervalDays : 1,
                startDate, startTime, endDate: endDate || null, timeZone: TIME_ZONE,
                accountId: this.currentUser.accountId, operator: this.currentUser.name || this.currentUser.accountId,
                groupId: this.currentGroupId, active: true, nextIndex: 1, createdAt: new Date().toISOString()
            };
            data.recurringTemplates.push(template);
            data.todos.unshift(occurrenceTodo(template, 0));
            materializeRecurring(data);
        });
        if (saved) { $('recurringTodoModal').style.display = 'none'; this.refreshRecurring(); }
    },

    renderRecurringTemplates() {
        const active = this.state.recurringTemplates.filter(template => template.active);
        $('recurring-existing').innerHTML = active.length ? '<h4>進行中的循環</h4>' + active.map(template =>
            '<div class="recurring-existing-item"><span>' + escapeHTML(template.title) + '<small>' +
            escapeHTML(template.frequency === 'daily' ? '每隔 ' + template.intervalDays + ' 天' : frequencyNames[template.frequency]) +
            ' · ' + escapeHTML(template.startTime) + '</small></span>' +
            button('stop-recurring', '停止循環', 'data-id="' + escapeHTML(template.id) + '"') + '</div>').join('') : '';
    },

    async stopRecurring(id) {
        if (!confirm('停止後續循環？已產生的待辦與完成紀錄會保留。')) return;
        await this.commit(data => {
            const template = data.recurringTemplates.find(item => item.id === id);
            if (template) template.active = false;
        });
    }
};

window.NexusTodoApp = NexusTodoApp;
document.addEventListener('error', event => {
    if (event.target instanceof HTMLImageElement && event.target.classList.contains('person-avatar')) {
        const fallback = fallbackAvatar(event.target.alt);
        if (event.target.src !== fallback) event.target.src = fallback;
    }
}, true);
document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const { action, value, id, context = 'normal' } = target.dataset;
    if (NexusTodoApp.busy) return;
    const form = NexusTodoApp.forms[context];
    const actions = {
        filter: () => { NexusTodoApp.currentFilter = value; NexusTodoApp.completedPage = 1; NexusTodoApp.render(); },
        'choose-category': () => { form.category = value; NexusTodoApp.renderCategoryButtons(); },
        'add-category': () => NexusTodoApp.handleAddCustomCategory(context),
        'delete-category': () => NexusTodoApp.deleteCategory(value),
        'assign-all': () => { form.scope = 'all'; form.ids = []; form.unresolved = []; NexusTodoApp.renderAssigneeChips(); },
        'assign-member': () => {
            if (form.scope === 'all') { form.scope = 'members'; form.ids = []; }
            form.ids = form.ids.includes(value) ? form.ids.filter(accountId => accountId !== value) : [...form.ids, value];
            form.unresolved = [];
            if (!form.ids.length) form.scope = 'all';
            NexusTodoApp.renderAssigneeChips();
        },
        toggle: () => NexusTodoApp.toggleTodo(id),
        edit: () => NexusTodoApp.openEditModal(id),
        delete: () => NexusTodoApp.deleteTodo(id),
        'completed-tab': () => { NexusTodoApp.completedTab = value; NexusTodoApp.completedPage = 1; NexusTodoApp.renderTodoList(); },
        'completed-page': () => { NexusTodoApp.completedPage += Number(value); NexusTodoApp.renderTodoList(); },
        'open-recurring': () => NexusTodoApp.openRecurringModal(),
        'close-recurring': () => { $('recurringTodoModal').style.display = 'none'; },
        'save-recurring': () => NexusTodoApp.saveRecurring(),
        frequency: () => NexusTodoApp.selectFrequency(value),
        'stop-recurring': () => NexusTodoApp.stopRecurring(id)
    };
    if (actions[action]) { event.preventDefault(); actions[action](); }
});
async function refreshVisibleData() {
    if (!NexusTodoApp.ready) return;
    await NexusTodoApp.refreshMembersForForm();
    await NexusTodoApp.refreshRecurring();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshVisibleData(); });
window.addEventListener('focus', refreshVisibleData);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !NexusTodoApp.busy) {
        NexusTodoApp.closeAddModal();
        $('recurringTodoModal').style.display = 'none';
    }
});
window.addEventListener('pagehide', () => { NexusTodoApp.unsubscribe?.(); clearInterval(NexusTodoApp.recurringTimer); });
const initialize = () => NexusTodoApp.init(new URLSearchParams(location.search).get('groupId'));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
else initialize();
