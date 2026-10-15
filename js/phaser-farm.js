import { db } from './firebase-config.js'; 
import { doc, onSnapshot, runTransaction, setDoc, updateDoc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// 1. Firebase 用戶驗證與設定 (嚴格使用 accountId)
// ==========================================
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

if (!currentUser || !currentUser.accountId) {
    alert('資料異常：請確認您已正確登入且擁有 accountId！');
    window.location.href = 'index.html';
    throw new Error("未登入或缺少 accountId"); 
}

const CURRENT_GROUP_ID = currentUser.groupId || "default_group";
const CURRENT_ACCOUNT_ID = currentUser.accountId; 
const myFarmRef = doc(db, "groups", CURRENT_GROUP_ID, "users", CURRENT_ACCOUNT_ID);

document.getElementById('playerName').innerText = currentUser.name || "我";

// 遊戲邏輯常數
const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
const STEAL_COOLDOWN_MS = 60 * 60 * 1000;   
const STEAL_SUCCESS_RATE = 0.7;             

const EGG_PRICE = 10;   
const HEN_PRICE = 500;  
const WORM_PRICE = 1;
const EARTHWORM_PRICE = 5;
const FANG_PRICE = 10;
const EXPAND_SLOT_PRICE = 100;

// ==========================================
// 2. Phaser 遊戲場景架構
// ==========================================

class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FFCA28', '8': '#BDBDBD', '9': '#7CB342', 'A': '#388E3C', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2',
            'K': '#FFA000', 'L': '#FFF9C4', 'M': '#FF4081', 'N': '#F48FB1'
        };

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('hen', { data: ['......1111..', '......1411..', '......1111..', '......111133', '....11111122', '....111111..', '..11118811..', '..11118811..', '....118811..', '....111111..', '......3..3..', '......3..3..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coop', { data: ['......CCCC......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', 'DDDDDDDDDDDDDDDD', '..FGFGFGFGFGFG..', '..GFFGFGFGFFGF..', '..FGFGIIIIFGFG..', '..GFFGIIIIFFGF..', '..FGFGFFFFFGFG..', '..GFFGHHHHFFGF..', '..FGFGHHHHFGFG..', '..GFFHEEEEHFFG..', '..FGFHEEEEFGFG..', '..GFFGFGFGFFGF..'], pixelWidth: 10, palette: palette });
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '7L77K', '7777K', '777KK', '.7KK.'], pixelWidth: 5, palette: palette });
        this.textures.generate('cabbage', { data: ['..AA..', '.A99A.', 'A9A99A', 'A999AA', '.AAAA.'], pixelWidth: 5, palette: palette });
        this.textures.generate('worm', { data: ['9A9A'], pixelWidth: 5, palette: palette });
        this.textures.generate('earthworm', { data: ['N2N2'], pixelWidth: 5, palette: palette });
        this.textures.generate('heart', { data: ['.M.M.', 'MMMMM', 'MMMMM', '.MMM.', '..M..'], pixelWidth: 4, palette: palette });
        
        // 告示牌
        this.textures.generate('signboard', { data: ['..GGGGGG..', '.GFFFFFFG.', 'GFF4444FFG', 'GFF4444FFG', 'GFFFFFFFFG', '.GFFFFFFG.', '..GGGGGG..', '....GG....', '....GG....', '....GG....'], pixelWidth: 3, palette: palette });
        
        // --- 🐺 Minecraft 風格：大野狼事件物件 ---
        this.textures.generate('wolf', { 
            data: [
                '......4444......',
                '....44888844....',
                '..448888888844..',
                '..488288882884..',
                '.48882888828884.',
                '.48888844888884.',
                '.48888411488884.',
                '.48888444488884.',
                '..488888888884..',
                '....44444444....'
            ], pixelWidth: 4, palette: palette 
        });
        this.textures.generate('wolf_bump', { 
            data: [
                '..22........22..',
                '.2222......2222.',
                '..22........22..',
                '......4444......',
                '....44888844....',
                '..448888888844..',
                '..488488884884..',
                '.48884888848884.',
                '.48888844888884.',
                '.48888411488884.',
                '.48888444488884.',
                '..488888888884..',
                '....44444444....'
            ], pixelWidth: 4, palette: palette 
        });
        this.textures.generate('club', { 
            data: [
                '..GG..',
                '.GFFG.',
                'GFFFFG',
                'GFFFFG',
                'GFFFFG',
                '.GFFG.',
                '.GFFG.',
                '..GG..',
                '..GG..'
            ], pixelWidth: 4, palette: palette 
        });
        this.textures.generate('fang', { 
            data: [
                '..44..',
                '.4114.',
                '.4114.',
                '..414.',
                '..44..'
            ], pixelWidth: 4, palette: palette 
        });

        this.scene.start('MyFarmScene');
    }
}

