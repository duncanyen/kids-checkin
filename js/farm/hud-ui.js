import { poultryState } from './poultry.js';

// 共用 HUD 只讀取 BootScene 維護的存檔快照，不另外建立 Firebase 訂閱。
const glyphs = {
    coin: '<circle cx="24" cy="24" r="20" fill="#ed9719"/><circle cx="24" cy="23" r="16" fill="#ffd94c"/><path d="m24 10 4 8 9 1-7 6 2 10-8-5-8 5 2-10-7-6 9-1Z" fill="#ffa719"/>',
    egg: '<path d="M24 3C14 3 5 22 6 33c2 18 34 18 36 0C43 22 34 3 24 3Z" fill="#ffe1a1"/><path d="M17 12c-5 5-7 13-6 17" fill="none" stroke="#fff9dd" stroke-width="5"/>',
    broom: '<path d="m30 5 6 3-15 27-6-4Z" fill="#bd7b3e"/><path d="m12 23 15 9-7 14L2 36Z" fill="#ffcb43"/><path d="m10 29 13 7M9 34l-3 4m9-1-3 5m9-1-2 4" fill="none"/><path d="m35 25 2-5 2 5 5 2-5 2-2 5-2-5-5-2Z" fill="#ffe97b"/>',
    gear: '<path d="m20 3 8 0 1 6 5 2 5-3 5 6-4 5 1 5 6 3-3 8-6-1-4 4-1 7h-9l-1-7-5-2-6 2-4-7 5-4-1-6-4-4 5-7 6 2 4-3Z" fill="#ffca69"/><circle cx="25" cy="24" r="8" fill="#fff3c7"/>'
};
const icon = kind => `<span class="farm-hud-art farm-hud-art--${kind}" aria-hidden="true"></span>`;
const glyph = kind => `<svg viewBox="0 0 50 50" aria-hidden="true" stroke="#64381b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyphs[kind]}</svg>`;
function button(kind, label, locked = false) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'farm-hud-button';
    node.innerHTML = icon(kind);
    if (locked) node.dataset.unavailable = label;
    node.setAttribute('aria-label', locked ? `${label}，尚未開放` : label);
    return node;
}

/**
 * 將既有通知與排行榜入口接到固定圖示導覽；生命週期隨 Phaser.Game 結束。
 * @param {Phaser.Game} game - 已掛載通知與排行榜的遊戲實例。
 */
