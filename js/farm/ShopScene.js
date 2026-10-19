import { db } from '../firebase-config.js';
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, EGG_PRICE, HEN_PRICE, WORM_PRICE, EARTHWORM_PRICE, FANG_PRICE, EXPAND_SLOT_PRICE, COOP_LV2_PRICE, COOP_LV3_PRICE, COOP_LV2_MAX, COOP_LV3_MAX } from './constants.js';

export default class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 商店', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '🔙 返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.assetText = this.add.text(195, 120, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'center', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        this.isProcessing = false; 
        this.createConfirmDialog();
        this.createTabs();

        this.msgText = this.add.text(195, 680, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
        this.initGlobalData();

        this.events.on('shutdown', () => { 
            this.registry.events.off('changedata-myFarmData', this.onFarmDataChanged, this);
        });
    }

    createTabs() {
        const btnBuy = this.add.rectangle(100, 180, 120, 40, 0xE53935, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(100, 180, '📥 買進', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnSell = this.add.rectangle(290, 180, 120, 40, 0x4CAF50, 0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(290, 180, '📤 賣出', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.buyContainer = this.add.container(0, 240);
        this.sellContainer = this.add.container(0, 240).setVisible(false);

        btnBuy.on('pointerdown', () => {
            btnBuy.setFillStyle(0xE53935, 1); btnSell.setFillStyle(0x4CAF50, 0.5);
            this.buyContainer.setVisible(true); this.sellContainer.setVisible(false);
        });

        btnSell.on('pointerdown', () => {
            btnSell.setFillStyle(0x4CAF50, 1); btnBuy.setFillStyle(0xE53935, 0.5);
            this.buyContainer.setVisible(false); this.sellContainer.setVisible(true);
        });

        // 📥 買進清單
        this.addShopItem(this.buyContainer, 95, 40, 'hen', `母雞\n${HEN_PRICE}金幣`, 0x333333, () => this.openTradeModal('buy', 'hen', '母雞', HEN_PRICE));
        this.addShopItem(this.buyContainer, 295, 40, 'mini_house', `倉庫容量(+10)\n${EXPAND_SLOT_PRICE}金幣`, 0x333333, () => this.openTradeModal('buy', 'expand', '倉庫擴充(+10)', EXPAND_SLOT_PRICE));
        this.addShopItem(this.buyContainer, 95, 140, 'medicine', `咕咕活力散\n10金幣`, 0x333333, () => this.openTradeModal('buy', 'medicine', '咕咕活力散', 10));
        this.addShopItem(this.buyContainer, 295, 140, 'coop', `中雞舍\n${COOP_LV2_PRICE}金幣`, 0x1976D2, () => this.openTradeModal('buy', 'coop2', '中型雞舍', COOP_LV2_PRICE, true));
        this.addShopItem(this.buyContainer, 95, 240, 'coop', `大雞舍\n${COOP_LV3_PRICE}金幣`, 0x1976D2, () => this.openTradeModal('buy', 'coop3', '大型雞舍', COOP_LV3_PRICE, true));

        // 📤 賣出清單
        this.addShopItem(this.sellContainer, 95, 40, 'egg', `雞蛋\n${EGG_PRICE}金幣`, 0x333333, () => this.openTradeModal('sell', 'inventoryEggs', '雞蛋', EGG_PRICE));
        this.addShopItem(this.sellContainer, 295, 40, 'worm', `菜蟲\n${WORM_PRICE}金幣`, 0x333333, () => this.openTradeModal('sell', 'worms', '菜蟲', WORM_PRICE));
        this.addShopItem(this.sellContainer, 95, 140, 'earthworm', `蚯蚓\n${EARTHWORM_PRICE}金幣`, 0x333333, () => this.openTradeModal('sell', 'earthworms', '蚯蚓', EARTHWORM_PRICE));
        this.addShopItem(this.sellContainer, 295, 140, 'fang', `狼牙\n${FANG_PRICE}金幣`, 0x333333, () => this.openTradeModal('sell', 'wolfFangs', '狼牙', FANG_PRICE));
        this.addShopItem(this.sellContainer, 195, 240, 'tiger_pelt', `虎皮\n50金幣`, 0x333333, () => this.openTradeModal('sell', 'tigerPelts', '虎皮', 50));
    }

    addShopItem(container, x, y, iconKey, text, color, callback) {
        const bg = this.add.rectangle(x, y, 170, 80, color, 0.9).setInteractive({ cursor: 'pointer' });
        const icon = this.add.image(x - 45, y, iconKey);
        const scale = Math.min(45 / icon.width, 45 / icon.height);
        icon.setScale(scale);
        const txt = this.add.text(x + 18, y, text, { fontSize: '13px', color: '#fff', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
        bg.on('pointerdown', callback);
        container.add([bg, icon, txt]);
    }

    // 🔒 數量選擇與交易對話框 (強性將按鈕文字顏色設定為亮白色 #FFFFFF)
    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); 
        const bg = this.add.rectangle(195, 422, 320, 220, 0xffffff, 1).setOrigin(0.5);
        
        this.dialogTitle = this.add.text(195, 335, '交易名稱', { fontSize: '18px', color: '#000000', fontStyle: 'bold', align:'center' }).setOrigin(0.5).setDepth(105);
        this.dialogSubText = this.add.text(195, 365, '單價: 0 金幣', { fontSize: '14px', color: '#666666', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // ➖ 減號按鈕 (黑色背景，白色加粗文字)
        const btnMinus = this.add.rectangle(110, 410, 40, 36, 0x333333, 1).setInteractive({ cursor: 'pointer' });
        const txtMinus = this.add.text(110, 410, '➖', { fontSize: '18px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // 數量顯示
        this.textQty = this.add.text(170, 410, '1', { fontSize: '20px', color: '#000000', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // ➕ 加號按鈕 (黑色背景，白色加粗文字)
        const btnPlus = this.add.rectangle(230, 410, 40, 36, 0x333333, 1).setInteractive({ cursor: 'pointer' });
        const txtPlus = this.add.text(230, 410, '➕', { fontSize: '18px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // 🌟 MAX 按鈕 (橘色背景，白色加粗文字)
        const btnMax = this.add.rectangle(280, 410, 45, 36, 0xFF9800, 1).setInteractive({ cursor: 'pointer' });
        const txtMax = this.add.text(280, 410, 'MAX', { fontSize: '13px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // 總計金額
        this.dialogTotalText = this.add.text(195, 460, '總計: 0 金幣', { fontSize: '16px', color: '#E53935', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // 按鈕：確認交易 與 取消
        const btnYes = this.add.rectangle(130, 505, 100, 38, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        const textYes = this.add.text(130, 505, '確認交易', { fontSize: '15px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);
        
        const btnNo = this.add.rectangle(260, 505, 100, 38, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        const textNo = this.add.text(260, 505, '取消', { fontSize: '15px', color: '#FFFFFF', fontStyle: 'bold' }).setOrigin(0.5).setDepth(105);

        // 事件綁定
        btnMinus.on('pointerdown', () => this.updateQuantity(-1));
        btnPlus.on('pointerdown', () => this.updateQuantity(1));
        btnMax.on('pointerdown', () => this.setQuantity(this.currentMaxQty));

        btnNo.on('pointerdown', () => this.dialogContainer.setVisible(false));
        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.confirmTradeCallback) this.confirmTradeCallback(this.currentQty);
        });

        // 容器層級排列：底圖 -> 矩形按鈕 -> 文字
        this.dialogContainer.add([
            overlay, bg, 
            btnMinus, btnPlus, btnMax, btnYes, btnNo,
            this.dialogTitle, this.dialogSubText,
            txtMinus, this.textQty, txtPlus, txtMax,
            this.dialogTotalText, textYes, textNo
        ]);
    }

    // 計算當前可買賣的最大數量
    openTradeModal(type, itemKey, itemName, unitPrice, isSingleOnly = false) {
        if (this.isProcessing || !this.farmData) return;

        this.tradeType = type;
        this.tradeUnitPrice = unitPrice;
        this.currentQty = 1;

        const coins = this.farmData.coins || 0;
        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0) + (this.farmData.tigerPelts || 0) + (this.farmData.medicines || 0);
        const freeSpace = Math.max(0, (this.farmData.warehouseLimit || 10) - usedSpace);

        if (type === 'buy') {
            if (isSingleOnly) {
                this.currentMaxQty = 1;
            } else if (itemKey === 'hen') {
                const coopLevel = this.farmData.coopLevel || 1;
                const maxHens = (coopLevel === 3) ? COOP_LV3_MAX : (coopLevel === 2 ? COOP_LV2_MAX : 3);
                const currentHens = this.farmData.hens || 1;
                const spaceForHens = Math.max(0, maxHens - currentHens);
                const maxByCoins = Math.floor(coins / unitPrice);
                this.currentMaxQty = Math.min(spaceForHens, maxByCoins);
            } else if (itemKey === 'expand') {
                this.currentMaxQty = Math.floor(coins / unitPrice);
            } else if (itemKey === 'medicine') {
                const maxByCoins = Math.floor(coins / unitPrice);
                this.currentMaxQty = Math.min(freeSpace, maxByCoins);
            }
        } else {
            // 賣出數量上限以倉庫擁有的數量為準
            this.currentMaxQty = this.farmData[itemKey] || 0;
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
        this.dialogSubText.setText(`單價: ${unitPrice} 金幣`);
        this.updateQuantity(0); // 刷新UI數字與總金額

        // 綁定點擊交易後的邏輯
        this.confirmTradeCallback = (qty) => {
            if (type === 'buy') {
                if (itemKey === 'hen') this.executeBuyHen(qty);
                else if (itemKey === 'expand') this.executeExpandWarehouse(qty);
                else if (itemKey === 'medicine') this.executeBuyMedicine(qty);
                else if (itemKey === 'coop2') this.executeUpgradeCoop(2, unitPrice);
                else if (itemKey === 'coop3') this.executeUpgradeCoop(3, unitPrice);
            } else {
                this.executeSellItem(itemKey, unitPrice, itemName, qty);
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
        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0) + (this.farmData.tigerPelts || 0) + (this.farmData.medicines || 0);
        this.assetText.setText(`持有金幣: ${this.farmData.coins || 0}\n庫存容量: ${usedSpace}/${this.farmData.warehouseLimit || 10}`);
    }

    // 📦 批量買藥水
    async executeBuyMedicine(qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const totalPrice = qty * 10;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                const usedSpace = (farm.inventoryEggs || 0) + (farm.worms || 0) + (farm.earthworms || 0) + (farm.wolfFangs || 0) + (farm.tigerPelts || 0) + (farm.medicines || 0);
                if (usedSpace + qty > (farm.warehouseLimit || 10)) throw "倉庫容量不足！";
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

    // 📦 批量賣物品
    async executeSellItem(itemKey, unitPrice, itemName, qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const totalPrice = qty * unitPrice;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
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

    // 🐔 批量買母雞
    async executeBuyHen(qty) {
        if (this.isProcessing) return;
        this.isProcessing = true;
        const totalPrice = qty * HEN_PRICE;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                const coopLevel = farm.coopLevel || 1; 
                let maxHens = (coopLevel === 3) ? COOP_LV3_MAX : (coopLevel === 2 ? COOP_LV2_MAX : 3);
                if ((farm.hens || 1) + qty > maxHens) throw `母雞數量將超過雞舍限制 (${maxHens}隻)！`;
                if ((farm.coins || 0) < totalPrice) throw "金幣不足！";

                let states = farm.hensState || [];
                for (let i = 0; i < qty; i++) {
                    states.push({ isSick: false });
                }

                t.update(myFarmRef, { 
                    "farm.coins": farm.coins - totalPrice, 
                    "farm.hens": (farm.hens || 1) + qty,
                    "farm.hensState": states
                });
            });
            this.showMsg(`購買成功！母雞數量 +${qty}`, '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    // 🏠 升級雞舍 (單次)
    async executeUpgradeCoop(level, price) {
        if (this.isProcessing) return;
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

    // 📦 批量擴充倉庫
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