// --- 場景 B：自己的農莊 ---
class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        const cx = this.cameras.main.centerX; 
        const cy = this.cameras.main.centerY;
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.isHarvesting = false; 

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5);
        this.coopEgg = this.add.image(cx, cy - 140, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        // 10x10 大菜園
        const startX = cx - 135, startY = cy + 60, spacing = 30;
        this.add.rectangle(cx, startY + 135, 300, 300, 0x5D4037, 0.4).setOrigin(0.5);
        
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                let cab = this.add.image(startX + c * spacing, startY + r * spacing, 'cabbage').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
                cab.on('pointerdown', () => this.searchCabbage(cab));
            }
        }

        const sign = this.add.image(startX, startY - 20, 'signboard').setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(5);
        sign.on('pointerdown', () => {
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        this.hen = this.add.image(cx, cy - 30, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting && this.emptyClickCount < 4) {
                this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            }
            this.harvestEgg();
        });

        const btnLobby = this.add.rectangle(55, 40, 85, 40, 0x1976D2, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 40, '🗺️ 村落', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnLobby.on('pointerdown', () => this.scene.start('LobbyScene'));

        const btnShop = this.add.rectangle(145, 40, 85, 40, 0x8E24AA, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(145, 40, '🛒 商店', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnShop.on('pointerdown', () => this.scene.start('ShopScene'));

        const btnWarehouse = this.add.rectangle(235, 40, 85, 40, 0xE65100, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(235, 40, '🎒 倉庫', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnWarehouse.on('pointerdown', () => this.scene.start('WarehouseScene'));

        this.add.rectangle(340, 40, 90, 40, 0x000000, 0.6).setOrigin(0.5);
        this.add.image(315, 40, 'coin').setScale(0.8).setOrigin(0.5);
        this.coinsText = this.add.text(345, 40, '0', { fontSize: '16px', fontFamily: 'monospace', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.timerBg = this.add.rectangle(cx, 90, 200, 30, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '連線中...', { fontSize: '15px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        this.initFirebase();
        this.startHenRoutine(); 
        
        this.events.on('shutdown', () => {
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
        });
    }

    startHenRoutine() {
        this.time.addEvent({ delay: 30000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });
        this.wanderHen();
    }
    wanderHen() {
        if (this.isHenSitting || !this.hen || !this.hen.active) return;
        const targetX = Phaser.Math.Between(50, 340);
        const targetY = Phaser.Math.Between(120, 450); 
        this.hen.setFlipX(targetX < this.hen.x);
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, targetX, targetY);
        this.walkTween = this.tweens.add({
            targets: this.hen, x: targetX, y: targetY, duration: distance * 20, ease: 'Linear',
            onComplete: () => {
                if (this.isHenSitting) return;
                this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => this.wanderHen());
            }
        });
        this.waddleTween = this.tweens.add({ targets: this.hen, y: '-=6', duration: 150, yoyo: true, repeat: Math.floor((distance * 20) / 300) });
    }
    prepareToLayEgg() {
        this.isHenSitting = true;
        if (this.walkTween) this.walkTween.stop();
        if (this.waddleTween) this.waddleTween.stop();
        const nestX = this.cameras.main.centerX;
        const nestY = this.cameras.main.centerY - 130;
        this.hen.setFlipX(nestX < this.hen.x);
        this.tweens.add({
            targets: this.hen, x: nestX, y: nestY, duration: Phaser.Math.Distance.Between(this.hen.x, this.hen.y, nestX, nestY) * 15, ease: 'Linear',
            onComplete: () => {
                this.tweens.add({
                    targets: this.hen, scaleY: 0.7, scaleX: 1.15, y: nestY + 15, duration: 300, ease: 'Power2',
                    onComplete: () => {
                        this.time.delayedCall(5000, () => {
                            this.tweens.add({ targets: this.hen, scaleY: 1, scaleX: 1, y: nestY, duration: 300, onComplete: () => { this.isHenSitting = false; this.wanderHen(); } });
                        });
                    }
                });
            }
        });
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (!docSnap.exists() || !docSnap.data().farm) {
                setDoc(myFarmRef, { farm: { coins: 0, inventoryEggs: 0, hens: 1, eggsReady: 0, lastLayTime: Date.now(), warehouseLimit: 10, worms: 0, earthworms: 0, wolfFangs: 0 } }, { merge: true });
                return;
            }
            this.farmData = docSnap.data().farm;
            this.updateUI();
            this.startEggTimer(); 
        });
    }

    updateUI() {
        if (!this.farmData) return;
        this.coinsText.setText(`${this.farmData.coins || 0}`);
        this.coopEgg.setVisible(this.farmData.eggsReady > 0);
    }

    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;

            const now = Date.now();
            let eggsReady = this.farmData.eggsReady || 0;
            let lastLayTime = this.farmData.lastLayTime || now;
            let changed = false;

            const maxEggs = (this.farmData.hens || 1) * 6;

            while (now - lastLayTime >= LAY_EGG_TIME_MS && eggsReady < maxEggs) {
                eggsReady++;
                lastLayTime += LAY_EGG_TIME_MS;
                changed = true;
            }

            if (eggsReady >= maxEggs) {
                if (now - lastLayTime > 0) {
                    lastLayTime = now;
                    changed = true;
                }
            }

            if (changed) {
                updateDoc(myFarmRef, { "farm.eggsReady": eggsReady, "farm.lastLayTime": lastLayTime }).catch(e => console.error(e));
                this.farmData.eggsReady = eggsReady;
                this.farmData.lastLayTime = lastLayTime;
                this.updateUI(); 
            }

            if (eggsReady >= maxEggs) {
                this.timerText.setText(`🥚 產能已滿 (${maxEggs}/${maxEggs})`);
                this.timerText.setColor('#A5D6A7');
            } else {
                let timeLeft = LAY_EGG_TIME_MS - (now - lastLayTime);
                if (timeLeft < 0) timeLeft = 0;
                
                const h = Math.floor(timeLeft / 3600000);
                const m = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
                this.timerText.setText(`下顆蛋倒數: ${h}:${m}:${s}`);
                this.timerText.setColor('#FFD54F');
            }
        }, 1000);
    }

    async searchCabbage(cabSprite) {
        if (!this.farmData || cabSprite.isAnimating) return;
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
        const limit = this.farmData.warehouseLimit || 10;
        
        const rand = Phaser.Math.Between(1, 500);
        let foundType = null;
        let icon = null;
        
        if (rand === 1) { foundType = 'earthworms'; icon = '蚯蚓'; }
        else if (rand >= 2 && rand <= 6) { foundType = 'worms'; icon = '菜蟲'; }
        else return;

        if (usedSpace >= limit) {
            this.showFloatingText('倉庫已滿！', '#F44336', 16, cabSprite.x, cabSprite.y);
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
            });
            this.showFloatingText(`+1 ${icon}`, '#A5D6A7', 16, cabSprite.x, cabSprite.y);
        } catch (e) { console.error(e); }
    }

    async harvestEgg() {
        if (this.isHarvesting) return; 

        if (!this.farmData || this.farmData.eggsReady <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickTimer) this.emptyClickTimer.remove();
            this.emptyClickTimer = this.time.delayedCall(2000, () => this.emptyClickCount = 0);

            if (this.emptyClickCount >= 5) {
                this.showFloatingText('沒蛋啦還一直點~咕咕💢', '#F44336', 16); 
                this.hen.setTint(0xff0000); 
                this.time.delayedCall(500, () => this.hen.clearTint());
                this.tweens.add({ targets: this.hen, y: this.hen.y - 25, duration: 100, yoyo: true, repeat: 1 });
                this.emptyClickCount = 0;
            } else {
                this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff', 20);
            }
            return;
        }

        const eggsToHarvest = this.farmData.eggsReady;
        const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
        const limit = this.farmData.warehouseLimit || 10;
        
        if (usedSpace + eggsToHarvest > limit) {
            this.showFloatingText('🎒 倉庫空間不足，請先擴充或販售！', '#F44336', 14);
            return;
        }

        this.emptyClickCount = 0;
        this.isHarvesting = true; 

        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(myFarmRef);
                const farm = docSnap.data().farm;
                if (farm.eggsReady > 0) {
                    transaction.update(myFarmRef, {
                        "farm.inventoryEggs": (farm.inventoryEggs || 0) + farm.eggsReady,
                        "farm.eggsReady": 0
                    });
                }
            });
            this.showFloatingText(`+${eggsToHarvest} 🥚`, '#FFD54F', 22);
        } catch (e) { console.error(e); } 
        finally { this.isHarvesting = false; }
    }

    showFloatingText(msg, color, fontSize = 22, x = this.hen.x, y = this.hen.y - 40) {
        const floatTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1200, onComplete: () => floatTxt.destroy() });
    }

    showNoticeText(msg, color, fontSize, x, y) {
        if (this.noticeTxt) this.noticeTxt.destroy();
        this.noticeTxt = this.add.text(x, y, msg, { 
            fontSize: `${fontSize}px`, fontFamily: 'sans-serif', color: color, 
            fontStyle: 'bold', stroke: '#000', strokeThickness: 2, 
            align: 'left', backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 8, y: 8 } 
        }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: this.noticeTxt, alpha: 0, duration: 3500, delay: 2000, onComplete: () => { if(this.noticeTxt) this.noticeTxt.destroy(); } });
    }
}

