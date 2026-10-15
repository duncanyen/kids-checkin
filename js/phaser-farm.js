import { db } from './firebase-config.js'; 
import { doc, onSnapshot, runTransaction, setDoc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// 1. Firebase 用戶驗證與設定
// ==========================================
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

// ⚠️ 嚴格檢查：必須要有 accountId
if (!currentUser || !currentUser.accountId) {
    alert('資料異常：請確認您已正確登入且擁有 accountId！');
    window.location.href = 'index.html';
    throw new Error("未登入或缺少 accountId"); 
}

const CURRENT_GROUP_ID = currentUser.groupId || "default_group";
const CURRENT_ACCOUNT_ID = currentUser.accountId; 

// 所有針對個人農莊的讀寫，嚴格綁定 accountId
const myFarmRef = doc(db, "groups", CURRENT_GROUP_ID, "users", CURRENT_ACCOUNT_ID);

document.getElementById('playerName').innerText = currentUser.name || "我";

// 遊戲邏輯常數
const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; // 4 小時生一顆
const MAX_EGGS_PER_DAY = 6;                 // 最多累積 6 顆
const STEAL_COOLDOWN_MS = 60 * 60 * 1000;   // 偷蛋 CD：1 小時
const STEAL_SUCCESS_RATE = 0.7;             // 偷竊成功率 70%

const EGG_PRICE = 10;   // 賣出雞蛋獲得金幣
const HEN_PRICE = 500;  // 買母雞所需金幣

// ==========================================
// 2. Phaser 遊戲場景架構
// ==========================================

// --- 場景 A：啟動與素材生成 ---
class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FDD835', '8': '#BDBDBD', '9': '#7CB342', 'A': '#689F38', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2' 
        };

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('hen', { data: ['......1111..', '......1411..', '......1111..', '......111133', '....11111122', '....111111..', '..11118811..', '..11118811..', '....118811..', '....111111..', '......3..3..', '......3..3..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coop', { data: ['......CCCC......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', 'DDDDDDDDDDDDDDDD', '..FGFGFGFGFGFG..', '..GFFGFGFGFFGF..', '..FGFGIIIIFGFG..', '..GFFGIIIIFFGF..', '..FGFGFFFFFGFG..', '..GFFGHHHHFFGF..', '..FGFGHHHHFGFG..', '..GFFHEEEEHFFG..', '..FGFHEEEEFGFG..', '..GFFGFGFGFFGF..'], pixelWidth: 10, palette: palette });
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '77177', '71777', '77777', '.777.'], pixelWidth: 4, palette: palette });
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });

        this.scene.start('MyFarmScene');
    }
}

// --- 場景 B：自己的農莊 ---
class MyFarmScene extends Phaser.Scene {
    constructor() { super({ key: 'MyFarmScene' }); }

    create() {
        const cx = this.cameras.main.centerX; // 對應 390 的中心為 195
        const cy = this.cameras.main.centerY; // 對應 844 的中心為 422
        this.isHenSitting = false;
        this.emptyClickCount = 0;

        // 背景
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        
        // 雞舍
        this.coop = this.add.image(cx, cy - 100, 'coop').setOrigin(0.5);
        
        // 雞舍內的小雞蛋圖示 (有蛋才會顯示)
        this.coopEgg = this.add.image(cx, cy - 60, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        // 母雞
        this.hen = this.add.image(cx, cy + 50, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting && this.emptyClickCount < 4) {
                this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            }
            this.harvestEgg();
        });

        // ---------------- UI 佈局 (符合手機介面) ----------------

