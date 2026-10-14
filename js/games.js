// 1. 從 firebase-config.js 引入共用 db
import { db } from './firebase-config.js'; 
import { 
    doc, setDoc, addDoc, collection, onSnapshot, serverTimestamp, 
    getDocs, query, where, orderBy, limit, runTransaction 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const RPS_ICONS = ["✊", "✋", "✌️"];
let isGameLocked = false;
let isParent = false;

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
let currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

let userGroupId = 'default_group';
let userDocId = '';
// 新增 farm 預設權限
let myPermissions = { rps: true, g2048: true, farm: true };

if (!currentUser) {
    alert('請先選擇使用者登入！');
    window.location.href = 'index.html';
} else {
    userGroupId = currentUser.groupId || 'default_group';
    userDocId = `${userGroupId}_${currentUser.name}`;

    document.getElementById('gameUserAvatar').src = currentUser.avatar || 'homebase_icon.jpg';
    document.getElementById('gameUserName').innerText = currentUser.name || '';
    
    isParent = (currentUser.role === 'admin' || currentUser.role === 'parent' || currentUser.name === '爸爸' || currentUser.name === '媽咪');
    setupView();
    listenMyPermissions();
}

function listenMyPermissions() {
    onSnapshot(doc(db, "game_permissions", userDocId), (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            myPermissions = {
                rps: data.rps !== false,
                g2048: data.g2048 !== false,
                farm: data.farm !== false
            };
        } else {
            myPermissions = { rps: true, g2048: true, farm: true };
        }
    });
}

function setupView() {
    if (isParent) {
        document.getElementById('modeSwitchContainer').style.display = 'flex';
        switchParentView('admin');
    } else {
        document.getElementById('modeSwitchContainer').style.display = 'none';
        document.getElementById('gameZoneTitle').innerText = "🎮 遊戲區";
        returnToLobby();
        listenKidGameData(userDocId);
        listen2048UserData(userDocId);
    }
}

function switchParentView(mode) {
    const btnAdmin = document.getElementById('btnModeAdmin');
    const btnPlay = document.getElementById('btnModePlay');

    if (mode === 'admin') {
        btnAdmin.classList.add('active');
        btnPlay.classList.remove('active');
        document.getElementById('gameZoneTitle').innerText = "🛡️ 權限管理中心";
        document.getElementById('parentAdminContainer').style.display = 'block';
        document.getElementById('gameLobby').style.display = 'none';
        document.getElementById('kidGameContainer').style.display = 'none';
        document.getElementById('g2048Container').style.display = 'none';
        document.getElementById('farmContainer').style.display = 'none';
        loadParentAdminData();
    } else {
        btnPlay.classList.add('active');
        btnAdmin.classList.remove('active');
        document.getElementById('gameZoneTitle').innerText = "🎮 遊戲區 (親自遊玩)";
        document.getElementById('parentAdminContainer').style.display = 'none';
        returnToLobby();
        listenKidGameData(userDocId);
        listen2048UserData(userDocId);
    }
}

function selectGame(gameType) {
    if (gameType === 'rps' && myPermissions.rps === false) {
        alert('🚫 您已被管理員禁止進入【剪刀石頭布對決】！');
        return;
    }
    if (gameType === 'g2048' && myPermissions.g2048 === false) {
        alert('🚫 您已被管理員禁止進入【2048】！');
        return;
    }
    if (gameType === 'farm' && myPermissions.farm === false) {
        alert('🚫 您已被管理員禁止進入【咕咕莊園】！');
        return;
    }

    document.getElementById('gameLobby').style.display = 'none';
    if (gameType === 'rps') {
        document.getElementById('gameZoneTitle').innerText = "🎮 剪刀石頭布對決";
        document.getElementById('kidGameContainer').style.display = 'block';
    } else if (gameType === 'g2048') {
        document.getElementById('gameZoneTitle').innerText = "🔢 2048 數字方塊";
        document.getElementById('g2048Container').style.display = 'block';
        init2048Game();
    } else if (gameType === 'farm') {
        document.getElementById('gameZoneTitle').innerText = "🐔 咕咕莊園";
        document.getElementById('farmContainer').style.display = 'block';
        initFarmGame();
    }
}

