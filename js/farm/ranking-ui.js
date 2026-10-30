import { FARM_RANKINGS, loadFarmRanking } from './rankings.js';

const node = (tag, className, text) => {
    const result = document.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
};
export function mountFarmRankings(game, context) {
    let disposed = false, version = 0, inputEnabled;
    const launcher = node('button', 'farm-ranking-launcher');
    launcher.type = 'button'; launcher.hidden = true;
    launcher.setAttribute('aria-label', '開啟排行榜'); launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M16 3H32V15Q32 25 24 26Q16 25 16 15ZM16 7H6V12Q6 21 18 21M32 7H42V12Q42 21 30 21M24 26V34M15 37H33"/></svg>';
    const overlay = node('div', 'farm-ranking-overlay'); overlay.hidden = true;
    const panel = node('section', 'farm-ranking-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'farm-ranking-title');
    const header = node('header', 'farm-mail-header');
    const title = node('h2', '', '排行榜'); title.id = 'farm-ranking-title';
    const closeButton = node('button', 'farm-mail-button', '關閉'); closeButton.type = 'button';
    header.append(title, closeButton);
    const tabs = node('div', 'farm-mail-tabs'); tabs.setAttribute('role', 'tablist');
    const status = node('p', 'farm-mail-status'); status.setAttribute('role', 'status');
    const content = node('div', 'farm-ranking-content'); content.setAttribute('role', 'tabpanel'); content.id = 'farm-ranking-content';
    const note = node('p', 'farm-ranking-note');
    const buttons = [];
    for (const [key, config] of Object.entries(FARM_RANKINGS)) {
        const tab = node('button', 'farm-mail-tab', config.label); tab.type = 'button';
        tab.setAttribute('role', 'tab'); tab.id = `farm-ranking-tab-${key}`;
        tab.setAttribute('aria-controls', content.id);
        tab.addEventListener('click', () => load(key)); tabs.append(tab); buttons.push([key, tab]);
    }
    const retry = node('button', 'farm-mail-button', '重新整理'); retry.type = 'button';
    let current = Object.keys(FARM_RANKINGS)[0]; retry.addEventListener('click', () => load(current));
    panel.append(header, tabs, status, content, note, retry); overlay.append(panel); document.body.append(launcher, overlay);
    async function load(key) {
        current = key; const request = ++version, config = FARM_RANKINGS[key];
        buttons.forEach(([id, tab]) => tab.setAttribute('aria-selected', String(id === key)));
        content.setAttribute('aria-labelledby', `farm-ranking-tab-${key}`);
        content.replaceChildren(); note.textContent = config.note; status.textContent = '正在統計公開村落…'; retry.disabled = true;
        try {
            const rows = await loadFarmRanking(context, key);
            if (disposed || overlay.hidden || request !== version) return;
            const list = node('ol', 'farm-ranking-list');
            rows.forEach((row, index) => {
                const item = node('li', 'farm-ranking-row'), person = node('div', 'farm-ranking-person');
                person.append(node('strong', '', row.name), node('small', '', row.villages.join('、')));
                item.append(node('span', 'farm-ranking-place', String(index + 1)), person, node('span', 'farm-ranking-score', `${row.score} ${config.unit}`)); list.append(item);
            });
            content.append(list); status.textContent = rows.length ? '公開村落 · Top 10' : '目前還沒有成功偷蛋的紀錄，來爭取第一名！';
        } catch (error) { if (!disposed && request === version) status.textContent = error.message || '排行榜載入失敗，請重新整理。'; }
        finally { if (request === version) retry.disabled = false; }
    }
    function ready() { if (!disposed && game.registry.get('myFarmData')) launcher.hidden = false; }
    const onSet = (_parent, key) => { if (key === 'myFarmData') ready(); };
    game.registry.events.on('setdata', onSet); game.registry.events.on('changedata-myFarmData', ready); ready();
    launcher.addEventListener('click', () => {
        if (!document.querySelector('.farm-mail-overlay:not([hidden]),.farm-ranking-overlay:not([hidden])')) {
            inputEnabled = game.input.enabled; game.input.enabled = false; overlay.hidden = false; closeButton.focus(); load(current);
        }
    });
    function close() { if (overlay.hidden) return; version++; overlay.hidden = true; game.input.enabled = inputEnabled; launcher.focus(); }
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button:not(:disabled)')], first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    game.events.once('destroy', () => {
        disposed = true; version++;
        game.registry.events.off('setdata', onSet); game.registry.events.off('changedata-myFarmData', ready);
        launcher.remove(); overlay.remove();
    });
}