        // 左上角 1：咕咕村落按鈕
        const btnLobby = this.add.rectangle(55, 40, 85, 40, 0x1976D2, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 40, '🗺️ 咕咕村落', { fontSize: '13px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnLobby.on('pointerdown', () => this.scene.start('LobbyScene'));

        // 左上角 2：商店按鈕
        const btnShop = this.add.rectangle(150, 40, 85, 40, 0x8E24AA, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(150, 40, '🛒 商店', { fontSize: '13px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnShop.on('pointerdown', () => this.scene.start('ShopScene'));

        // 右上角：資源顯示區 (金幣與庫存雞蛋)
        this.add.rectangle(320, 40, 110, 50, 0x000000, 0.5).setOrigin(0.5);
        this.add.text(285, 25, '🪙', { fontSize: '14px' }).setOrigin(0.5);
        this.coinsText = this.add.text(330, 25, '0', { fontSize: '14px', fontFamily: 'monospace', color: '#fff' }).setOrigin(0.5);
        this.add.text(285, 50, '🥚', { fontSize: '14px' }).setOrigin(0.5);
        this.eggsText = this.add.text(330, 50, '0', { fontSize: '14px', fontFamily: 'monospace', color: '#fff' }).setOrigin(0.5);

        // 正上方：產蛋倒數計時器
        this.timerBg = this.add.rectangle(cx, 90, 200, 30, 0x000000, 0.6).setOrigin(0.5);
        this.timerText = this.add.text(cx, 90, '連線中...', { fontSize: '15px', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        // 初始化與監聽
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
        const targetY = Phaser.Math.Between(250, 700);
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
        const nestY = this.cameras.main.centerY - 50;
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
                setDoc(myFarmRef, { farm: { coins: 0, inventoryEggs: 0, hens: 1, eggsReady: 0, lastLayTime: Date.now() } }, { merge: true });
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
        this.eggsText.setText(`${this.farmData.inventoryEggs || 0}`);
        
        // 雞舍內的小雞蛋圖示
        this.coopEgg.setVisible(this.farmData.eggsReady > 0);
    }

    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;

            // 1. 檢查離線/背景生蛋邏輯
            const now = Date.now();
            const elapsed = now - this.farmData.lastLayTime;
            const eggsToProduce = Math.floor(elapsed / LAY_EGG_TIME_MS);
            
            if (eggsToProduce > 0 && this.farmData.eggsReady < MAX_EGGS_PER_DAY) {
                const actualLaid = Math.min(eggsToProduce, MAX_EGGS_PER_DAY - this.farmData.eggsReady);
                setDoc(myFarmRef, {
                    "farm.eggsReady": this.farmData.eggsReady + actualLaid,
                    "farm.lastLayTime": this.farmData.lastLayTime + (actualLaid * LAY_EGG_TIME_MS)
                }, { merge: true });
            }
            // 2. 更新畫面倒數 UI
            if (this.farmData.eggsReady >= MAX_EGGS_PER_DAY) {
                this.timerText.setText('🥚 產能已滿 (6/6)');
                this.timerText.setColor('#A5D6A7');
            } else {
                let timeLeft = LAY_EGG_TIME_MS - (Date.now() - this.farmData.lastLayTime);
                if (timeLeft < 0) timeLeft = 0;
                
                const h = Math.floor(timeLeft / 3600000);
                const m = Math.floor((timeLeft % 3600000) / 60000).toString().padStart(2, '0');
                const s = Math.floor((timeLeft % 60000) / 1000).toString().padStart(2, '0');
                this.timerText.setText(`下顆蛋倒數: ${h}:${m}:${s}`);
                this.timerText.setColor('#FFD54F');
            }
        }, 1000);
    }

    async harvestEgg() {
        if (!this.farmData || this.farmData.eggsReady <= 0) {
            this.emptyClickCount++;
            if (this.emptyClickTimer) this.emptyClickTimer.remove();
            this.emptyClickTimer = this.time.delayedCall(2000, () => this.emptyClickCount = 0);

            if (this.emptyClickCount >= 5) {
                this.showFloatingText('就跟你說沒有蛋了還一直點~咕咕💢', '#F44336', 16); 
                this.hen.setTint(0xff0000); 
                this.time.delayedCall(500, () => this.hen.clearTint());
                this.tweens.add({ targets: this.hen, y: this.hen.y - 25, duration: 100, yoyo: true, repeat: 1 });
                this.emptyClickCount = 0;
            } else {
                this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff', 20);
            }
            return;
        }

        this.emptyClickCount = 0;
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(myFarmRef);
                const farm = docSnap.data().farm;
                if (farm.eggsReady > 0) {
                    transaction.update(myFarmRef, {
                        "farm.inventoryEggs": (farm.inventoryEggs || 0) + farm.eggsReady,
                        "farm.eggsReady": 0,
                        "farm.lastLayTime": Date.now() // 收成後重置下蛋時間，避免爆發
                    });
                }
            });
            this.showFloatingText(`+${this.farmData.eggsReady} 🥚`, '#FFD54F', 22);
        } catch (e) { console.error(e); }
    }