function returnToLobby() {
    document.getElementById('kidGameContainer').style.display = 'none';
    document.getElementById('g2048Container').style.display = 'none';
    document.getElementById('farmContainer').style.display = 'none';
    document.getElementById('gameLobby').style.display = 'flex';
    document.getElementById('gameZoneTitle').innerText = isParent && document.getElementById('btnModePlay').classList.contains('active') ? "🎮 遊戲區 (親自遊玩)" : "🎮 遊戲區";
}

let groupMembers = [];
let kidsPermissions = {};
let selectedMember = null;

async function loadParentAdminData() {
    const chipsContainer = document.getElementById('memberChipsList');
    chipsContainer.innerHTML = '<div class="lb-loading" style="padding:10px;">載入群組成員中...</div>';

    try {
        const q = query(collection(db, "users"), where("groupId", "==", userGroupId));
        const querySnapshot = await getDocs(q);
        
        groupMembers = [];
        querySnapshot.forEach((doc) => {
            const userData = doc.data();
            if (userData.name) groupMembers.push(userData.name);
        });

        if (!groupMembers.includes(currentUser.name)) groupMembers.push(currentUser.name);

        groupMembers.forEach(memberName => {
            const targetDocId = `${userGroupId}_${memberName}`;
            onSnapshot(doc(db, "game_permissions", targetDocId), (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    kidsPermissions[memberName] = {
                        rps: data.rps !== false,
                        g2048: data.g2048 !== false,
                        farm: data.farm !== false
                    };
                } else {
                    kidsPermissions[memberName] = { rps: true, g2048: true, farm: true };
                }
                if (selectedMember === memberName) renderMemberPermissionDetails();
            });
        });
        renderMemberChips();
    } catch (error) {
        chipsContainer.innerHTML = '<div class="lb-loading" style="color:red;">載入失敗</div>';
    }
}

function renderMemberChips() {
    const chipsContainer = document.getElementById('memberChipsList');
    chipsContainer.innerHTML = '';
    if (groupMembers.length === 0) return chipsContainer.innerHTML = '<div class="lb-loading">尚無其他成員</div>';

    groupMembers.forEach((memberName) => {
        const chip = document.createElement('div');
        chip.className = `member-chip ${selectedMember === memberName ? 'active' : ''}`;
        chip.innerHTML = `👤 ${memberName}`;
        chip.onclick = () => selectMemberToManage(memberName);
        chipsContainer.appendChild(chip);
    });
    if (!selectedMember && groupMembers.length > 0) selectMemberToManage(groupMembers[0]);
}

function selectMemberToManage(memberName) {
    selectedMember = memberName;
    document.getElementById('selectedMemberTitle').innerText = `管理 ${memberName} 的遊戲權限`;
    document.getElementById('memberPermissionSection').style.display = 'block';
    document.querySelectorAll('.member-chip').forEach(el => el.classList.toggle('active', el.innerText.includes(memberName)));
    renderMemberPermissionDetails();
}

function renderMemberPermissionDetails() {
    if (!selectedMember) return;
    const perms = kidsPermissions[selectedMember] || { rps: true, g2048: true, farm: true };

    const btnRpsAllow = document.getElementById('btnRpsAllow');
    const btnRpsBan = document.getElementById('btnRpsBan');
    if (btnRpsAllow) btnRpsAllow.className = `btn-perm ${perms.rps !== false ? 'allow-active' : ''}`;
    if (btnRpsBan) btnRpsBan.className = `btn-perm ${perms.rps === false ? 'ban-active' : ''}`;

    const btn2048Allow = document.getElementById('btn2048Allow');
    const btn2048Ban = document.getElementById('btn2048Ban');
    if (btn2048Allow) btn2048Allow.className = `btn-perm ${perms.g2048 !== false ? 'allow-active' : ''}`;
    if (btn2048Ban) btn2048Ban.className = `btn-perm ${perms.g2048 === false ? 'ban-active' : ''}`;

    const btnFarmAllow = document.getElementById('btnFarmAllow');
    const btnFarmBan = document.getElementById('btnFarmBan');
    if (btnFarmAllow) btnFarmAllow.className = `btn-perm ${perms.farm !== false ? 'allow-active' : ''}`;
    if (btnFarmBan) btnFarmBan.className = `btn-perm ${perms.farm === false ? 'ban-active' : ''}`;
}

