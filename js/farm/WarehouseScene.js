import { preloadSceneAssets, finishSceneAssets } from './assets.js';
import { onSceneExit } from './scene-cleanup.js';
import { configureFarmViewport } from './viewport.js';
import { itemCategory, addCategoryTabs, ITEM_CATEGORIES, coopName } from './item-categories.js';
import { BREEDS, poultryState, feedPoultry, coopCapacity } from './poultry.js';
import { GUARD_DOG_BREEDS, guardDogLeases, guardDogStatus } from './guard-dog-core.js';
import { openGuardDogAction, watchGuardDogInventory } from './guard-dog-ui.js';
import { addFarmBackground } from './scenery.js';
import { db } from '../firebase-config.js';
import { runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { myFarmRef, getUsedSpace, WEAPONS_CONFIG } from './constants.js';

export default class WarehouseScene extends Phaser.Scene {
    constructor() { super({ key: 'WarehouseScene' }); }

    preload() { preloadSceneAssets(this); }

    create() {
        if (!finishSceneAssets(this)) return;
        configureFarmViewport(this);
        addFarmBackground(this);
        
        // 以顯示尺寸計算比例，讓高解析精靈圖維持原本的預覽大小。
        this.hen = this.add.sprite(195, 180, 'hen', 0).setOrigin(0.5).play('hen_idle');
        this.hen.setScale(96 / this.hen.width);
        this.isFeeding = false;

        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '我的倉庫', { fontSize: '22px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '返回', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.capacityText = this.add.text(195, 110, '容量: 0/10', { fontSize: '16px', color: '#fff', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);
        this.itemsPanel = this.add.container(0, 310);
        this.emptyText = this.add.text(195, 340, '倉庫空空如也～', { fontSize: '18px', color: '#FFFFFF', fontStyle: 'bold', backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 10, y: 8 } }).setOrigin(0.5).setVisible(false);

        this.warehouseCategory = 'chickens';
        this.warehousePages = {};
        this.categoryTabs = addCategoryTabs(this, 250, key => this.selectWarehouseCategory(key));
        this.allConfigItems = [
            ...Object.entries(GUARD_DOG_BREEDS).map(([breedId,breed])=>({key:`guard:${breedId}`,name:breed.name,icon:breed.texture,type:'guardDog',breedId})),
            ...Object.entries(BREEDS).map(([key, breed]) => ({ key: `bird:${key}`, name: breed.name, icon: breed.texture, type: 'bird', breed: key })),
            { key: 'ownedCoop', name: '雞舍', icon: 'coop', type: 'coop' },
            { key: 'warehouseCapacity', name: '倉庫容量', icon: 'coop', type: 'warehouse' },
            { key: 'coins', name: '金幣', icon: 'coin' },
            ...Object.values(BREEDS).map(b => ({ key: b.eggKey, name: b.eggName, icon: b.eggIcon })),
            { key: 'worms', name: '菜蟲', icon: 'worm' },
            { key: 'earthworms', name: '蚯蚓', icon: 'earthworm' },
            { key: 'wolfFangs', name: '狼牙', icon: 'fang' },
            { key: 'tigerPelts', name: '虎皮', icon: 'tiger_pelt' },
            { key: 'dragonScales', name: '龍麟', icon: 'dragon_scale' },
            { key: 'eagleFeathers', name: '巨鷹羽毛', icon: 'eagle-feather' },
            { key: 'gorillaFangs', name: '猩猩尖牙', icon: 'gorilla_fang' },
            { key: 'medicines', name: '咕咕活力散', icon: 'medicine' },
            ...Object.entries(WEAPONS_CONFIG).filter(([key]) => key !== 'club').map(([key, weapon]) => ({ key, name: weapon.name, icon: weapon.icon, type: 'weapon' }))
        ];

        this.createActionPanel();
        this.createFeedPicker();
        this.warehousePage = 0;
        this.createWarehousePages();
        this.msgText = this.add.text(195, 680, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(30);

        this.initFirebase();
        watchGuardDogInventory(this,()=>this.farmData,()=>this.renderWarehouseItems());
        onSceneExit(this, () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    createActionPanel() {
        this.actionPanel = this.add.container(195, 530).setDepth(50).setVisible(false);
        this.actionBg = this.add.rectangle(0, 0, 350, 130, 0x222222, 0.95).setOrigin(0.5);
        this.actionTitle = this.add.text(0, -38, '是否要餵食母雞？', { fontSize: '16px', color: '#FFF', fontStyle: 'bold', align: 'center' }).setOrigin(0.5);
        
        this.btnFeed = this.add.rectangle(-105, 20, 95, 38, 0x4CAF50, 1).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.textFeed = this.add.text(-105, 20, '是(餵食)', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.btnCancel = this.add.rectangle(0, 20, 95, 38, 0x757575, 1).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.textCancel = this.add.text(0, 20, '否(離開)', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        this.btnDiscard = this.add.rectangle(105, 20, 95, 38, 0xE53935, 1).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.textDiscard = this.add.text(105, 20, '丟棄', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.btnCancel.on('pointerdown', () => this.actionPanel.setVisible(false));

        this.actionPanel.add([
            this.actionBg, this.actionTitle, 
            this.btnFeed, this.textFeed, 
            this.btnCancel, this.textCancel, 
            this.btnDiscard, this.textDiscard
        ]);
    }

    initFirebase() {
        let closed = false;
        const apply = farm => {
            if (closed || !farm) return;
            this.farmData = farm;
            this.capacityText.setText(`容量: ${getUsedSpace(farm)}/${farm.warehouseLimit || 10}`);
            this.renderWarehouseItems();
        };
        const changed = (_parent, farm) => apply(farm);
        const first = (_parent, key, farm) => { if (key === 'myFarmData') apply(farm); };
        this.registry.events.on('changedata-myFarmData', changed);
        this.registry.events.on('setdata', first);
        apply(this.registry.get('myFarmData'));
        this.unsubscribe = () => {
            closed = true;
            this.registry.events.off('changedata-myFarmData', changed);
            this.registry.events.off('setdata', first);
        };
    }

    renderWarehouseItems() {
        this.itemsPanel.removeAll(true); 

        if (!this.farmData) return;

        const liveDogs=guardDogLeases(this.farmData),hasDogs=liveDogs.length>0;
        const dialogId=this.guardDogDialog?.root.dataset.guardDogLeaseId;
        if(dialogId&&!liveDogs.some(dog=>dog.id===dialogId))this.guardDogDialog.close();
        this.categoryTabs.setCategories(ITEM_CATEGORIES.filter(item=>item.key!=='dogs'||hasDogs).map(item=>item.key));
        if(this.warehouseCategory==='dogs'&&!hasDogs){this.warehouseCategory='chickens';this.actionPanel.setVisible(false);}
        const category = this.warehouseCategory;
        const ownedItems = this.allConfigItems.filter(item => itemCategory(item.key) === category && this.warehouseItemCount(item) > 0);
        const totalPages = Math.max(1, Math.ceil(ownedItems.length / 8));
        this.warehousePage = this.warehousePages[category] = Math.min(this.warehousePages[category] || 0, totalPages - 1);
        this.visibleWarehouseItems = ownedItems.slice(this.warehousePage * 8, this.warehousePage * 8 + 8);
        this.categoryTabs.select(category);
        const label = ITEM_CATEGORIES.find(c => c.key === category).label;
        this.emptyText.setText(`「${label}」分類目前沒有物品`).setVisible(ownedItems.length === 0);
        this.warehousePageText.setText(`${this.warehousePage + 1} / ${totalPages}`);
        for (const object of [this.warehousePageText, this.previousPage, this.previousLabel, this.nextPage, this.nextLabel]) object.setVisible(totalPages > 1);
        this.previousPage.setAlpha(this.warehousePage > 0 ? 1 : 0.4);
        this.nextPage.setAlpha(this.warehousePage < totalPages - 1 ? 1 : 0.4);
        ownedItems.forEach((item, index) => {
            if (Math.floor(index / 8) !== this.warehousePage) return;
            index %= 8;
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = 100 + col * 190;
            const y = row * 72;
            const count = this.warehouseItemCount(item);

            const bg = this.add.rectangle(x, y, 160, 66, 0x000000, 0.6).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
            
            const img = this.add.image(x - 45, y, item.icon);
            
            const scale = Math.min(45 / img.width, 45 / img.height);
            img.setScale(scale);

            let displayTxt = `${item.name}\nx ${count}`;
            if(item.type==='guardDog'){const dog=guardDogLeases(this.farmData).find(dog=>dog.breedId===item.breedId);displayTxt=`${item.name}\n${dog?guardDogStatus(dog):'租期已結束'}`;}
            if (item.type === 'bird') displayTxt = `${item.name}\n雞舍中 × ${count}`;
            if (item.type === 'coop') displayTxt = `${coopName(this.farmData.coopLevel)}\n飼養 ${poultryState(this.farmData).hens.length}/${coopCapacity(this.farmData.coopLevel)}`;
            if (item.type === 'warehouse') displayTxt = `倉庫容量\n${getUsedSpace(this.farmData)}/${this.farmData.warehouseLimit || 10} 格`;
            if (item.type === 'weapon' && this.farmData[WEAPONS_CONFIG[item.key]?.ranged ? 'equippedBow' : 'equippedWeapon'] === item.key) {
                displayTxt = `[裝備中]\n${displayTxt}`;
            }

            const txt = this.add.text(x + 18, y - 10, displayTxt, { fontSize: item.type==='guardDog'?'11px':'14px', wordWrap: item.type==='guardDog'?{width:96}:undefined, color: '#fff', align: 'center', fontStyle: 'bold' }).setOrigin(0.5);

            bg.on('pointerdown', () => this.handleItemClick(item.key, item.name));
            this.itemsPanel.add([bg, img, txt]);
        });
    }

    handleItemClick(key, name) {
        if (!this.farmData) return;
        const count = this.farmData[key] || 0;
        
        const itemConfig = this.allConfigItems.find(i => i.key === key);
        if(itemConfig?.type==='guardDog'){this.actionPanel.setVisible(false);openGuardDogAction(this,itemConfig.breedId);return;}
        if (itemConfig?.type === 'warehouse') {
            this.actionPanel.setVisible(false);
            this.showMsg(`倉庫容量 ${getUsedSpace(this.farmData)}/${this.farmData.warehouseLimit || 10}\n擴充請到商店「其他」分類`, '#FFD54F');
            return;
        }
        if (itemConfig?.type === 'bird' || itemConfig?.type === 'coop') {
            this.actionPanel.setVisible(false);
            this.showMsg(itemConfig.type === 'bird' ? `${name}住在雞舍，買賣請到商店「雞」分類！` : `${coopName(this.farmData.coopLevel)}可飼養 ${coopCapacity(this.farmData.coopLevel)} 隻雞`, '#FFD54F');
            return;
        }

        if (itemConfig && itemConfig.type === 'weapon') {
            const isEquipped = this.farmData[WEAPONS_CONFIG[key]?.ranged ? 'equippedBow' : 'equippedWeapon'] === key;
            this.actionTitle.setText(isEquipped ? `已配戴在身上\n是否缷下裝備 [${name}]？` : `是否配備此物品 [${name}]？`);
            this.textFeed.setText(isEquipped ? '缷下' : '配備');
            this.actionPanel.setVisible(true);

            this.btnFeed.off('pointerdown');
            this.btnDiscard.off('pointerdown');

            this.btnFeed.on('pointerdown', () => this.toggleEquipWeapon(key, isEquipped));
            this.btnDiscard.on('pointerdown', () => this.discardItem(key));
            return;
        }

        if (Object.values(BREEDS).some(b => b.eggKey === key) || key === 'coins' || key === 'inventoryEggs' || key === 'wolfFangs' || key === 'tigerPelts' || key === 'dragonScales' || key === 'eagleFeathers' || key === 'gorillaFangs' || key === 'medicines') {
            this.actionPanel.setVisible(false);
            if (key === 'medicines') {
                this.showMsg('咕咕活力散請在母雞生病時點擊母雞使用！', '#FFD54F');
            } else {
                this.showMsg('此物品請至商店販售！', '#FFD54F');
            }
            return;
        }

        if (count <= 0) {
            this.actionPanel.setVisible(false);
            this.showMsg(`沒有${name}可以操作！`, '#F44336'); 
            return;
        }

        this.actionTitle.setText(`是否要餵食母雞 [${name}]？`);
        this.textFeed.setText('是(餵食)');
        this.actionPanel.setVisible(true);

        this.btnFeed.off('pointerdown');
        this.btnDiscard.off('pointerdown');

        this.btnFeed.on('pointerdown', () => this.feedItem(key));
        this.btnDiscard.on('pointerdown', () => this.discardItem(key));
    }

    async toggleEquipWeapon(key, currentlyEquipped) {
        this.actionPanel.setVisible(false);
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (!farm || !WEAPONS_CONFIG[key] || !(farm[key] > 0)) throw '倉庫已沒有這把武器！';
                const slot = WEAPONS_CONFIG[key].ranged ? 'equippedBow' : 'equippedWeapon';
                if (currentlyEquipped !== (farm[slot] === key)) throw '裝備狀態已變更，請重新選擇！';
                const next = currentlyEquipped ? (slot === 'equippedBow' ? null : 'club') : key;
                t.update(myFarmRef, { [`farm.${slot}`]: next });
            });
            this.showMsg(currentlyEquipped ? '已卸下裝備！' : `裝備成功！已換上 [${WEAPONS_CONFIG[key].name}]`, '#4CAF50');
        } catch (e) { this.showMsg(typeof e === 'string' ? e : '配備失敗，請稍後重試', '#F44336'); }
    }

    warehouseItemCount(item) {
        if(item.type==='guardDog')return guardDogLeases(this.farmData).some(dog=>dog.breedId===item.breedId)?1:0;
        if (item.type === 'bird') return poultryState(this.farmData).hens.filter(h => h.breed === item.breed).length;
        if (item.type === 'coop' || item.type === 'warehouse') return 1;
        return this.farmData[item.key] || 0;
    }

    selectWarehouseCategory(key) {
        if (!ITEM_CATEGORIES.some(c => c.key === key)) return;
        this.warehouseCategory = key;
        this.actionPanel.setVisible(false);
        this.feedPicker.setVisible(false);
        this.renderWarehouseItems();
    }

    changeWarehousePage(delta) {
        const category = this.warehouseCategory;
        this.warehousePages[category] = Math.max(0, (this.warehousePages[category] || 0) + delta);
        this.actionPanel.setVisible(false);
        this.renderWarehouseItems();
    }

    createWarehousePages() {
        this.previousPage = this.add.rectangle(70, 630, 90, 36, 0x735038).setInteractive({ cursor: 'pointer' });
        this.nextPage = this.add.rectangle(320, 630, 90, 36, 0x735038).setInteractive({ cursor: 'pointer' });
        this.previousLabel = this.add.text(70, 630, '上一頁', { fontSize: '14px', color: '#fff2cc' }).setOrigin(0.5);
        this.nextLabel = this.add.text(320, 630, '下一頁', { fontSize: '14px', color: '#fff2cc' }).setOrigin(0.5);
        this.warehousePageText = this.add.text(195, 630, '', { fontSize: '15px', color: '#fff2cc', backgroundColor: '#593b27', padding: 5 }).setOrigin(0.5);
        this.previousPage.on('pointerdown', () => this.changeWarehousePage(-1));
        this.nextPage.on('pointerdown', () => this.changeWarehousePage(1));
    }

    createFeedPicker() {
        this.feedPicker = this.add.container(0, 0).setDepth(80).setVisible(false);
        const shade = this.add.rectangle(195, 422, 390, 844, 0x000000, 0.8).setInteractive();
        const paper = this.add.rectangle(195, 405, 350, 350, 0xffefd0).setStrokeStyle(3, 0x735038);
        this.feedPicker.add([shade, paper, this.add.text(195, 260, '選擇要餵食的品種', { fontSize: '20px', color: '#593b27', fontStyle: 'bold' }).setOrigin(0.5)]);
        this.feedBreedButtons = {};
        Object.entries(BREEDS).forEach(([breed, config], i) => {
            const y = 325 + i * 65;
            const button = this.add.rectangle(195, y, 290, 50, 0x735038).setInteractive({ cursor: 'pointer' });
            const label = this.add.text(195, y, config.name, { fontSize: '16px', color: '#fff2cc' }).setOrigin(0.5);
            this.feedPicker.add([button, label]);
            this.feedBreedButtons[breed] = { button, label };
            button.on('pointerdown', () => { this.feedPicker.setVisible(false); this.feedItem(this.pendingFeedItem, breed); });
        });
        const cancel = this.add.text(195, 540, '取消', { fontSize: '18px', color: '#735038', padding: 10 }).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        cancel.on('pointerdown', () => this.feedPicker.setVisible(false));
        this.feedPicker.add(cancel);
    }

    async feedItem(key, breed) {
        if (this.isFeeding || !this.farmData || !(this.farmData[key] > 0)) return;
        this.actionPanel.setVisible(false);
        const hens = poultryState(this.farmData).hens;
        const breeds = [...new Set(hens.map(h => h.breed))];
        if (!breeds.length) { this.showMsg('雞舍沒有雞隻，請先到商店選購！', '#FFD54F'); return; }
        if (!breed && breeds.length > 1) {
            this.pendingFeedItem = key;
            for (const [b, { button, label }] of Object.entries(this.feedBreedButtons)) {
                const count = hens.filter(h => h.breed === b).length;
                button.setVisible(count > 0); label.setVisible(count > 0).setText(`${BREEDS[b].name} × ${count}`);
            }
            this.feedPicker.setVisible(true);
            return;
        }
        breed ||= breeds[0];
        this.isFeeding = true;
        const now = Date.now();
        try {
            await runTransaction(db, async transaction => {
                const snap = await transaction.get(myFarmRef), farm = snap.data()?.farm;
                if (!farm) throw new Error('農場資料不存在');
                transaction.update(myFarmRef, feedPoultry(farm, key, breed, now));
            });
            this.hen.setTexture(BREEDS[breed].texture, 0).setScale(96 / this.hen.width).play(`${breed}_idle`);
            this.showHeartEffect(key === 'earthworms');
            this.showMsg(`${BREEDS[breed].name}很開心！加速 ${key === 'worms' ? 30 : 60} 分鐘`, '#4CAF50');
        } catch (e) { this.showMsg(e.message || '餵食失敗，請稍後重試', '#F44336'); }
        finally { this.isFeeding = false; }
    }

    async discardItem(key) {
        if (!this.farmData || (this.farmData[key] || 0) <= 0) return;
        this.actionPanel.setVisible(false);
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[key] > 0) {
                    const updates = { [`farm.${key}`]: farm[key] - 1 };
                    
                    if ((farm.equippedWeapon === key || farm.equippedBow === key) && (farm[key] - 1) === 0) {
                        updates[WEAPONS_CONFIG[key]?.ranged ? 'farm.equippedBow' : 'farm.equippedWeapon'] = WEAPONS_CONFIG[key]?.ranged ? null : 'club';
                    }
                    
                    t.update(myFarmRef, updates);
                }
            });
            this.showMsg('已丟棄物品！', '#BDBDBD');
        } catch (e) { console.error(e); }
    }

    showHeartEffect(isBig) {
        this.tweens.add({ targets: this.hen, y: this.hen.y - 15, duration: 150, yoyo: true });

        const size = isBig ? 1 : .7;
        const heart = this.add.graphics({ x: this.hen.x, y: this.hen.y - 30 }).setDepth(30);
        const points = Array.from({ length: 48 }, (_, index) => {
            const angle = index / 48 * Math.PI * 2;
            return { x: 16 * Math.sin(angle) ** 3 * size, y: -(13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) * size };
        });
        heart.fillStyle(0xe56a88, 1).fillPoints(points, true);
        this.tweens.add({
            targets: heart, y: heart.y - 60, scaleX: 1.3, scaleY: 1.3, alpha: 0, duration: 1500, ease: 'Power1',
            onComplete: () => heart.destroy()
        });
    }

    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2500, delay: 1000 });
    }
}