    showFloatingText(msg, color, fontSize = 22) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 60, alpha: 0, duration: 1200, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 C：村落大廳 (Lobby) ---
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);

        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(195, 50, '🗺️ 咕咕村落', { fontSize: '24px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        const btnHome = this.add.rectangle(330, 50, 80, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(330, 50, '🏠 返回', { fontSize: '15px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
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

            if (index === 0) {
                this.add.text(195, 320, '群組內還沒有其他鄰居喔！', { fontSize: '16px', color: '#fff' }).setOrigin(0.5);
            }
        } catch (e) {
            this.loadingText.setText('載入失敗，請檢查網路');
        }
    }

    showFloatingText(x, y, msg, color) {
        const floatTxt = this.add.text(x, y - 40, msg, { fontSize: '14px', fontFamily: 'sans-serif', color: color, fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 D：拜訪與偷蛋 (Visit) ---
class VisitScene extends Phaser.Scene {
    constructor() { super({ key: 'VisitScene' }); }

    init(data) {
        this.targetAccountId = data.targetAccountId; 
        this.targetName = data.targetName;
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.targetFarmData = null;

        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 100, 'coop').setOrigin(0.5);
        this.coopEgg = this.add.image(cx, cy - 60, 'egg').setScale(0.8).setOrigin(0.5).setDepth(6).setVisible(false);

        this.hen = this.add.image(cx, cy + 50, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting && this.emptyClickCount < 4) {
                this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            }
            this.attemptSteal(); 
        });

        this.add.rectangle(195, 50, 240, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(195, 50, `潛入 [${this.targetName}] 的家`, { fontSize: '16px', fontFamily: 'sans-serif', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        const btnBack = this.add.rectangle(55, 50, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 50, '❮ 溜走', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('LobbyScene'));

        this.initFirebase();
        this.startHenRoutine(); 
        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    startHenRoutine() {
        this.time.addEvent({ delay: 25000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });
        this.wanderHen();
    }
    wanderHen() {
        if (this.isHenSitting || !this.hen || !this.hen.active) return;
        const targetX = Phaser.Math.Between(50, 340);
        const targetY = Phaser.Math.Between(250, 700);
        this.hen.setFlipX(targetX < this.hen.x);
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, targetX, targetY);
        this.walkTween = this.tweens.add({
            targets: this.hen, x: targetX, y: targetY, duration: distance * 20, ease: 'Linear',
            onComplete: () => { if (!this.isHenSitting) this.time.delayedCall(2000, () => this.wanderHen()); }
        });
        this.waddleTween = this.tweens.add({ targets: this.hen, y: '-=6', duration: 150, yoyo: true, repeat: Math.floor((distance * 20) / 300) });
    }
    prepareToLayEgg() {
        this.isHenSitting = true;
        if (this.walkTween) this.walkTween.stop();
        if (this.waddleTween) this.waddleTween.stop();
        const nestX = this.cameras.main.centerX;
        const nestY = this.cameras.main.centerY - 50;
        this.hen.setFlipX(nestX < this.hen.x);
        this.tweens.add({
            targets: this.hen, x: nestX, y: nestY, duration: Phaser.Math.Distance.Between(this.hen.x, this.hen.y, nestX, nestY) * 15, ease: 'Linear',
            onComplete: () => {
                this.tweens.add({ targets: this.hen, scaleY: 0.7, scaleX: 1.15, y: nestY + 15, duration: 300, onComplete: () => {
                    this.time.delayedCall(4000, () => {
                        this.tweens.add({ targets: this.hen, scaleY: 1, scaleX: 1, y: nestY, duration: 300, onComplete: () => { this.isHenSitting = false; this.wanderHen(); } });
                    });
                }});
            }
        });
    }
    initFirebase() {
        // 嚴格綁定目標的 accountId
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        this.unsubscribe = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.coopEgg.setVisible(this.targetFarmData.eggsReady > 0);
            }
        });
    }

    async attemptSteal() {
        const myDocSnap = await getDoc(myFarmRef);
        const myFarmData = myDocSnap.data()?.farm || {};
        
        // 檢查防偷竊冷卻時間 (1 小時 CD)
        if (myFarmData.lastStealTime && Date.now() - myFarmData.lastStealTime < STEAL_COOLDOWN_MS) {
            const leftMs = STEAL_COOLDOWN_MS - (Date.now() - myFarmData.lastStealTime);
            const leftMins = Math.ceil(leftMs / 60000);
            this.showFloatingText(`還在被警察追！\n請等 ${leftMins} 分鐘`, '#F44336', 15);
            return;
        }

        if (!this.targetFarmData || this.targetFarmData.eggsReady <= 0) {
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
                this.showFloatingText('人家現在沒蛋啦！', '#ffffff', 18);
            }
            return;
        }

        this.emptyClickCount = 0;
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);

        try {
            await runTransaction(db, async (transaction) => {
                const targetDoc = await transaction.get(targetRef);
                const myDoc = await transaction.get(myFarmRef);
                const targetFarm = targetDoc.data().farm;
                const myFarm = myDoc.data().farm || { inventoryEggs: 0 };

                if (!targetFarm || targetFarm.eggsReady <= 0) throw "手腳太慢，蛋不見了！";
                
                if (Math.random() > STEAL_SUCCESS_RATE) {
                    // 偷竊失敗也會進入冷卻
                    transaction.update(myFarmRef, { "farm.lastStealTime": Date.now() });
                    throw "被狗咬了！偷竊失敗！";
                }

                transaction.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
                transaction.update(myFarmRef, { 
                    "farm.inventoryEggs": (myFarm.inventoryEggs || 0) + 1,
                    "farm.lastStealTime": Date.now() // 偷竊成功進入冷卻
                });
            });
            this.showFloatingText('😎 偷到 +1 🥚', '#FFD54F', 18);
        } catch (error) {
            this.showFloatingText(`🐕 ${error}`, '#F44336', 16);
            this.cameras.main.shake(300, 0.01);
        }
    }

    showFloatingText(msg, color, fontSize = 22) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3, align: 'center' }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 60, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 E：商店系統 (Shop) ---