// --- 場景 C：村落大廳 (Lobby) ---
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(195, 50, '🗺️ 咕咕村落', { fontSize: '24px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnHome = this.add.rectangle(55, 50, 70, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 50, '🏠 返回', { fontSize: '15px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnHome.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.loadingText = this.add.text(195, 320, '正在尋找鄰居...', { fontSize: '18px', color: '#fff' }).setOrigin(0.5);
        this.loadNeighbors();
    }

    async loadNeighbors() {
        try {
            const q = query(collection(db, "users"), where("groupId", "==", CURRENT_GROUP_ID));
            const querySnapshot = await getDocs(q);
            
            this.loadingText.destroy();
            let index = 0;
            const startX = 80, startY = 150, spacingX = 115, spacingY = 130;

            querySnapshot.forEach((docSnap) => {
                const userData = docSnap.data();
                const memberAccountId = userData.accountId; 
                const memberName = userData.name || "未知";
                
                if (!memberAccountId || memberAccountId === CURRENT_ACCOUNT_ID) return;

                const col = index % 3;
                const row = Math.floor(index / 3);
                const x = startX + col * spacingX;
                const y = startY + row * spacingY;

                const house = this.add.image(x, y, 'mini_house').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
                this.add.rectangle(x, y + 40, 80, 22, 0x000000, 0.5).setOrigin(0.5);
                this.add.text(x, y + 40, memberName, { fontSize: '13px', fontFamily: 'sans-serif', color: '#fff' }).setOrigin(0.5);

                house.on('pointerdown', async () => {
                    house.setTint(0xcccccc);
                    this.time.delayedCall(100, () => house.clearTint());
                    
                    const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", memberAccountId);
                    const targetSnap = await getDoc(targetRef);
                    if (targetSnap.exists() && targetSnap.data().farm) {
                        this.scene.start('VisitScene', { targetAccountId: memberAccountId, targetName: memberName });
                    } else {
                        this.showFloatingText(x, y, '尚未啟用！', '#FFCDD2');
                    }
                });
                index++;
            });
            if (index === 0) this.add.text(195, 320, '群組內還沒有其他鄰居喔！', { fontSize: '16px', color: '#fff' }).setOrigin(0.5);
        } catch (e) {
            this.loadingText.setText('載入失敗，請檢查網路');
        }
    }

    showFloatingText(x, y, msg, color) {
        const floatTxt = this.add.text(x, y - 40, msg, { fontSize: '14px', fontFamily: 'sans-serif', color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 D：拜訪偷蛋與大野狼事件 (Visit) ---
class VisitScene extends Phaser.Scene {
    constructor() { super({ key: 'VisitScene' }); }

    init(data) {
        this.targetAccountId = data.targetAccountId; 
        this.targetName = data.targetName;
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        this.emptyClickCount = 0;
        this.targetFarmData = null;
        this.myFarmData = null; 
        this.isStealing = false; 

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 180, 'coop').setOrigin(0.5);
        this.coopEgg = this.add.image(cx, cy - 140, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        const startX = cx - 135, startY = cy + 60, spacing = 30;
        this.add.rectangle(cx, startY + 135, 300, 300, 0x5D4037, 0.4).setOrigin(0.5);
        
        for (let r = 0; r < 10; r++) {
            for (let c = 0; c < 10; c++) {
                let cab = this.add.image(startX + c * spacing, startY + r * spacing, 'cabbage').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
                cab.on('pointerdown', () => this.searchCabbage(cab));
            }
        }

        const sign = this.add.image(startX, startY - 20, 'signboard').setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(5);
        sign.on('pointerdown', () => {
            this.showNoticeText('幫忙抓菜園裡的蟲子\n有機率獲得一些寶貝哦!', '#FFF', 14, sign.x + 95, sign.y - 20);
        });

        this.hen = this.add.image(cx, cy - 30, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        this.hen.on('pointerdown', () => {
            this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            this.attemptSteal(); 
        });

        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5).setDepth(30);
        this.add.text(195, 50, `潛入 [${this.targetName}] 的家`, { fontSize: '16px', fontFamily: 'sans-serif', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);

        const btnBack = this.add.rectangle(55, 50, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' }).setDepth(30);
        this.add.text(55, 50, '❮ 溜走', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(30);
        btnBack.on('pointerdown', () => this.scene.start('LobbyScene'));

        this.initFirebase();
        this.startHenRoutine(); 

        // 🐺 大野狼突發事件 (10% 機率)
        if (Phaser.Math.Between(1, 10) === 1) {
            this.spawnWolfEvent();
        }

        this.events.on('shutdown', () => { 
            if (this.unsubscribeTarget) this.unsubscribeTarget(); 
            if (this.unsubscribeMyFarm) this.unsubscribeMyFarm(); 
        });
    }

    // --- 🐺 大野狼事件邏輯 ---
    spawnWolfEvent() {
        this.isWolfDefeated = false;
        this.wolfHitCount = 0;

        // 從菜園右下方生成
        const spawnX = this.cameras.main.centerX + 120;
        const spawnY = this.cameras.main.centerY + 220; 
        
        this.wolf = this.add.image(spawnX, spawnY, 'wolf').setOrigin(0.5).setScale(1.2).setDepth(25).setInteractive({ cursor: 'pointer' });
        this.club = this.add.image(0, 0, 'club').setOrigin(0.5).setScale(1.5).setDepth(30).setVisible(false);

        // 警告提示
        const warnText = this.add.text(this.cameras.main.centerX, 120, '⚠️ 警告：大野狼來襲！\n快用木棒打退牠 (點擊200下)', { 
            fontSize: '18px', color: '#F44336', fontStyle: 'bold', align: 'center', stroke: '#fff', strokeThickness: 3 
        }).setOrigin(0.5).setDepth(30);
        this.tweens.add({ targets: warnText, scale: 1.1, yoyo: true, repeat: -1, duration: 500 });

        // 大野狼花 60 秒緩慢移動到雞舍
        this.wolfTween = this.tweens.add({
            targets: this.wolf,
            x: this.coop.x,
            y: this.coop.y + 40, 
            duration: 60000,
            ease: 'Linear',
            onComplete: () => {
                warnText.destroy();
                if (!this.isWolfDefeated) {
                    this.wolfEscapes(); // 60秒沒打完：失敗！
                }
            }
        });

        // 點擊打狼
        this.wolf.on('pointerdown', (pointer) => {
            if (this.isWolfDefeated) return;
            this.wolfHitCount++;

            // 野狼受擊閃爍紅光
            this.wolf.setTint(0xff0000);
            this.time.delayedCall(50, () => this.wolf.clearTint());

            // 顯示揮動木棒動畫
            this.club.setPosition(pointer.x + 15, pointer.y - 15);
            this.club.setVisible(true);
            this.club.setAngle(-45);
            this.tweens.add({
                targets: this.club, angle: 45, duration: 50, yoyo: true,
                onComplete: () => this.club.setVisible(false)
            });

            // 判斷勝利
            if (this.wolfHitCount >= 200) {
                warnText.destroy();
                this.defeatWolf();
            } else if (this.wolfHitCount % 20 === 0) {
                this.showFloatingText(`還差 ${200 - this.wolfHitCount} 下!`, '#FF9800', 16, this.wolf.x, this.wolf.y - 40);
            }
        });
    }

    // 擊敗大野狼
    defeatWolf() {
        this.isWolfDefeated = true;
        if (this.wolfTween) this.wolfTween.stop();
        this.wolf.setTexture('wolf_bump'); // 換成頭上長包的圖
        this.club.setVisible(false);

        this.showFloatingText('🎉 成功擊退大野狼！', '#4CAF50', 22, this.wolf.x, this.wolf.y - 50);

        this.tweens.add({
            targets: this.wolf, alpha: 0, y: this.wolf.y - 50, duration: 1500, delay: 1000,
            onComplete: () => this.wolf.destroy()
        });

        // 發送狼牙獎勵
        runTransaction(db, async (t) => {
            const snap = await t.get(myFarmRef);
            const farm = snap.data().farm;
            const usedSpace = (farm.inventoryEggs || 0) + (farm.worms || 0) + (farm.earthworms || 0) + (farm.wolfFangs || 0);
            
            if (usedSpace < (farm.warehouseLimit || 10)) {
                t.update(myFarmRef, { "farm.wolfFangs": (farm.wolfFangs || 0) + 1 });
                return true; 
            } else {
                return false; 
            }
        }).then((success) => {
            if (success) {
                this.time.delayedCall(1000, () => this.showFloatingText('獲得 狼牙 +1 🦷', '#FFF', 20, this.cameras.main.centerX, this.cameras.main.centerY));
            } else {
                this.time.delayedCall(1000, () => this.showFloatingText('打贏了！但倉庫滿了，裝不下狼牙...', '#F44336', 16, this.cameras.main.centerX, this.cameras.main.centerY));
            }
        }).catch(e => console.error(e));
    }

    // 失敗懲罰：偷走鄰居一顆蛋
    wolfEscapes() {
        this.showFloatingText('大野狼偷走了一顆蛋逃跑了！', '#F44336', 18, this.wolf.x, this.wolf.y - 30);
        this.tweens.add({
            targets: this.wolf, alpha: 0, x: this.wolf.x + 100, duration: 1000,
            onComplete: () => this.wolf.destroy()
        });

        // 扣除鄰居的蛋
        runTransaction(db, async (t) => {
            const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
            const targetDoc = await t.get(targetRef);
            const targetFarm = targetDoc.data().farm;
            if (targetFarm && targetFarm.eggsReady > 0) {
                t.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
            }
        }).catch(e => console.error(e));
    }
    // ----------------------------

    startHenRoutine() { this.wanderHen(); }
    wanderHen() {
        if (!this.hen || !this.hen.active) return;
        const targetX = Phaser.Math.Between(50, 340);
        const targetY = Phaser.Math.Between(120, 450); 
        this.hen.setFlipX(targetX < this.hen.x);
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, targetX, targetY);
        this.walkTween = this.tweens.add({
            targets: this.hen, x: targetX, y: targetY, duration: distance * 20, ease: 'Linear',
            onComplete: () => { this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => this.wanderHen()); }
        });
        this.waddleTween = this.tweens.add({ targets: this.hen, y: '-=6', duration: 150, yoyo: true, repeat: Math.floor((distance * 20) / 300) });
    }

    initFirebase() {
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        this.unsubscribeTarget = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.coopEgg.setVisible(this.targetFarmData.eggsReady > 0);
            }
        });

        this.unsubscribeMyFarm = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.myFarmData = docSnap.data().farm;
            }
        });
    }

    async searchCabbage(cabSprite) {
        if (!this.myFarmData || cabSprite.isAnimating) return;
        
        cabSprite.isAnimating = true;
        this.tweens.add({ targets: cabSprite, y: cabSprite.y - 10, duration: 100, yoyo: true, onComplete: () => cabSprite.isAnimating = false });

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0);
        const limit = this.myFarmData.warehouseLimit || 10;
        
        const rand = Phaser.Math.Between(1, 500);
        let foundType = null;
        let icon = null;
        
        if (rand === 1) { foundType = 'earthworms'; icon = '蚯蚓'; }
        else if (rand >= 2 && rand <= 6) { foundType = 'worms'; icon = '菜蟲'; }
        else return;

        if (usedSpace >= limit) {
            this.showFloatingText('我的倉庫滿了！', '#F44336', 16, cabSprite.x, cabSprite.y);
            return;
        }

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { [`farm.${foundType}`]: (farm[foundType] || 0) + 1 });
            });
            this.showFloatingText(`+1 ${icon}`, '#A5D6A7', 16, cabSprite.x, cabSprite.y);
        } catch (e) { console.error(e); }
    }

    async attemptSteal() {
        if (this.isStealing) return;
        if (!this.myFarmData) return;
        
        if (this.myFarmData.lastStealTime && Date.now() - this.myFarmData.lastStealTime < STEAL_COOLDOWN_MS) {
            const leftMins = Math.ceil((STEAL_COOLDOWN_MS - (Date.now() - this.myFarmData.lastStealTime)) / 60000);
            this.showFloatingText(`還在被警察追！請等 ${leftMins} 分鐘`, '#F44336', 15, this.hen.x, this.hen.y - 40);
            return;
        }

        if (!this.targetFarmData || this.targetFarmData.eggsReady <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickCount >= 5) {
                this.showFloatingText('沒蛋啦還一直點~咕咕💢', '#F44336', 16, this.hen.x, this.hen.y - 40); 
                this.hen.setTint(0xff0000); 
                this.time.delayedCall(500, () => this.hen.clearTint());
                this.tweens.add({ targets: this.hen, y: this.hen.y - 25, duration: 100, yoyo: true, repeat: 1 });
                this.emptyClickCount = 0;
            } else {
                this.showFloatingText('人家現在沒蛋啦！', '#ffffff', 18, this.hen.x, this.hen.y - 40);
            }
            return;
        }

        const usedSpace = (this.myFarmData.inventoryEggs || 0) + (this.myFarmData.worms || 0) + (this.myFarmData.earthworms || 0) + (this.myFarmData.wolfFangs || 0);
        if (usedSpace >= (this.myFarmData.warehouseLimit || 10)) {
            this.showFloatingText('你的倉庫滿了，偷不了！', '#F44336', 15, this.hen.x, this.hen.y - 40);
            return;
        }

        this.emptyClickCount = 0;
        this.isStealing = true;
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);

        try {
            await runTransaction(db, async (t) => {
                const targetDoc = await t.get(targetRef);
                const targetFarm = targetDoc.data().farm;
                const myDoc = await t.get(myFarmRef);
                const myCurrentFarm = myDoc.data().farm;

                if (!targetFarm || targetFarm.eggsReady <= 0) throw "手腳太慢，蛋不見了！";
                
                if (Math.random() > STEAL_SUCCESS_RATE) {
                    t.update(myFarmRef, { "farm.lastStealTime": Date.now() });
                    throw "被狗咬了！偷竊失敗！";
                }

                t.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
                t.update(myFarmRef, { 
                    "farm.inventoryEggs": (myCurrentFarm.inventoryEggs || 0) + 1,
                    "farm.lastStealTime": Date.now()
                });
            });
            this.showFloatingText('😎 偷到 +1 🥚', '#FFD54F', 18, this.hen.x, this.hen.y - 40);
        } catch (error) {
            this.showFloatingText(`🐕 ${error}`, '#F44336', 16, this.hen.x, this.hen.y - 40);
            this.cameras.main.shake(300, 0.01);
        } finally {
            this.isStealing = false;
        }
    }

    showFloatingText(msg, color, fontSize = 22, x, y) {
        const floatTxt = this.add.text(x, y, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }

    showNoticeText(msg, color, fontSize, x, y) {
        if (this.noticeTxt) this.noticeTxt.destroy();
        this.noticeTxt = this.add.text(x, y, msg, { 
            fontSize: `${fontSize}px`, fontFamily: 'sans-serif', color: color, 
            fontStyle: 'bold', stroke: '#000', strokeThickness: 2, 
            align: 'left', backgroundColor: 'rgba(0,0,0,0.7)', padding: { x: 8, y: 8 } 
        }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: this.noticeTxt, alpha: 0, duration: 3500, delay: 2000, onComplete: () => { if(this.noticeTxt) this.noticeTxt.destroy(); } });
    }
}

