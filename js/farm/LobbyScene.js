import { addFarmBackground } from './scenery.js';
import { db } from '../firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID } from './constants.js';
import { isPublicVillage, villageTitle, filterVillages, listPublicVillages, loadVillageFarms, readVillageAccess } from './villages.js';

export default class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    init(data = {}) { this.selectedGroupId = data.targetGroupId || CURRENT_GROUP_ID; this.openPublic = data.openPublic || false; this.notice = data.notice || ''; }

    create() {
        this.lobbyToken = Symbol('lobby');
        this.requestId = (this.requestId || 0) + 1;
        this.entering = false;
        this.mode = 'own';
        this.page = 1;
        this.groups = [];
        addFarmBackground(this);
        this.add.rectangle(195, 50, 245, 50, 0x24372b, 0.92);
        this.titleText = this.add.text(195, 50, '村落', { fontSize: '20px', color: '#fff', fontStyle: 'bold', wordWrap: { width: 230 }, align: 'center' }).setOrigin(0.5);
        this.button(42, 50, '返回', () => this.scene.start('MyFarmScene'), 58);
        this.nav = this.add.container();
        this.content = this.add.container();
        this.pager = this.add.container();
        this.loadingText = this.add.text(195, 330, '正在尋找村落…', { fontSize: '16px', color: '#fff', backgroundColor: '#30432e', padding: 8, wordWrap: { width: 330 }, align: 'center' }).setOrigin(0.5);
        this.statusText = this.add.text(195, 190, this.notice, { fontSize: '13px', color: '#fff', backgroundColor: '#30432e', padding: 5, wordWrap: { width: 330 }, align: 'center' }).setOrigin(0.5).setVisible(!!this.notice);
        this.createSearch();
        this.swipeStart = null;
        this.input.on('pointerdown', pointer => { this.swipeStart = { x: pointer.x, y: pointer.y }; });
        this.input.on('pointerup', pointer => {
            if (!this.swipeStart || !this.publicEnabled) return;
            const dx = pointer.x - this.swipeStart.x, dy = pointer.y - this.swipeStart.y;
            if (Math.abs(dx) > 65 && Math.abs(dy) < 60) this.showPublic();
            this.swipeStart = null;
        });
        this.events.once('shutdown', () => { this.lobbyToken = null; this.requestId++; this.searchResizeObserver.disconnect(); this.searchRoot.remove(); });
        this.loadNeighbors();
    }

    button(x, y, text, callback, width = 150, container = null) {
        const bg = this.add.rectangle(x, y, width, 36, 0x344d37, 0.96).setStrokeStyle(1, 0xc8cf95).setInteractive({ cursor: 'pointer' });
        const label = this.add.text(x, y, text, { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        bg.on('pointerdown', callback);
        container?.add([bg, label]);
        return bg;
    }

    createSearch() {
        const parent = document.getElementById('game-container');
        parent.style.position = 'relative';
        const root = document.createElement('div');
        root.style.cssText = 'position:absolute;left:5%;top:14.5%;width:90%;z-index:10;display:none;font:16px sans-serif';
        const input = document.createElement('input');
        input.type = 'search'; input.placeholder = '搜尋公開村落名稱…'; input.autocomplete = 'off';
        input.setAttribute('aria-label', '搜尋公開村落'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'false'); input.setAttribute('aria-controls', 'village-suggestions');
        input.style.cssText = 'box-sizing:border-box;width:100%;height:38px;border-radius:10px;border:1px solid #b8c49b;padding:8px 12px;font-size:16px;background:#fffdf2;color:#263d2c';
        const suggestions = document.createElement('ul');
        suggestions.id = 'village-suggestions'; suggestions.setAttribute('role', 'listbox');
        suggestions.style.cssText = 'margin:3px 0 0;padding:0;list-style:none;max-height:250px;overflow:auto;background:#fffdf2;color:#263d2c;border-radius:8px;box-shadow:0 4px 12px #0005;display:none';
        root.append(input, suggestions); parent.append(root);
        this.searchRoot = root; this.searchInput = input; this.suggestions = suggestions;
        const alignSearch = () => {
            const canvas = this.game.canvas.getBoundingClientRect(), bounds = parent.getBoundingClientRect();
            root.style.left = `${canvas.left - bounds.left + canvas.width * 0.05}px`;
            root.style.top = `${canvas.top - bounds.top + canvas.height * 122 / 844}px`;
            root.style.width = `${canvas.width * 0.9}px`;
        };
        this.searchResizeObserver = new ResizeObserver(alignSearch);
        this.searchResizeObserver.observe(this.game.canvas);
        alignSearch();
        input.addEventListener('input', () => { this.requestId++; this.entering = false; this.mode = 'public'; this.page = 1; this.renderPublic(); this.autocomplete(); });
        input.addEventListener('keydown', event => {
            const buttons = [...suggestions.querySelectorAll('button')];
            if (event.key === 'Escape') this.hideSuggestions();
            if (event.key === 'ArrowDown' && buttons.length) { event.preventDefault(); buttons[0].focus(); }
            if (event.key === 'Enter') { event.preventDefault(); this.showPublic(); this.hideSuggestions(); }
        });
        suggestions.addEventListener('keydown', event => {
            const buttons = [...suggestions.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
            if (event.key === 'Escape') { this.hideSuggestions(); input.focus(); }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus(); }
        });
        root.addEventListener('focusout', () => queueMicrotask(() => { if (!root.contains(document.activeElement)) this.hideSuggestions(); }));
    }

    hideSuggestions() { this.suggestions.replaceChildren(); this.suggestions.style.display = 'none'; this.searchInput.setAttribute('aria-expanded', 'false'); }

    autocomplete() {
        this.hideSuggestions();
        if (!this.searchInput.value.trim()) return;
        const matches = filterVillages(this.groups, this.searchInput.value).slice(0, 6);
        for (const group of matches) {
            const item = document.createElement('li'), button = document.createElement('button');
            button.type = 'button'; button.textContent = villageTitle(group); button.setAttribute('role', 'option');
            button.style.cssText = 'display:block;width:100%;text-align:left;padding:12px;border:0;border-bottom:1px solid #e5e7ce;background:transparent;color:#263d2c;font-size:16px;cursor:pointer';
            button.addEventListener('pointerdown', event => event.preventDefault());
            button.addEventListener('click', () => { this.hideSuggestions(); this.searchInput.blur(); this.showVillage(group.id); });
            item.append(button); this.suggestions.append(item);
        }
        if (!matches.length) { const item = document.createElement('li'); item.textContent = '找不到符合的公開村落'; item.style.padding = '12px'; this.suggestions.append(item); }
        this.suggestions.style.display = 'block'; this.searchInput.setAttribute('aria-expanded', 'true');
    }

    async loadNeighbors() {
        const token = this.lobbyToken;
        try {
            this.ownGroup = await readVillageAccess(CURRENT_GROUP_ID, CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID);
            if (!this.scene.isActive() || this.lobbyToken !== token) return;
            this.publicEnabled = isPublicVillage(this.ownGroup);
            this.nav.removeAll(true);
            this.button(105, 98, '自己的村落', () => this.showVillage(CURRENT_GROUP_ID), 160, this.nav);
            if (this.publicEnabled) {
                this.button(285, 98, '公開村落一覽 →', () => this.showPublic(), 170, this.nav);
                this.searchRoot.style.display = 'block';
                try { this.groups = await listPublicVillages(CURRENT_GROUP_ID); } catch { this.statusText.setText('公開列表載入失敗，請點右方按鈕重試').setVisible(true); }
            } else this.button(285, 98, '封閉型村落', () => {}, 170, this.nav);
            if (!this.scene.isActive() || this.lobbyToken !== token) return;
            if (this.mode === 'public' && this.publicEnabled) this.renderPublic();
            else if (this.openPublic && this.publicEnabled) await this.showPublic();
            else await this.showVillage(this.publicEnabled ? this.selectedGroupId : CURRENT_GROUP_ID);
        } catch (error) { if (this.lobbyToken === token && this.loadingText.active) this.loadingText.setText(error.message); }
    }

    async showPublic() {
        if (!this.publicEnabled) return;
        const request = ++this.requestId;
        this.entering = false;
        this.mode = 'public'; this.page = 1; this.hideSuggestions();
        this.content.removeAll(true); this.pager.removeAll(true); this.titleText.setText('公開村落一覽');
        this.loadingText.setText('正在載入公開村落…').setVisible(true);
        try {
            const own = await readVillageAccess(CURRENT_GROUP_ID, CURRENT_GROUP_ID, CURRENT_ACCOUNT_ID);
            if (!isPublicVillage(own)) throw new Error('自己的村落已改為封閉型。');
            const groups = await listPublicVillages(CURRENT_GROUP_ID);
            if (!this.scene.isActive() || request !== this.requestId) return;
            this.groups = groups;
            this.renderPublic();
        } catch (error) { if (request === this.requestId && this.loadingText.active) this.loadingText.setText(error.message); }
    }

    renderPublic() {
        if (!this.scene.isActive()) return;
        this.mode = 'public'; this.titleText.setText('公開村落一覽'); this.content.removeAll(true); this.loadingText.setVisible(false);
        const filtered = filterVillages(this.groups, this.searchInput.value);
        const pages = Math.max(1, Math.ceil(filtered.length / 10)); this.page = Math.min(this.page, pages);
        filtered.slice((this.page - 1) * 10, this.page * 10).forEach((group, index) => {
            const x = 103 + index % 2 * 184, y = 245 + Math.floor(index / 2) * 89;
            const card = this.add.rectangle(x, y, 170, 76, 0x293f2c, 0.94).setStrokeStyle(1, 0xd7c788).setInteractive({ cursor: 'pointer' }).setData('villageGroupId', group.id);
            const text = this.add.text(x, y, villageTitle(group), { fontSize: '15px', color: '#fff4c4', align: 'center', wordWrap: { width: 150 } }).setOrigin(0.5);
            card.on('pointerdown', () => this.showVillage(group.id)); this.content.add([card, text]);
        });
        if (!filtered.length) this.content.add(this.add.text(195, 300, '找不到符合的公開村落', { fontSize: '17px', color: '#fff', backgroundColor: '#30432e', padding: 8 }).setOrigin(0.5));
        this.renderPagination(pages, page => { this.page = page; this.hideSuggestions(); this.renderPublic(); });
    }

    async showVillage(groupId) {
        const request = ++this.requestId;
        this.entering = false;
        this.hideSuggestions(); this.mode = groupId === CURRENT_GROUP_ID ? 'own' : 'village'; this.page = 1;
        this.content.removeAll(true); this.pager.removeAll(true); this.loadingText.setText('正在尋找已建立的雞舍…').setVisible(true);
        try {
            const result = await loadVillageFarms(CURRENT_GROUP_ID, groupId, CURRENT_ACCOUNT_ID);
            if (!this.scene.isActive() || request !== this.requestId) return;
            this.displayGroup = result.group; this.farms = result.farms; this.titleText.setText(villageTitle(result.group));
            this.loadingText.setVisible(false); this.renderFarms();
        } catch (error) { if (this.scene.isActive() && request === this.requestId) this.loadingText.setText(error.message); }
    }

    renderFarms() {
        this.content.removeAll(true);
        const pages = Math.max(1, Math.ceil(this.farms.length / 9)); this.page = Math.min(this.page, pages);
        this.farms.slice((this.page - 1) * 9, this.page * 9).forEach((member, index) => {
            const x = 80 + index % 3 * 115, y = 245 + Math.floor(index / 3) * 150;
            const house = this.add.image(x, y, 'coop').setDisplaySize(96, 90).setInteractive({ cursor: 'pointer' });
            const bg = this.add.rectangle(x, y + 56, 102, 36, 0x203527, 0.9);
            const name = this.add.text(x, y + 56, member.name || member.accountId, { fontSize: '13px', color: '#fff', wordWrap: { width: 96 }, align: 'center' }).setOrigin(0.5);
            house.on('pointerdown', async () => {
                if (this.entering) return;
                this.entering = true;
                const request = this.requestId, group = this.displayGroup;
                try {
                    const groupId = group.id;
                    await readVillageAccess(CURRENT_GROUP_ID, groupId, CURRENT_ACCOUNT_ID, getDoc, member.accountId);
                    const snapshot = await getDoc(doc(db, 'groups', groupId, 'users', member.accountId));
                    if (!snapshot.exists() || !snapshot.data().farm) throw new Error('這位成員尚未建立雞舍。');
                    if (this.scene.isActive() && request === this.requestId) this.scene.start('VisitScene', { targetGroupId: groupId, targetGroupName: group.name, targetAccountId: member.accountId, targetName: member.name });
                } catch (error) { if (this.scene.isActive() && request === this.requestId) this.showFloatingText(195, 185, error.message, '#FFCDD2'); }
                finally { if (request === this.requestId) this.entering = false; }
            });
            this.content.add([house, bg, name]);
        });
        if (!this.farms.length) this.content.add(this.add.text(195, 320, '村落內還沒有其他已建立的雞舍', { fontSize: '16px', color: '#fff', backgroundColor: '#30432e', padding: 8 }).setOrigin(0.5));
        this.renderPagination(pages, page => { this.page = page; this.renderFarms(); });
    }

    renderPagination(pages, change) {
        this.pager.removeAll(true);
        const numbers = [...new Set([1, this.page - 1, this.page, this.page + 1, pages].filter(page => page >= 1 && page <= pages))].sort((a, b) => a - b);
        const count = this.add.text(195, 705, `第 ${this.page} / ${pages} 頁`, { fontSize: '14px', color: '#fff', backgroundColor: '#30432e', padding: 5 }).setOrigin(0.5); this.pager.add(count);
        numbers.forEach((page, index) => { const button = this.button(195 + (index - (numbers.length - 1) / 2) * 50, 750, String(page), () => change(page), 40, this.pager); button.setData('page', page); if (page === this.page) button.setFillStyle(0x6a7534); });
    }

    showFloatingText(x, y, msg, color) {
        const text = this.add.text(x, y, msg, { fontSize: '14px', color, backgroundColor: '#30432e', padding: 5, wordWrap: { width: 330 }, align: 'center' }).setOrigin(0.5).setDepth(40);
        this.tweens.add({ targets: text, alpha: 0, duration: 2500, onComplete: () => text.destroy() });
    }
}
