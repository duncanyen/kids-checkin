import { db } from '../firebase-config.js';
import { createFarmMailStore, formatMailTime, WELCOME_ID } from './mail-store.js';

const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
};
const button = (label, action, className = 'farm-mail-button') => {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
};

export function mountFarmMail(game, context) {
    const store = createFarmMailStore(db, context);
    let ensured = false, initializing, unsubscribe, notices = [], category = 'visitor', detailId = null, busy = false;
    let inputEnabled, disposed = false, openVersion = 0;
    let starting, loaded = false;
    const reading = new Set();
    const launcher = button('', open, 'farm-mail-launcher');
    launcher.setAttribute('aria-label', '開啟通知');
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = '<svg viewBox="0 0 48 36" aria-hidden="true"><rect x="2" y="2" width="44" height="32" rx="5"/><path d="M4 5L24 21L44 5M4 32L17 19M44 32L31 19"/></svg>';
    const badge = el('span', 'farm-mail-badge');
    badge.hidden = true; badge.setAttribute('aria-hidden', 'true');
    launcher.append(badge);
    launcher.hidden = true;
    const overlay = el('div', 'farm-mail-overlay');
    overlay.hidden = true;
    const panel = el('section', 'farm-mail-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'farm-mail-title');
    const header = el('header', 'farm-mail-header');
    const title = el('h2', '', '通知'); title.id = 'farm-mail-title';
    const closeButton = button('關閉', close);
    header.append(title, closeButton);
    const tabs = el('div', 'farm-mail-tabs');
    tabs.setAttribute('role', 'tablist');
    const tabButtons = ['visitor', 'system'].map((type, i) => {
        const tab = button(i ? '系統' : '訪客', () => { category = type; detailId = null; render(); }, 'farm-mail-tab');
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'farm-mail-content');
        tab.id = `farm-mail-tab-${type}`;
        tab.addEventListener('keydown', event => {
            if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            tabButtons[1 - i].click(); tabButtons[1 - i].focus();
        });
        tabs.append(tab);
        return tab;
    });
    const message = el('p', 'farm-mail-status'); message.setAttribute('role', 'status');
    const content = el('div', 'farm-mail-content'); content.id = 'farm-mail-content'; content.setAttribute('role', 'tabpanel');
    panel.append(header, tabs, message, content);
    overlay.append(panel);
    document.body.append(launcher, overlay);

    async function ensure() {
        if (ensured) return;
        if (!initializing) {
            initializing = store.ensureWelcome().then(() => { ensured = true; }).finally(() => { initializing = null; });
        }
        return initializing;
    }
    function farmReady() {
        if (disposed || !game.registry.get('myFarmData')) return;
        launcher.hidden = false;
        start().catch(() => { launcher.title = '通知準備失敗，點擊重試'; });
    }
    function updateBadge() {
        const unread = notices.filter(row => !row.readAt).length;
        badge.hidden = unread === 0;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        launcher.setAttribute('aria-label', unread ? `開啟通知，${unread} 則未讀` : '開啟通知');
    }
    async function start() {
        if (unsubscribe) return;
        if (!starting) starting = (async () => {
            await ensure();
            if (disposed || unsubscribe) return;
            unsubscribe = store.watch(rows => {
                if (disposed) return;
                notices = rows; loaded = true;
                updateBadge();
                if (!overlay.hidden) { message.textContent = ''; render(); }
            }, () => {
                unsubscribe = null; loaded = false;
                message.textContent = '通知載入失敗，請關閉後重試。';
            });
        })().finally(() => { starting = null; });
        return starting;
    }
    async function markRead(rows) {
        const ids = rows.filter(row => !row.readAt && !reading.has(row.id)).map(row => row.id);
        if (!ids.length) return;
        ids.forEach(id => reading.add(id));
        try {
            for (let offset = 0; offset < ids.length; offset += 100) {
                const batch = ids.slice(offset, offset + 100);
                const readAt = await store.markRead(batch);
                for (const notice of notices) if (batch.includes(notice.id)) notice.readAt ||= readAt;
            }
            updateBadge();
        } catch { if (!overlay.hidden) message.textContent = '已讀狀態儲存失敗，請稍後重試。'; }
        finally { ids.forEach(id => reading.delete(id)); }
    }
    function onSetData(_parent, key) { if (key === 'myFarmData') farmReady(); }
    game.registry.events.on('setdata', onSetData);
    game.registry.events.on('changedata-myFarmData', farmReady);
    farmReady();

    async function open() {
        if (!overlay.hidden || disposed) return;
        const version = ++openVersion;
        overlay.hidden = false;
        inputEnabled = game.input.enabled;
        game.input.enabled = false;
        closeButton.focus();
        message.textContent = '正在載入通知…';
        try {
            await start();
            if (overlay.hidden || disposed || version !== openVersion) return;
            if (loaded) {
                message.textContent = '';
                render();
            }
        } catch { if (version === openVersion && !disposed) message.textContent = '通知準備失敗，請確認連線與群組權限後重試。'; }
    }
    function close() {
        if (overlay.hidden || busy) return;
        openVersion++;
        overlay.hidden = true;
        game.input.enabled = inputEnabled;
        launcher.focus();
    }
    async function remove(notice) {
        if (busy) return;
        const warning = notice.reward && !notice.claimedAt ? '尚有未領取獎勵，刪除後無法領取，也不會重新寄送。確定刪除？' : '確定刪除這則通知？';
        if (!window.confirm(warning)) return;
        await action(async () => {
            await store.remove(notice.id);
            notices = notices.filter(row => row.id !== notice.id);
            updateBadge();
            detailId = null;
            message.textContent = '通知已刪除';
        });
    }
    async function action(callback) {
        if (busy) return;
        busy = true; render();
        try { await callback(); }
        catch (error) { message.textContent = error.message || '操作失敗，請稍後重試。'; }
        finally { busy = false; render(); }
    }
    function render() {
        tabButtons.forEach((tab, i) => {
            const active = category === (i ? 'system' : 'visitor');
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
            tab.disabled = busy;
        });
        content.setAttribute('aria-labelledby', `farm-mail-tab-${category}`);
        closeButton.disabled = busy;
        content.replaceChildren();
        const current = notices.find(row => row.id === detailId && row.type === 'system');
        if (current) {
            markRead([current]);
            const back = button('‹ 返回列表', () => { detailId = null; render(); }); back.disabled = busy;
            content.append(back, el('h3', '', current.title), el('time', 'farm-mail-time', formatMailTime(current.createdAt)), el('p', 'farm-mail-body', current.body || ''));
            if (current.reward) {
                const rewards = el('section', 'farm-mail-rewards');
                rewards.append(el('h4', '', '🎁 獎勵'), el('p', '', `🪙 金幣 × ${current.reward.coins || 0}`), el('p', '', `🐛 菜蟲 × ${current.reward.worms || 0}`), el('p', '', `🪱 蚯蚓 × ${current.reward.earthworms || 0}`));
                rewards.append(el('small', '', '獎勵不受倉庫容量限制；超出容量時，請先餵食或整理倉庫。'));
                const claim = button(current.claimedAt ? '已領取' : '領取', () => action(async () => {
                    const received = await store.claim(current.id);
                    current.claimedAt = current.claimedAt || Date.now();
                    message.textContent = received ? '獎勵已收入金幣與倉庫！' : '這份獎勵已經領取過了。';
                }), 'farm-mail-button farm-mail-claim');
                claim.disabled = busy || !!current.claimedAt || current.id !== WELCOME_ID;
                rewards.append(claim);
                content.append(rewards);
            }
            const del = button('刪除通知', () => remove(current), 'farm-mail-button farm-mail-delete'); del.disabled = busy;
            content.append(del);
            return;
        }
        detailId = null;
        const rows = notices.filter(row => row.type === category);
        if (!overlay.hidden && category === 'visitor') markRead(rows);
        if (!rows.length) content.append(el('p', 'farm-mail-empty', category === 'visitor' ? '目前沒有訪客來偷蛋的紀錄' : '目前沒有系統通知'));
        for (const notice of rows) {
            const row = el('article', 'farm-mail-row');
            const summary = el(category === 'system' ? 'button' : 'div', 'farm-mail-summary');
            if (category === 'system') {
                summary.type = 'button'; summary.disabled = busy;
                summary.addEventListener('click', () => { detailId = notice.id; render(); });
            }
            summary.append(el('strong', '', notice.title), el('time', 'farm-mail-time', formatMailTime(notice.createdAt)));
            if (category === 'visitor') summary.append(el('small', '', '訪客來偷蛋'));
            if (notice.reward && !notice.claimedAt) {
                const gift = el('span', 'farm-mail-gift', '🎁'); gift.setAttribute('aria-label', '有獎勵可領取');
                summary.append(gift);
            }
            const del = button('刪除', () => remove(notice), 'farm-mail-button farm-mail-delete'); del.disabled = busy;
            row.append(summary, del); content.append(row);
        }
    }
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button:not(:disabled)')].filter(node => node.tabIndex >= 0);
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
    game.events.once('destroy', () => {
        disposed = true;
        unsubscribe?.();
        game.registry.events.off('setdata', onSetData);
        game.registry.events.off('changedata-myFarmData', farmReady);
        launcher.remove(); overlay.remove();
    });
}