// --- 場景 E：商店系統 (Shop) ---
class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 咕咕莊園商店', { fontSize: '22px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '❮ 返回', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.assetText = this.add.text(195, 120, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'center', lineHeight: 1.5, backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        // 調整距離，加入販賣狼牙按鈕
        this.createShopBtn(195, 200, `🥚 賣出雞蛋 (+${EGG_PRICE} 🪙)`, 0x4CAF50, () => this.sellItem('inventoryEggs', EGG_PRICE, '雞蛋'));
        this.createShopBtn(195, 270, `🐛 賣出菜蟲 (+${WORM_PRICE} 🪙)`, 0x4CAF50, () => this.sellItem('worms', WORM_PRICE, '菜蟲'));
        this.createShopBtn(195, 340, `🪱 賣出蚯蚓 (+${EARTHWORM_PRICE} 🪙)`, 0x4CAF50, () => this.sellItem('earthworms', EARTHWORM_PRICE, '蚯蚓'));
        this.createShopBtn(195, 410, `🐺 賣出狼牙 (+${FANG_PRICE} 🪙)`, 0x4CAF50, () => this.sellItem('wolfFangs', FANG_PRICE, '狼牙'));
        this.createShopBtn(195, 480, `🐔 買進母雞 (-${HEN_PRICE} 🪙)`, 0xE53935, () => this.buyHen());
        this.createShopBtn(195, 550, `📦 擴充容量10格 (-${EXPAND_SLOT_PRICE} 🪙)`, 0x1976D2, () => this.expandWarehouse());

        this.msgText = this.add.text(195, 620, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        this.initFirebase();
        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    createShopBtn(x, y, text, color, callback) {
        const btn = this.add.rectangle(x, y, 300, 50, color, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(x, y, text, { fontSize: '16px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btn.on('pointerdown', callback);
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
        if (!this.farmData || (this.farmData[itemKey] || 0) < 1) {
            this.showMsg(`${itemName}不足，無法賣出！`, '#F44336'); return;
        }
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[itemKey] > 0) {
                    t.update(myFarmRef, { [`farm.${itemKey}`]: farm[itemKey] - 1, "farm.coins": (farm.coins || 0) + price });
                }
            });
            this.showMsg(`賣出成功！獲得 ${price} 金幣`, '#4CAF50');
        } catch (e) { console.error(e); }
    }

    async buyHen() {
        if (!this.farmData || (this.farmData.coins || 0) < HEN_PRICE) {
            this.showMsg(`金幣不足，無法購買母雞！`, '#F44336'); return;
        }
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { "farm.coins": farm.coins - HEN_PRICE, "farm.hens": (farm.hens || 1) + 1 });
            });
            this.showMsg('購買成功！母雞數量 +1', '#FFD54F');
        } catch (e) { console.error(e); }
    }

    async expandWarehouse() {
        if (!this.farmData || (this.farmData.coins || 0) < EXPAND_SLOT_PRICE) {
            this.showMsg(`金幣不足，無法擴充倉庫！`, '#F44336'); return;
        }
        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                t.update(myFarmRef, { "farm.coins": farm.coins - EXPAND_SLOT_PRICE, "farm.warehouseLimit": (farm.warehouseLimit || 10) + 10 });
            });
            this.showMsg('擴充成功！容量 +10', '#FFD54F');
        } catch (e) { console.error(e); }
    }
}

