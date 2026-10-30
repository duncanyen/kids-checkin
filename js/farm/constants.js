import { ENEMY_HEALTH, WEAPONS_CONFIG } from './combat-rules.js';
export { WEAPONS_CONFIG };
import { requireGameMembership } from '../game-members.js';
import { readGameContext, watchGameContext } from '../game-context.js';
import { db } from '../firebase-config.js'; 
import { doc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// ==========================================
// Firebase 用戶驗證與設定
// ==========================================
const context = readGameContext();
watchGameContext(context);
export const membershipReady = requireGameMembership(context);
// Entry/Boot owns the error UI; attach a handler before the engine finishes loading.
membershipReady.catch(() => {});
export const currentUser = context.user;
export const CURRENT_GROUP_ID = context.groupId;
export const CURRENT_ACCOUNT_ID = context.accountId;
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
export const DRAGON_CONFIG = Object.freeze({ health: ENEMY_HEALTH.dragon, flightMs: 10000, durationMs: 60000, encounterOdds: 30, homeEncounterOdds: 20, coinPenalty: 100 });
export const EXPAND_SLOT_PRICE = 100;
export const COOP_LV2_PRICE = 3000;
export const COOP_LV3_PRICE = 10000;
export const AXE_PRICE = WEAPONS_CONFIG.battleaxe.buyPrice;
export const MACE_SELL_PRICE = WEAPONS_CONFIG.mace.sellPrice;
export const MACE_PRICE = WEAPONS_CONFIG.mace.buyPrice; // 狼牙棒售價

// 容量設定
export const COOP_LV1_MAX = 3;
export const COOP_LV2_MAX = 10;
export const COOP_LV3_MAX = 20;

// ==========================================
// 擴充性武器與庫存系統配置
// ==========================================
export { INVENTORY_KEYS, getUsedSpace } from './inventory-core.js';
