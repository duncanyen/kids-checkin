import { requireGameMembership } from './game-members.js';
import { readGameContext, watchGameContext } from './game-context.js';
// 1. 從 firebase-config.js 引入共用 db
import { db } from './firebase-config.js'; 
import { 
    doc, setDoc, addDoc, collection, onSnapshot, serverTimestamp,
    getDocs, query, where, orderBy, limit 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

const RPS_ICONS = ["✊", "✋", "✌️"];
let isGameLocked = false;

const context = readGameContext();
watchGameContext(context);
await requireGameMembership(context);
const currentUser = context.user;
const userGroupId = context.groupId;
// Keep existing, already group-scoped record IDs and permission settings.
const userDocId = `${userGroupId}_${currentUser.name}`;
let myPermissions = { rps: true, g2048: true, farm: true };

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
    const gameZoneTitle = document.getElementById('gameZoneTitle');
    if (gameZoneTitle) gameZoneTitle.innerText = "🎮 遊戲區";
    
    // 所有成員（包含管理者）統一進入遊戲大廳
    returnToLobby();
    listenKidGameData(userDocId);
    listen2048UserData(userDocId);
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
        alert('🚫 您已被管理員禁止進入【咕咕村落】!');
        return;
    }

    if (gameType === 'farm') {
        window.location.href = 'farmgame.html';
        return;
    }

    document.getElementById('gameLobby').style.display = 'none';
    const gameZoneTitle = document.getElementById('gameZoneTitle');

    if (gameType === 'rps') {
        if (gameZoneTitle) gameZoneTitle.innerText = "🎮 剪刀石頭布對決";
        document.getElementById('kidGameContainer').style.display = 'block';
    } else if (gameType === 'g2048') {
        if (gameZoneTitle) gameZoneTitle.innerText = "🔢 2048 數字方塊";
        document.getElementById('g2048Container').style.display = 'block';
        init2048Game();
    }
}

function returnToLobby() {
    const kidGameContainer = document.getElementById('kidGameContainer');
    const g2048Container = document.getElementById('g2048Container');
    const gameLobby = document.getElementById('gameLobby');
    const gameZoneTitle = document.getElementById('gameZoneTitle');

    if (kidGameContainer) kidGameContainer.style.display = 'none';
    if (g2048Container) g2048Container.style.display = 'none';
    if (gameLobby) gameLobby.style.display = 'flex';
    if (gameZoneTitle) gameZoneTitle.innerText = "🎮 遊戲區";
}

// ---------------------------
// 剪刀石頭布邏輯
// ---------------------------
function getTodayStr() { 
    const d = new Date(); 
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
}

function getInitialRpsStats() { 
    return { groupId: userGroupId, accountId: context.accountId, userName: currentUser.name, totalScore: 0, lastPlayDate: getTodayStr(), currentStreak: 0, maxStreak: 0 };
}

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
    const tsEl = document.getElementById('gameTotalScore');
    const gsEl = document.getElementById('gameStreak');
    const msEl = document.getElementById('gameMaxStreak');
    
    if (tsEl) tsEl.innerText = currentKidStats.totalScore || 0;
    if (gsEl) gsEl.innerText = currentKidStats.currentStreak || 0;
    if (msEl) msEl.innerText = currentKidStats.maxStreak || 0;
    
    if (!isGameLocked) {
        document.querySelectorAll('.p-card').forEach(card => card.classList.remove('disabled'));
    }
}

function resetGameArena() {
    isGameLocked = false;
    const compCardEl = document.getElementById('compCard');
    const resultTextEl = document.getElementById('gameResultText');
    
    if (compCardEl) {
        compCardEl.innerText = "❓";
        compCardEl.classList.remove('card-solid');
    }
    if (resultTextEl) {
        resultTextEl.innerText = "準備好了嗎？";
    }
    document.querySelectorAll('.p-card').forEach(card => card.classList.remove('disabled'));
}

