const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const core = import('data:text/javascript;base64,' + fs.readFileSync('js/todo-core.js').toString('base64'));
const profiles = [{ accountId: 'alice', name: '新名字', nameHistory: ['舊名字'] }, { accountId: 'bob', name: '小華' }, { accountId: 'c', name: '同名' }, { accountId: 'd', name: '同名' }];
test('assignment IDs take priority, all members are visible, and legacy names require an unambiguous group identity', async () => {
    const { todoAssignedTo } = await core, alice = profiles[0];
    assert.equal(todoAssignedTo({ assigneeScope: 'members', assigneeAccountIds: ['alice'], assignees: ['改名前的舊顯示'] }, alice, profiles), true);
    assert.equal(todoAssignedTo({ assigneeAccountIds: ['bob'], assignees: ['新名字'] }, alice, profiles), false);
    assert.equal(todoAssignedTo({ assigneeScope: 'all', assigneeAccountIds: [] }, alice, profiles), true);
    assert.equal(todoAssignedTo({ assignees: '所有人員' }, alice, profiles), true);
    assert.equal(todoAssignedTo({ assignees: ['舊名字'] }, alice, profiles), true);
    assert.equal(todoAssignedTo({ assignees: ['同名'] }, profiles[2], profiles), false);
    assert.equal(todoAssignedTo({ assignees: ['舊名字'] }, alice, []), false);
    assert.equal(todoAssignedTo({ accountId: 'alice', assigneeAccountIds: [] }, alice, profiles), false);
});
test('homepage widget shows only the current assignee or everyone, including after reassignment/account changes', async () => {
    const { todoAssignedTo } = await core;
    const todos = [
        { title: '給Alice', assigneeScope: 'members', assigneeAccountIds: ['alice'] },
        { title: '給Bob', accountId: 'alice', assigneeAccountIds: ['bob'] },
        { title: '全部共用', assigneeScope: 'all' },
        { title: '舊名稱指派', assignees: ['舊名字'] },
        { title: '已完成項', completed: true, assigneeAccountIds: ['alice'] },
        { title: '未指派項', accountId: 'alice' }
    ];
    const element = { innerHTML: '' }; let receive, unsubscribed = 0;
    const context = { window: { currentGroup: { id: 'A' }, groupMembers: profiles, userAvatarMap: {} },
        document: { getElementById: id => id === 'todoWidgetContent' ? element : null },
        todoAssignedTo, todoUnsubscribe: null, financeUnsubscribe: null, console,
        db: {}, collection: (_, name) => name, where: () => ({}), query: (...args) => args,
        watchMemberWidget: (_, callback) => { receive = callback; return () => unsubscribed++; } };
    const source = fs.readFileSync('js/dashboard.js', 'utf8');
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('window.checkWidgetData ='), source.indexOf('window.checkUnreadMessages =')), context);
    const emit = () => receive({ forEach: callback => callback({ data: () => ({ groupId: 'A', todos }) }) });
    context.window.checkWidgetData(profiles[0]); emit();
    for (const title of ['給Alice', '全部共用', '舊名稱指派']) assert.ok(element.innerHTML.includes(title));
    for (const title of ['給Bob', '未指派項', '已完成項']) assert.ok(!element.innerHTML.includes(title));
    todos[0].assigneeAccountIds = ['bob']; emit(); assert.ok(!element.innerHTML.includes('給Alice'));
    context.window.checkWidgetData(profiles[1]); emit(); assert.equal(unsubscribed, 1);
    assert.ok(element.innerHTML.includes('給Bob')); assert.ok(element.innerHTML.includes('全部共用'));
    assert.ok(!element.innerHTML.includes('舊名稱指派'));
    todos.forEach(todo => { todo.assigneeScope = 'members'; todo.assigneeAccountIds = ['alice']; }); emit();
    assert.match(element.innerHTML, /目前沒有指派給你的待辦事項/);
});