class ShopScene extends Phaser.Scene {
    constructor() { super({ key: 'ShopScene' }); }

    create() {
        this.add.tileSprite(0, 0, 390, 844, 'grass').setOrigin(0, 0);

        // 標題
        this.add.rectangle(195, 60, 240, 50, 0x000000, 0.7).setOrigin(0.5);
        this.add.text(195, 60, '🛒 咕咕莊園商店', { fontSize: '22px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        // 返回按鈕
        const btnBack = this.add.rectangle(55, 60, 70, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(55, 60, '❮ 返回', { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('MyFarmScene'));

        // 顯示持有資產區塊
        this.add.rectangle(195, 150, 280, 100, 0x000000, 0.5).setOrigin(0.5);
        this.assetText = this.add.text(195, 150, '讀取中...', { fontSize: '16px', color: '#FFD54F', align: 'center', lineHeight: 1.5 }).setOrigin(0.5);

        // 賣出按鈕
        const btnSell = this.add.rectangle(195, 260, 260, 60, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(195, 260, `🥚 賣出雞蛋 (+${EGG_PRICE} 🪙)`, { fontSize: '18px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnSell.on('pointerdown', () => this.sellEgg());

        // 買進按鈕
        const btnBuy = this.add.rectangle(195, 340, 260, 60, 0xE53935, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(195, 340, `🐔 買進母雞 (-${HEN_PRICE} 🪙)`, { fontSize: '18px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBuy.on('pointerdown', () => this.buyHen());

        // 交易回饋訊息區
        this.msgText = this.add.text(195, 420, '', { fontSize: '16px', fontStyle: 'bold', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5);

        this.initFirebase();
        this.events.on('shutdown', () => { if (this.unsubscribe) this.unsubscribe(); });
    }

    initFirebase() {
        this.unsubscribe = onSnapshot(myFarmRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.farmData = docSnap.data().farm;
                this.assetText.setText(`持有金幣: ${this.farmData.coins || 0} 🪙\n持有雞蛋: ${this.farmData.inventoryEggs || 0} 🥚\n持有母雞: ${this.farmData.hens || 1} 🐔`);
            }
        });
    }

    showMsg(msg, color) {
        this.msgText.setText(msg).setColor(color).setAlpha(1);
        this.tweens.add({ targets: this.msgText, alpha: 0, duration: 2000, delay: 1000 });
    }

    async sellEgg() {
        if (!this.farmData || (this.farmData.inventoryEggs || 0) < 1) {
            this.showMsg('雞蛋不足，無法賣出！', '#F44336');
            return;
        }
        try {
            await runTransaction(db, async (t) => {
                const docSnap = await t.get(myFarmRef);
                const farm = docSnap.data().farm;
                if (farm.inventoryEggs > 0) {
                    t.update(myFarmRef, {
                        "farm.inventoryEggs": farm.inventoryEggs - 1,
                        "farm.coins": (farm.coins || 0) + EGG_PRICE
                    });
                }
            });
            this.showMsg(`賣出成功！獲得 ${EGG_PRICE} 金幣`, '#4CAF50');
        } catch (e) { console.error(e); }
    }

    async buyHen() {
        if (!this.farmData || (this.farmData.coins || 0) < HEN_PRICE) {
            this.showMsg(`金幣不足 ${HEN_PRICE}，無法購買！`, '#F44336');
            return;
        }
        try {
            await runTransaction(db, async (t) => {
                const docSnap = await t.get(myFarmRef);
                const farm = docSnap.data().farm;
                if (farm.coins >= HEN_PRICE) {
                    t.update(myFarmRef, {
                        "farm.coins": farm.coins - HEN_PRICE,
                        "farm.hens": (farm.hens || 1) + 1
                    });
                }
            });
            this.showMsg('購買成功！母雞數量 +1', '#FFD54F');
        } catch (e) { console.error(e); }
    }
}

// ==========================================
// 3. 啟動 Phaser 遊戲引擎 (手機滿版設定)
// ==========================================
const config = {
    type: Phaser.AUTO,
    scale: {
        mode: Phaser.Scale.FIT,       // 自動等比例縮放以適應螢幕
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 390,                   // 基準寬度 (對應 iPhone 13~17 系列寬度)
        height: 844                   // 基準高度
    },
    parent: 'game-container', 
    pixelArt: true, 
    scene: [BootScene, MyFarmScene, LobbyScene, VisitScene, ShopScene] 
};

const game = new Phaser.Game(config);