async function setMemberPermission(gameType, allow) {
    if (!selectedMember) return;
    try {
        const targetDocId = `${userGroupId}_${selectedMember}`;
        const docRef = doc(db, "game_permissions", targetDocId);
        const currentPerms = kidsPermissions[selectedMember] || { rps: true, g2048: true, farm: true };
        currentPerms[gameType] = allow;
        await setDoc(docRef, currentPerms, { merge: true });
    } catch (error) {
        alert("更新權限失敗，請檢查網路。");
    }
}

// ---------------------------
// 🐔 咕咕莊園 遊戲邏輯區塊
// ---------------------------
const EGG_PRICE = 10;
const HEN_PRICE = 500;
const LAY_EGG_TIME_MS = 4 * 60 * 60 * 1000; 
const STEAL_SUCCESS_RATE = 0.7;

let farmUnsubscribe = null;
let farmInterval = null;

function initFarmGame() {
    const myFarmRef = doc(db, "groups", userGroupId, "users", currentUser.name);
    
    if (farmUnsubscribe) farmUnsubscribe();
    farmUnsubscribe = onSnapshot(myFarmRef, (docSnap) => {
        if (!docSnap.exists() || !docSnap.data().farm) {
            setDoc(myFarmRef, {
                farm: { coins: 0, inventoryEggs: 0, hens: 1, eggsReady: 0, todayLaid: 0, lastLayTime: Date.now() }
            }, { merge: true });
            return;
        }
        const farmData = docSnap.data().farm;
        updateFarmUI(farmData);
        startEggTimer(farmData, myFarmRef);
    });

    loadGroupMembersFarm();
}

function updateFarmUI(farmData) {
    document.getElementById('my-coins').textContent = farmData.coins || 0;
    document.getElementById('my-eggs').textContent = farmData.inventoryEggs || 0;
    document.getElementById('hen-count').textContent = `母雞數量: ${farmData.hens || 1}`;
    
    const btnHarvest = document.getElementById('btn-harvest');
    const elEggTimer = document.getElementById('egg-timer');

    if (farmData.eggsReady > 0) {
        elEggTimer.textContent = `🥚 已經有 ${farmData.eggsReady} 顆蛋可以收成！`;
        btnHarvest.disabled = false;
    } else {
        btnHarvest.disabled = true;
    }
}

function startEggTimer(farmData, myFarmRef) {
    if (farmInterval) clearInterval(farmInterval);
    farmInterval = setInterval(() => {
        const elEggTimer = document.getElementById('egg-timer');
        if (farmData.eggsReady > 0) return; // 已經有蛋等收成，不繼續倒數

        const timeLeft = LAY_EGG_TIME_MS - (Date.now() - farmData.lastLayTime);
        
        if (timeLeft <= 0) {
            elEggTimer.textContent = "正在下蛋...";
            // 觸發下蛋 (保護機制: 由客戶端發起，若有 Cloud Function 更好)
            setDoc(myFarmRef, {
                "farm.eggsReady": farmData.eggsReady + 1,
                "farm.lastLayTime": Date.now()
            }, { merge: true });
            clearInterval(farmInterval);
        } else {
            const h = Math.floor((timeLeft / (1000 * 60 * 60)) % 24);
            const m = Math.floor((timeLeft / 1000 / 60) % 60);
            const s = Math.floor((timeLeft / 1000) % 60);
            elEggTimer.textContent = `下蛋倒數: ${h}時 ${m}分 ${s}秒`;
        }
    }, 1000);
}

async function harvestEggs() {
    const myFarmRef = doc(db, "groups", userGroupId, "users", currentUser.name);
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
        alert("🎉 收成成功！");
    } catch (e) {
        console.error("收成失敗:", e);
    }
}

async function sellEggs() {
    const myFarmRef = doc(db, "groups", userGroupId, "users", currentUser.name);
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
}