async function playGame(playerChoice) {
    if (isGameLocked) return;
    isGameLocked = true;
    document.querySelectorAll('.p-card').forEach(card => card.classList.add('disabled'));

    const compChoice = Math.floor(Math.random() * 3);
    const compCardEl = document.getElementById('compCard');
    if (compCardEl) {
        compCardEl.innerText = RPS_ICONS[compChoice];
        compCardEl.classList.add('card-solid');
    }

    const resultTextEl = document.getElementById('gameResultText');
    const result = (playerChoice - compChoice + 3) % 3;
    let addedPoints = 0;
    let reason = "";

    if (result === 0) {
        if (resultTextEl) {
            resultTextEl.innerText = "平手！再來一次！";
            resultTextEl.style.color = "#f59e0b";
        }
        setTimeout(resetGameArena, 1500);
        return;
    } else if (result === 1) {
        currentKidStats.totalScore = (currentKidStats.totalScore || 0) + 1;
        currentKidStats.currentStreak = (currentKidStats.currentStreak || 0) + 1;
        
        if (currentKidStats.currentStreak > (currentKidStats.maxStreak || 0)) {
            currentKidStats.maxStreak = currentKidStats.currentStreak;
        }
        
        addedPoints = 1; 
        reason = "剪刀石頭布 獲勝";
        let msg = "🎉 贏了！獲得 1 分！";

        if (currentKidStats.currentStreak % 3 === 0) {
            currentKidStats.totalScore += 2; 
            addedPoints += 2;
            reason = `剪刀石頭布 連勝${currentKidStats.currentStreak}場額外加分`;
            msg = `🔥 連贏 ${currentKidStats.currentStreak} 場！總共獲得 3 分！`;
        }
        if (resultTextEl) {
            resultTextEl.innerText = msg; 
            resultTextEl.style.color = "var(--primary-color)";
        }
    } else {
        currentKidStats.currentStreak = 0;
        if (resultTextEl) {
            resultTextEl.innerText = "😢 輸了！連勝中斷！";
            resultTextEl.style.color = "var(--cancel-color)";
        }
    }

    const docRef = doc(db, "game_records", userDocId);
    await setDoc(docRef, {
        groupId: userGroupId,
        accountId: context.accountId,
        userName: currentUser.name, 
        totalScore: currentKidStats.totalScore,
        lastPlayDate: getTodayStr(), 
        currentStreak: currentKidStats.currentStreak, 
        maxStreak: currentKidStats.maxStreak || 0
    }, { merge: true });

    if (addedPoints > 0) {
        await addDoc(collection(db, "scores"), {
            groupId: userGroupId,
            accountId: context.accountId,
            date: getTodayStr(),
            operator: currentUser.name, 
            examType: "遊戲獎勵", 
            subject: reason, 
            score: 100, 
            points: addedPoints, 
            timestamp: serverTimestamp()
        });
    }
    updateGameUI();
    setTimeout(resetGameArena, 2000);
}

// ---------------------------
// 2048 與排行榜邏輯
// ---------------------------
let g2048Board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
let g2048Score = 0; 
let g2048BestScore = 0; 
let g2048GameOver = false;

function listen2048UserData(docId) {
    onSnapshot(doc(db, "game_records_2048", docId), (docSnap) => {
        g2048BestScore = 0;
        if (docSnap.exists()) {
            g2048BestScore = docSnap.data().bestScore || 0;
            const el = document.getElementById('g2048BestScore');
            if (el) el.innerText = g2048BestScore;
        } else {
            const el = document.getElementById('g2048BestScore');
            if (el) el.innerText = '0';
        }
    });
}

function init2048Game() {
    g2048Board = [[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]];
    g2048Score = 0; 
    g2048GameOver = false;
    window._hasWon2048 = false;
    
    const scEl = document.getElementById('g2048Score');
    const stEl = document.getElementById('g2048Status');
    if (scEl) scEl.innerText = g2048Score;
    if (stEl) stEl.innerText = "";
    
    addNewTile(); 
    addNewTile(); 
    render2048Board();
}

function addNewTile() {
    let emptyCells = [];
    for(let r=0; r<4; r++) {
        for(let c=0; c<4; c++) {
            if(g2048Board[r][c] === 0) emptyCells.push({r, c});
        }
    }
    if(emptyCells.length > 0) {
        let cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        g2048Board[cell.r][cell.c] = Math.random() < 0.9 ? 2 : 4;
    }
}

