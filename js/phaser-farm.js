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

const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
const MAX_EGGS_PER_DAY = 6;

// ==========================================
// 2. Phaser 遊戲場景與「純程式像素畫」
// ==========================================
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.farmData = null;
        this.farmInterval = null;
    }

    preload() {
        // 定義像素調色盤 (Palette) - 已微調為更接近麥塊的顏色
        const palette = {
            '1': '#FFFFFF', // 白 (母雞身體)
            '2': '#E53935', // 紅 (肉垂)
            '3': '#FBC02D', // 黃 (嘴/腳)
            '4': '#000000', // 黑 (眼睛)
            '5': '#8D6E63', // 淺木頭 (雞舍)
            '6': '#5D4037', // 深木頭 (雞舍陰影)
            '7': '#FDD835', // 金黃色 (金幣)
            '8': '#BDBDBD', // 灰白 (翅膀陰影)
            '9': '#7CB342', // 淺草地
            'A': '#689F38'  // 深草地
        };

        // 1. 生成草地
        this.textures.generate('grass', {
            data: [
                '99999999',
                '9A999999',
                '9999A999',
                '99999999',
                '99A99999',
                '999999A9',
                '99999999',
                '9999A999'
            ],
            pixelWidth: 8,
            palette: palette
        });

        // 2. 🌟 生成 Minecraft 完美還原版母雞 (側視圖)
        this.textures.generate('hen', {
            data: [
                '......1111..', // 頭頂
                '......1411..', // 眼睛 (4是黑眼珠)
                '......1111..', // 臉頰
                '......111133', // 鳥喙 (3是黃色)
                '....11111122', // 脖子與紅色肉垂 (2是紅色)
                '....111111..', // 身體前端
                '..11118811..', // 尾巴、身體與灰色翅膀 (8是灰色)
                '..11118811..', // 尾巴、身體與灰色翅膀
                '....118811..', // 身體底部與翅膀
                '....111111..', // 身體最底部
                '......3..3..', // 腳
                '......3..3..'  // 腳
            ],
            pixelWidth: 6, // 放大倍率
            palette: palette
        });

        // 3. 生成雞舍 (Coop)
        this.textures.generate('coop', {
            data: [
                '......5555......',
                '....55666655....',
                '...5666666665...',
                '..565555555565..',
                '.5655......5565.',
                '.555........555.',
                '.555........555.',
                '.555..4444..555.',
                '.555..4444..555.',
                '.555555..555555.'
            ],
            pixelWidth: 10,
            palette: palette
        });

        // 4. 生成雞蛋 (Egg)
        this.textures.generate('egg', {
            data: [
                '..11..',
                '.1111.',
                '111111',
                '111118',
                '.1118.',
                '..88..'
            ],
            pixelWidth: 6,
            palette: palette
        });
        
        // 5. 生成金幣 (Coin)
        this.textures.generate('coin', {
            data: [
                '.777.',
                '77177',
                '71777',
                '77777',
                '.777.'
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

        // 2. 放置木頭雞舍
        this.coop = this.add.image(cx, cy - 80, 'coop').setOrigin(0.5);

        // 3. 放置雞蛋 (預設隱藏，生蛋才顯示)
        this.egg = this.add.image(cx + 40, cy + 40, 'egg').setOrigin(0.5);
        this.egg.setVisible(false);

        // 4. 放置母雞
        this.hen = this.add.image(cx - 20, cy + 20, 'hen').setOrigin(0.5);
        this.hen.setInteractive({ cursor: 'pointer' }); 
        
        // 點擊母雞的互動特效
        this.hen.on('pointerdown', () => {
            this.tweens.add({
                targets: this.hen,
                y: this.hen.y - 15,
                scaleX: 1.1,
                scaleY: 0.9,
                duration: 100,
                yoyo: true
            });
            this.harvestEgg();
        });

        // 5. 繪製 UI
        this.add.rectangle(70, 30, 120, 70, 0x000000, 0.5).setOrigin(0.5);
        this.add.image(30, 20, 'coin').setOrigin(0.5);
        this.coinsText = this.add.text(50, 10, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });
        
        this.add.image(30, 45, 'egg').setScale(0.7).setOrigin(0.5);
        this.eggsText = this.add.text(50, 35, '0', { fontSize: '20px', fontFamily: 'monospace', color: '#fff' });

        // 6. 狀態提示文字框
        const promptBg = this.add.rectangle(cx, cy - 180, 260, 40, 0x000000, 0.6).setOrigin(0.5);
        this.statusText = this.add.text(cx, cy - 180, '連線中...', { 
            fontSize: '18px', 
            fontFamily: 'sans-serif', 
            color: '#ffffff'
        }).setOrigin(0.5);

        // 7. 啟動 Firebase
        this.initFirebase();
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
            this.statusText.setColor('#A5D6A7'); 
        } else {
            this.egg.setVisible(false); 
            this.statusText.setColor('#ffffff');
        }
    }

    startEggTimer() {
        if (this.farmInterval) clearInterval(this.farmInterval);
        
        this.farmInterval = setInterval(() => {
            if (!this.farmData) return;
            
            if (this.farmData.eggsReady > 0 || this.farmData.todayLaid >= MAX_EGGS_PER_DAY) {
                if (this.farmData.todayLaid >= MAX_EGGS_PER_DAY && this.farmData.eggsReady === 0) {
                    this.statusText.setText("今日產能已滿，休息中💤");
                }
                return; 
            }

            const timeLeft = LAY_EGG_TIME_MS - (Date.now() - this.farmData.lastLayTime);
            
            if (timeLeft <= 0) {
                this.statusText.setText("正在下蛋...");
                setDoc(myFarmRef, {
                    "farm.eggsReady": this.farmData.eggsReady + 1,
                    "farm.lastLayTime": Date.now()
                }, { merge: true });
                clearInterval(this.farmInterval);
            } else {
                const h = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
                const m = Math.floor((timeLeft / 1000 / 60) % 60);
                const s = Math.floor((timeLeft / 1000) % 60);
                this.statusText.setText(`下蛋倒數: ${h}時 ${m}分 ${s}秒`);
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