async function buyHen() {
    const myFarmRef = doc(db, "groups", userGroupId, "users", currentUser.name);
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
                throw "金幣不足！";
            }
        });
        alert("🐔 成功購買一隻母雞！");
    } catch (e) {
        alert(e);
    }
}

function loadGroupMembersFarm() {
    const groupUsersRef = collection(db, "groups", userGroupId, "users");
    const groupList = document.getElementById('group-farm-list');
    
    onSnapshot(groupUsersRef, (snapshot) => {
        groupList.innerHTML = '';
        let hasOthers = false;
        
        snapshot.forEach((docSnap) => {
            if (docSnap.id === currentUser.name) return; // 不顯示自己
            hasOthers = true;
            const farmData = docSnap.data().farm || {};
            
            const div = document.createElement('div');
            div.className = 'farm-member-item';
            const hasEggHint = farmData.eggsReady > 0 ? "⚠️ 雞舍有動靜" : "💤 安靜";
            
            div.innerHTML = `
                <div>
                    <strong>👤 ${docSnap.id}</strong>
                    <p style="font-size: 12px; color: var(--text-sub);">狀態: ${hasEggHint}</p>
                </div>
                <button class="btn btn-steal" onclick="stealEgg('${docSnap.id}')">摸走雞蛋</button>
            `;
            groupList.appendChild(div);
        });
        
        if (!hasOthers) groupList.innerHTML = '<p style="color:var(--text-sub);">群組內還沒有其他人開始養雞喔</p>';
    });
}

async function stealEgg(targetName) {
    const targetRef = doc(db, "groups", userGroupId, "users", targetName);
    const myFarmRef = doc(db, "groups", userGroupId, "users", currentUser.name);
    
    try {
        await runTransaction(db, async (transaction) => {
            const targetDoc = await transaction.get(targetRef);
            const myDoc = await transaction.get(myFarmRef);
            
            const targetFarm = targetDoc.data().farm;
            const myFarm = myDoc.data().farm;

            if (!targetFarm || targetFarm.eggsReady <= 0) throw "哎呀！裡面沒有蛋。";

            if (Math.random() > STEAL_SUCCESS_RATE) throw "🐕 汪！被狗咬了！偷竊失敗！";

            transaction.update(targetRef, { "farm.eggsReady": targetFarm.eggsReady - 1 });
            transaction.update(myFarmRef, { "farm.inventoryEggs": (myFarm.inventoryEggs || 0) + 1 });
        });
        alert("😎 神不知鬼不覺！偷到一顆蛋！");
    } catch (error) {
        alert(error);
    }
}

// ---------------------------
// 剪刀石頭布 & 2048 原有邏輯
// ---------------------------
// (此處保留了你原本的所有剪刀石頭布與2048的程式碼，為了版面整潔與正確性，原邏輯未做任何刪減)
function getTodayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function getInitialRpsStats() { return { groupId: userGroupId, userName: currentUser.name, totalScore: 0, lastPlayDate: getTodayStr(), currentStreak: 0, maxStreak: 0 }; }

let currentKidStats = getInitialRpsStats();

function listenKidGameData(docId) {
    const docRef = doc(db, "game_records", docId);
    onSnapshot(docRef, async (docSnap) => {
        if (docSnap.exists()) {
            currentKidStats = docSnap.data();
            if (currentKidStats.lastPlayDate !== getTodayStr()) {
                currentKidStats.lastPlayDate = getTodayStr();
                currentKidStats.currentStreak = 0;
                await setDoc(docRef, currentKidStats, { merge: true });
            }
        } else {
            currentKidStats = getInitialRpsStats();
            await setDoc(docRef, currentKidStats);
        }
        updateGameUI();
    });
}

function updateGameUI() {
    document.getElementById('gameTotalScore').innerText = currentKidStats.totalScore || 0;
    document.getElementById('gameStreak').innerText = currentKidStats.currentStreak || 0;
    document.getElementById('gameMaxStreak').innerText = currentKidStats.maxStreak || 0;
    if (!isGameLocked) document.querySelectorAll('.p-card').forEach(card => card.classList.remove('disabled'));
}