function render2048Board() {
    const boardEl = document.getElementById('g2048Board');
    if (!boardEl) return;
    
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
    
    const scEl = document.getElementById('g2048Score');
    if (scEl) scEl.innerText = g2048Score;
    
    if(g2048Score > g2048BestScore) {
        g2048BestScore = g2048Score;
        const bscEl = document.getElementById('g2048BestScore');
        if (bscEl) bscEl.innerText = g2048BestScore;
        
        setDoc(doc(db, "game_records_2048", userDocId), { 
            groupId: userGroupId,
            accountId: context.accountId,
            userName: currentUser.name, 
            bestScore: g2048BestScore 
        }, { merge: true }).catch(e=>{});
    }
}

function slideRow(row) {
    let arr = row.filter(val => val !== 0);
    for(let i=0; i<arr.length-1; i++) {
        if(arr[i] === arr[i+1]) { 
            arr[i] *= 2; 
            g2048Score += arr[i]; 
            arr[i+1] = 0; 
        }
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
    for(let r=0; r<4; r++) {
        for(let c=0; c<4; c++) {
            newBoard[c][3-r] = g2048Board[r][c];
        }
    }
    g2048Board = newBoard;
}

function makeMove(direction) {
    if(g2048GameOver) return;
    let moved = false;
    if(direction === 'left') { 
        moved = moveLeft(); 
    } else if(direction === 'up') { 
        rotateBoard(); rotateBoard(); rotateBoard(); 
        moved = moveLeft(); 
        rotateBoard(); 
    } else if(direction === 'right') { 
        rotateBoard(); rotateBoard(); 
        moved = moveLeft(); 
        rotateBoard(); rotateBoard(); 
    } else if(direction === 'down') { 
        rotateBoard(); 
        moved = moveLeft(); 
        rotateBoard(); rotateBoard(); rotateBoard(); 
    }

    if(moved) { 
        addNewTile(); 
        render2048Board(); 
        checkGameOver(); 
    }
}

function checkGameOver() {
    let hasZero = false; 
    let canMerge = false;
    const stEl = document.getElementById('g2048Status');

    for(let r=0; r<4; r++) {
        for(let c=0; c<4; c++) {
            if(g2048Board[r][c] === 2048 && !window._hasWon2048) {
                window._hasWon2048 = true;
                if (stEl) {
                    stEl.innerText = "🏆 太神啦！成功拼出 2048！";
                    stEl.style.color = "var(--primary-color)";
                }
            }
            if(g2048Board[r][c] === 0) hasZero = true;
            if(c < 3 && g2048Board[r][c] === g2048Board[r][c+1]) canMerge = true;
            if(r < 3 && g2048Board[r][c] === g2048Board[r+1][c]) canMerge = true;
        }
    }
    if(!hasZero && !canMerge) {
        g2048GameOver = true;
        if (stEl) {
            stEl.innerText = "😢 遊戲結束！";
            stEl.style.color = "var(--cancel-color)";
        }
    }
}

let currentLbGame = ''; 
let currentLbTab = 'group';

function openLeaderboard(gameType) {
    currentLbGame = gameType; 
    currentLbTab = 'group';
    const lbTitle = document.getElementById('lbTitle');
    const lbModal = document.getElementById('leaderboardModal');
    
    if (lbTitle) lbTitle.innerText = gameType === 'rps' ? '🏆 猜拳 排行榜' : '🏆 2048 排行榜';
    if (lbModal) lbModal.style.display = 'flex';
    
    loadLeaderboard('group');
}

function closeLeaderboard() { 
    const lbModal = document.getElementById('leaderboardModal');
    if (lbModal) lbModal.style.display = 'none'; 
}

async function loadLeaderboard(tabType) {
    currentLbTab = tabType;
    const tabGroup = document.getElementById('tabGroup');
    const tabGlobal = document.getElementById('tabGlobal');
    
    if (tabGroup) tabGroup.classList.toggle('active', tabType === 'group');
    if (tabGlobal) tabGlobal.classList.toggle('active', tabType === 'global');
    
    const listEl = document.getElementById('lbList');
    if (!listEl) return;
    
    listEl.innerHTML = '<div class="lb-loading">載入中...</div>';

    try {
        const colName = currentLbGame === 'rps' ? 'game_records' : 'game_records_2048';
        let q;
        if (tabType === 'group') {
            q = query(collection(db, colName), where("groupId", "==", userGroupId));
        } else {
            q = query(collection(db, colName), orderBy(currentLbGame === 'rps' ? 'totalScore' : 'bestScore', "desc"), limit(100));
        }

        const querySnapshot = await getDocs(q);
        let dataList = [];
        querySnapshot.forEach((doc) => dataList.push(doc.data()));

        if (tabType === 'group') {
            dataList.sort((a, b) => currentLbGame === 'rps' ? (b.totalScore || 0) - (a.totalScore || 0) : (b.bestScore || 0) - (a.bestScore || 0));
        }

        listEl.innerHTML = '';
        if (dataList.length === 0) {
            listEl.innerHTML = '<div class="lb-loading">目前尚無紀錄</div>';
            return;
        }

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
    } catch (error) { 
        listEl.innerHTML = '<div class="lb-loading" style="color:red;">載入失敗</div>'; 
    }
}

// --- 暴露給 window 供 HTML onClick 綁定 ---
window.selectGame = selectGame;
window.returnToLobby = returnToLobby;
window.init2048Game = init2048Game;
window.openLeaderboard = openLeaderboard;
window.closeLeaderboard = closeLeaderboard;
window.loadLeaderboard = loadLeaderboard;
window.playGame = playGame;

// --- 事件監聽器區 ---
window.addEventListener('keydown', (e) => {
    const g2048Container = document.getElementById('g2048Container');
    if(g2048Container && g2048Container.style.display === 'block') {
        if(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", " "].includes(e.key)) { e.preventDefault(); }
        if(e.key === 'ArrowLeft') makeMove('left'); 
        if(e.key === 'ArrowUp') makeMove('up');
        if(e.key === 'ArrowRight') makeMove('right'); 
        if(e.key === 'ArrowDown') makeMove('down');
    }
});

let touchStartX = 0, touchStartY = 0;
const boardEl = document.getElementById('g2048Board');
if (boardEl) {
    boardEl.addEventListener('touchstart', (e) => { 
        touchStartX = e.touches[0].clientX; 
        touchStartY = e.touches[0].clientY; 
    }, {passive: true});
    
    boardEl.addEventListener('touchend', (e) => {
        const g2048Container = document.getElementById('g2048Container');
        if(g2048Container && g2048Container.style.display !== 'block') return;
        
        let deltaX = e.changedTouches[0].clientX - touchStartX;
        let deltaY = e.changedTouches[0].clientY - touchStartY;
        
        if(Math.abs(deltaX) > Math.abs(deltaY)) {
            if(Math.abs(deltaX) > 30) { 
                if(deltaX > 0) makeMove('right'); 
                else makeMove('left'); 
            }
        } else {
            if(Math.abs(deltaY) > 30) { 
                if(deltaY > 0) makeMove('down'); 
                else makeMove('up'); 
            }
        }
    }, {passive: true});
}

document.querySelectorAll('.p-card').forEach(card => {
    card.addEventListener('click', () => {
        playGame(parseInt(card.getAttribute('data-choice')));
    });
});

const btnBack = document.getElementById('btnBack');
const btnLogout = document.getElementById('btnLogout');

if (btnBack) {
    btnBack.addEventListener('click', () => window.location.href = 'index.html');
}
if (btnLogout) {
    btnLogout.addEventListener('click', () => {
        sessionStorage.removeItem('familyCheckInUser');
        localStorage.removeItem('familyCheckInUser');
        window.location.href = 'index.html';
    });
}

// Initialize after score variables are declared, including fast cached snapshots.
const avatarEl = document.getElementById('gameUserAvatar');
if (avatarEl) avatarEl.src = currentUser.avatar || 'homebase_icon.jpg';
const nameEl = document.getElementById('gameUserName');
if (nameEl) nameEl.innerText = currentUser.name || '';
setupView();
listenMyPermissions();
