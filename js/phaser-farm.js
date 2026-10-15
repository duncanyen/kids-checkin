import { db } from './firebase-config.js'; 
import { doc, onSnapshot, runTransaction, setDoc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// 1. Firebase 用戶驗證與設定
// ==========================================
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

if (!currentUser) {
    alert('請先選擇使用者登入！');
    window.location.href = 'index.html';
    throw new Error("未登入"); 
}

const CURRENT_GROUP_ID = currentUser.groupId || "default_group";
const CURRENT_ACCOUNT_ID = currentUser.name; 
const myFarmRef = doc(db, "groups", CURRENT_GROUP_ID, "users", CURRENT_ACCOUNT_ID);

document.getElementById('playerName').innerText = CURRENT_ACCOUNT_ID;

const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
const MAX_EGGS_PER_DAY = 6;
const STEAL_SUCCESS_RATE = 0.7;

// ==========================================
// 2. Phaser 遊戲場景架構
// ==========================================

// --- 場景 A：啟動與資源生成 ---
class BootScene extends Phaser.Scene {
    constructor() { super({ key: 'BootScene' }); }

    create() {
        const palette = {
            '1': '#FFFFFF', '2': '#E53935', '3': '#FBC02D', '4': '#000000', 
            '7': '#FDD835', '8': '#BDBDBD', '9': '#7CB342', 'A': '#689F38', 
            'C': '#D32F2F', 'D': '#B71C1C', 'E': '#FFF59D', 'F': '#8D6E63', 
            'G': '#5D4037', 'H': '#212121', 'I': '#81D4FA', 'J': '#1976D2' // J: 藍色屋頂(鄰居)
        };

        this.textures.generate('grass', { data: ['99999999', '9A999999', '9999A999', '99999999', '99A99999', '999999A9', '99999999', '9999A999'], pixelWidth: 8, palette: palette });
        this.textures.generate('hen', { data: ['......1111..', '......1411..', '......1111..', '......111133', '....11111122', '....111111..', '..11118811..', '..11118811..', '....118811..', '....111111..', '......3..3..', '......3..3..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coop', { data: ['......CCCC......', '....CCCCCCCC....', '..CCCCCCCCCCCC..', '.CCCCCCCCCCCCCC.', 'DDDDDDDDDDDDDDDD', '..FGFGFGFGFGFG..', '..GFFGFGFGFFGF..', '..FGFGIIIIFGFG..', '..GFFGIIIIFFGF..', '..FGFGFFFFFGFG..', '..GFFGHHHHFFGF..', '..FGFGHHHHFGFG..', '..GFFHEEEEHFFG..', '..FGFHEEEEFGFG..', '..GFFGFGFGFFGF..'], pixelWidth: 10, palette: palette });
        this.textures.generate('egg', { data: ['..11..', '.1111.', '111111', '111118', '.1118.', '..88..'], pixelWidth: 6, palette: palette });
        this.textures.generate('coin', { data: ['.777.', '77177', '71777', '77777', '.777.'], pixelWidth: 4, palette: palette });
        
        // 鄰居地圖上的專屬小屋 (藍色系，較小)
        this.textures.generate('mini_house', { data: ['....JJJJ....', '...JJJJJJ...', '..JJJJJJJJ..', '.JJJJJJJJJJ.', 'DDDDDDDDDDDD', '...FGFGFG...', '...GFF4FG...', '...FGFGFG...', '...GFFGFG...'], pixelWidth: 8, palette: palette });

        // 生成完畢，直接進入自己的農莊
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

        this.add.tileSprite(0, 0, 480, 640, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 80, 'coop').setOrigin(0.5);
        
        this.egg = this.add.image(cx, cy - 10, 'egg').setOrigin(0.5);
        this.egg.setDepth(5).setVisible(false);

        this.hen = this.add.image(cx, cy + 60, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting && this.emptyClickCount < 4) {
                this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            }
            this.harvestEgg();
        });

        // 左上角 UI
        this.add.rectangle(70, 30, 120, 70, 0x000000, 0.5).setOrigin(0.5);
        this.add.image(30, 20, 'coin').setOrigin(0.5);
        this.coinsText = this.add.text(50, 10, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });
        this.add.image(30, 45, 'egg').setScale(0.7).setOrigin(0.5);
        this.eggsText = this.add.text(50, 35, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });

        // 右上角：「前往大廳」按鈕
        const btnLobby = this.add.rectangle(400, 30, 120, 40, 0x1976D2, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(400, 30, '🗺️ 村落大廳', { fontSize: '16px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnLobby.on('pointerdown', () => {
            this.scene.start('LobbyScene');
        });

        this.promptBg = this.add.rectangle(cx, cy - 200, 280, 40, 0x000000, 0.6).setOrigin(0.5).setVisible(false);
        this.statusText = this.add.text(cx, cy - 200, '', { fontSize: '18px', fontFamily: 'sans-serif', color: '#A5D6A7' }).setOrigin(0.5).setVisible(false);

        this.initFirebase();
        this.startHenRoutine(); 
        
        // 切換場景時清理監聽器
        this.events.on('shutdown', () => {
            if (this.unsubscribe) this.unsubscribe();
            if (this.farmInterval) clearInterval(this.farmInterval);
        });
    }

    // AI 走路邏輯 (與上版相同)
    startHenRoutine() {
        this.time.addEvent({ delay: 30000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });
        this.wanderHen();
    }
    wanderHen() {
        if (this.isHenSitting || !this.hen || !this.hen.active) return;
        const targetX = Phaser.Math.Between(80, 400);
        const targetY = Phaser.Math.Between(250, 550);
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
        const nestY = this.cameras.main.centerY - 20;
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
                setDoc(myFarmRef, { farm: { coins: 0, inventoryEggs: 0, hens: 1, eggsReady: 0, todayLaid: 0, lastLayTime: Date.now() } }, { merge: true });
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

        if (this.farmData.eggsReady > 0) {
            this.egg.setVisible(true); 
            this.statusText.setText(`產了 ${this.farmData.eggsReady} 顆蛋！(點擊母雞收成)`);
            this.statusText.setVisible(true);
            this.promptBg.setVisible(true);
        } else {
            this.egg.setVisible(false); 
            this.statusText.setVisible(false);
            this.promptBg.setVisible(false);
        }
    }

    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        this.farmInterval = setInterval(() => {
            if (!this.farmData || this.farmData.eggsReady > 0 || this.farmData.todayLaid >= MAX_EGGS_PER_DAY) return;
            const timeLeft = LAY_EGG_TIME_MS - (Date.now() - this.farmData.lastLayTime);
            if (timeLeft <= 0) {
                setDoc(myFarmRef, { "farm.eggsReady": this.farmData.eggsReady + 1, "farm.lastLayTime": Date.now() }, { merge: true });
                clearInterval(this.farmInterval);
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
                this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff', 22);
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
                        "farm.lastLayTime": Date.now()
                    });
                }
            });
            this.showFloatingText('+1 🥚', '#FFD54F', 22);
        } catch (e) { console.error(e); }
    }

    showFloatingText(msg, color, fontSize = 22) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 60, alpha: 0, duration: 1200, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 C：村落大廳 (Lobby) ---