function resetGameArena() {
    isGameLocked = false;
    document.getElementById('compCard').innerText = "❓";
    document.getElementById('compCard').classList.remove('card-solid');
    document.getElementById('gameResultText').innerText = "準備好了嗎？";
    document.querySelectorAll('.p-card').forEach(card => card.classList.remove('disabled'));
}

async function playGame(playerChoice) {
    if (isGameLocked) return;
    isGameLocked = true;
    document.querySelectorAll('.p-card').forEach(card => card.classList.add('disabled'));

    const compChoice = Math.floor(Math.random() * 3);
    const compCardEl = document.getElementById('compCard');
    compCardEl.innerText = RPS_ICONS[compChoice];
    compCardEl.classList.add('card-solid');

    const resultTextEl = document.getElementById('gameResultText');
    const result = (playerChoice - compChoice + 3) % 3;
    let addedPoints = 0, reason = "";

    if (result === 0) {
        resultTextEl.innerText = "平手！再來一次！";
        resultTextEl.style.color = "#f59e0b";
        setTimeout(resetGameArena, 1500);
        return;
    } else if (result === 1) {
        currentKidStats.totalScore += 1;
        currentKidStats.currentStreak += 1;
        if (currentKidStats.currentStreak > (currentKidStats.maxStreak || 0)) currentKidStats.maxStreak = currentKidStats.currentStreak;
        addedPoints = 1; reason = "剪刀石頭布 獲勝";
        let msg = "🎉 贏了！獲得 1 分！";

        if (currentKidStats.currentStreak % 3 === 0) {
            currentKidStats.totalScore += 2; addedPoints += 2;
            reason = `剪刀石頭布 連勝${currentKidStats.currentStreak}場額外加分`;
            msg = `🔥 連贏 ${currentKidStats.currentStreak} 場！總共獲得 3 分！`;
        }
        resultTextEl.innerText = msg; resultTextEl.style.color = "var(--primary-color)";
    } else {
        currentKidStats.currentStreak = 0;
        resultTextEl.innerText = "😢 輸了！連勝中斷！";
        resultTextEl.style.color = "var(--cancel-color)";
    }

    const docRef = doc(db, "game_records", userDocId);
    await setDoc(docRef, {
        groupId: userGroupId, userName: currentUser.name, totalScore: currentKidStats.totalScore,
        lastPlayDate: getTodayStr(), currentStreak: currentKidStats.currentStreak, maxStreak: currentKidStats.maxStreak || 0
    }, { merge: true });

    if (addedPoints > 0) {
        await addDoc(collection(db, "scores"), {
            date: getTodayStr(), operator: currentUser.name, examType: "遊戲獎勵", subject: reason, score: 100, points: addedPoints, timestamp: serverTimestamp()
        });
    }
    updateGameUI();
    setTimeout(resetGameArena, 2000);
}

// 2048 與排行榜邏輯省略 (直接沿用你原有的全部邏輯)
let g2048Board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
let g2048Score = 0; let g2048BestScore = 0; let g2048GameOver = false;

function listen2048UserData(docId) {
    onSnapshot(doc(db, "game_records_2048", docId), (docSnap) => {
        if (docSnap.exists()) {
            g2048BestScore = docSnap.data().bestScore || 0;
            document.getElementById('g2048BestScore').innerText = g2048BestScore;
        }
    });
}

function init2048Game() {
    g2048Board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    g2048Score = 0; g2048GameOver = false;
    document.getElementById('g2048Score').innerText = g2048Score;
    document.getElementById('g2048Status').innerText = "";
    addNewTile(); addNewTile(); render2048Board();
}

