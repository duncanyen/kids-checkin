import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc, onSnapshot, runTransaction, collection, getDocs, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCj3XrBxi1c3RokMzCIhEB3hjJB-BPuO9Y",
    authDomain: "homebasedb.firebaseapp.com",
    projectId: "homebasedb",
    storageBucket: "homebasedb.firebasestorage.app",
    messagingSenderId: "476832900272",
    appId: "1:476832900272:web:443bacb7cbc3113e9f8775"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==========================================
// 1. 動態取得當下登入的群組與人員資訊
// ==========================================
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
let currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

// 若未登入，阻斷執行並導回首頁
if (!currentUser) {
    alert('請先選擇使用者登入！');
    window.location.href = 'index.html';
    throw new Error("未登入，停止載入遊戲"); 
}

// 動態設定為當前登入者的群組 ID 與名稱
const CURRENT_GROUP_ID = currentUser.groupId || "default_group";
const CURRENT_ACCOUNT_ID = currentUser.name; 
const myFarmRef = doc(db, "groups", CURRENT_GROUP_ID, "users", CURRENT_ACCOUNT_ID);

// ==========================================
// 遊戲設定常數
// ==========================================
const EGG_PRICE = 10;
const HEN_PRICE = 500;
const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; // 4 小時
const MAX_EGGS_PER_DAY = 6;
const STEAL_SUCCESS_RATE = 0.7; // 70% 偷竊成功率

// UI 綁定
const elCoins = document.getElementById('my-coins');
const elEggs = document.getElementById('my-eggs');
const elHenCount = document.getElementById('hen-count');
const elEggTimer = document.getElementById('egg-timer');
const btnHarvest = document.getElementById('btn-harvest');
const btnSellEgg = document.getElementById('btn-sell-egg');
const btnBuyHen = document.getElementById('btn-buy-hen');
const groupList = document.getElementById('group-list');

// 2. 初始化 / 監聽自己的農場狀態 (Realtime Snapshot)
async function initMyFarm() {
  onSnapshot(myFarmRef, (docSnap) => {
    if (!docSnap.exists()) {
      // 首次進入遊戲，初始化農場資料
      setDoc(myFarmRef, {
        farm: {
          coins: 0,
          inventoryEggs: 0,
          hens: 1,
          eggsReady: 0, // 巢裡等待收成的蛋
          todayLaid: 0, // 今日已生數量
          lastLayTime: Date.now()
        }
      }, { merge: true });
      return;
    }

    const data = docSnap.data().farm;
    if (!data) return;

    updateMyUI(data);
    checkEggProduction(data);
  });
}

// 更新自己介面的數值
function updateMyUI(farmData) {
  elCoins.textContent = farmData.coins || 0;
  elEggs.textContent = farmData.inventoryEggs || 0;
  elHenCount.textContent = `母雞數量: ${farmData.hens || 1}`;
  
  if (farmData.eggsReady > 0) {
    elEggTimer.textContent = `🥚 已經有 ${farmData.eggsReady} 顆蛋可以收成！`;
    btnHarvest.disabled = false;
  } else {
    btnHarvest.disabled = true;
  }
}

// 3. 檢查是否該下蛋了 (前端顯示用)
function checkEggProduction(farmData) {
  // 簡化版計時器：每秒更新倒數
  setInterval(() => {
    if (farmData.eggsReady > 0 || farmData.todayLaid >= MAX_EGGS_PER_DAY) {
      if (farmData.todayLaid >= MAX_EGGS_PER_DAY) elEggTimer.textContent = "今日產能已滿，母雞休息中💤";
      return;
    }

    const now = Date.now();
    const timePassed = now - farmData.lastLayTime;
    const timeLeft = LAY_EGG_TIME_MS - timePassed;

    if (timeLeft <= 0) {
      elEggTimer.textContent = "即將下蛋...";
      // 注意：這只是前端視覺，實際收成/增加應透過後端或 Transaction 防護
    } else {
      const hours = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((timeLeft / 1000 / 60) % 60);
      const secs = Math.floor((timeLeft / 1000) % 60);
      elEggTimer.textContent = `下蛋倒數: ${hours}時 ${mins}分 ${secs}秒`;
    }
  }, 1000);
}

