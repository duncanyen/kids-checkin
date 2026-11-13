import { theftRankingStatus, THEFT_RANKING_START, THEFT_RANKING_END } from './ranking-core.js';
import { FARM_RANKINGS, loadFarmRanking } from './rankings.js';

const art = name => `assets/farm/leaderboard/leaderboard_${name}.png`;
const image = (name, className = '') => { const result = document.createElement('img'); result.src = art(name); result.alt = ''; result.className = className; result.draggable = false; result.decoding = 'async'; return result; };
const node = (tag, className, text) => {
    const result = document.createElement(tag);
    result.className = className;
    if (text !== undefined) result.textContent = text;
    return result;
};
export function mountFarmRankings(game, context) {
    let disposed = false, version = 0, inputEnabled, boundaryTimer, lastManualRefresh = -Infinity;
    const pending = new Map();
    const launcher = node('button', 'farm-ranking-launcher');
    launcher.type = 'button'; launcher.hidden = true;
    launcher.setAttribute('aria-label', '開啟排行榜'); launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.innerHTML = '<svg viewBox="0 0 48 40" aria-hidden="true"><path d="M16 3H32V15Q32 25 24 26Q16 25 16 15ZM16 7H6V12Q6 21 18 21M32 7H42V12Q42 21 30 21M24 26V34M15 37H33"/></svg>';
    const overlay = node('div', 'farm-ranking-overlay'); overlay.hidden = true;
    const panel = node('section', 'farm-ranking-panel');
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-labelledby', 'farm-ranking-title');
    const header = node('header', 'farm-ranking-header');
    const title = node('h2', '', '排行榜'); title.id = 'farm-ranking-title';
    const titleArt = image('title'); titleArt.alt = '排行榜'; title.replaceChildren(titleArt);
    const closeButton = node('button', 'farm-ranking-close'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', '關閉'); closeButton.append(image('close'));
    header.append(title, closeButton);
    const tabs = node('div', 'farm-ranking-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '排行榜分類');
    const status = node('p', 'farm-ranking-status'); status.setAttribute('role', 'status');
    const content = node('div', 'farm-ranking-content'); content.setAttribute('role', 'tabpanel'); content.id = 'farm-ranking-content'; content.tabIndex = 0;
    const note = node('p', 'farm-ranking-note');
    const reward = node('footer', 'farm-ranking-footer');
    const rewardBanner = node('div', 'farm-ranking-reward-banner'); rewardBanner.append(image('gift'), note);
    const period = node('p', 'farm-ranking-period');
    const periodText = node('span', ''); period.append(image('calendar'), periodText);
    const buttons = [];
    for (const [key, config] of Object.entries(FARM_RANKINGS)) {
        const tab = node('button', 'farm-ranking-tab', config.label); tab.type = 'button';
        if (key === 'stolenEggs') { tab.replaceChildren(image('category'), node('span', 'farm-ranking-sr', config.label)); }
        tab.setAttribute('role', 'tab'); tab.id = `farm-ranking-tab-${key}`;
        tab.setAttribute('aria-controls', content.id);
        tab.addEventListener('click', () => { if (key !== current) load(key); }); tabs.append(tab); buttons.push([key, tab]);
    }
    const retry = node('button', 'farm-ranking-refresh'); retry.type = 'button'; retry.setAttribute('aria-label', '重新整理'); retry.append(image('refresh'));
    let current = Object.keys(FARM_RANKINGS)[0];
    retry.addEventListener('click', () => {
        if (retry.disabled || Date.now() - lastManualRefresh < 1200) return;
        lastManualRefresh = Date.now(); load(current);
    });
    reward.append(rewardBanner, retry);
    const grassLeft = image('grass_left', 'farm-ranking-grass farm-ranking-grass--left');
    const grassRight = image('grass_right', 'farm-ranking-grass farm-ranking-grass--right');
    panel.append(header, tabs, period, status, content, reward, grassLeft, grassRight); overlay.append(panel); document.body.append(launcher, overlay);
    async function load(key) {
        current = key; const request = ++version, config = FARM_RANKINGS[key];
        buttons.forEach(([id, tab]) => tab.setAttribute('aria-selected', String(id === key)));
        content.setAttribute('aria-labelledby', `farm-ranking-tab-${key}`);
        content.replaceChildren(); note.textContent = config.note; periodText.textContent = config.period; status.textContent = '正在統計公開村落…'; retry.disabled = true; content.setAttribute('aria-busy', 'true'); retry.setAttribute('aria-busy', 'true');
        try {
            // 重開彈窗時共用尚未完成的查詢；不增加新監聽器或改動資料層的快取／排序。
            let query = pending.get(key);
            if (!query) {
                query = loadFarmRanking(context, key); pending.set(key, query);
                query.finally(() => { if (pending.get(key) === query) pending.delete(key); }).catch(() => {});
            }
            const rows = await query;
            if (disposed || overlay.hidden || request !== version) return;
            const list = node('ol', 'farm-ranking-list');
            rows.forEach((row, index) => {
                const item = node('li', `farm-ranking-row farm-ranking-row--${['gold','silver','bronze'][index] || 'normal'}`), person = node('div', 'farm-ranking-person');
                person.append(node('strong', '', row.name), node('small', '', row.groupName));
                const place = node('span', 'farm-ranking-place'); place.setAttribute('aria-label', `第 ${index + 1} 名`);
                if (index < 3) place.append(image(`medal_${['gold','silver','bronze'][index]}`));
                else place.append(image('rank_normal'), node('span', 'farm-ranking-place-number', String(index + 1)));
                // 排序直接沿用 loadFarmRanking，不在呈現層重新排名。
                person.querySelector('strong').title = row.name; person.querySelector('small').title = row.groupName;
                item.append(place, person, node('span', 'farm-ranking-score', `${row.score.toLocaleString('zh-TW')} ${config.unit}`)); list.append(item);
            });
            content.append(list); if (!rows.length) content.append(node('p', 'farm-ranking-empty', '目前還沒有本期成功偷蛋紀錄，下一位上榜的可能就是你！')); status.textContent = `${theftRankingStatus()} · 公開村落 · Top 10${rows.length ? '' : ' · 尚無本期成功偷蛋紀錄'}`;
        } catch (error) { if (!disposed && !overlay.hidden && request === version) status.textContent = error.message || '排行榜載入失敗，請重新整理。'; }
        finally {
            // 舊查詢不得解除新畫面的載入狀態、重設計時器或在關閉後再排程。
            if (!disposed && !overlay.hidden && request === version) {
                retry.disabled = false; retry.setAttribute('aria-busy', 'false'); content.setAttribute('aria-busy', 'false');
                clearTimeout(boundaryTimer);
                const next = [THEFT_RANKING_START, THEFT_RANKING_END].find(time => time > Date.now());
                if (next) boundaryTimer = setTimeout(() => load(current), Math.min(2147483647, Math.max(1, next - Date.now() + 20)));
            }
        }
    }

    function ready() { if (!disposed && game.registry.get('myFarmData')) launcher.hidden = false; }
    const onSet = (_parent, key) => { if (key === 'myFarmData') ready(); };
    game.registry.events.on('setdata', onSet); game.registry.events.on('changedata-myFarmData', ready); ready();
    launcher.addEventListener('click', () => {
        if (!document.querySelector('.farm-mail-overlay:not([hidden]),.farm-ranking-overlay:not([hidden])')) {
            inputEnabled = game.input.enabled; game.input.enabled = false; overlay.hidden = false; closeButton.focus(); load(current);
        }
    });
    function close() { if (overlay.hidden) return; version++; clearTimeout(boundaryTimer); overlay.hidden = true; game.input.enabled = inputEnabled; launcher.focus(); }
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
    for (const eventName of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'wheel']) overlay.addEventListener(eventName, event => event.stopPropagation(), { passive: true });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key !== 'Tab') return;
        const focusable = [...panel.querySelectorAll('button:not(:disabled),[tabindex="0"]')], first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    game.events.once('destroy', () => {
        disposed = true; version++; clearTimeout(boundaryTimer);
        game.registry.events.off('setdata', onSet); game.registry.events.off('changedata-myFarmData', ready);
        launcher.remove(); overlay.remove();
    });
}
