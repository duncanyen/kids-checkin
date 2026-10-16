import { db } from '../firebase-config.js';
import { doc, onSnapshot, runTransaction, getDoc, addDoc, collection, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { CURRENT_GROUP_ID, myFarmRef, STEAL_COOLDOWN_MS, STEAL_SUCCESS_RATE, playerName } from './constants.js';

export default class VisitScene extends Phaser.Scene {
    // ... 前面的 constructor, create, sendSystemNotification, spawnWolf 等等都與上一版完全相同 ...

    // 🌟 優化版 Firebase 初始設定
    initFirebase() {
        // 1. 自己農場的資料改從全域 Registry 讀取 (不消耗 Read)
        this.myFarmData = this.registry.get('myFarmData');
        this.registry.events.on('changedata-myFarmData', this.onMyFarmDataChanged, this);

        // 2. 目標農場的資料因為是別人的，會隨時變動，才需要獨立使用 onSnapshot (消耗 1 次 Read)
        const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", this.targetAccountId);
        this.unsubscribeTarget = onSnapshot(targetRef, (docSnap) => {
            if (docSnap.exists() && docSnap.data().farm) {
                this.targetFarmData = docSnap.data().farm;
                this.coopEgg.setVisible(this.targetFarmData.eggsReady > 0);
                this.syncTargetHens(); 
            }
        });
    }

    onMyFarmDataChanged(parent, value) {
        this.myFarmData = value; // 只要全域變數更新，這裡也會同步知道自己的容量滿了沒
    }

    // ... 中間的 wanderSingleHen, searchCabbage, attemptSteal 維持原樣 ...

    // 確保你在 create() 裡面的 shutdown 事件也要做對應修改 (原本寫在 create 最下方)
    /*
        this.events.on('shutdown', () => { 
            if (this.unsubscribeTarget) this.unsubscribeTarget(); 
            // 🌟 將取消 myFarm 的監聽改為拔除 registry 的事件
            this.registry.events.off('changedata-myFarmData', this.onMyFarmDataChanged, this);

            this.hensGroup.forEach(hen => {
                if (hen.walkTween) hen.walkTween.stop();
                if (hen.waddleTween) hen.waddleTween.stop();
            });
        });
    */
}
