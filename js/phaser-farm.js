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
        this.isHenSitting = false; // 判斷母雞狀態
    }

    preload() {
        // 定義更豐富的像素調色盤 (Palette)
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

        // 1. 生成草地
        this.textures.generate('grass', {
            data: [
                '99999999', '9A999999', '9999A999', '99999999',
                '99A99999', '999999A9', '99999999', '9999A999'
            ],
            pixelWidth: 8,
            palette: palette
        });

        // 2. 生成 Minecraft 母雞 (側視圖)
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

        // 3. 生成精緻版雞舍 (紅色穀倉風格)
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

        // 4. 生成雞蛋
        this.textures.generate('egg', {
            data: [
                '..11..', '.1111.', '111111',
                '111118', '.1118.', '..88..'
            ],
            pixelWidth: 6,
            palette: palette
        });
        
        // 5. 生成金幣
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

        // 1. 鋪滿像素草地背景
        this.add.tileSprite(0, 0, 480, 640, 'grass').setOrigin(0, 0);

        // 2. 放置升級版雞舍
        this.coop = this.add.image(cx, cy - 80, 'coop').setOrigin(0.5);

        // 3. 放置雞蛋 (預設隱藏)
        this.egg = this.add.image(cx, cy - 10, 'egg').setOrigin(0.5);
        this.egg.setDepth(5); // 確保顯示在母雞前面或適當位置
        this.egg.setVisible(false);

        // 4. 放置母雞
        this.hen = this.add.image(cx, cy + 60, 'hen').setOrigin(0.5);
        this.hen.setDepth(10); // 確保母雞在最上層
        this.hen.setInteractive({ cursor: 'pointer' }); 
        
        // 點擊母雞收成
        this.hen.on('pointerdown', () => {
            if (!this.isHenSitting) {
                // 站立時的點擊特效
                this.tweens.add({
                    targets: this.hen,
                    y: this.hen.y - 15,
                    scaleX: 1.1,
                    scaleY: 0.9,
                    duration: 100,
                    yoyo: true
                });
            }
            this.harvestEgg();
        });

        // 5. 繪製 UI 
        this.add.rectangle(70, 30, 120, 70, 0x000000, 0.5).setOrigin(0.5);
        this.add.image(30, 20, 'coin').setOrigin(0.5);
        this.coinsText = this.add.text(50, 10, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });
        
        this.add.image(30, 45, 'egg').setScale(0.7).setOrigin(0.5);
        this.eggsText = this.add.text(50, 35, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });

        // 6. 狀態提示文字框 (預設隱藏，有蛋才顯示)
        this.promptBg = this.add.rectangle(cx, cy - 200, 280, 40, 0x000000, 0.6).setOrigin(0.5);
        this.statusText = this.add.text(cx, cy - 200, '', { 
            fontSize: '18px', fontFamily: 'sans-serif', color: '#A5D6A7'
        }).setOrigin(0.5);
        this.promptBg.setVisible(false);
        this.statusText.setVisible(false);

        // 7. 啟動 Firebase 與母雞 AI 行為
        this.initFirebase();
        this.startHenRoutine(); // 啟動自動走路 AI
    }

    // ==========================================
    // 母雞 AI 巡邏系統 (走路與下蛋動畫)
    // ==========================================
    startHenRoutine() {
        // 每 30 秒強制母雞回雞舍「蹲下」
        this.time.addEvent({
            delay: 30000, 
            callback: this.prepareToLayEgg,
            callbackScope: this,
            loop: true
        });
        
        // 立即開始散步
        this.wanderHen();
    }

    wanderHen() {
        if (this.isHenSitting) return;

        // 隨機決定草地上的目標位置
        const targetX = Phaser.Math.Between(80, 400);
        const targetY = Phaser.Math.Between(250, 550);

        // 決定面向 (原圖頭朝右，若往左走則水平翻轉)
        this.hen.setFlipX(targetX < this.hen.x);

        // 計算距離以維持固定移動速度
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, targetX, targetY);
        const duration = distance * 20; // 調整這個數字可以改變走路速度

        // 走路位移動畫
        this.walkTween = this.tweens.add({
            targets: this.hen,
            x: targetX,
            y: targetY,
            duration: duration,
            ease: 'Linear',
            onComplete: () => {
                if (this.isHenSitting) return;
                // 到達定點後，隨機發呆 1~3 秒再繼續走
                this.time.delayedCall(Phaser.Math.Between(1000, 3000), () => {
                    this.wanderHen();
                });
            }
        });

        // 走路時可愛的上下搖晃特效 (Waddle)
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
        
        // 停止目前的走路與搖晃
        if (this.walkTween) this.walkTween.stop();
        if (this.waddleTween) this.waddleTween.stop();

        // 目標：雞舍門口
        const nestX = this.cameras.main.centerX;
        const nestY = this.cameras.main.centerY - 20;

        this.hen.setFlipX(nestX < this.hen.x);
        const distance = Phaser.Math.Distance.Between(this.hen.x, this.hen.y, nestX, nestY);
        
        // 走向雞舍
        this.tweens.add({
            targets: this.hen,
            x: nestX,
            y: nestY,
            duration: distance * 15,
            ease: 'Linear',
            onComplete: () => {
                // 到達雞舍，蹲下準備生蛋
                this.tweens.add({
                    targets: this.hen,
                    scaleY: 0.7,   // 壓扁
                    scaleX: 1.15,  // 變寬
                    y: nestY + 15, // 身體往下沉
                    duration: 300,
                    ease: 'Power2',
                    onComplete: () => {
                        // 假裝生蛋蹲 5 秒鐘
                        this.time.delayedCall(5000, () => {
                            // 站起來繼續散步
                            this.tweens.add({
                                targets: this.hen,
                                scaleY: 1,
                                scaleX: 1,
                                y: nestY,
                                duration: 300,
                                onComplete: () => {
                                    this.isHenSitting = false;
                                    this.wanderHen(); // 恢復散步
                                }
                            });
                        });
                    }
                });
            }
        });
    }

    // ==========================================
    // Firebase 資料庫邏輯
    // ==========================================
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
            this.startEggTimer(); // 啟動背後計算
        });
    }

    updateUI() {
        if (!this.farmData) return;

        this.coinsText.setText(`${this.farmData.coins || 0}`);
        this.eggsText.setText(`${this.farmData.inventoryEggs || 0}`);

        // 根據資料庫實際狀態更新畫面 (只顯示結果，不顯示倒數)
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
        
        // 這裡純粹在背後計算時間，不干擾畫面顯示
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;
            
            if (this.farmData.eggsReady > 0 || this.farmData.todayLaid >= MAX_EGGS_PER_DAY) {
                return; 
            }

            const timeLeft = LAY_EGG_TIME_MS - (Date.now() - this.farmData.lastLayTime);
            
            // 時間到了，觸發資料庫寫入生蛋
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
            this.showFloatingText('沒蛋啦~ 咕咕！', '#ffffff');
            return;
        }

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
            this.showFloatingText('+1 🥚', '#FFD54F');
        } catch (e) {
            console.error("收成失敗:", e);
        }
    }

    showFloatingText(msg, color) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 40, msg, { 
            fontSize: '22px', 
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
    pixelArt: true, // 保持邊緣銳利，呈現完美麥塊感
    scene: [MainScene] 
};

const game = new Phaser.Game(config);