class LobbyScene extends Phaser.Scene {
    constructor() { super({ key: 'LobbyScene' }); }

    create() {
        this.add.tileSprite(0, 0, 480, 640, 'grass').setOrigin(0, 0);

        // 大廳標題
        this.add.rectangle(240, 40, 240, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(240, 40, '🗺️ 咕咕村莊大廳', { fontSize: '24px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);

        // 右上角：「回自己農莊」按鈕
        const btnHome = this.add.rectangle(400, 40, 100, 40, 0x4CAF50, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(400, 40, '🏠 回我家', { fontSize: '16px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnHome.on('pointerdown', () => this.scene.start('MyFarmScene'));

        this.loadingText = this.add.text(240, 320, '正在尋找鄰居...', { fontSize: '20px', color: '#fff' }).setOrigin(0.5);
        
        this.loadNeighbors();
    }

    async loadNeighbors() {
        try {
            // 從 users 集合抓取同群組的所有成員
            const q = query(collection(db, "users"), where("groupId", "==", CURRENT_GROUP_ID));
            const querySnapshot = await getDocs(q);
            
            this.loadingText.destroy();
            
            let index = 0;
            const startX = 100, startY = 150, spacingX = 140, spacingY = 130;

            querySnapshot.forEach((docSnap) => {
                const memberName = docSnap.data().name;
                if (!memberName || memberName === CURRENT_ACCOUNT_ID) return; // 不顯示自己

                // 計算網格位置 (每行 3 個)
                const col = index % 3;
                const row = Math.floor(index / 3);
                const x = startX + col * spacingX;
                const y = startY + row * spacingY;

                // 畫出像素小屋
                const house = this.add.image(x, y, 'mini_house').setOrigin(0.5).setInteractive({ cursor: 'pointer' });
                // 名稱告示牌
                this.add.rectangle(x, y + 45, 90, 24, 0x000000, 0.5).setOrigin(0.5);
                this.add.text(x, y + 45, memberName, { fontSize: '14px', fontFamily: 'sans-serif', color: '#fff' }).setOrigin(0.5);

                // 點擊小屋的互動
                house.on('pointerdown', async () => {
                    house.setTint(0xcccccc);
                    this.time.delayedCall(100, () => house.clearTint());
                    
                    // 檢查對方是否已經開通農莊
                    const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", memberName);
                    const targetSnap = await getDoc(targetRef);
                    
                    if (targetSnap.exists() && targetSnap.data().farm) {
                        // 有開通，前往拜訪偷蛋！
                        this.scene.start('VisitScene', { targetName: memberName });
                    } else {
                        // 尚未開通
                        this.showFloatingText(x, y, '雜草叢生\n尚未啟用！', '#FFCDD2');
                    }
                });

                index++;
            });

            if (index === 0) {
                this.add.text(240, 320, '群組內還沒有其他鄰居喔！', { fontSize: '18px', color: '#fff' }).setOrigin(0.5);
            }
        } catch (e) {
            console.error("載入鄰居失敗", e);
            this.loadingText.setText('載入失敗，請檢查網路');
        }
    }

    showFloatingText(x, y, msg, color) {
        const floatTxt = this.add.text(x, y - 40, msg, { fontSize: '14px', fontFamily: 'sans-serif', color: color, fontStyle: 'bold', align: 'center', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 40, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}

// --- 場景 D：拜訪與偷蛋 (Visit) ---
class VisitScene extends Phaser.Scene {
    constructor() { super({ key: 'VisitScene' }); }

    init(data) {
        this.targetName = data.targetName; // 接收要拜訪的對象名字
    }
    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;
        this.isHenSitting = false;
        this.emptyClickCount = 0;
        this.targetFarmData = null;

        this.add.tileSprite(0, 0, 480, 640, 'grass').setOrigin(0, 0);
        this.coop = this.add.image(cx, cy - 80, 'coop').setOrigin(0.5);
        
        this.egg = this.add.image(cx, cy - 10, 'egg').setOrigin(0.5).setDepth(5).setVisible(false);

        // 別人的母雞
        this.hen = this.add.image(cx, cy + 60, 'hen').setOrigin(0.5).setDepth(10).setInteractive({ cursor: 'pointer' }); 
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting && this.emptyClickCount < 4) {
                this.tweens.add({ targets: this.hen, y: this.hen.y - 15, scaleX: 1.1, scaleY: 0.9, duration: 100, yoyo: true });
            }
            this.attemptSteal(); // 改為偷竊邏輯
        });

        // 頂部標題：顯示正在拜訪誰
        this.add.rectangle(240, 40, 300, 50, 0x000000, 0.6).setOrigin(0.5);
        this.add.text(240, 40, `偷偷潛入 [${this.targetName}] 的農莊`, { fontSize: '18px', fontFamily: 'sans-serif', color: '#FFD54F', fontStyle: 'bold' }).setOrigin(0.5);

        // 返回大廳按鈕
        const btnBack = this.add.rectangle(60, 40, 80, 40, 0x757575, 0.9).setOrigin(0.5).setInteractive({ cursor: 'pointer' });
        this.add.text(60, 40, '❮ 溜走', { fontSize: '16px', fontFamily: 'sans-serif', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
        btnBack.on('pointerdown', () => this.scene.start('LobbyScene'));

        this.initFirebase();
        this.startHenRoutine(); // 鄰居的母雞也會走路
        
        this.events.on('shutdown', () => {
            if (this.unsubscribe) this.unsubscribe();
        });
    }

    startHenRoutine() {
        this.time.addEvent({ delay: 25000, callback: this.prepareToLayEgg, callbackScope: this, loop: true });
        this.wanderHen();
    }
    wanderHen() {
        if (this.isHenSitting || !this.hen || !this.hen.active) return;
        const targetX = Phaser.Math.Between(80, 400);
        const targetY = Phaser.Math.Between(250, 550);
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
        const nestY = this.cameras.main.centerY - 20;
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
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetName);
        this.unsubscribe = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.egg.setVisible(this.targetFarmData.eggsReady > 0);
            }
        });
    }

    async attemptSteal() {
        if (!this.targetFarmData || this.targetFarmData.eggsReady <= 0) {
            // 鄰居家沒蛋，連點一樣會觸發生氣彩蛋
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
                this.showFloatingText('人家現在沒蛋啦！', '#ffffff', 20);
            }
            return;
        }

        this.emptyClickCount = 0;
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetName);

        try {
            await runTransaction(db, async (transaction) => {
                const targetDoc = await transaction.get(targetRef);
                const myDoc = await transaction.get(myFarmRef);
                const targetFarm = targetDoc.data().farm;
                const myFarm = myDoc.data().farm || { inventoryEggs: 0 };

                if (!targetFarm || targetFarm.eggsReady <= 0) throw "手腳太慢，蛋不見了！";
                if (Math.random() > STEAL_SUCCESS_RATE) throw "被狗咬了！偷竊失敗！"; // 30% 失敗機率

                transaction.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
                transaction.update(myFarmRef, { "farm.inventoryEggs": (myFarm.inventoryEggs || 0) + 1 });
            });
            this.showFloatingText('😎 神不知鬼不覺！偷到 +1 🥚', '#FFD54F', 18);
        } catch (error) {
            this.showFloatingText(`🐕 ${error}`, '#F44336', 18);
            // 偷竊失敗的震動特效
            this.cameras.main.shake(300, 0.01);
        }
    }

    showFloatingText(msg, color, fontSize = 22) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { fontSize: `${fontSize}px`, fontFamily: 'monospace', color: color, fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
        this.tweens.add({ targets: floatTxt, y: floatTxt.y - 60, alpha: 0, duration: 1500, onComplete: () => floatTxt.destroy() });
    }
}

// ==========================================
// 3. 啟動 Phaser 遊戲引擎
// ==========================================
const config = {
    type: Phaser.AUTO,
    width: 480,       
    height: 640,      
    parent: 'game-container', 
    pixelArt: true, 
    scene: [BootScene, MyFarmScene, LobbyScene, VisitScene] 
};

const game = new Phaser.Game(config);
