import { preloadSceneAssets, finishSceneAssets } from './assets.js';
import { onSceneExit } from './scene-cleanup.js';
import { configureFarmViewport } from './viewport.js';
import { itemCategory, addCategoryTabs, ITEM_CATEGORIES } from './item-categories.js';
import { addPoultryGuide } from './poultry-guide.js';
import { BREEDS, poultryState, coopCapacity, tradePoultry } from './poultry.js';
import { hitsToDefeat } from './combat-rules.js';
import { GORILLA_FANG_PRICE } from './gorilla-rules.js';
import { addFarmBackground } from './scenery.js';
import { db } from '../firebase-config.js';
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, WORM_PRICE, EARTHWORM_PRICE, FANG_PRICE, DRAGON_SCALE_PRICE, EXPAND_SLOT_PRICE, COOP_LV2_PRICE, COOP_LV3_PRICE, WEAPONS_CONFIG, getUsedSpace } from './constants.js';

export default class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    preload() { preloadSceneAssets(this); }

    create() {
        if (!finishSceneAssets(this)) return;
        configureFarmViewport(this);
        addFarmBackground(this);
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 商店', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '🔙 返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.assetText = this.add.text(195, 120, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'left', backgroundColor: '#000', padding: { left: 34, right: 10, top: 6, bottom: 6 } }).setOrigin(0.5);
        this.assetCoin = this.add.image(this.assetText.getBounds().left + 17, this.assetText.getBounds().top + 16, 'coin').setDisplaySize(24, 24);

        this.isProcessing = false; 
        this.createConfirmDialog();
        this.createTabs();
        this.createWeaponGuide();
        addPoultryGuide(this);

        this.msgText = this.add.text(195, 680, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
        this.initGlobalData();

        onSceneExit(this, () => {
            this.registry.events.off('changedata-myFarmData', this.onFarmDataChanged, this);
        });
    }

    createTabs() {
        const btnBuy = this.add.rectangle(100, 180, 120, 40, 0xE53935, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(100, 180, '📥 買進', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnSell = this.add.rectangle(290, 180, 120, 40, 0x4CAF50, 0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(290, 180, '📤 賣出', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.buyContainer = this.add.container(0, 290);
        this.sellContainer = this.add.container(0, 290).setVisible(false);

        btnBuy.on('pointerdown', () => {
            btnBuy.setFillStyle(0xE53935, 1); btnSell.setFillStyle(0x4CAF50, 0.5);
            this.buyContainer.setVisible(true); this.sellContainer.setVisible(false);
        });

        btnSell.on('pointerdown', () => {
            btnSell.setFillStyle(0x4CAF50, 1); btnBuy.setFillStyle(0xE53935, 0.5);
            this.buyContainer.setVisible(false); this.sellContainer.setVisible(true);
        });

        this.shopPages = { buy: {}, sell: {} };
        this.shopCategory = 'chickens';
        this.categoryTabs = addCategoryTabs(this, 230, key => this.selectShopCategory(key));
        this.shopMode = 'buy';
        this.catalog = { buy: [], sell: [] };
        const buy = this.catalog.buy, sell = this.catalog.sell;
        for (const [key, breed] of Object.entries(BREEDS)) {
            buy.push([key, breed.texture, `${breed.name}\n${breed.buy}金幣`, () => this.openTradeModal('buy', key, breed.name, breed.buy)]);
            sell.push([`bird:${key}`, breed.texture, `${breed.name}\n${breed.sell}金幣`, () => this.openTradeModal('sell', `bird:${key}`, breed.name, breed.sell)]);
            sell.push([breed.eggKey, breed.eggIcon, `${breed.eggName}\n${breed.eggPrice}金幣`, () => this.openTradeModal('sell', breed.eggKey, breed.eggName, breed.eggPrice)]);
        }
        buy.push(
            ['expand', 'coop', `倉庫容量(+10)\n${EXPAND_SLOT_PRICE}金幣`, () => this.openTradeModal('buy', 'expand', '倉庫擴充(+10)', EXPAND_SLOT_PRICE)],
            ['medicine', 'medicine', '咕咕活力散\n10金幣', () => this.openTradeModal('buy', 'medicine', '咕咕活力散', 10)],
            ['coop2', 'coop', `中級雞舍\n${COOP_LV2_PRICE}金幣`, () => this.openTradeModal('buy', 'coop2', '中級雞舍', COOP_LV2_PRICE, true)],
            ['coop3', 'coop', `高級雞舍\n${COOP_LV3_PRICE}金幣`, () => this.openTradeModal('buy', 'coop3', '高級雞舍', COOP_LV3_PRICE, true)]
        );
        buy.push(['coop4', 'coop', '特級雞舍\n即將推出', () => this.showMsg('特級雞舍即將推出', '#FFD54F')],
            ['coop5', 'coop', '頂級雞舍\n即將推出', () => this.showMsg('頂級雞舍即將推出', '#FFD54F')]);
        for (const [key, weapon] of Object.entries(WEAPONS_CONFIG)) {
            if (weapon.buyPrice) buy.push([key, weapon.icon, `${weapon.name}\n${weapon.buyPrice}金幣`, () => this.openTradeModal('buy', key, weapon.name, weapon.buyPrice)]);
            if (weapon.sellPrice) sell.push([key, weapon.icon, `${weapon.name}\n${weapon.sellPrice}金幣`, () => this.openTradeModal('sell', key, weapon.name, weapon.sellPrice)]);
        }
        for (const [key, icon, name, price] of [['eagleFeathers', 'eagle-feather', '巨鷹羽毛', 300], ['worms', 'worm', '菜蟲', WORM_PRICE], ['earthworms', 'earthworm', '蚯蚓', EARTHWORM_PRICE], ['wolfFangs', 'fang', '狼牙', FANG_PRICE], ['tigerPelts', 'tiger_pelt', '虎皮', 50], ['dragonScales', 'dragon_scale', '龍麟', DRAGON_SCALE_PRICE], ['gorillaFangs', 'gorilla_fang', '猩猩尖牙', GORILLA_FANG_PRICE]]) {
            sell.push([key, icon, `${name}\n${price}金幣`, () => this.openTradeModal('sell', key, name, price)]);
        }
        for (const [mode, entries] of Object.entries(this.catalog)) {
            const container = mode === 'buy' ? this.buyContainer : this.sellContainer;
            const categoryIndexes = {};
            entries.forEach(([key, icon, text, action]) => {
                const category = itemCategory(key);
                const index = categoryIndexes[category] || 0;
                categoryIndexes[category] = index + 1;
                const slot = index % 6;
                const objects = this.addShopItem(container, slot % 2 ? 295 : 95, 40 + Math.floor(slot / 2) * 100, icon, text, 0x735038, action);
                for (const object of objects) { object.catalogPage = Math.floor(index / 6); object.catalogCategory = category; object.catalogKey = key; }
            });
        }
        this.previousPage = this.add.rectangle(70, 640, 90, 36, 0x735038).setInteractive({ cursor: 'pointer' });
        this.nextPage = this.add.rectangle(320, 640, 90, 36, 0x735038).setInteractive({ cursor: 'pointer' });
        this.previousLabel = this.add.text(70, 640, '◀ 上一頁', { fontSize: '14px', color: '#fff2cc' }).setOrigin(0.5);
        this.nextLabel = this.add.text(320, 640, '下一頁 ▶', { fontSize: '14px', color: '#fff2cc' }).setOrigin(0.5);
        this.pageText = this.add.text(195, 640, '', { fontSize: '15px', color: '#fff2cc', backgroundColor: '#593b27', padding: 5 }).setOrigin(0.5);
        this.previousPage.on('pointerdown', () => this.changeShopPage(-1));
        this.nextPage.on('pointerdown', () => this.changeShopPage(1));
        btnBuy.on('pointerdown', () => { this.shopMode = 'buy'; this.changeShopPage(0); });
        btnSell.on('pointerdown', () => { this.shopMode = 'sell'; this.changeShopPage(0); });
        this.emptyCategoryText = this.add.text(195, 400, '', { fontSize: '17px', color: '#fff2cc', align: 'center', backgroundColor: '#593b27', padding: 12 }).setOrigin(0.5);
        this.changeShopPage(0);
    }

    selectShopCategory(key) {
        if (!ITEM_CATEGORIES.some(c => c.key === key)) return;
        this.shopCategory = key;
        this.changeShopPage(0);
    }

    changeShopPage(delta) {
        const mode = this.shopMode, category = this.shopCategory;
        const count = this.catalog[mode].filter(([key]) => itemCategory(key) === category).length;
        const total = Math.max(1, Math.ceil(count / 6));
        const page = this.shopPages[mode][category] = Phaser.Math.Clamp((this.shopPages[mode][category] || 0) + delta, 0, total - 1);
        for (const [name, container] of [['buy', this.buyContainer], ['sell', this.sellContainer]]) {
            container.setVisible(name === mode);
            for (const object of container.list) object.setVisible(name === mode && object.catalogCategory === category && object.catalogPage === page);
        }
        this.categoryTabs.select(category);
        this.emptyCategoryText?.setText(category === 'coops' ? '雞舍升級後直接使用，無法賣出。' : '此分類目前沒有可販售的商品。').setVisible(count === 0);
        this.pageText.setText(`${page + 1} / ${total}`);
        for (const object of [this.pageText, this.previousPage, this.previousLabel, this.nextPage, this.nextLabel]) object.setVisible(total > 1);
        this.previousPage.setAlpha(page > 0 ? 1 : 0.4);
        this.nextPage.setAlpha(page < total - 1 ? 1 : 0.4);
    }

    createWeaponGuide() {
        const button = this.add.rectangle(100, 730, 170, 42, 0x735038).setStrokeStyle(2, 0xdcb975).setInteractive({ cursor: 'pointer' });
        this.add.text(100, 730, '武器圖鑑', { fontSize: '16px', color: '#fff2cc' }).setOrigin(0.5);
        const panel = this.add.container(0, 0).setDepth(90).setVisible(false);
        const shade = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive();
        const paper = this.add.rectangle(195, 398, 370, 450, 0xffefd0).setStrokeStyle(3, 0x735038);
        const title = this.add.text(195, 205, '武器圖鑑', { fontSize: '22px', color: '#593b27', fontStyle: 'bold' }).setOrigin(0.5);
        panel.add([shade, paper, title]);
        const hits = (enemy, keys, suffix) => keys.map(key => `${hitsToDefeat(WEAPONS_CONFIG[key], enemy)}`).join('／') + suffix;
        const guide = [
            '近戰：木棒／狼牙棒／雙手斧',
            ...[['wolf', '大野狼'], ['tiger', '老虎'], ['gorilla', '大金剛']].map(([key, name]) => `${name}：${hits(key, ['club', 'mace', 'battleaxe'], ' 下')}`),
            '', '飛行系：短弓／獵弓',
            ...[['dragon', '烈火龍'], ['eagle', '巨飛鷹']].map(([key, name]) => `${name}：${hits(key, ['shortbow', 'huntingbow'], ' 箭')}`),
            '飛行系近戰無效，弓箭僅攻擊飛行系。',
            '近戰與弓可各配備一把，拖曳弓瞄準射箭。'
        ].join('\n');
        panel.add(this.add.text(195, 260, guide, { fontSize: '14px', color: '#593b27', align: 'center', lineSpacing: 7 }).setOrigin(.5,0));
        const close = this.add.rectangle(195, 577, 130, 38, 0x735038).setInteractive({ cursor: 'pointer' });
        panel.add([close, this.add.text(195, 577, '返回商店', { fontSize: '16px', color: '#fff2cc' }).setOrigin(0.5)]);
        button.on('pointerdown', () => panel.setVisible(true));
        close.on('pointerdown', () => panel.setVisible(false));
        this.weaponGuide = panel;
    }

    addShopItem(container, x, y, iconKey, text, color, callback) {
        const bg = this.add.rectangle(x, y, 170, 80, color, 0.9).setInteractive({ cursor: 'pointer' });
        const icon = this.add.image(x - 45, y, iconKey);
        const scale = Math.min(45 / icon.width, 45 / icon.height);
        icon.setScale(scale);
        const txt = this.add.text(x + 18, y, text, { fontSize: '13px', color: '#fff', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
        bg.on('pointerdown', callback);
        container.add([bg, icon, txt]);
        return [bg, icon, txt];
    }

    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); 
        const bg = this.add.rectangle(195, 422, 320, 220, 0xffffff, 1).setOrigin(0.5);
        
        this.dialogTitle = this.add.text(195, 335, '交易名稱', { fontSize: '18px', color: '#000000', fontStyle: 'bold', align:'center' }).setOrigin(0.5).setDepth(105);
        this.dialogSubText = this.add.text(195, 365, '單價: 0 金幣', { fontSize: '14px', color: '#666666', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        const btnMinus = this.add.rectangle(110, 410, 40, 36, 0xFFFFFF, 1).setStrokeStyle(1, 0xCCCCCC).setInteractive({ cursor: 'pointer' });
        const txtMinus = this.add.text(110, 410, '➖', { fontSize: '18px', color: '#000000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        this.textQty = this.add.text(170, 410, '1', { fontSize: '20px', color: '#000000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        const btnPlus = this.add.rectangle(230, 410, 40, 36, 0xFFFFFF, 1).setStrokeStyle(1, 0xCCCCCC).setInteractive({ cursor: 'pointer' });
        const txtPlus = this.add.text(230, 410, '➕', { fontSize: '18px', color: '#000000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        const btnMax = this.add.rectangle(280, 410, 45, 36, 0xFF9800, 1).setInteractive({ cursor: 'pointer' });
        const txtMax = this.add.text(280, 410, 'MAX', { fontSize: '13px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        this.dialogTotalText = this.add.text(195, 460, '總計: 0 金幣', { fontSize: '16px', color: '#E53935', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        const btnYes = this.add.rectangle(130, 505, 100, 38, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        const textYes = this.add.text(130, 505, '確認交易', { fontSize: '15px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);
        
        const btnNo = this.add.rectangle(260, 505, 100, 38, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        const textNo = this.add.text(260, 505, '取消', { fontSize: '15px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        btnMinus.on('pointerdown', () => this.updateQuantity(-1));
        btnPlus.on('pointerdown', () => this.updateQuantity(1));
        btnMax.on('pointerdown', () => this.setQuantity(this.currentMaxQty));

        btnNo.on('pointerdown', () => this.dialogContainer.setVisible(false));
        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.confirmTradeCallback) this.confirmTradeCallback(this.currentQty);
        });

        this.dialogContainer.add([
            overlay, bg, 
            btnMinus, btnPlus, btnMax, btnYes, btnNo,
            this.dialogTitle, this.dialogSubText,
            txtMinus, this.textQty, txtPlus, txtMax,
            this.dialogTotalText, textYes, textNo
        ]);
    }

    openTradeModal(type, itemKey, itemName, unitPrice, isSingleOnly = false) {
        if (this.isProcessing || !this.farmData) return;

        if (['coop4', 'coop5'].includes(itemKey)) { this.showMsg('此雞舍即將推出', '#FFD54F'); return; }

        if (type === 'sell' && WEAPONS_CONFIG[itemKey] && this.farmData.equippedWeapon === itemKey) {
            this.showMsg('請先到倉庫卸下武器，再至商店賣出！', '#FFD54F');
            return;
        }

        this.tradeType = type;
        this.tradeUnitPrice = unitPrice;
        this.currentQty = 1;

        const coins = this.farmData.coins || 0;
        const usedSpace = getUsedSpace(this.farmData);
        const freeSpace = Math.max(0, (this.farmData.warehouseLimit || 10) - usedSpace);

        if (type === 'buy') {
            if (isSingleOnly) {
                this.currentMaxQty = 1;
            } else if (BREEDS[itemKey]) {
                const coopLevel = this.farmData.coopLevel || 1;
                const maxHens = coopCapacity(coopLevel);
                const currentHens = poultryState(this.farmData).hens.length;
                const spaceForHens = Math.max(0, maxHens - currentHens);
                const maxByCoins = Math.floor(coins / unitPrice);
                this.currentMaxQty = Math.min(spaceForHens, maxByCoins);
            } else if (itemKey === 'expand') {
                this.currentMaxQty = Math.floor(coins / unitPrice);
            } else if (itemKey === 'medicine' || WEAPONS_CONFIG[itemKey]) {
                const maxByCoins = Math.floor(coins / unitPrice);
                this.currentMaxQty = Math.min(freeSpace, maxByCoins);
            }
        } else {
            this.currentMaxQty = itemKey.startsWith('bird:') ? poultryState(this.farmData).hens.filter(h => h.breed === itemKey.slice(5)).length : (this.farmData[itemKey] || 0);
        }

        if (this.currentMaxQty <= 0) {
            if (type === 'buy') {
                this.showMsg('金幣不足或達到購買上限！', '#F44336');
            } else {
                this.showMsg(`${itemName}不足，無法賣出！`, '#F44336');
            }
            return;
        }

        this.dialogTitle.setText(`${type === 'buy' ? '買進' : '賣出'} [${itemName}]`);
        this.dialogSubText.setText(`單價: ${unitPrice} 金幣${type === 'buy' && BREEDS[itemKey] ? `・每 ${BREEDS[itemKey].interval / 3600000} 小時 1 顆蛋` : ''}`);
        if (type === 'sell' && itemKey.startsWith('bird:')) this.dialogSubText.setText(`單價: ${unitPrice} 金幣\n優先出售健康雞，已產出的蛋保留`);
        this.updateQuantity(0); 

        this.confirmTradeCallback = (qty) => {
            if (type === 'buy') {
                if (BREEDS[itemKey]) this.executeBuyHen(qty, itemKey);
                else if (itemKey === 'expand') this.executeExpandWarehouse(qty);
                else if (itemKey === 'medicine') this.executeBuyMedicine(qty);
                else if (itemKey === 'coop2') this.executeUpgradeCoop(2, unitPrice);
                else if (itemKey === 'coop3') this.executeUpgradeCoop(3, unitPrice);
                else if (WEAPONS_CONFIG[itemKey]) this.executeBuyWeapon(itemKey, qty, unitPrice);
            } else {
                if (itemKey.startsWith('bird:')) this.executeTradePoultry(itemKey.slice(5), qty, 'sell');
                else this.executeSellItem(itemKey, unitPrice, itemName, qty);
            }
        };

        this.dialogContainer.setVisible(true);
    }

    updateQuantity(delta) {
        this.currentQty = Phaser.Math.Clamp(this.currentQty + delta, 1, Math.max(1, this.currentMaxQty));
        this.textQty.setText(`${this.currentQty}`);
        const total = this.currentQty * this.tradeUnitPrice;
        this.dialogTotalText.setText(`總計: ${total} 金幣`).setColor(this.tradeType === 'buy' ? '#E53935' : '#4CAF50');
    }

    setQuantity(qty) {
        this.currentQty = Phaser.Math.Clamp(qty, 1, Math.max(1, this.currentMaxQty));
        this.textQty.setText(`${this.currentQty}`);
        const total = this.currentQty * this.tradeUnitPrice;
        this.dialogTotalText.setText(`總計: ${total} 金幣`).setColor(this.tradeType === 'buy' ? '#E53935' : '#4CAF50');
    }

    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2000, delay: 1000 });
    }

    initGlobalData() {
        const currentData = this.registry.get('myFarmData');
        if (currentData) this.onFarmDataChanged(null, currentData);
        this.registry.events.on('changedata-myFarmData', this.onFarmDataChanged, this);
    }

    onFarmDataChanged(parent, value) {
        this.farmData = value;
        const usedSpace = getUsedSpace(this.farmData);
        this.assetText.setText(`持有金幣: ${this.farmData.coins || 0}\n庫存容量: ${usedSpace}/${this.farmData.warehouseLimit || 10}`);
        this.assetCoin.setPosition(this.assetText.getBounds().left + 17, this.assetText.getBounds().top + 16);
    }

    async executeBuyWeapon(key, qty, price) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const config = WEAPONS_CONFIG[key];
        if (!config?.buyPrice || !Number.isSafeInteger(qty) || qty <= 0) { this.isProcessing = false; return; }
        const totalPrice = qty * config.buyPrice;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (getUsedSpace(farm) + qty > (farm.warehouseLimit || 10)) throw "倉庫容量不足！";
                if ((farm.coins || 0) < totalPrice) throw "金幣不足！";

                t.update(myFarmRef, { 
                    "farm.coins": farm.coins - totalPrice, 
                    [`farm.${key}`]: (farm[key] || 0) + qty 
                });
            });
            this.showMsg(`購買成功！獲得 ${WEAPONS_CONFIG[key]?.name || '武器'} +${qty}`, '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "購買失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    async executeBuyMedicine(qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const totalPrice = qty * 10;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (getUsedSpace(farm) + qty > (farm.warehouseLimit || 10)) throw "倉庫容量不足！";
                if ((farm.coins || 0) < totalPrice) throw "金幣不足！";

                t.update(myFarmRef, { 
                    "farm.coins": farm.coins - totalPrice, 
                    "farm.medicines": (farm.medicines || 0) + qty 
                });
            });
            this.showMsg(`購買成功！獲得 咕咕活力散 +${qty} 💊`, '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "購買失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    async executeSellItem(itemKey, unitPrice, itemName, qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const weapon = WEAPONS_CONFIG[itemKey];
        if (!Number.isSafeInteger(qty) || qty <= 0 || (weapon && !weapon.sellPrice)) { this.isProcessing = false; return; }
        const egg = Object.values(BREEDS).find(b => b.eggKey === itemKey);
        const totalPrice = qty * (weapon?.sellPrice ?? egg?.eggPrice ?? unitPrice);
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (weapon && (farm.equippedWeapon === itemKey || farm.equippedBow === itemKey)) throw '請先到倉庫卸下武器！';
                if ((farm[itemKey] || 0) >= qty) {
                    t.update(myFarmRef, { 
                        [`farm.${itemKey}`]: farm[itemKey] - qty, 
                        "farm.coins": (farm.coins || 0) + totalPrice 
                    });
                } else throw `${itemName}數量不足！`;
            });
            this.showMsg(`賣出成功！獲得 ${totalPrice} 金幣`, '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    executeBuyHen(qty, breed = 'hen') {
        return this.executeTradePoultry(breed, qty, 'buy');
    }

    async executeTradePoultry(breed, qty, type) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const now = Date.now();
        const ids = Array.from({ length: Number.isSafeInteger(qty) && qty > 0 && qty <= 20 ? qty : 0 }, () => crypto.randomUUID());
        try {
            await runTransaction(db, async transaction => {
                const snap = await transaction.get(myFarmRef), farm = snap.data()?.farm;
                if (!farm) throw new Error('農場資料不存在');
                transaction.update(myFarmRef, tradePoultry(farm, breed, qty, type, now, ids));
            });
            this.showMsg(`${type === 'buy' ? '購買' : '賣出'}成功！${BREEDS[breed].name} ${type === 'buy' ? '+' : '-'}${qty}`, '#FFD54F');
        } catch (e) { this.showMsg(e.message || '交易失敗，請稍後重試', '#F44336'); }
        finally { this.isProcessing = false; }
    }

    async executeUpgradeCoop(level, price) {
        if (this.isProcessing) return;
        if (![2, 3].includes(level)) { this.showMsg('此雞舍即將推出', '#FFD54F'); return; }
        this.isProcessing = true;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.coopLevel || 1) >= level) throw "已有更高級雞舍！";
                if ((farm.coins || 0) < price) throw "金幣不足！";
                t.update(myFarmRef, { "farm.coins": farm.coins - price, "farm.coopLevel": level });
            });
            this.showMsg('升級成功！', '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); } 
        finally { this.isProcessing = false; }
    }

    async executeExpandWarehouse(qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const totalPrice = qty * EXPAND_SLOT_PRICE;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.coins || 0) < totalPrice) throw "金幣不足！";
                t.update(myFarmRef, { 
                    "farm.coins": farm.coins - totalPrice, 
                    "farm.warehouseLimit": (farm.warehouseLimit || 10) + (qty * 10) 
                });
            });
            this.showMsg(`擴充成功！容量 +${qty * 10}`, '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }
}