// 4. 實作：收成自己的蛋
btnHarvest.addEventListener('click', async () => {
  try {
    await runTransaction(db, async (transaction) => {
      const sfDoc = await transaction.get(myFarmRef);
      const farm = sfDoc.data().farm;
      
      if (farm.eggsReady > 0) {
        transaction.update(myFarmRef, {
          "farm.inventoryEggs": (farm.inventoryEggs || 0) + farm.eggsReady,
          "farm.eggsReady": 0,
          "farm.lastLayTime": Date.now() // 重置計時
        });
      }
    });
    alert("收成成功！");
  } catch (e) {
    console.error("收成失敗: ", e);
  }
});

// 5. 實作：商店買賣 (賣雞蛋)
btnSellEgg.addEventListener('click', async () => {
  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(myFarmRef);
      const farm = docSnap.data().farm;
      if (farm.inventoryEggs >= 1) {
        transaction.update(myFarmRef, {
          "farm.inventoryEggs": farm.inventoryEggs - 1,
          "farm.coins": (farm.coins || 0) + EGG_PRICE
        });
      } else {
        throw "沒有蛋可以賣囉！";
      }
    });
  } catch (e) {
    alert(e);
  }
});

// 5-1. 實作：商店買賣 (買母雞)
btnBuyHen.addEventListener('click', async () => {
  try {
    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(myFarmRef);
      const farm = docSnap.data().farm;
      if (farm.coins >= HEN_PRICE) {
        transaction.update(myFarmRef, {
          "farm.coins": farm.coins - HEN_PRICE,
          "farm.hens": (farm.hens || 1) + 1
        });
      } else {
        throw "金幣不足！需要 " + HEN_PRICE + " 🪙";
      }
    });
    alert("🐔 成功購買一隻母雞！");
  } catch (e) {
    alert(e);
  }
});

// 6. 載入群組成員列表並實作「偷蛋」介面
async function loadGroupMembers() {
  const usersRef = collection(db, "groups", CURRENT_GROUP_ID, "users");
  onSnapshot(usersRef, (snapshot) => {
    groupList.innerHTML = '';
    let hasOthers = false;

    snapshot.forEach((docSnap) => {
      if (docSnap.id === CURRENT_ACCOUNT_ID) return; // 不顯示自己
      
      hasOthers = true;
      const memberData = docSnap.data();
      const farmData = memberData.farm || {};
      
      const div = document.createElement('div');
      div.className = 'member-item';
      
      // 隱藏確切狀態，增加神祕感
      const hasEggHint = farmData.eggsReady > 0 ? "⚠️ 雞舍有動靜" : "💤 安靜";
      
      div.innerHTML = `
        <div>
          <strong>${memberData.displayName || docSnap.id}</strong>
          <p style="font-size: 12px; color: #6b7280;">狀態: ${hasEggHint}</p>
        </div>
        <button class="btn-steal" onclick="stealEgg('${docSnap.id}')">摸走雞蛋</button>
      `;
      groupList.appendChild(div);
    });

    if (!hasOthers) {
      groupList.innerHTML = '<p style="color:#6b7280;">群組內還沒有其他人開始養雞喔</p>';
    }
  });
}

// 實作：偷蛋邏輯 (掛載在 window 讓 HTML onclick 可以呼叫)
window.stealEgg = async (targetAccountId) => {
  const targetRef = doc(db, "groups", CURRENT_GROUP_ID, "users", targetAccountId);
  
  try {
    await runTransaction(db, async (transaction) => {
      const targetDoc = await transaction.get(targetRef);
      const myDoc = await transaction.get(myFarmRef);
      
      const targetFarm = targetDoc.data().farm;
      const myFarm = myDoc.data().farm;

      if (!targetFarm || targetFarm.eggsReady <= 0) {
        throw "哎呀！裡面沒有蛋。";
      }

      // 判定成功率
      if (Math.random() > STEAL_SUCCESS_RATE) {
        throw "被狗咬了！偷竊失敗！";
      }

      // 偷竊成功：對方蛋-1，自己庫存+1
      transaction.update(targetRef, {
        "farm.eggsReady": targetFarm.eggsReady - 1
      });
      transaction.update(myFarmRef, {
        "farm.inventoryEggs": (myFarm.inventoryEggs || 0) + 1
      });
    });
    alert("😎 神不知鬼不覺！偷到一顆蛋！");
  } catch (error) {
    alert(error);
  }
};

// ==========================================
// 啟動應用
// ==========================================
initMyFarm();
loadGroupMembers();
