import { poultryState } from './poultry.js';

import { FARM_DOCK, placeFarmDockButton, splitFarmCountdown, styleFarmDockSprite, farmDockMaskURL } from './hud-layout.js';

// 共用 HUD 只讀取 BootScene 維護的存檔快照，不另外建立 Firebase 訂閱。
const assetV2 = file => `assets/farm/reference-ui/v2/${file}`;
const repairedAsset = file => `assets/farm/reference-ui/repairs/${file}`;
const resourcePanel = kind => kind === 'coins'
    ? assetV2('coins_panel_dynamic_base.png')
    : repairedAsset(`${kind}-panel.png`);
// 保留第一階段已完成的四張圖片與按鈕。
const referenceIcons = new Set(['tasks', 'trophy', 'gift', 'settings']);
const icon = kind => referenceIcons.has(kind)
    ? `<span class="farm-hud-art farm-hud-art--${kind} farm-hud-art--reference" aria-hidden="true"><img src="assets/farm/reference-ui/${kind}.png" alt="" decoding="async" draggable="false"></span>`
    : `<span class="farm-hud-art farm-hud-art--${kind}" aria-hidden="true"></span>`;

// 在圖片預留區內縮排較長數值，不截斷實際金額或倒數字串。
function fitHudText(node) {
    node.style.fontSize = '';
    if (node.clientWidth > 0 && node.scrollWidth > node.clientWidth) {
        const size = parseFloat(getComputedStyle(node).fontSize);
        node.style.fontSize = `${Math.max(6, Math.floor(size * node.clientWidth / node.scrollWidth * 10) / 10)}px`;
    }
}
function button(kind, label, locked = false) {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'farm-hud-button';
    node.innerHTML = icon(kind);
    if (locked) node.dataset.unavailable = label;
    node.setAttribute('aria-label', locked ? `${label}，尚未開放` : label);
    return node;
}

/** 怪物準備、戰鬥與尚未成功結算時，暫時收起場景導覽。 */
export function hasFarmHudEncounter(scene) {
    if (!scene) return false;
    return !!(scene.preparingEncounter || scene.preparingGiant || scene.preparingCobra || scene.preparingMole ||
        ['giantEncounter','cobraEncounter','moleEncounter','dragonEncounter','gorillaEncounter','eagleEncounter'].some(key=>scene[key]&&!scene[key].destroyed&&!scene[key].settled) ||
        ['wolf','tiger'].some(key=>scene[key]?.active&&!scene[key].getData('resolved')));
}

/**
 * 將既有通知與排行榜入口接到固定圖示導覽；生命週期隨 Phaser.Game 結束。
 * @param {Phaser.Game} game - 已掛載通知與排行榜的遊戲實例。
 */
