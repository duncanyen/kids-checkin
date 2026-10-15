import { db } from './firebase-config.js'; 
import { doc, onSnapshot, runTransaction, setDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; // 4 小時
const MAX_EGGS_PER_DAY = 6;

// ==========================================
// 2. Phaser 遊戲場景
// ==========================================
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.farmData = null;
        this.farmInterval = null;
        this.isHenSitting = false; 
        
        // 新增：母雞生氣計數系統
        this.emptyClickCount = 0;
        this.emptyClickTimer = null;
    }

    preload() {
        const palette = {
            '1': '#FFFFFF', // 白 (母雞身體)
            '2': '#E53935', // 紅 (肉垂)
            '3': '#FBC02D', // 黃 (嘴/腳)
            '4': '#000000', // 黑 (眼睛)
            '7': '#FDD835', // 金黃色 (金幣)
            '8': '#BDBDBD', // 灰白 (翅膀陰影)
            '9': '#7CB342', // 淺草地
            'A': '#689F38', // 深草地
            'C': '#D32F2F', // 紅色屋頂
            'D': '#B71C1C', // 屋頂陰影
            'E': '#FFF59D', // 乾草
            'F': '#8D6E63', // 淺木頭
            'G': '#5D4037', // 深木頭
            'H': '#212121', // 雞舍內部黑影
            'I': '#81D4FA'  // 窗戶玻璃
        };

        this.textures.generate('grass', {
            data: [
                '99999999', '9A999999', '9999A999', '99999999',
                '99A99999', '999999A9', '99999999', '9999A999'
            ],
            pixelWidth: 8,
            palette: palette
        });

        this.textures.generate('hen', {
            data: [
                '......1111..', 
                '......1411..', 
                '......1111..', 
                '......111133', 
                '....11111122', 
                '....111111..', 
                '..11118811..', 
                '..11118811..', 
                '....118811..', 
                '....111111..', 
                '......3..3..', 
                '......3..3..'  
            ],
            pixelWidth: 6,
            palette: palette
        });

        this.textures.generate('coop', {
            data: [
                '......CCCC......',
                '....CCCCCCCC....',
                '..CCCCCCCCCCCC..',
                '.CCCCCCCCCCCCCC.',
                'DDDDDDDDDDDDDDDD',
                '..FGFGFGFGFGFG..',
                '..GFFGFGFGFFGF..',
                '..FGFGIIIIFGFG..',
                '..GFFGIIIIFFGF..',
                '..FGFGFFFFFGFG..',
                '..GFFGHHHHFFGF..',
                '..FGFGHHHHFGFG..',
                '..GFFHEEEEHFFG..',
                '..FGFHEEEEFGFG..',
                '..GFFGFGFGFFGF..'
            ],
            pixelWidth: 10,
            palette: palette
        });

        this.textures.generate('egg', {
            data: [
                '..11..', '.1111.', '111111',
                '111118', '.1118.', '..88..'
            ],
            pixelWidth: 6,
            palette: palette
        });
        
        this.textures.generate('coin', {
            data: [
                '.777.', '77177', '71777', '77777', '.777.'
            ],
            pixelWidth: 4,
            palette: palette
        });
    }

    create() {
        const cx = this.cameras.main.centerX;
        const cy = this.cameras.main.centerY;

        this.add.tileSprite(0, 0, 480, 640, 'grass').setOrigin(0, 0);

        this.coop = this.add.image(cx, cy - 80, 'coop').setOrigin(0.5);

        this.egg = this.add.image(cx, cy - 10, 'egg').setOrigin(0.5);
        this.egg.setDepth(5); 
        this.egg.setVisible(false);

        this.hen = this.add.image(cx, cy + 60, 'hen').setOrigin(0.5);
        this.hen.setDepth(10); 
        this.hen.setInteractive({ cursor: 'pointer' }); 
        
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting) {
                // 普通的點擊跳動特效 (如果沒生氣的話)
                if (this.emptyClickCount < 4) {
                    this.tweens.add({
                        targets: this.hen,
                        y: this.hen.y - 15,
                        scaleX: 1.1,
                        scaleY: 0.9,
                        duration: 100,
                        yoyo: true
                    });
                }
            }
            this.harvestEgg();
        });

        this.add.rectangle(70, 30, 120, 70, 0x000000, 0.5).setOrigin(0.5);
        this.add.image(30, 20, 'coin').setOrigin(0.5);
        this.coinsText = this.add.text(50, 10, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });
        
        this.add.image(30, 45, 'egg').setScale(0.7).setOrigin(0.5);
        this.eggsText = this.add.text(50, 35, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });

        this.promptBg = this.add.rectangle(cx, cy - 200, 280, 40, 0x000000, 0.6).setOrigin(0.5);
        this.statusText = this.add.text(cx, cy - 200, '', { 
            fontSize: '18px', fontFamily: 'sans-serif', color: '#A5D6A7'
        }).setOrigin(0.5);
        this.promptBg.setVisible(false);
        this.statusText.setVisible(false);

        this.initFirebase();
        this.startHenRoutine(); 
    }

    startHenRoutine() {
        this.time.addEvent({
            delay: 30000, 
            callback: this.prepareToLayEgg,
            callbackScope: this,
            loop: true
        });
        
        this.wanderHen();
    }

    wanderHen() {
        if (this.isHenSitting) return;

        const targetX = Phaser.Math.Between(80, 400);
        const targetY = Phaser.Math.Between(250, 550);

        this.hen.setFlipX(targetX < this.hen.x);

        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, targetX, targetY);
        const duration = distance * 20; 

        this.walkTween = this.tweens.add({
            targets: this.hen,
            x: targetX,
            y: targetY,
            duration: duration,
            ease: 'Linear',
            onComplete: () => {
                if (this.isHenSitting) return;
                this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => {
                    this.wanderHen();
                });
            }
        });

        this.waddleTween = this.tweens.add({
            targets: this.hen,
            y: '-=6',
            duration: 150,
            yoyo: true,
            repeat: Math.floor(duration / 300)
        });
    }

    prepareToLayEgg() {
        this.isHenSitting = true;
        
        if (this.walkTween) this.walkTween.stop();
        if (this.waddleTween) this.waddleTween.stop();

        const nestX = this.cameras.main.centerX;
        const nestY = this.cameras.main.centerY - 20;

        this.hen.setFlipX(nestX < this.hen.x);
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, nestX, nestY);
        
        this.tweens.add({
            targets: this.hen,
            x: nestX,
            y: nestY,
            duration: distance * 15,
            ease: 'Linear',
            onComplete: () => {
                this.tweens.add({
                    targets: this.hen,
                    scaleY: 0.7,   
                    scaleX: 1.15,  
                    y: nestY + 15, 
                    duration: 300,
                    ease: 'Power2',
                    onComplete: () => {
                        this.time.delayedCall(5000, () => {
                            this.tweens.add({
                                targets: this.hen,
                                scaleY: 1,
                                scaleX: 1,
                                y: nestY,
                                duration: 300,
                                onComplete: () => {
                                    this.isHenSitting = false;
                                    this.wanderHen(); 
                                }
                            });
                        });
                    }
                });
            }
        });
    }

    initFirebase() {
        onSnapshot(myFarmRef, (docSnap) => {
            if (!docSnap.exists() || !docSnap.data().farm) {
                setDoc(myFarmRef, {
                    farm: { coins: 0, inventoryEggs: 0, hens: 1, eggsReady: 0, todayLaid: 0, lastLayTime: Date.now() }
                }, { merge: true });
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
            if (!this.farmData) return;
            
            if (this.farmData.eggsReady > 0 || this.farmData.todayLaid >= MAX_EGGS_PER_DAY) {
                return; 
            }

            const timeLeft = LAY_EGG_TIME_MS - (Date.now() - this.farmData.lastLayTime);
            
            if (timeLeft <= 0) {
                setDoc(myFarmRef, {
                    "farm.eggsReady": this.farmData.eggsReady + 1,
                    "farm.lastLayTime": Date.now()
                }, { merge: true });
                clearInterval(this.farmInterval);
            }
        }, 1000);
    }

    async harvestEgg() {
        if (!this.farmData || this.farmData.eggsReady <= 0) {
            // 🌟 這裡實作母雞生氣的邏輯 🌟
            this.emptyClickCount++;

            // 清除之前的重置計時器，確保連點計數有效
            if (this.emptyClickTimer) {
                this.emptyClickTimer.remove();
            }

            // 如果超過 2 秒沒點擊，就把計數器歸零
            this.emptyClickTimer = this.time.delayedCall(2000, () => {
                this.emptyClickCount = 0;
            });

            if (this.emptyClickCount >= 5) {
                // 生氣演出：飄出生氣文字
                this.showFloatingText('就跟你說沒有蛋了還一直點~咕咕💢', '#F44336', 16); 
                
                // 生氣演出：母雞變紅 500 毫秒
                this.hen.setTint(0xff0000); 
                this.time.delayedCall(500, () => this.hen.clearTint());

                // 生氣演出：快速憤怒跳躍
                this.tweens.add({
                    targets: this.hen,
                    y: this.hen.y - 25,
                    duration: 100,
                    yoyo: true,
                    repeat: 1
                });
                
                // 重置計數，要再點 5 下才會再次暴走
                this.emptyClickCount = 0;
            } else {
                // 普通沒蛋的提示
                this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff', 22);
            }
            return;
        }

        // 如果成功收成，把計數器與計時器歸零
        this.emptyClickCount = 0;
        if (this.emptyClickTimer) this.emptyClickTimer.remove();

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
        } catch (e) {
            console.error("收成失敗:", e);
        }
    }

    showFloatingText(msg, color, fontSize = 22) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { 
            fontSize: `${fontSize}px`, 
            fontFamily: 'monospace', 
            color: color, 
            fontStyle: 'bold',
            stroke: '#000000',
            strokeThickness: 3
        }).setOrigin(0.5);
        floatTxt.setDepth(20);

        this.tweens.add({
            targets: floatTxt,
            y: floatTxt.y - 60,
            alpha: 0,
            duration: 1200,
            onComplete: () => floatTxt.destroy()
        });
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
    scene: [MainScene] 
};

const game = new Phaser.Game(config);
