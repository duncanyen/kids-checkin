class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 咕咕莊園商店', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '🔙 返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.assetText = this.add.text(195, 120, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'center', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        this.isProcessing = false; // 🔒 防連點鎖

        // 創建確認視窗 Container (預設隱藏)
        this.createConfirmDialog();

        // 創建 Tab 切換
        this.currentTab = 'buy';
        this.createTabs();

        this.msgText = this.add.text(195, 750, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        this.initFirebase();
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

        // --- 買進列表 (網格排列) ---
        this.addShopItem(this.buyContainer, 95, 40, '母雞\n(-500)', 0x333333, () => this.askConfirm('母雞', 500, () => this.buyHen()));
        this.addShopItem(this.buyContainer, 295, 40, '擴充倉庫\n(-100)', 0x333333, () => this.askConfirm('倉庫容量+10', 100, () => this.expandWarehouse()));
        this.addShopItem(this.buyContainer, 95, 140, '中雞舍\n(-3000)', 0x1976D2, () => this.askConfirm('中型雞舍(容納10隻)', 3000, () => this.upgradeCoop(2, 3000)));
        this.addShopItem(this.buyContainer, 295, 140, '大雞舍\n(-10000)', 0x1976D2, () => this.askConfirm('大型雞舍(容納20隻)', 10000, () => this.upgradeCoop(3, 10000)));

        // --- 賣出列表 (網格排列) ---
        this.addShopItem(this.sellContainer, 95, 40, '雞蛋\n(+10)', 0x333333, () => this.askConfirm('賣出雞蛋', 0, () => this.sellItem('inventoryEggs', 10, '雞蛋')));
        this.addShopItem(this.sellContainer, 295, 40, '菜蟲\n(+1)', 0x333333, () => this.askConfirm('賣出菜蟲', 0, () => this.sellItem('worms', 1, '菜蟲')));
        this.addShopItem(this.sellContainer, 95, 140, '蚯蚓\n(+5)', 0x333333, () => this.askConfirm('賣出蚯蚓', 0, () => this.sellItem('earthworms', 5, '蚯蚓')));
        this.addShopItem(this.sellContainer, 295, 140, '狼牙\n(+10)', 0x333333, () => this.askConfirm('賣出狼牙', 0, () => this.sellItem('wolfFangs', 10, '狼牙')));
    }

    addShopItem(container, x, y, text, color, callback) {
        const bg = this.add.rectangle(x, y, 160, 80, color, 0.9).setInteractive({ cursor: 'pointer' });
        const txt = this.add.text(x, y, text, { fontSize: '15px', color: '#fff', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
        bg.on('pointerdown', callback);
        container.add([bg, txt]);
    }

    createConfirmDialog() {
        this.dialogContainer = this.add.container(0, 0).setDepth(100).setVisible(false);
        const overlay = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive(); // 阻擋下方點擊
        const bg = this.add.rectangle(195, 422, 300, 150, 0xffffff, 1).setOrigin(0.5);
        this.dialogText = this.add.text(195, 380, '確定要購買嗎？', { fontSize: '18px', color: '#000', fontStyle: 'bold' }).setOrigin(0.5);
        
        const btnYes = this.add.rectangle(120, 460, 100, 40, 0x4CAF50, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(120, 460, '確認', { fontSize: '16px', color: '#fff' }).setOrigin(0.5);
        
        const btnNo = this.add.rectangle(270, 460, 100, 40, 0xF44336, 1).setInteractive({ cursor: 'pointer' });
        this.add.text(270, 460, '取消', { fontSize: '16px', color: '#fff' }).setOrigin(0.5);

        btnNo.on('pointerdown', () => this.dialogContainer.setVisible(false));
        btnYes.on('pointerdown', () => {
            this.dialogContainer.setVisible(false);
            if (this.confirmCallback) this.confirmCallback();
        });

        this.dialogContainer.add([overlay, bg, this.dialogText, btnYes, this.add.text(120, 460, '確認', { fontSize: '16px', color: '#fff' }).setOrigin(0.5), btnNo, this.add.text(270, 460, '取消', { fontSize: '16px', color: '#fff' }).setOrigin(0.5)]);
    }

    askConfirm(itemName, price, callback) {
        if (this.isProcessing) return; // 若正在交易中則阻擋
        this.dialogText.setText(price > 0 ? `確定花費 ${price} 購買\n[${itemName}] 嗎？` : `確定要 ${itemName} 嗎？`);
        this.confirmCallback = callback;
        this.dialogContainer.setVisible(true);
    }

    // --- Firebase Transaction 範例 (防連點與雞舍容量判斷) ---
    async buyHen() {
        if (this.isProcessing) return;
        this.isProcessing = true; 

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                const coopLevel = farm.coopLevel || 1; 
                let maxHens = 3;
                if (coopLevel === 2) maxHens = 10;
                if (coopLevel === 3) maxHens = 20;

                if ((farm.hens || 1) >= maxHens) throw "雞舍已滿，請先升級雞舍！";
                if ((farm.coins || 0) < 500) throw "金幣不足！";

                t.update(myFarmRef, { "farm.coins": farm.coins - 500, "farm.hens": (farm.hens || 1) + 1 });
            });
            this.showMsg('購買成功！母雞數量 +1', '#FFD54F');
        } catch (e) { 
            this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336'); 
        } finally {
            this.isProcessing = false; // 🔓 解除鎖定
        }
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
        } catch (e) {
            this.showMsg(typeof e === 'string' ? e : "交易失敗", '#F44336');
        } finally {
            this.isProcessing = false;
        }
    }

    // ...(其他買賣機制同理，在 try-catch 的 finally 內加入 this.isProcessing = false)...
}