function addNewTile() {
    let emptyCells = [];
    for(let r=0; r<4; r++) for(let c=0; c<4; c++) if(g2048Board[r][c] === 0) emptyCells.push({r, c});
    if(emptyCells.length > 0) {
        let cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        g2048Board[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
    }
}

function render2048Board() {
    const boardEl = document.getElementById('g2048Board');
    boardEl.innerHTML = '';
    for(let r=0; r<4; r++) {
        for(let c=0; c<4; c++) {
            let val = g2048Board[r][c];
            let cellDiv = document.createElement('div');
            cellDiv.className = `g2048-cell ${val > 0 ? 'tile-'+val : ''}`;
            cellDiv.innerText = val > 0 ? val : '';
            boardEl.appendChild(cellDiv);
        }
    }
    document.getElementById('g2048Score').innerText = g2048Score;
    if(g2048Score > g2048BestScore) {
        g2048BestScore = g2048Score;
        document.getElementById('g2048BestScore').innerText = g2048BestScore;
        setDoc(doc(db, "game_records_2048", userDocId), { groupId: userGroupId, userName: currentUser.name, bestScore: g2048BestScore }, { merge: true }).catch(e=>{});
    }
}

function slideRow(row) {
    let arr = row.filter(val => val !== 0);
    for(let i=0; i<arr.length-1; i++) {
        if(arr[i] === arr[i+1]) { arr[i] *= 2; g2048Score += arr[i]; arr[i+1] = 0; }
    }
    arr = arr.filter(val => val !== 0);
    while(arr.length < 4) arr.push(0);
    return arr;
}

function moveLeft() {
    let changed = false;
    for(let r=0; r<4; r++) {
        let original = [...g2048Board[r]];
        g2048Board[r] = slideRow(g2048Board[r]);
        if(original.toString() !== g2048Board[r].toString()) changed = true;
    }
    return changed;
}
function rotateBoard() {
    let newBoard = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    for(let r=0; r<4; r++) for(let c=0; c<4; c++) newBoard[c][3-r] = g2048Board[r][c];
    g2048Board = newBoard;
}
function makeMove(direction) {
    if(g2048GameOver) return;
    let moved = false;
    if(direction === 'left') { moved = moveLeft(); }
    else if(direction === 'up') { rotateBoard(); rotateBoard(); rotateBoard(); moved = moveLeft(); rotateBoard(); }
    else if(direction === 'right') { rotateBoard(); rotateBoard(); moved = moveLeft(); rotateBoard(); rotateBoard(); }
    else if(direction === 'down') { rotateBoard(); moved = moveLeft(); rotateBoard(); rotateBoard(); rotateBoard(); }

    if(moved) { addNewTile(); render2048Board(); checkGameOver(); }
}

function checkGameOver() {
    let hasZero = false; let canMerge = false;
    for(let r=0; r<4; r++) {
        for(let c=0; c<4; c++) {
            if(g2048Board[r][c] === 2048 && !window._hasWon2048) {
                window._hasWon2048 = true;
                document.getElementById('g2048Status').innerText = "🏆 太神啦！成功拼出 2048！";
                document.getElementById('g2048Status').style.color = "var(--primary-color)";
            }
            if(g2048Board[r][c] === 0) hasZero = true;
            if(c < 3 && g2048Board[r][c] === g2048Board[r][c+1]) canMerge = true;
            if(r < 3 && g2048Board[r][c] === g2048Board[r+1][c]) canMerge = true;
        }
    }
    if(!hasZero && !canMerge) {
        g2048GameOver = true;
        document.getElementById('g2048Status').innerText = "😢 遊戲結束！";
        document.getElementById('g2048Status').style.color = "var(--cancel-color)";
    }
}

let currentLbGame = ''; let currentLbTab = 'group';
function openLeaderboard(gameType) {
    currentLbGame = gameType; currentLbTab = 'group';
    document.getElementById('lbTitle').innerText = gameType === 'rps' ? '🏆 猜拳 排行榜' : '🏆 2048 排行榜';
    document.getElementById('leaderboardModal').style.display = 'flex';
    loadLeaderboard('group');
}
function closeLeaderboard() { document.getElementById('leaderboardModal').style.display = 'none'; }
async function loadLeaderboard(tabType) {
    currentLbTab = tabType;
    document.getElementById('tabGroup').classList.toggle('active', tabType === 'group');
    document.getElementById('tabGlobal').classList.toggle('active', tabType === 'global');
    
    const listEl = document.getElementById('lbList');
    listEl.innerHTML = '<div class="lb-loading">載入中...</div>';

    try {
        const colName = currentLbGame === 'rps' ? 'game_records' : 'game_records_2048';
        let q;
        if (tabType === 'group') q = query(collection(db, colName), where("groupId", "==", userGroupId));
        else q = query(collection(db, colName), orderBy(currentLbGame === 'rps' ? 'totalScore' : 'bestScore', "desc"), limit(100));

        const querySnapshot = await getDocs(q);
        let dataList = [];
        querySnapshot.forEach((doc) => dataList.push(doc.data()));

        if (tabType === 'group') {
            dataList.sort((a, b) => currentLbGame === 'rps' ? (b.totalScore || 0) - (a.totalScore || 0) : (b.bestScore || 0) - (a.bestScore || 0));
        }

        listEl.innerHTML = '';
        if (dataList.length === 0) return listEl.innerHTML = '<div class="lb-loading">目前尚無紀錄</div>';

        dataList.forEach((item, index) => {
            let rankClass = index === 0 ? 'top1' : index === 1 ? 'top2' : index === 2 ? 'top3' : '';
            const scoreText = currentLbGame === 'rps' ? `總分: ${item.totalScore || 0} <br><span style="font-size:12px;color:var(--text-sub);">最高連勝: ${item.maxStreak || 0}</span>` : `最高分: ${item.bestScore || 0}`;
            const groupDisplay = tabType === 'global' ? `<div class="lb-group">群組: ${item.groupId || '未知'}</div>` : '';
            
            listEl.innerHTML += `
                <li class="lb-item">
                    <div class="lb-rank ${rankClass}">${index + 1}</div>
                    <div class="lb-info"><div class="lb-name">${item.userName || '匿名玩家'}</div>${groupDisplay}</div>
                    <div class="lb-score">${scoreText}</div>
                </li>
            `;
        });
    } catch (error) { listEl.innerHTML = '<div class="lb-loading" style="color:red;">載入失敗</div>'; }
}

// --- 暴露給 window 供 HTML onClick 綁定 ---
window.selectGame = selectGame;
window.returnToLobby = returnToLobby;
window.selectMemberToManage = selectMemberToManage;
window.setMemberPermission = setMemberPermission;
window.init2048Game = init2048Game;
window.openLeaderboard = openLeaderboard;
window.closeLeaderboard = closeLeaderboard;
window.loadLeaderboard = loadLeaderboard;
window.playGame = playGame;
// 咕咕莊園暴露函數
window.harvestEggs = harvestEggs;
window.sellEggs = sellEggs;
window.buyHen = buyHen;
window.stealEgg = stealEgg;


// --- 事件監聽器區 ---
window.addEventListener('keydown', (e) => {
    if(document.getElementById('g2048Container').style.display === 'block') {
        if(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", " "].includes(e.key)) { e.preventDefault(); }
        if(e.key === 'ArrowLeft') makeMove('left'); if(e.key === 'ArrowUp') makeMove('up');
        if(e.key === 'ArrowRight') makeMove('right'); if(e.key === 'ArrowDown') makeMove('down');
    }
});

let touchStartX = 0, touchStartY = 0;
const boardEl = document.getElementById('g2048Board');
if (boardEl) {
    boardEl.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, {passive: true});
    boardEl.addEventListener('touchend', (e) => {
        if(document.getElementById('g2048Container').style.display !== 'block') return;
        let deltaX = e.changedTouches[0].clientX - touchStartX;
        let deltaY = e.changedTouches[0].clientY - touchStartY;
        if(Math.abs(deltaX) > Math.abs(deltaY)) {
            if(Math.abs(deltaX) > 30) { if(deltaX > 0) makeMove('right'); else makeMove('left'); }
        } else {
            if(Math.abs(deltaY) > 30) { if(deltaY > 0) makeMove('down'); else makeMove('up'); }
        }
    }, {passive: true});
}

document.querySelectorAll('.p-card').forEach(card => {
    card.addEventListener('click', () => playGame(parseInt(card.getAttribute('data-choice'))));
});

document.getElementById('btnModeAdmin').addEventListener('click', () => switchParentView('admin'));
document.getElementById('btnModePlay').addEventListener('click', () => switchParentView('play'));
document.getElementById('btnBack').addEventListener('click', () => window.location.href = 'index.html');
document.getElementById('btnLogout').addEventListener('click', () => {
    sessionStorage.removeItem('familyCheckInUser');
    localStorage.removeItem('familyCheckInUser');
    window.location.href = 'index.html';
});
