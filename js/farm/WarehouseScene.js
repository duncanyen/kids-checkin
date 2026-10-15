import { db } from '../firebase-config.js';
import { onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, EGG_PRICE, HEN_PRICE, WORM_PRICE, EARTHWORM_PRICE, FANG_PRICE, EXPAND_SLOT_PRICE, COOP_LV2_PRICE, COOP_LV3_PRICE, COOP_LV2_MAX, COOP_LV3_MAX } from './constants.js';

export default class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 商店', { fontSize: '22px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '🔙 返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.assetText = this.add.text(195, 120, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'center', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        this.isProcessing = false; 
        
        // 準備隱藏的確認視窗
        this.createConfirmDialog();
        // 準備買賣分頁與商品圖示
        this.createTabs();

        this.msgText = this.add.text(195, 680, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);
        this.initFirebase();

        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    createTabs() {
        const btnBuy = this.add.rectangle(100, 180, 120, 40, 0xE53935, 1).setInteractive({ cursor: 'pointer' });
        const textBuy = this.add.text(100, 180, '📥 買進', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnSell = this.add.rectangle(290, 180, 120, 40, 0x4CAF50, 0.5).setInteractive({ cursor: 'pointer' });
        const textSell = this.add.text(290, 180, '📤 賣出', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

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

        // --- 買進列表 (加入對應圖示) ---
        this.addShopItem(this.buyContainer, 95, 40, 'hen', `母雞\n(-${HEN_PRICE})`, 0x333333, () => this.askConfirm('母雞', HEN_PRICE, () => this.buyHen()));
        this.addShopItem(this.buyContainer, 295, 40, 'mini_house', `容量+10\n(-${EXPAND_SLOT_PRICE})`, 0x333333, () => this.askConfirm('倉庫擴充', EXPAND_SLOT_PRICE, () => this.expandWarehouse()));
        this.addShopItem(this.buyContainer, 95, 140, 'coop', `中雞舍\n(-${COOP_LV2_PRICE})`, 0x1976D2, () => this.askConfirm('中型雞舍(10雞)', COOP_LV2_PRICE, () => this.upgradeCoop(2, COOP_LV2_PRICE)));
        this.addShopItem(this.buyContainer, 295, 140, 'coop', `大雞舍\n(-${COOP_LV3_PRICE})`, 0x1976D2, () => this.askConfirm('大型雞舍(20雞)', COOP_LV3_PRICE, () => this.upgradeCoop(3, COOP_LV3_PRICE)));

        // --- 賣出列表 (加入對應圖示) ---
        this.addShopItem(this.sellContainer, 95, 40, 'egg', `雞蛋\n(+${EGG_PRICE})`, 0x333333, () => this.askConfirm('賣出雞蛋', 0, () => this.sellItem('inventoryEggs', EGG_PRICE, '雞蛋')));
        this.addShopItem(this.sellContainer, 295, 40, 'worm', `菜蟲\n(+${WORM_PRICE})`, 0x333333, () => this.askConfirm('賣出菜蟲', 0, () => this.sellItem('worms', WORM_PRICE, '菜蟲')));
        this.addShopItem(this.sellContainer, 95, 140, 'earthworm', `蚯蚓\n(+${EARTHWORM_PRICE})`, 0x333333, () => this.askConfirm('賣出蚯蚓', 0, () => this.sellItem('earthworms', EARTHWORM_PRICE, '蚯蚓')));
        this.addShopItem(this.sellContainer, 295, 140, 'fang', `狼牙\n(+${FANG_PRICE})`, 0x333333, () => this.askConfirm('賣出狼牙', 0, () => this.sellItem('wolfFangs', FANG_PRICE, '狼牙')));
    }

    // 負責把圖示與文字組裝進方塊中，並加入防破版縮放機制
    addShopItem(container, x, y, iconKey, text, color, callback) {
        const bg = this.add.rectangle(x, y, 170, 80, color, 0.9).setInteractive({ cursor: 'pointer' });
        
        // 動態縮放圖示：限制最大只能是 45x45 像素
        const icon = this.add.image(x - 45, y, iconKey);
        const maxIconSize = 45;
        const scale = Math.min(maxIconSize / icon.width, maxIconSize / icon.height);
        icon.setScale(scale);

        // 文字稍微往右邊推，避免與圖示重疊
        const txt = this.add.text(x + 18, y, text, { fontSize: '14px', color: '#fff', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
        
        bg.on('pointerdown', callback);
        container.add([bg, icon, txt]);
    }

    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); 
        const bg = this.add.rectangle(195, 422, 300, 150, 0xffffff, 1).setOrigin(0.5);
        this.dialogText = this.add.text(195, 380, '確定要購買嗎？', { fontSize: '18px', color: '#000', fontStyle: 'bold', align:'center' }).setOrigin(0.5);
        
        const btnYes = this.add.rectangle(120, 460, 100, 40, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        const txtYes = this.add.text(120, 460, '確認', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnNo = this.add.rectangle(270, 460, 100, 40, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        const txtNo = this.add.text(270, 460, '取消', { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        btnNo.on('pointerdown', () => this.dialogContainer.setVisible(false));
        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.confirmCallback) this.confirmCallback();
        });

        this.dialogContainer.add([overlay, bg, this.dialogText, btnYes, txtYes, btnNo, txtNo]);
    }

    askConfirm(itemName, price, callback) {
        if (this.isProcessing) return; 
        this.dialogText.setText(price > 0 ? `確定花費 ${price} 購買\n[${itemName}] 嗎？` : `確定要執行\n[${itemName}] 嗎？`);
        this.confirmCallback = callback;
        this.dialogContainer.setVisible(true);
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.farmData = docSnap.data().farm;
                const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
                this.assetText.setText(`持有金幣: ${this.farmData.coins || 0}\n庫存容量: ${usedSpace}/${this.farmData.warehouseLimit || 10}`);
            }
        });
    }

    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2000, delay: 1000 });
    }

    async sellItem(itemKey, price, itemName) {
        if (this.isProcessing) return;
        if (!this.farmData || (this.farmData[itemKey] || 0) < 1) { this.showMsg(`${itemName}不足，無法賣出！`, '#F44336'); return; }
        
        this.isProcessing = true;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[itemKey] > 0) {
                    t.update(myFarmRef, { [`farm.${itemKey}`]: farm[itemKey] - 1, "farm.coins": (farm.coins || 0) + price });
                } else { throw `${itemName}不足！`; }
            });
            this.showMsg(`賣出成功！獲得 ${price} 金幣`, '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    async buyHen() {
        if (this.isProcessing) return;
        if (!this.farmData || (this.farmData.coins || 0) < HEN_PRICE) { this.showMsg(`金幣不足！`, '#F44336'); return; }
        
        this.isProcessing = true;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                const coopLevel = farm.coopLevel || 1; 
                let maxHens = 3;
                if (coopLevel === 2) maxHens = COOP_LV2_MAX;
                if (coopLevel === 3) maxHens = COOP_LV3_MAX;

                if ((farm.hens || 1) >= maxHens) throw `雞舍已滿 (${maxHens}隻)，請先升級雞舍！`;
                if ((farm.coins || 0) < HEN_PRICE) throw "金幣不足！";

                t.update(myFarmRef, { "farm.coins": farm.coins - HEN_PRICE, "farm.hens": (farm.hens || 1) + 1 });
            });
            this.showMsg('購買成功！母雞數量 +1', '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }

    async upgradeCoop(level, price) {
        if (this.isProcessing) return;
        this.isProcessing = true;

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.coopLevel || 1) >= level) throw "你已經擁有同級或更高級的雞舍了！";
                if ((farm.coins || 0) < price) throw "金幣不足！";

                t.update(myFarmRef, { "farm.coins": farm.coins - price, "farm.coopLevel": level });
            });
            this.showMsg('雞舍升級成功！', '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); } 
        finally { this.isProcessing = false; }
    }

    async expandWarehouse() {
        if (this.isProcessing) return;
        if (!this.farmData || (this.farmData.coins || 0) < EXPAND_SLOT_PRICE) { this.showMsg(`金幣不足！`, '#F44336'); return; }
        
        this.isProcessing = true;
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if ((farm.coins || 0) < EXPAND_SLOT_PRICE) throw "金幣不足！";
                t.update(myFarmRef, { "farm.coins": farm.coins - EXPAND_SLOT_PRICE, "farm.warehouseLimit": (farm.warehouseLimit || 10) + 10 });
            });
            this.showMsg('擴充成功！容量 +10', '#FFD54F');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); }
        finally { this.isProcessing = false; }
    }
}
