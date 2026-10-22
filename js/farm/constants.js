import { db } from '../firebase-config.js'; 
import { doc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// Firebase 用戶驗證與設定
// ==========================================
const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
export const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

if (!currentUser || !currentUser.accountId) {
    alert('資料異常：請確認您已正確登入且擁有 accountId！');
    window.location.href = 'index.html';
    throw new Error("未登入或缺少 accountId"); 
}

export const CURRENT_GROUP_ID = currentUser.groupId || "default_group";
export const CURRENT_ACCOUNT_ID = currentUser.accountId; 
export const myFarmRef = doc(db, "groups", CURRENT_GROUP_ID, "users", CURRENT_ACCOUNT_ID);

export const playerName = currentUser.name || "我";

// ==========================================
// 遊戲邏輯常數
// ==========================================
export const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
export const STEAL_COOLDOWN_MS = 60 * 60 * 1000;   
export const STEAL_SUCCESS_RATE = 0.7;             

// 售價設定
export const EGG_PRICE = 10;   
export const HEN_PRICE = 1000;  
export const WORM_PRICE = 1;
export const EARTHWORM_PRICE = 3;
export const FANG_PRICE = 20;
export const DRAGON_SCALE_PRICE = 200;
export const DRAGON_CONFIG = Object.freeze({ health: 600, flightMs: 10000, durationMs: 40000, encounterOdds: 30, coinPenalty: 100 });
export const EXPAND_SLOT_PRICE = 100;
export const COOP_LV2_PRICE = 3000;
export const COOP_LV3_PRICE = 10000;
export const MACE_PRICE = 2000; // 狼牙棒售價

// 容量設定
export const COOP_LV1_MAX = 3;
export const COOP_LV2_MAX = 10;
export const COOP_LV3_MAX = 20;

// ==========================================
// 擴充性武器與庫存系統配置
// ==========================================
export const WEAPONS_CONFIG = {
    'club': { name: '木棒', damage: 1, icon: 'club' },
    'mace': { name: '狼牙棒', damage: 10, icon: 'mace' }
};

export const INVENTORY_KEYS = ['inventoryEggs', 'worms', 'earthworms', 'wolfFangs', 'tigerPelts', 'dragonScales', 'medicines', 'mace'];

// 動態計算倉庫目前使用容量
export const getUsedSpace = (farm) => {
    if (!farm) return 0;
    return INVENTORY_KEYS.reduce((sum, key) => sum + (farm[key] || 0), 0);
};