// --- 場景 F：倉庫系統 (Warehouse) ---
class WarehouseScene extends Phaser.Scene {
    constructor() { super({ key: 'WarehouseScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.hen = this.add.image(195, 180, 'hen').setScale(1.5).setOrigin(0.5);
        this.isFeeding = false;

        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🎒 我的倉庫', { fontSize: '22px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '❮ 返回', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.capacityText = this.add.text(195, 110, '容量: 0/10', { fontSize: '16px', color: '#fff', backgroundColor: '#000', padding: 5 }).setOrigin(0.5);

        this.itemsPanel = this.add.container(0, 260);
        this.itemSlots = {};
        
        const configItems = [
            { key: 'coins', name: '金幣', icon: 'coin' },
            { key: 'inventoryEggs', name: '雞蛋', icon: 'egg' },
            { key: 'worms', name: '菜蟲', icon: 'worm' },
            { key: 'earthworms', name: '蚯蚓', icon: 'earthworm' },
            { key: 'wolfFangs', name: '狼牙', icon: 'fang' } // 新增狼牙
        ];

        let index = 0;
        configItems.forEach(item => {
            const col = index % 2;
            const row = Math.floor(index / 2);
            const x = 100 + col * 190;
            const y = row * 100;

            const bg = this.add.rectangle(x, y, 160, 80, 0x000000, 0.5).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
            const img = this.add.image(x - 40, y, item.icon).setScale(1.5);
            const txt = this.add.text(x + 10, y - 10, `${item.name}\nx 0`, { fontSize: '16px', color: '#fff', align: 'center' }).setOrigin(0.5);

            bg.on('pointerdown', () => this.handleItemClick(item.key, item.name));
            this.itemSlots[item.key] = txt;
            this.itemsPanel.add([bg, img, txt]);
            index++;
        });

        // 位置下移，避免與第五個物品(狼牙)重疊
        this.actionPanel = this.add.container(0, 530).setVisible(false);
        this.actionBg = this.add.rectangle(195, 0, 340, 100, 0x333333, 0.9).setOrigin(0.5);
        this.actionTitle = this.add.text(195, -25, '選擇動作', { fontSize: '18px', color: '#fff' }).setOrigin(0.5);
        
        this.btnFeed = this.add.rectangle(110, 20, 120, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(110, 20, '😋 餵食母雞', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        
        this.btnDiscard = this.add.rectangle(280, 20, 120, 40, 0xE53935, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(280, 20, '🗑️ 丟棄', { fontSize: '14px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        this.actionPanel.add([this.actionBg, this.actionTitle, this.btnFeed, this.btnDiscard]);

        this.msgText = this.add.text(195, 650, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        this.initFirebase();
        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.farmData = docSnap.data().farm;
                const usedSpace = (this.farmData.inventoryEggs || 0) + (this.farmData.worms || 0) + (this.farmData.earthworms || 0) + (this.farmData.wolfFangs || 0);
                this.capacityText.setText(`容量: ${usedSpace}/${this.farmData.warehouseLimit || 10}`);

                this.itemSlots['coins'].setText(`金幣\nx ${this.farmData.coins || 0}`);
                this.itemSlots['inventoryEggs'].setText(`雞蛋\nx ${this.farmData.inventoryEggs || 0}`);
                this.itemSlots['worms'].setText(`菜蟲\nx ${this.farmData.worms || 0}`);
                this.itemSlots['earthworms'].setText(`蚯蚓\nx ${this.farmData.earthworms || 0}`);
                this.itemSlots['wolfFangs'].setText(`狼牙\nx ${this.farmData.wolfFangs || 0}`);
            }
        });
    }

    handleItemClick(key, name) {
        if (!this.farmData) return;
        const count = this.farmData[key] || 0;
        
        if (key === 'coins' || key === 'inventoryEggs' || key === 'wolfFangs') {
            this.actionPanel.setVisible(false);
            this.showMsg('此物品請至商店販售！', '#FFD54F');
            return;
        }

        if (count <= 0) {
            this.actionPanel.setVisible(false);
            this.showMsg(`沒有${name}可以操作！`, '#F44336');
            return;
        }

        this.actionTitle.setText(`對 ${name} 進行操作`);
        this.actionPanel.setVisible(true);
        this.btnFeed.removeAllListeners();
        this.btnDiscard.removeAllListeners();

        this.btnFeed.on('pointerdown', () => this.feedItem(key));
        this.btnDiscard.on('pointerdown', () => this.discardItem(key));
    }

    async feedItem(key) {
        if (this.isFeeding) return;
        if (!this.farmData || (this.farmData[key] || 0) <= 0) return;
        this.actionPanel.setVisible(false);
        this.isFeeding = true; 

        const reduceMins = key === 'worms' ? 30 : 60;
        const reduceMs = reduceMins * 60 * 1000;

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[key] > 0) {
                    let newLastLayTime = farm.lastLayTime - reduceMs;
                    let newEggsReady = farm.eggsReady || 0;
                    const now = Date.now();
                    const maxEggs = (farm.hens || 1) * 6;
                    
                    while (now - newLastLayTime >= LAY_EGG_TIME_MS && newEggsReady < maxEggs) {
                        newEggsReady++;
                        newLastLayTime += LAY_EGG_TIME_MS;
                    }
                    if (newEggsReady >= maxEggs) {
                        if (now - newLastLayTime > 0) newLastLayTime = now;
                    }

                    t.update(myFarmRef, { 
                        [`farm.${key}`]: farm[key] - 1,
                        "farm.lastLayTime": newLastLayTime,
                        "farm.eggsReady": newEggsReady
                    });
                }
            });
            this.showHeartEffect(key === 'earthworms');
            this.showMsg(`母雞很開心！下顆蛋加速 ${reduceMins} 分鐘`, '#4CAF50');
        } catch (e) { 
            console.error(e); 
        } finally {
            this.isFeeding = false;
        }
    }

    async discardItem(key) {
        if (!this.farmData || (this.farmData[key] || 0) <= 0) return;
        this.actionPanel.setVisible(false);

        try {
            await runTransaction(db, async (t) => {
                const snap = await t.get(myFarmRef);
                const farm = snap.data().farm;
                if (farm[key] > 0) {
                    t.update(myFarmRef, { [`farm.${key}`]: farm[key] - 1 });
                }
            });
            this.showMsg('已丟棄物品！', '#BDBDBD');
        } catch (e) { console.error(e); }
    }

    showHeartEffect(isBig) {
        this.tweens.add({ targets: this.hen, y: this.hen.y - 15, duration: 150, yoyo: true });
        const heart = this.add.image(this.hen.x, this.hen.y - 30, 'heart').setScale(isBig ? 2 : 1).setDepth(20);
        this.tweens.add({ targets: heart, y: heart.y - 50, alpha: 0, duration: 1500, onComplete: () => heart.destroy() });
    }

    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2500, delay: 1000 });
    }
}

// ==========================================
// 3. 啟動 Phaser 遊戲引擎 (手機滿版設定)
// ==========================================
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 390, 
        height: 844
    },
    parent: 'game-container', 
    pixelArt: true, 
    scene: [BootScene, MyFarmScene, LobbyScene, VisitScene, ShopScene, WarehouseScene] 
};

const game = new Phaser.Game(config);
