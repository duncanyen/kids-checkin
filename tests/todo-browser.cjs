// Start a repository static server, then node tests/todo-browser.cjs.
// All Firebase operations use in-memory fixtures; production is never used.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const baseURL = process.env.TODO_BASE_URL || 'http://127.0.0.1:8004';

(async () => {
    const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei' });
    await context.addInitScript(() => {
        window.__now = '2026-10-22T02:00:00Z';
        const NativeDate = Date;
        window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [window.__now])); }
            static now() { return new NativeDate(window.__now).getTime(); }
        };
        const profiles = Array.from({ length: 12 }, (_, i) => ({
            accountId: 'u' + i, name: i === 0 ? '建立者' : i <= 2 ? '同名成員' : '成員' + i,
            avatar: ['mom.jpg', 'dad.jpg', 'junjun.jpg', 'cheng.jpg'][i % 4]
        }));
        // Match the exact JPEG data-URL format produced by personal avatar upload.
        const photo = document.createElement('canvas');
        photo.width = photo.height = 32;
        const photoContext = photo.getContext('2d');
        photoContext.fillStyle = '#b45309'; photoContext.fillRect(0, 0, 32, 32);
        profiles[1].avatar = photo.toDataURL('image/jpeg', 0.8);
        profiles.push({ accountId: 'outsider', name: '同名成員', avatar: 'Nexus.png' });
        window.__store = {
            'groups/group-A': { members: profiles.slice(0, 12).map(p => p.accountId) },
            'groups/group-B': { members: ['u0', 'outsider'] },
            'groups/group-C': { members: ['outsider'] },
            'todos/group-A': {
                categories: ['家務', '採買', '分類\'"<測試>'], serverOnly: 'preserve',
                todos: [
                    { id: 1, title: '舊待辦', category: '採買', deadline: '今天', assignees: ['同名成員'], completed: false },
                    { id: 2, title: '今日既有完成', category: '家務', deadline: '2026-10-22', assignees: ['所有人員'], completed: true, completedAt: '2026-10-22T01:00:00Z' },
                    ...Array.from({ length: 12 }, (_, i) => ({ id: 10 + i, title: '歷史' + i, category: '家務', assignees: ['所有人員'], completed: true, completedAt: '2026-10-20T01:00:00Z' })),
                    { id: 30, title: '舊年分不明', category: '家務', assignees: ['所有人員'], completed: true, completedAt: '10/22 09:00' }
                ]
            }
        };
        for (const profile of profiles) window.__store['users/' + profile.accountId] = profile;
        window.__writes = []; window.__queries = [];
        sessionStorage.setItem('familyCheckInUser', JSON.stringify({ accountId: 'u0', id: 'wrong-document-id', docId: 'u0', name: '舊名字' }));
        localStorage.setItem('lastGroupId', 'group-A');
    });
    await context.route('**/js/firebase-config.js', route => route.fulfill({ contentType: 'text/javascript', body: 'export const db = {};' }));
    await context.route('https://www.gstatic.com/**', route => route.fulfill({
        contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'fixtures/todo-firestore.js'), 'utf8')
    }));
    const errors = [], alerts = [];
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { alerts.push(dialog.message()); await dialog.accept(); });
    await page.goto(baseURL + '/todo.html?groupId=group-A');
    await page.waitForFunction(() => window.NexusTodoApp?.ready);
    assert.equal(await page.locator('#completed-section').getAttribute('open'), null);
    assert.equal(await page.locator('#assigneeAvatarContainer [data-action="assign-member"]').count(), 12);
    assert.equal(await page.locator('#assigneeAvatarContainer [data-action="assign-all"]').count(), 1);
    assert.equal(await page.locator('#assigneeAvatarContainer [data-value="u1"] img').getAttribute('src'),
        await page.evaluate(() => window.__store['users/u1'].avatar));
    assert.match(await page.locator('#assigneeAvatarContainer [data-value="u1"] img').getAttribute('src'), /^data:image\/jpeg;base64,/);
    assert.equal(await page.evaluate(() => window.__queries.every(q => q.filters[0].field === 'accountId')), true);

    await page.locator('.fab-btn').click();
    await page.locator('#new-todo-title').fill('採買 & 整理 <測試>');
    await page.locator('#new-todo-note').fill('帶環保袋\n不要忘記');
    await page.locator('#assigneeAvatarContainer [data-value="u1"]').click();
    await page.locator('#assigneeAvatarContainer [data-value="u2"]').click();
    await page.locator('#modal-submit-btn').click();
    await page.waitForFunction(() => document.getElementById('addTodoModal').style.display === 'none');
    let data = await page.evaluate(() => window.__store['todos/group-A']);
    const created = data.todos.find(todo => todo.title === '採買 & 整理 <測試>');
    assert.equal(created.accountId, 'u0');
    assert.equal(created.operator, '建立者');
    assert.equal(created.groupId, 'group-A');
    assert.equal(data.accountId, 'u0');
    assert.equal(data.groupId, 'group-A');
    assert.equal(data.serverOnly, 'preserve');
    assert.deepEqual(created.assigneeAccountIds, ['u1', 'u2']);
    assert.equal(await page.locator('[data-todo-id="' + created.id + '"] .person-avatar').count(), 2);
    assert.equal(await page.locator('[data-todo-id="' + created.id + '"] .todo-title').textContent(), created.title);
    assert.equal(await page.evaluate(() => window.__writes.every(write => write.path === 'todos/group-A')), true);

    await page.locator('[data-todo-id="1"] [data-action="edit"]').click();
    await page.waitForSelector('#addTodoModal', { state: 'visible' });
    assert.match(await page.locator('#assigneeAvatarContainer').textContent(), /舊指派姓名無法確認帳號/);
    await page.locator('#modal-submit-btn').click();
    assert.match(alerts.at(-1), /重新選擇舊待辦/);
    await page.locator('#addTodoModal .modal-btns button').first().click();

    await page.evaluate(() => {
        const photo = document.createElement('canvas'); photo.width = photo.height = 32;
        const context = photo.getContext('2d'); context.fillStyle = '#2563eb'; context.fillRect(0, 0, 32, 32);
        window.__store['users/u1'].avatar = photo.toDataURL('image/jpeg', 0.8);
        window.dispatchEvent(new Event('focus'));
    });
    await page.waitForFunction(id => {
        const photo = window.__store['users/u1'].avatar;
        return document.querySelector('#assigneeAvatarContainer [data-value="u1"] img').getAttribute('src') === photo &&
            [...document.querySelectorAll('[data-todo-id="' + id + '"] img')].some(image => image.getAttribute('src') === photo);
    }, created.id);

    await page.evaluate(() => { window.__store['users/u1'].name = '改名後'; });
    await page.locator('[data-todo-id="' + created.id + '"] [data-action="edit"]').click();
    await page.waitForSelector('#addTodoModal', { state: 'visible' });
    assert.equal(await page.locator('#assigneeAvatarContainer [data-value="u1"]').getAttribute('aria-pressed'), 'true');
    assert.match(await page.locator('#assigneeAvatarContainer [data-value="u1"]').textContent(), /改名後/);
    await page.locator('#modal-submit-btn').click();
    await page.waitForSelector('#addTodoModal', { state: 'hidden' });
    assert.deepEqual(await page.evaluate(id => window.__store['todos/group-A'].todos.find(t => t.id === id).assigneeAccountIds, created.id), ['u1', 'u2']);

    await page.locator('[data-todo-id="' + created.id + '"] input').click();
    await page.waitForFunction(id => window.__store['todos/group-A'].todos.find(t => t.id === id).completed, created.id);
    assert.equal(await page.locator('#completed-section').getAttribute('open'), null);
    await page.locator('#completed-section summary').click();
    assert.match(await page.locator('#completed-tab-today').textContent(), /2/);
    assert.equal(await page.locator('#completed-list-container [data-todo-id="' + created.id + '"]').count(), 1);
    await page.locator('#completed-tab-history').click();
    assert.equal(await page.locator('#completed-list-container .todo-item').count(), 10);
    await page.locator('[data-action="completed-page"][data-value="1"]').click();
    assert.equal(await page.locator('#completed-list-container .todo-item').count(), 3);
    assert.match(await page.locator('#completed-list-container').textContent(), /舊年分不明/);
    await page.locator('#completed-tab-today').click();
    await page.locator('#completed-list-container [data-todo-id="' + created.id + '"] input').click();
    await page.waitForFunction(id => !window.__store['todos/group-A'].todos.find(t => t.id === id).completed, created.id);

    async function recurring(frequency, title, start, end, interval = '1') {
        await page.locator('[data-action="open-recurring"]').click();
        await page.locator('#recurring-title').fill(title);
        assert.deepEqual(await page.locator('#recurring-category-container [data-action="choose-category"]').allTextContents(), ['家務', '採買', '分類\'"<測試>']);
        await page.locator('#recurring-note').fill('循環備註');
        await page.locator('#recurringAssigneeContainer [data-value="u2"]').click();
        await page.locator('[data-action="frequency"][data-value="' + frequency + '"]').click();
        await page.locator('#recurring-start-date').fill(start);
        await page.locator('#recurring-start-time').fill('09:00');
        await page.locator('#recurring-end-date').fill(end);
        if (frequency === 'daily') await page.locator('#recurring-interval').fill(interval);
        else assert.equal(await page.locator('#recurring-interval').isDisabled(), true);
        await page.locator('[data-action="save-recurring"]').click();
        await page.waitForSelector('#recurringTodoModal', { state: 'hidden' });
    }
    await recurring('daily', '隔兩天倒垃圾', '2026-10-20', '2026-10-24', '2');
    data = await page.evaluate(() => window.__store['todos/group-A']);
    let occurrences = data.todos.filter(t => t.title === '隔兩天倒垃圾');
    assert.deepEqual(occurrences.map(t => t.deadline).sort(), ['2026-10-20', '2026-10-22']);
    assert.equal(data.recurringTemplates[0].timeZone, 'Asia/Taipei');
    assert.equal(data.recurringTemplates[0].accountId, 'u0');
    assert.deepEqual(occurrences[0].assigneeAccountIds, ['u2']);
    await page.evaluate(async () => {
        window.__now = '2026-10-24T02:00:00Z';
        await window.NexusTodoApp.refreshRecurring();
        await window.NexusTodoApp.refreshRecurring();
    });
    occurrences = await page.evaluate(() => window.__store['todos/group-A'].todos.filter(t => t.title === '隔兩天倒垃圾'));
    assert.equal(occurrences.length, 3);
    assert.equal(new Set(occurrences.map(t => t.id)).size, 3);
    await page.evaluate(() => { window.__now = '2026-10-22T02:00:00Z'; });
    await recurring('weekly', '每週整理', '2026-10-01', '2026-10-22');
    await recurring('monthly', '月底整理', '2026-01-31', '2026-03-31');
    await recurring('yearly', '每年提醒', '2024-02-29', '2026-03-01');
    data = await page.evaluate(() => window.__store['todos/group-A']);
    assert.deepEqual(data.todos.filter(t => t.title === '每週整理').map(t => t.deadline).sort(), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22']);
    assert.deepEqual(data.todos.filter(t => t.title === '月底整理').map(t => t.deadline).sort(), ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.deepEqual(data.todos.filter(t => t.title === '每年提醒').map(t => t.deadline).sort(), ['2024-02-29', '2025-02-28', '2026-02-28']);
    for (const todo of data.todos.filter(t => t.recurringTemplateId)) {
        assert.equal(todo.groupId, 'group-A'); assert.equal(todo.accountId, 'u0');
    }

    await recurring('daily', '可停止的循環', '2026-10-25', '');
    await page.locator('[data-action="open-recurring"]').click();
    const stoppedId = await page.evaluate(() => window.__store['todos/group-A'].recurringTemplates.find(t => t.title === '可停止的循環').id);
    await page.locator('[data-action="stop-recurring"][data-id="' + stoppedId + '"]').click();
    await page.waitForFunction(id => !window.__store['todos/group-A'].recurringTemplates.find(t => t.id === id).active, stoppedId);
    await page.locator('[data-action="close-recurring"]').click();
    await page.evaluate(async () => { window.__now = '2026-11-10T02:00:00Z'; await window.NexusTodoApp.refreshRecurring(); });
    assert.equal(await page.evaluate(() => window.__store['todos/group-A'].todos.filter(t => t.title === '可停止的循環').length), 1);
    await page.evaluate(async () => { window.__now = '2026-10-22T02:00:00Z'; await window.NexusTodoApp.refreshRecurring(); });

    await page.locator('[data-action="open-recurring"]').click();
    await page.locator('#recurring-title').fill('無效循環');
    await page.locator('#recurring-interval').fill('31');
    await page.locator('[data-action="save-recurring"]').click();
    assert.match(alerts.at(-1), /1–30/);
    await page.locator('#recurring-interval').fill('1');
    await page.locator('#recurring-end-date').fill('2026-01-01');
    await page.locator('[data-action="save-recurring"]').click();
    assert.match(alerts.at(-1), /結束日期/);
    await page.locator('[data-action="close-recurring"]').click();

    await page.locator('.fab-btn').click();
    await page.locator('#new-todo-title').fill('失敗後重試');
    await page.evaluate(() => { window.__failNext = true; });
    await page.locator('#modal-submit-btn').click();
    await page.waitForFunction(() => !window.NexusTodoApp.busy);
    assert.equal(await page.locator('#addTodoModal').isVisible(), true);
    assert.equal(await page.locator('#new-todo-title').inputValue(), '失敗後重試');
    assert.equal(await page.evaluate(() => window.__store['todos/group-A'].todos.some(t => t.title === '失敗後重試')), false);
    await page.evaluate(() => { window.__store['todos/group-A'].todos.push({ id: 'remote', title: '另一位成員剛新增', category: '家務', assignees: ['所有人員'], completed: false }); });
    await page.locator('#modal-submit-btn').click();
    await page.waitForSelector('#addTodoModal', { state: 'hidden' });
    assert.equal(await page.evaluate(() => window.__store['todos/group-A'].todos.some(t => t.id === 'remote')), true);
    assert.equal(await page.evaluate(() => window.__store['todos/group-A'].todos.filter(t => t.title === '失敗後重試').length), 1);

    const other = await context.newPage();
    other.on('pageerror', error => errors.push(error.message));
    await other.goto(baseURL + '/todo.html?groupId=group-B');
    await other.waitForFunction(() => window.NexusTodoApp?.ready);
    assert.equal(await other.locator('#assigneeAvatarContainer [data-action="assign-member"]').count(), 2);
    assert.equal(await other.locator('#assigneeAvatarContainer [data-value="u1"]').count(), 0);
    assert.equal(await other.locator('#assigneeAvatarContainer [data-value="outsider"]').count(), 1);
    assert.equal(await other.locator('#todo-list-container .todo-item').count(), 0);
    await other.goto(baseURL + '/todo.html?groupId=group-C');
    await other.waitForFunction(() => document.getElementById('todo-loading-status').textContent.includes('不在'));
    assert.equal(await other.locator('.fab-btn').isDisabled(), true);
    assert.equal(await other.evaluate(() => window.__writes.length), 0);
    if (process.env.TODO_SCREENSHOTS) {
        await page.bringToFront();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: process.env.TODO_SCREENSHOTS + '/todo-main.png' });
        await page.locator('.fab-btn').click();
        await page.locator('#new-todo-title').fill('採買晚餐食材');
        await page.locator('#assigneeAvatarContainer [data-value="u1"]').click();
        await page.waitForTimeout(450);
        await page.screenshot({ path: process.env.TODO_SCREENSHOTS + '/todo-assignees.png' });
        await page.locator('#addTodoModal .modal-btns button').first().click();
        await page.locator('[data-action="open-recurring"]').click();
        await page.locator('#recurring-title').fill('整理公共空間');
        await page.waitForTimeout(450);
        await page.screenshot({ path: process.env.TODO_SCREENSHOTS + '/todo-recurring.png' });
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['12 group members and everyone avatar', 'uploaded JPEG avatars and refresh', 'stable creator/assignee IDs', 'rename and duplicate names', 'collapsed completion tabs and pagination', 'daily/weekly/monthly/yearly occurrences', 'idempotent catch-up and end date', 'input validation', 'atomic failure and retry', 'fresh concurrent writes retained', 'group isolation'], errors }));
    await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