export function mountFarmHud(game) {
    const root = document.createElement('div'); root.className = 'farm-hud'; root.hidden = true;
    const top = document.createElement('section'); top.className = 'farm-hud-status'; top.setAttribute('aria-label', '農莊資源');
    for (const [kind, label, key] of [['coin','金幣','coins'],['egg','待採收雞蛋（所有雞種）','eggs'],['broom','雞舍髒亂值','dirt']]) {
        const stat = document.createElement('div'); stat.className = 'farm-hud-stat'; stat.dataset.label = label;
        stat.innerHTML = `${glyph(kind)}<span><strong data-hud-value="${key}">—</strong></span>`;
        stat.setAttribute('aria-label', label); top.append(stat);
    }
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'farm-hud-button farm-hud-settings';
    settings.innerHTML = glyph('gear'); settings.dataset.unavailable = '設定'; settings.setAttribute('aria-label', '設定，尚未開放'); top.append(settings);
    const side = document.createElement('nav'); side.className = 'farm-hud-side'; side.setAttribute('aria-label', '村落活動');
    const ranking = document.querySelector('.farm-ranking-launcher') || button('trophy','排行榜',true);
    ranking.classList.add('farm-hud-button'); ranking.innerHTML = icon('trophy');
    side.append(button('tasks','每日任務',true), ranking, button('gift','活動',true));
    const bottom = document.createElement('nav'); bottom.className = 'farm-hud-bottom'; bottom.setAttribute('aria-label', '咕咕村落功能');
    const village = button('village','村落'), shop = button('shop','商店'), warehouse = button('warehouse','倉庫');
    const mail = document.querySelector('.farm-mail-launcher') || button('mail','通知',true);
    mail.classList.add('farm-hud-button'); mail.querySelector('svg')?.remove();
    mail.querySelectorAll('.farm-hud-art,.farm-hud-label').forEach(node=>node.remove());
    mail.insertAdjacentHTML('afterbegin',icon('mail'));
    bottom.append(village, shop, warehouse, button('guide','圖鑑',true), mail);
    const toast = document.createElement('div');
    toast.className = 'farm-hud-toast'; toast.hidden = true; toast.setAttribute('role','status');
    let toastTimer;
    root.append(top, side, bottom, toast); document.querySelector('#game-container').append(root);
    root.addEventListener('click', event => {
        const entry = event.target.closest('[data-unavailable]');
        if (!entry) return;
        toast.textContent = `${entry.dataset.unavailable}尚未開放`; toast.hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(()=>{toast.hidden=true;},2400);
    });
    // 導覽浮在場景上，透明區域保留地圖與原本的點擊操作。
    document.body.classList.add('farm-hud-mounted');
    // DOM 資源列出現時，父容器高度會變；不能只等視窗 resize 才重算畫布。
    const resizeObserver = new ResizeObserver(([entry]) => {
        const { width,height } = entry.contentRect;
        if (width > 0 && height > 0) game.scale.setParentSize(width,height);
    });
    resizeObserver.observe(document.querySelector('#game-container'));
    let currentKey, lastCheck = 0;
    function refresh() {
        const farm = game.registry.get('myFarmData');
        const ready = game.registry.get('farmLoadState')?.phase === 'ready';
        root.hidden = !farm;
        top.hidden = !farm || currentKey !== 'MyFarmScene';
        if (!farm) return;
        const values = { coins: Number(farm.coins) || 0, eggs: Object.values(poultryState(farm).ready).reduce((sum,n)=>sum+n,0), dirt: Number(farm.cleanliness) || 0 };
        for (const [key,value] of Object.entries(values)) {
            const text = ready ? (key === 'dirt' ? `${value}/100` : value.toLocaleString('zh-TW')) : '—';
            const node = top.querySelector(`[data-hud-value="${key}"]`);
            node.textContent = text; node.classList.toggle('is-long',text.length > 6);
            const stat = node.closest('.farm-hud-stat');
            stat.setAttribute('aria-label',`${stat.dataset.label}：${text}`);
        }
        top.querySelector('[data-hud-value="dirt"]').classList.toggle('is-warning', values.dirt > 80);
    }
    function occupied() {
        return !game.input.enabled || game.scene.getScenes(true).some(scene => scene.input?.enabled === false || scene.isProcessing || scene.isFeeding || scene.isTreating || scene.preparingEncounter || scene.preparingGiant || scene.preparingCobra || scene.preparingMole || scene.housingDialog || scene.dialogContainer?.visible || scene.tradeContainer?.visible ||
            ['giantEncounter','cobraEncounter','moleEncounter','dragonEncounter','gorillaEncounter','eagleEncounter'].some(key=>scene[key]&&!scene[key].destroyed&&!scene[key].settled) ||
            ['wolf','tiger'].some(key=>scene[key]?.active&&!scene[key].getData('resolved')));
    }
    const routes = [[village,'LobbyScene'],[shop,'ShopScene'],[warehouse,'WarehouseScene']];
    for (const [node,key] of routes) node.addEventListener('click', () => {
        if (occupied() || game.registry.get('farmLoadState')?.phase !== 'ready') return;
        const scene = game.scene.getScenes(true).find(scene=>['MyFarmScene','LobbyScene','VisitScene','ShopScene','WarehouseScene'].includes(scene.scene.key));
        // 村落入口在其他功能頁先回自家；在自家可繼續前往村落拜訪。
        const target = key === 'LobbyScene' && scene?.scene.key !== 'MyFarmScene' ? 'MyFarmScene' : key;
        if (scene && scene.scene.key !== target) scene.scene.start(target);
    });
    function step(_time) {
        if (_time - lastCheck < 100) return;
        lastCheck = _time;
        const scene = game.scene.getScenes(true).find(scene=>['MyFarmScene','LobbyScene','VisitScene','ShopScene','WarehouseScene'].includes(scene.scene.key));
        const key = scene?.scene.key;
        if (key !== currentKey) {
            currentKey = key; top.hidden = !game.registry.get('myFarmData') || key !== 'MyFarmScene'; side.hidden = !['MyFarmScene','VisitScene'].includes(key);
            for (const [node,target] of routes) {
                const active = target === 'LobbyScene' ? ['MyFarmScene','LobbyScene','VisitScene'].includes(key) : key === target;
                if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
            }
        }
        const disabled = !scene || game.registry.get('farmLoadState')?.phase !== 'ready' || occupied();
        for (const [node] of routes) node.disabled = disabled;
        mail.classList.toggle('is-selected', document.querySelector('.farm-mail-overlay')?.hidden === false);
        ranking.classList.toggle('is-selected', document.querySelector('.farm-ranking-overlay')?.hidden === false);
    }
    const onSet = (_parent,key) => { if (key === 'myFarmData' || key === 'farmLoadState') refresh(); };
    game.registry.events.on('setdata',onSet);
    game.registry.events.on('changedata-myFarmData',refresh);
    game.registry.events.on('changedata-farmLoadState',refresh);
    game.events.on('step',step); refresh();
    game.events.once('destroy', () => {
        game.registry.events.off('setdata',onSet); game.registry.events.off('changedata-myFarmData',refresh); game.registry.events.off('changedata-farmLoadState',refresh);
        game.events.off('step',step); clearTimeout(toastTimer); resizeObserver.disconnect(); root.remove(); top.remove(); document.body.classList.remove('farm-hud-mounted');
    });
}
