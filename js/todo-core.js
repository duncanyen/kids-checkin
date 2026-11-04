export const TIME_ZONE = 'Asia/Taipei';
export const DEFAULT_CATEGORIES = ['工作', '生活', '採買'];

export function dateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(value));
    const get = type => parts.find(part => part.type === type).value;
    return get('year') + '-' + get('month') + '-' + get('day');
}

export function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(value, count) {
    const date = new Date(value + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + count);
    return date.toISOString().slice(0, 10);
}

export function normalizeState(data = {}) {
    return {
        ...data,
        categories: Array.isArray(data.categories) ? data.categories : [...DEFAULT_CATEGORIES],
        todos: Array.isArray(data.todos) ? data.todos.map(todo => ({ ...todo, assignees: Array.isArray(todo.assignees) ? todo.assignees : todo.assignees ? [String(todo.assignees)] : [] })) : [],
        recurringTemplates: Array.isArray(data.recurringTemplates) ? data.recurringTemplates : []
    };
}

export function occurrenceDate(template, index) {
    const [year, month, day] = template.startDate.split('-').map(Number);
    if (template.frequency === 'daily') return addDays(template.startDate, index * template.intervalDays);
    if (template.frequency === 'weekly') return addDays(template.startDate, index * 7);
    const date = new Date(Date.UTC(year, month - 1, 1));
    if (template.frequency === 'monthly') date.setUTCMonth(date.getUTCMonth() + index);
    else if (template.frequency === 'yearly') date.setUTCFullYear(year + index);
    else throw new Error('不支援的循環頻率');
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
    return date.toISOString().slice(0, 10);
}

export function occurrenceTodo(template, index) {
    const date = occurrenceDate(template, index);
    return {
        id: 'rec-' + template.id + '-' + date,
        title: template.title, note: template.note, category: template.category,
        assigneeScope: template.assigneeScope,
        assigneeAccountIds: [...template.assigneeAccountIds],
        assignees: [...template.assignees],
        accountId: template.accountId, operator: template.operator, groupId: template.groupId,
        deadline: date, dueTime: template.startTime,
        dueAt: new Date(date + 'T' + template.startTime + ':00+08:00').toISOString(),
        recurringTemplateId: template.id, completed: false,
        completedAt: null, completedDate: null, createdAt: new Date().toISOString()
    };
}

// Called inside a Firestore transaction. Stable IDs and a persisted cursor prevent
// duplicate occurrences when two members open the page at the same time.
export function materializeRecurring(state, now = new Date()) {
    let changed = false;
    const ids = new Set(state.todos.map(todo => String(todo.id)));
    for (const template of state.recurringTemplates) {
        if (!template.active) continue;
        let index = template.nextIndex ?? 1;
        // Bound each transaction, retain the cursor so subsequent passes catch up.
        for (let count = 0; count < 200; count++) {
            const date = occurrenceDate(template, index);
            if (template.endDate && date > template.endDate) {
                template.active = false;
                changed = true;
                break;
            }
            const todo = occurrenceTodo(template, index);
            if (new Date(todo.dueAt).getTime() > new Date(now).getTime()) break;
            if (!ids.has(todo.id)) {
                state.todos.push(todo);
                ids.add(todo.id);
            }
            index++;
            template.nextIndex = index;
            changed = true;
        }
    }
    return changed;
}

export function completionDay(todo) {
    if (validDate(todo.completedDate)) return todo.completedDate;
    // Legacy "M/D HH:mm" values have no year: retain them in history, never
    // guess that an old record was completed today.
    if (/^\d{4}-\d{2}-\d{2}T/.test(todo.completedAt || '') &&
        Number.isFinite(Date.parse(todo.completedAt))) return dateKey(todo.completedAt);
    return null;
}

export function deadlineDate(label, today = dateKey()) {
    if (label === '今天') return today;
    if (label === '明天') return addDays(today, 1);
    if (label === '週末') {
        const day = new Date(today + 'T00:00:00Z').getUTCDay();
        return addDays(today, day === 0 ? 0 : (6 - day));
    }
    return validDate(label) ? label : today;
}

// Display profiles use the stable account identity, never a saved display name.
export function todoAssigneeProfiles(todo, profiles = []) {
    const members = profiles.filter(profile => profile.role !== 'removed');
    const names = Array.isArray(todo.assignees) ? todo.assignees : todo.assignees ? [String(todo.assignees)] : [];
    if (todo.assigneeScope === 'all' || (!todo.assigneeScope && !Array.isArray(todo.assigneeAccountIds) && names.some(name => ['所有人員', '所有人'].includes(name)))) return [{ name: '所有人' }];
    if (Array.isArray(todo.assigneeAccountIds)) {
        return [...new Set(todo.assigneeAccountIds)].map(accountId =>
            members.find(profile => profile.accountId === accountId) || { accountId, name: accountId });
    }
    // Legacy assignments can resolve a previous name only when it is unique
    // within this group. Ambiguous names receive a neutral avatar.
    return names.map(name => {
        const matches = members.filter(profile => [profile.name, ...(Array.isArray(profile.nameHistory) ? profile.nameHistory : [])].includes(name));
        return matches.length === 1 ? matches[0] : { name };
    });
}

// Homepage visibility follows assignment, not who created the task.
export function todoAssignedTo(todo, user, profiles = []) {
    if (!user?.accountId) return false;
    if (todo.assigneeScope === 'all') return true;
    if (Array.isArray(todo.assigneeAccountIds)) return todo.assigneeAccountIds.includes(user.accountId);
    const assignees = Array.isArray(todo.assignees) ? todo.assignees : todo.assignees ? [String(todo.assignees)] : [];
    if (!todo.assigneeScope && assignees.some(name => name === '所有人員' || name === '所有人')) return true;
    // Old tasks only have names. Resolve current and historical names uniquely
    // within the selected group; homonyms must never select a random account.
    return assignees.some(name => {
        const matches = new Set(profiles.filter(profile => profile.role !== 'removed' &&
            [profile.name, ...(Array.isArray(profile.nameHistory) ? profile.nameHistory : [])].includes(name)).map(profile => profile.accountId).filter(Boolean));
        return matches.size === 1 && matches.has(user.accountId);
    });
}