export function mountFarmHud(game) {
    const root = document.createElement('div'); root.className = 'farm-hud'; root.hidden = true;
    const top = document.createElement('section'); top.className = 'farm-hud-status'; top.setAttribute('aria-label', '農莊資源');
    for (const [kind, label, key] of [['coins','金幣','coins'],['eggs','待採收雞蛋（所有雞種）','eggs'],['cleanliness','雞舍髒亂值','dirt']]) {
        const stat = document.createElement('div'); stat.className = 'farm-hud-stat'; stat.dataset.label = label;
        stat.dataset.panel = kind;
        stat.innerHTML = `<img class="farm-hud-panel-art" src="${resourcePanel(kind)}" alt="" decoding="async" draggable="false"><span><strong data-hud-value="${key}">—</strong></span>`;
        stat.setAttribute('aria-label', label); top.append(stat);
    }
    const settings = document.createElement('button'); settings.type = 'button'; settings.className = 'farm-hud-button farm-hud-settings';
    settings.innerHTML = icon('settings'); settings.dataset.unavailable = '設定'; settings.setAttribute('aria-label', '設定，尚未開放'); top.append(settings);
    const side = document.createElement('nav'); side.className = 'farm-hud-side'; side.setAttribute('aria-label', '村落活動');
    const ranking = document.querySelector('.farm-ranking-launcher') || button('trophy','排行榜',true);
    ranking.classList.add('farm-hud-button'); ranking.innerHTML = icon('trophy');
    side.append(button('tasks','每日任務',true), ranking, button('gift','活動',true));
    const bottom = document.createElement('nav'); bottom.className = 'farm-hud-bottom'; bottom.setAttribute('aria-label', '咕咕村落功能');
    const village = button('village','村落'), shop = button('shop','商店'), warehouse = button('warehouse','倉庫');
    const mail = document.querySelector('.farm-mail-launcher') || button('mail','通知',true);
    mail.classList.add('farm-hud-button'); mail.querySelector('svg')?.remove();
    mail.querySelectorAll('.farm-hud-art,.farm-hud-label').forEach(node=>node.remove());
    bottom.append(village, shop, warehouse, button('guide','圖鑑',true), mail);
    bottom.classList.add('farm-hud-bottom--v2');
    const dockImage = document.createElement('img');
    dockImage.className = 'farm-hud-dock-art'; dockImage.src = assetV2('bottom_dock_no_badge.png');
    dockImage.alt = ''; dockImage.draggable = false; dockImage.decoding = 'async';
    dockImage.style.maskImage = farmDockMaskURL();
    dockImage.style.webkitMaskImage = farmDockMaskURL();
    bottom.prepend(dockImage);
    const dockButtons = [...bottom.querySelectorAll('button')];
    dockButtons.forEach((node, index) => {
        node.querySelector('.farm-hud-art')?.remove();
        const zone = FARM_DOCK.hotzones[index];
        placeFarmDockButton(node, zone);
        // 固定木質承座留在原位，只有按鈕圖像隨按壓縮放。
        const underlay = document.createElement('span');
        underlay.className = 'farm-hud-dock-underlay'; underlay.setAttribute('aria-hidden','true');
        underlay.style.cssText = node.style.cssText;
        styleFarmDockSprite(underlay, {...zone, y:290, h:50});
        bottom.insertBefore(underlay, node);
        if (node !== mail) {
            const sprite = document.createElement('span');
            sprite.className = 'farm-hud-dock-sprite'; sprite.setAttribute('aria-hidden','true');
            styleFarmDockSprite(sprite, zone); node.append(sprite);
        }
    });
    // 使用完整通知木牌蓋住 V2 的補色缺口；其餘底座圖像與熱區維持原檔。
    mail.insertAdjacentHTML('afterbegin', `<img class="farm-hud-mail-art" src="${repairedAsset('mail-button.png')}" alt="" decoding="async" draggable="false">`);
    let selectedDock = null, mailWasOpen = false;
    function updateDockSelection(mailOpen = false) {
        const selected = mailOpen ? mail : selectedDock;
        for (const node of dockButtons) node.classList.toggle('is-selected', node === selected);
    }
    bottom.addEventListener('click', event => {
        const node = event.target.closest('button');
        if (!node || node.disabled) return;
        selectedDock = node; updateDockSelection();
    });
    const countdown = document.createElement('button'); countdown.type = 'button';
    countdown.className = 'farm-hud-countdown'; countdown.hidden = true;
    countdown.innerHTML = `<img src="${assetV2('egg_countdown_dynamic_base.png')}" alt="" decoding="async" draggable="false"><span class="farm-hud-countdown-label"></span><span class="farm-hud-countdown-time"></span>`;
    // 保留原資訊欄的重試入口；正常計時仍由場景本身更新。
    countdown.addEventListener('click', () => {
        const scene = game.scene.getScenes(true).find(scene => scene.scene.key === 'MyFarmScene');
        if (game.input.enabled && scene?.input?.enabled && scene.timerText?.input?.enabled) scene.timerText.emit('pointerdown');
    });
    let timerPresentation, lastCountdownText;
    function restoreTimerPresentation() {
        if (!timerPresentation) return;
        for (const [node, visible] of timerPresentation) if (node?.active) node.setVisible(visible);
        timerPresentation = undefined;
    }
    function syncCountdown(scene) {
        const image = countdown.querySelector('img');
        const show = scene?.scene.key === 'MyFarmScene' && scene.timerText?.active && image.complete && image.naturalWidth > 0;
        countdown.hidden = !show;
        if (!show) { restoreTimerPresentation(); return; }
        if (timerPresentation?.[0][0] !== scene.timerText) {
            restoreTimerPresentation();
            timerPresentation = [scene.timerText, scene.timerBg].map(node => [node, node?.visible]);
            for (const [node] of timerPresentation) node?.setVisible(false);
        }
        const text = scene.timerText.text;
        countdown.disabled = !game.input.enabled || scene.input?.enabled === false;
        if (text === lastCountdownText) return;
        lastCountdownText = text;
        const { label, time } = splitFarmCountdown(text);
        countdown.querySelector('.farm-hud-countdown-label').textContent = label;
        countdown.querySelector('.farm-hud-countdown-time').textContent = time;
        countdown.classList.toggle('has-time', !!time);
        countdown.setAttribute('aria-label', text);
        if (time) countdown.querySelectorAll('span').forEach(fitHudText);
        else countdown.querySelector('.farm-hud-countdown-label').style.fontSize = '';
    }
    const toast = document.createElement('div');
    toast.className = 'farm-hud-toast'; toast.hidden = true; toast.setAttribute('role','status');
    let toastTimer;
    root.append(top, side, bottom, countdown, toast); document.querySelector('#game-container').append(root);
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
        positionSide();
    });
    resizeObserver.observe(document.querySelector('#game-container'));
    let currentKey, lastCheck = 0;
    function positionSide() {
        if (root.hidden || top.hidden) return;
        const coin = top.querySelector('.farm-hud-stat').getBoundingClientRect();
        const bounds = root.getBoundingClientRect();
        const iconOffset = side.querySelector('.farm-hud-art').getBoundingClientRect().top - side.getBoundingClientRect().top;
        side.style.top = `calc(${coin.bottom - bounds.top - iconOffset}px + 0.5cm)`;
        side.style.left = `${coin.left - bounds.left}px`;
        const sideRight = side.getBoundingClientRect().right - bounds.left;
        const width = Math.min(490, bounds.width - sideRight - 16);
        countdown.style.width = `${Math.max(0, width)}px`;
        // 原木牌整體縮為 50%；以原圖吊繩端點定位，讓兩條繩子接住上方框線。
        // 原圖為 897×235，繩心 x=218/722、頂端 y=15；資源圖透明留白不算外框。
        const eggs = top.querySelector('[data-panel="eggs"]').getBoundingClientRect();
        const dirt = top.querySelector('[data-panel="cleanliness"]').getBoundingClientRect();
        const renderedWidth = Math.max(0, width) * .5;
        const anchorCenter = (eggs.left + eggs.width / 2 + dirt.left + dirt.width / 2) / 2;
        const frameBottom = Math.min(eggs.top + eggs.height * .954, dirt.top + dirt.height * .950);
        countdown.style.left = `${anchorCenter - bounds.left - renderedWidth * 470 / 897}px`;
        countdown.style.top = `${frameBottom - bounds.top - renderedWidth * 15 / 897 - .75}px`;
        const dockHeight = bottom.getBoundingClientRect().height;
        if (dockHeight) root.style.setProperty('--farm-dock-height', `${dockHeight + 8}px`);
        top.querySelectorAll('[data-hud-value]').forEach(fitHudText);
        if (countdown.classList.contains('has-time')) countdown.querySelectorAll('span').forEach(fitHudText);
    }
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
        positionSide();
    }
    function occupied() {
        return !game.input.enabled || game.scene.getScenes(true).some(scene => scene.input?.enabled === false || scene.isProcessing || scene.isFeeding || scene.isTreating || hasFarmHudEncounter(scene) || scene.housingDialog || scene.dialogContainer?.visible || scene.tradeContainer?.visible);
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
        syncCountdown(scene);
        const inEncounter = game.scene.getScenes(true).some(hasFarmHudEncounter);
        const sideWasHidden = side.hidden;
        // 導覽只屬於自家農場；拜訪結束或戰鬥結算後，也須回到自家才恢復。
        side.hidden = inEncounter || key !== 'MyFarmScene';
        bottom.hidden = inEncounter || key !== 'MyFarmScene';
        if (inEncounter) { selectedDock = null; toast.hidden = true; clearTimeout(toastTimer); }
        if (key !== currentKey) {
            selectedDock = null;
            currentKey = key; top.hidden = !game.registry.get('myFarmData') || key !== 'MyFarmScene';
            positionSide();
            for (const [node,target] of routes) {
                const active = target === 'LobbyScene' ? ['MyFarmScene','LobbyScene','VisitScene'].includes(key) : key === target;
                if (active) node.setAttribute('aria-current','page'); else node.removeAttribute('aria-current');
            }
        }
        if (!side.hidden && sideWasHidden) positionSide();
        const disabled = !scene || game.registry.get('farmLoadState')?.phase !== 'ready' || occupied();
        for (const [node] of routes) node.disabled = disabled;
        const mailOpen = document.querySelector('.farm-mail-overlay')?.hidden === false;
        if (mailWasOpen && !mailOpen && selectedDock === mail) selectedDock = null;
        mailWasOpen = mailOpen;
        updateDockSelection(mailOpen);
        ranking.classList.toggle('is-selected', document.querySelector('.farm-ranking-overlay')?.hidden === false);
    }
    const onSet = (_parent,key) => { if (key === 'myFarmData' || key === 'farmLoadState') refresh(); };
    game.registry.events.on('setdata',onSet);
    game.registry.events.on('changedata-myFarmData',refresh);
    game.registry.events.on('changedata-farmLoadState',refresh);
    game.events.on('step',step); refresh();
    game.events.once('destroy', () => {
        game.registry.events.off('setdata',onSet); game.registry.events.off('changedata-myFarmData',refresh); game.registry.events.off('changedata-farmLoadState',refresh);
        restoreTimerPresentation();
        game.events.off('step',step); clearTimeout(toastTimer); resizeObserver.disconnect(); root.remove(); top.remove(); document.body.classList.remove('farm-hud-mounted');
    });
}
