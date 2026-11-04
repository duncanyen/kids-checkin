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
    const { todoAssignedTo, todoAssigneeProfiles } = await core;
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
        todoAssignedTo, todoAssigneeProfiles, todoUnsubscribe: null, financeUnsubscribe: null, console,
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

test('assignee profiles resolve account IDs before old names and handle legacy ambiguity safely', async () => {
    const { todoAssigneeProfiles } = await core;
    const members = [
        { accountId: 'alice', name: '新名字', nameHistory: ['舊名字'], avatar: 'alice.jpg' },
        { accountId: 'bob', name: '舊名字', avatar: 'bob.jpg' }
    ];
    assert.deepEqual(todoAssigneeProfiles({ assigneeAccountIds: ['alice'], assignees: ['舊名字'] }, members), [members[0]]);
    assert.deepEqual(todoAssigneeProfiles({ assignees: ['舊名字'] }, members), [{ name: '舊名字' }]);
    assert.deepEqual(todoAssigneeProfiles({ assignees: ['舊名字'] }, [members[0]]), [members[0]]);
    assert.deepEqual(todoAssigneeProfiles({ assigneeAccountIds: ['missing'], assignees: ['舊名字'] }, members), [{ accountId: 'missing', name: 'missing' }]);
    assert.deepEqual(todoAssigneeProfiles({ assigneeScope: 'all', assigneeAccountIds: [] }, members), [{ name: '所有人' }]);
});

test('homepage avatars and labels follow users.accountId through renames and late profile refreshes', async () => {
    const { todoAssignedTo, todoAssigneeProfiles } = await core;
    const todo = { title: '測試頭像', assigneeAccountIds: ['alice'], assignees: ['舊名字'] };
    const element = { innerHTML: '' }; let receive;
    const context = {
        window: { currentGroup: { id: 'A' }, groupMembers: [], userAvatarMap: { '舊名字': 'wrong-person.jpg', alice: 'account-avatar.jpg' } },
        document: { getElementById: id => id === 'todoWidgetContent' ? element : null },
        todoAssignedTo, todoAssigneeProfiles, todoUnsubscribe: null, financeUnsubscribe: null, console, db: {},
        collection: (_, name) => name, where: () => ({}), query: (...args) => args,
        watchMemberWidget: (_, callback) => { receive = callback; return () => {}; }
    };
    const source = fs.readFileSync('js/dashboard.js', 'utf8');
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('window.checkWidgetData ='), source.indexOf('window.checkUnreadMessages =')), context);
    const emit = () => receive({ forEach: cb => cb({ data: () => ({ todos: [todo] }) }) });
    context.window.checkWidgetData({ accountId: 'alice' }); emit();
    assert.match(element.innerHTML, /src="account-avatar.jpg"/);
    assert.ok(!element.innerHTML.includes('wrong-person.jpg'));
    context.window.groupMembers = [{ accountId: 'alice', name: '目前名稱', avatar: 'current-upload.jpg' }];
    emit();
    assert.match(element.innerHTML, /src="current-upload.jpg"/);
    assert.match(element.innerHTML, /title="目前名稱"/);
    assert.ok(!element.innerHTML.includes('舊名字'));
    context.window.groupMembers[0] = { accountId: 'alice', name: '再次改名', avatar: 'latest-upload.jpg' };
    emit();
    assert.match(element.innerHTML, /src="latest-upload.jpg"/);
    assert.match(element.innerHTML, /title="再次改名"/);
    assert.ok(!element.innerHTML.includes('current-upload.jpg'));
});
