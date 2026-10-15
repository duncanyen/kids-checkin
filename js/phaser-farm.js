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

// 遊戲邏輯常數
const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
const MAX_EGGS_PER_DAY = 6;

// ==========================================
// 2. Phaser 場景建構 (MainScene)
// ==========================================
class MainScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MainScene' });
        this.farmData = null; // 儲存 Firebase 傳來的資料
        this.farmInterval = null;
    }

    // 預載入：若有真正的美術圖，會在這裡 load.image()
    preload() {
        // 目前我們先用 Phaser 內建的 Text 繪製 Emoji 替代圖片
    }

    // 畫面建立與物件擺放
    create() {
        // 1. 繪製吉卜力風格的翠綠草地背景色
        this.cameras.main.setBackgroundColor('#7cb342'); // 柔和的草綠色

        // 2. 建立 UI 文字 (金幣與庫存)
        this.uiStyle = { fontSize: '20px', fontFamily: 'sans-serif', color: '#ffffff', fontStyle: 'bold' };
        this.coinsText = this.add.text(16, 16, '🪙 0', this.uiStyle);
        this.eggsText = this.add.text(16, 44, '🥚 0', this.uiStyle);

        // 3. 建立母雞與雞舍區域
        // (如果有圖片，這會是 this.add.image(x, y, 'hen_sprite'))
        this.hen = this.add.text(240, 350, '🐔', { fontSize: '80px' }).setOrigin(0.5);
        this.nest = this.add.text(240, 400, '🪹', { fontSize: '60px' }).setOrigin(0.5); // 巢
        
        // 將母雞設為可點擊 (Interactive)
        this.hen.setInteractive();
        
        // 點擊母雞的互動邏輯 (收成或特效)
        this.hen.on('pointerdown', () => {
            // 點擊時讓母雞稍微跳動一下 (Tween 動畫)
            this.tweens.add({
                targets: this.hen,
                y: this.hen.y - 20,
                duration: 100,
                yoyo: true // 自動彈回
            });
            this.harvestEgg();
        });

        // 4. 下蛋倒數與狀態提示
        this.statusText = this.add.text(240, 250, '連線中...', { 
            fontSize: '18px', 
            fontFamily: 'sans-serif', 
            color: '#333333',
            backgroundColor: 'rgba(255,255,255,0.8)',
            padding: { x: 10, y: 5 }
        }).setOrigin(0.5);
        this.statusText.setDepth(10); // 確保在最上層

        // 5. 啟動 Firebase 監聽
        this.initFirebase();
    }

    // 監聽 Firebase 資料
    initFirebase() {
        onSnapshot(myFarmRef, (docSnap) => {
            if (!docSnap.exists() || !docSnap.data().farm) {
                // 初始化資料庫
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

    // 根據資料庫更新畫面
    updateUI() {
        if (!this.farmData) return;

        // 更新左上角資源
        this.coinsText.setText(`🪙 ${this.farmData.coins || 0}`);
        this.eggsText.setText(`🥚 ${this.farmData.inventoryEggs || 0}`);

        // 判斷巢裡有沒有蛋
        if (this.farmData.eggsReady > 0) {
            this.nest.setText('🪺'); // 有蛋的巢
            this.statusText.setText(`產了 ${this.farmData.eggsReady} 顆蛋！\n(點擊母雞收成)`);
            this.statusText.setStyle({ color: '#2e7d32' }); // 綠字提示可收成
        } else {
            this.nest.setText('🪹'); // 空巢
            this.statusText.setStyle({ color: '#333333' });
        }
    }

    // 計時器邏輯
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

    // 點擊收成邏輯
    async harvestEgg() {
        if (!this.farmData || this.farmData.eggsReady <= 0) {
            // 如果沒蛋，可以加個「咕咕！」的提示
            this.statusText.setText("還沒有蛋可以收喔！咕！");
            setTimeout(() => this.updateUI(), 1500); // 1.5秒後恢復原本文字
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
            // 收成成功的飄字特效 (Floating Text)
            this.showFloatingText('+1 🥚');
        } catch (e) {
            console.error("收成失敗:", e);
        }
    }

    // 小特效：在畫面上飄出文字
    showFloatingText(msg) {
        const floatTxt = this.add.text(this.hen.x, this.hen.y - 50, msg, { fontSize: '24px', color: '#ffeb3b', fontStyle: 'bold' }).setOrigin(0.5);
        this.tweens.add({
            targets: floatTxt,
            y: floatTxt.y - 80,
            alpha: 0,
            duration: 1000,
            onComplete: () => floatTxt.destroy() // 動畫結束後移除物件
        });
    }
}

// ==========================================
// 3. 啟動 Phaser 遊戲引擎
// ==========================================
const config = {
    type: Phaser.AUTO,
    width: 480,       // 配合手機直式螢幕寬度
    height: 640,      // 直式高度
    parent: 'game-container', // 掛載到 HTML 中的 div id
    backgroundColor: '#333333',
    scene: [MainScene] // 載入我們的農場場景
};

const game = new Phaser.Game(config);
