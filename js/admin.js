import { normalizeAccountId, findAccountsById, newAccountRef, assertAccountAvailable, ACCOUNT_ID_TAKEN } from './account-identity.js';
import { FOOD_MENU, DEFAULT_MENUS } from './menu-catalog.js';
import { getSelectedGameGroupId, watchGameContext } from './game-context.js';
import { loadGameGroupMembers } from './game-members.js';
import { db } from './firebase-config.js';
import { 
    collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc,
    query, where, orderBy, serverTimestamp, onSnapshot, runTransaction
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let systemMenuOptions = [];
let allLogs = [];
let allUsers = [];
let pendingRequests = [];
let memberListUnsubscribe = null;
let memberListVersion = 0;

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;

const isParentOrAdmin = currentUser && (
    currentUser.role === 'admin' || 
    currentUser.role === 'parent' || 
    currentUser.name === '爸爸' || 
    currentUser.name === '媽咪'
);

const groupId = getSelectedGameGroupId(currentUser);
let lastGroupNameChange = null;

if (!isParentOrAdmin || !groupId) {
    alert("您沒有權限訪問管理者頁面！");
    window.location.href = 'index.html';
} else {
    watchGameContext({ groupId, accountId: currentUser.accountId });
    initAdminPage();
}

async function loadSystemMenus() {
    try {
        const snapshot = await getDocs(collection(db, 'system_menus'));
        const menus = snapshot.docs.map(snapshot => ({ ...snapshot.data(), id: snapshot.id }));
        if (!menus.length) {
            for (const menu of DEFAULT_MENUS) await setDoc(doc(db, 'system_menus', menu.id), menu);
            systemMenuOptions = DEFAULT_MENUS.map(menu => ({ ...menu }));
        } else {
            if (!menus.some(menu => menu.id === 'food')) {
                // Backfill only the missing feature; preserve existing defaults/order.
                const existing = await getDoc(doc(db, 'system_menus', 'food'));
                if (!existing.exists()) await setDoc(doc(db, 'system_menus', 'food'), FOOD_MENU);
                menus.push(existing.exists() ? { ...FOOD_MENU, ...existing.data(), id: 'food' } : { ...FOOD_MENU });
            }
            systemMenuOptions = menus.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
        }
    } catch (error) {
        console.error('無法讀取選單設定', error);
        systemMenuOptions = DEFAULT_MENUS.map(menu => ({ ...menu }));
    }
}

async function initAdminPage() {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    document.getElementById('logDateFilter').value = todayStr;

    setupToggle('btnToggleGroupSettings', 'groupSettingsForm', 'toggleIconGroupSettings');
    setupToggle('btnToggleRequests', 'requestsSection', 'toggleIconRequests', () => {
        if (pendingRequests.length === 0) fetchPendingRequests();
    });
    setupToggle('btnToggleGamePanel', 'adminGameSection', 'toggleIconGamePanel', () => {
        initAdminGameManagement();
    });
    setupToggle('btnToggleAddForm', 'addUserForm', 'toggleIconAdd');
    setupToggle('btnToggleUserList', 'userListContainer', 'toggleIconUserList', loadUsersFromFirebase);
    setupToggle('btnToggleLogs', 'logsSection', 'toggleIconLogs');

    // Bind expand/collapse before any remote request can delay the page.
    await loadSystemMenus();
    renderMenuCheckboxes('newMenusContainer', false);
    renderMenuCheckboxes('editMenusContainer', true);
    
    await loadGroupSettings();
    await loadUsersFromFirebase();
    let memberSignature = null;
    memberListUnsubscribe = onSnapshot(doc(db, 'groups', groupId), snapshot => {
        const signature = JSON.stringify(snapshot.exists() ? snapshot.data().members || [] : []);
        if (signature !== memberSignature) { memberSignature = signature; loadUsersFromFirebase(); }
    });
    window.addEventListener('pagehide', event => { if (!event.persisted) memberListUnsubscribe?.(); });
    window.addEventListener('pageshow', event => { if (event.persisted) loadUsersFromFirebase(); });

    // 綁定按鈕點擊事件
    document.getElementById('btnAddUser').addEventListener('click', addNewUser);
    document.getElementById('btnSaveGroupName').addEventListener('click', saveGroupName);
    document.getElementById('btnQueryLogs').addEventListener('click', fetchLogsByDate);
    document.getElementById('btnRefreshRequests').addEventListener('click', fetchPendingRequests);
    document.getElementById('targetGameChatRoomSelect').addEventListener('change', (e) => saveTargetGameRoom(e.target.value));
    
    // 遊戲權限微調按鈕
    document.getElementById('villageVisibility').addEventListener('change', event => saveVillageVisibility(event.target.value));
    document.getElementById('btnFarmAllow').addEventListener('click', () => setMemberPermission('farm', true));
    document.getElementById('btnFarmBan').addEventListener('click', () => setMemberPermission('farm', false));
    document.getElementById('btnRpsAllow').addEventListener('click', () => setMemberPermission('rps', true));
    document.getElementById('btnRpsBan').addEventListener('click', () => setMemberPermission('rps', false));
    document.getElementById('btn2048Allow').addEventListener('click', () => setMemberPermission('g2048', true));
    document.getElementById('btn2048Ban').addEventListener('click', () => setMemberPermission('g2048', false));

    // Modal 按鈕
    document.getElementById('btnCancelEditModal').addEventListener('click', closeEditModal);
    document.getElementById('btnSaveEditUser').addEventListener('click', saveEditUser);
}

function setupToggle(btnId, targetId, iconId, onOpenCallback) {
    const button = document.getElementById(btnId);
    button.setAttribute('aria-controls', targetId);
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => {
        const el = document.getElementById(targetId);
        const icon = document.getElementById(iconId);
        if (el.style.display === 'none' || el.style.display === '') {
            el.style.display = (targetId === 'addUserForm' || targetId === 'groupSettingsForm') ? 'flex' : 'block';
            icon.innerText = '▲';
            button.setAttribute('aria-expanded', 'true');
            if (onOpenCallback) onOpenCallback();
        } else {
            el.style.display = 'none';
            icon.innerText = '▼';
            button.setAttribute('aria-expanded', 'false');
        }
    });
}

function renderMenuCheckboxes(containerId, isEdit) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (systemMenuOptions.length === 0) {
        container.innerHTML = '<div style="color:#e53935; font-size:calc(12px * var(--n-font-scale, 1)); grid-column: 1 / -1;">無法載入選單，請重新整理網頁。</div>';
        return;
    }

    systemMenuOptions.forEach(menu => {
        const label = document.createElement('label');
        label.className = 'checkbox-label';
        const checkedStr = (!isEdit && menu.isDefault) ? 'checked' : '';
        label.innerHTML = `<input type="checkbox" value="${menu.id}" ${checkedStr}> ${menu.label}`;
        container.appendChild(label);
    });
}

function getCheckedMenus(containerId) {
    const container = document.getElementById(containerId);
    const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
    return Array.from(checkboxes).map(cb => cb.value);
}

async function loadGroupSettings() {
    try {
        const groupDoc = await getDoc(doc(db, "groups", groupId));
        if (groupDoc.exists()) {
            const data = groupDoc.data();
            document.getElementById('editGroupName').value = data.name || '我們的家';
            lastGroupNameChange = data.lastNameChange; 
        } else {
            document.getElementById('editGroupName').value = '我們的家';
        }
    } catch (error) {
        console.error("無法讀取群組資料:", error);
    }
}

async function saveGroupName() {
    const newName = document.getElementById('editGroupName').value.trim();
    if (!newName) return alert("群組名稱不可為空！");

    if (lastGroupNameChange) {
        const lastTimeMs = lastGroupNameChange.toMillis ? lastGroupNameChange.toMillis() : lastGroupNameChange;
        const now = Date.now();
        if (now - lastTimeMs < 24 * 60 * 60 * 1000) {
            return alert("⏳ 群組名稱每 24 小時只能更改一次喔！請稍後再試。");
        }
    }

    try {
        await setDoc(doc(db, "groups", groupId), { 
            name: newName, 
            lastNameChange: serverTimestamp() 
        }, { merge: true });

        alert("✅ 群組名稱已更新！");
        lastGroupNameChange = Date.now();
        await logAction('系統操作', `將群組名稱更改為：${newName}`);
    } catch (error) {
        alert("更新失敗，請檢查網路連線。");
    }
}

async function fetchPendingRequests() {
    const container = document.getElementById('requestsContainer');
    container.innerHTML = '<div style="text-align:center; color:#888; padding: 15px;">載入審核清單中...</div>';

    try {
        const q = query(
            collection(db, "group_requests"), 
            where("groupId", "==", groupId),
            where("status", "==", "pending")
        );
        const snapshot = await getDocs(q);
        pendingRequests = [];

        snapshot.forEach(docSnap => {
            pendingRequests.push({ reqId: docSnap.id, ...docSnap.data() });
        });

        renderRequests();
    } catch (error) {
        console.error("載入審核清單失敗:", error);
        container.innerHTML = '<div style="text-align:center; color:#e53935; padding: 15px;">載入失敗，請檢查網路或索引設定</div>';
    }
}

function renderRequests() {
    const container = document.getElementById('requestsContainer');
    container.innerHTML = '';

    if (pendingRequests.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#888; padding: 15px;">目前沒有待審核的入群申請。</div>';
        return;
    }

    pendingRequests.forEach(req => {
        const typeLabel = req.type === 'code' ? '🔑 透過邀請碼' : '🌐 自行申請';
        const div = document.createElement('div');
        div.className = 'user-reset-item';
        div.innerHTML = `
            <div class="user-info">
                <img class="user-avatar" src="${req.avatar || 'homebase_icon.jpg'}" onerror="this.src='https://ui-avatars.com/api/?name=${req.userName}'">
                <div>
                    <div class="user-name">${req.userName} <span style="font-size:calc(12px * var(--n-font-scale, 1)); color:var(--warning-color); font-weight:normal;">(${typeLabel})</span></div>
                    <div class="user-subtext">帳號 ID: ${req.accountId || '無'}</div>
                    <div class="user-features" style="color:#666;">申請時間: ${req.requestTime || '剛剛'}</div>
                </div>
            </div>
            <div class="action-buttons">
                <button class="btn-approve" onclick="handleRequest('${req.reqId}', 'approved', '${req.userId}', '${req.userName}')">同意</button>
                <button class="btn-reject" onclick="handleRequest('${req.reqId}', 'rejected', '${req.userId}', '${req.userName}')">駁回</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.handleRequest = async function(reqId, actionStatus, targetUserId, targetUserName) {
    const actionText = actionStatus === 'approved' ? '同意' : '駁回';
    if (!confirm(`確定要【${actionText}】成員【${targetUserName}】的入群申請嗎？`)) return;

    try {
        const requestRef = doc(db, 'group_requests', reqId);
        const request = await getDoc(requestRef);
        if (!request.exists() || request.data().groupId !== groupId) throw new Error('申請不屬於目前群組。');
        let accountId = request.data().accountId || null;
        let existing = null, userRef = null;
        if (actionStatus === 'approved') {
            if (!accountId && targetUserId) {
                const profile = await getDoc(doc(db, 'users', targetUserId));
                accountId = profile.exists() ? profile.data().accountId : targetUserId;
            }
            if (!accountId) throw new Error('申請缺少帳號 ID。');
            const profiles = await getDocs(query(collection(db, 'users'), where('accountId', '==', accountId)));
            existing = profiles.docs[0];
            if (existing?.data().role === 'removed') throw new Error('此帳號已停用，請先確認帳號狀態。');
            userRef = existing ? doc(db, 'users', existing.id) : doc(collection(db, 'users'));
        }
        await runTransaction(db, async transaction => {
            const group = await readManagedGroup(transaction);
            const latest = await transaction.get(requestRef);
            if (!latest.exists() || latest.data().groupId !== groupId || latest.data().status !== 'pending') throw new Error('申請已處理或不屬於目前群組。');
            if (actionStatus === 'approved') {
                if (!accountId) throw new Error('申請缺少帳號 ID。');
                if (!existing) transaction.set(userRef, {
                    groupId, accountId, name: targetUserName, role: 'member',
                    menus: systemMenuOptions.filter(menu => menu.isDefault).map(menu => menu.id),
                    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(targetUserName)}&background=random`
                });
                transaction.update(group.ref, { members: [...new Set([...group.members, accountId])] });
            }
            transaction.update(requestRef, { status: actionStatus, processedTime: serverTimestamp() });
        });
        await logAction('系統操作', `審核${actionText}：成員 ${targetUserName} 的入群申請`);

        alert(`已成功${actionText}該申請！`);
        fetchPendingRequests();
        loadUsersFromFirebase();
    } catch (error) {
        console.error("審核處理失敗:", error);
        alert("處理失敗：" + error.message);
    }
};

// ==========================================
// 🌟 遊戲進入權限管理邏輯 (整合成員 management)
// ==========================================
let groupMembers = [];
let kidsPermissions = {};
let selectedMember = null;

async function initAdminGameManagement() {
    listenVillageVisibility();
    await loadGameChatRoomsForSelect();
    await loadParentAdminData();
}

let villageVisibilityUnsubscribe;
function listenVillageVisibility() {
    const select = document.getElementById('villageVisibility');
    const status = document.getElementById('villageVisibilityStatus');
    select.disabled = true;
    villageVisibilityUnsubscribe?.();
    villageVisibilityUnsubscribe = onSnapshot(doc(db, 'groups', groupId), snapshot => {
        const visibility = snapshot.exists() && snapshot.data().farmVillageVisibility === 'public' ? 'public' : 'closed';
        select.value = visibility;
        select.dataset.saved = visibility;
        select.disabled = false;
        status.textContent = visibility === 'public' ? '公開型：成員可搜尋、拜訪其他公開村落，也開放外部成員拜訪與偷蛋。' : '封閉型：僅目前群組成員可進入，無法拜訪外部村落。';
    }, () => { status.textContent = '載入失敗，請重新開啟遊戲權限設定。'; });
}

async function saveVillageVisibility(visibility) {
    if (!['public', 'closed'].includes(visibility) || !isParentOrAdmin) return;
    const select = document.getElementById('villageVisibility');
    const status = document.getElementById('villageVisibilityStatus');
    select.disabled = true;
    try {
        const group = await getDoc(doc(db, 'groups', groupId));
        if (!group.exists() || !(group.data().members || []).includes(currentUser.accountId)) throw new Error('你已不在此群組。');
        await updateDoc(doc(db, 'groups', groupId), { farmVillageVisibility: visibility });
        select.dataset.saved = visibility;
        status.textContent = visibility === 'public' ? '已儲存：公開型村落，其他公開群組可拜訪與偷蛋。' : '已儲存：封閉型村落，外部拜訪已停止。';
    } catch (error) {
        select.value = select.dataset.saved || 'closed';
        status.textContent = error.message || '儲存失敗，請稍後重試。';
    } finally { select.disabled = false; }
}

async function loadGameChatRoomsForSelect() {
    try {
        const select = document.getElementById('targetGameChatRoomSelect');
        if (!select) return;
        select.innerHTML = '<option value="">-- 請選擇目標群組 --</option>';
        
        const querySnapshot = await getDocs(query(collection(db, "rooms"), where("groupId", "==", groupId)));
        querySnapshot.forEach(docSnap => {
            const room = docSnap.data();
            const opt = document.createElement('option');
            opt.value = docSnap.id;
            opt.innerText = room.name;
            select.appendChild(opt);
        });
        
        const configDoc = await getDoc(doc(db, "groups", groupId, "settings", "gameConfig"));
        if (configDoc.exists()) {
            const targetRoomId = configDoc.data().targetRoomId;
            if (targetRoomId) select.value = targetRoomId;
        }
    } catch (e) { 
        console.error("載入聊天室清單失敗", e); 
    }
}

async function saveTargetGameRoom(roomId) {
    try {
        if (roomId) {
            const room = await getDoc(doc(db, 'rooms', roomId));
            if (!room.exists() || room.data().groupId !== groupId) throw new Error('聊天室不屬於目前群組');
        }
        await setDoc(doc(db, "groups", groupId, "settings", "gameConfig"), { targetRoomId: roomId, updatedAt: serverTimestamp() }, { merge: true });
        alert('已成功設定遊戲通知發送的聊天室！');
    } catch (e) { 
        console.error("儲存設定失敗", e); 
        alert('設定儲存失敗'); 
    }
}

async function loadParentAdminData() {
    const chipsContainer = document.getElementById('memberChipsList');
    if (!chipsContainer) return;
    
    chipsContainer.innerHTML = '<div style="padding:10px; font-size:calc(12px * var(--n-font-scale, 1)); color:var(--text-sub);">載入「目前群組」成員中...</div>';

    try {
        const members = await loadGameGroupMembers(groupId, currentUser.accountId);
        groupMembers = [...new Set(members.map(member => member.name).filter(Boolean))];

        groupMembers.forEach(memberName => {
            const targetDocId = `${groupId}_${memberName}`;
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
                if (selectedMember === memberName) {
                    renderMemberPermissionDetails();
                }
            });
        });
        renderMemberChips();
    } catch (error) {
        console.error("載入成員權限失敗:", error);
        chipsContainer.innerHTML = '<div style="color:red; font-size:calc(12px * var(--n-font-scale, 1));">載入成員失敗</div>';
    }
}

function renderMemberChips() {
    const chipsContainer = document.getElementById('memberChipsList');
    if (!chipsContainer) return;
    
    chipsContainer.innerHTML = '';
    if (groupMembers.length === 0) {
        chipsContainer.innerHTML = '<div style="font-size:calc(12px * var(--n-font-scale, 1)); color:var(--text-sub);">尚無成員資料</div>';
        return;
    }

    groupMembers.forEach((memberName) => {
        const chip = document.createElement('div');
        chip.className = `member-chip ${selectedMember === memberName ? 'active' : ''}`;
        chip.innerHTML = `👤 ${memberName}`;
        chip.onclick = () => selectMemberToManage(memberName);
        chipsContainer.appendChild(chip);
    });

    if (!selectedMember && groupMembers.length > 0) {
        selectMemberToManage(groupMembers[0]);
    }
}

function selectMemberToManage(memberName) {
    selectedMember = memberName;
    const titleEl = document.getElementById('selectedMemberTitle');
    const sectionEl = document.getElementById('memberPermissionSection');
    
    if (titleEl) titleEl.innerText = `管理 ${memberName} 的遊戲權限`;
    if (sectionEl) sectionEl.style.display = 'block';
    
    document.querySelectorAll('.member-chip').forEach(el => {
        el.classList.toggle('active', el.innerText.includes(memberName));
    });
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
        const targetDocId = `${groupId}_${selectedMember}`;
        const docRef = doc(db, "game_permissions", targetDocId);
        const currentPerms = kidsPermissions[selectedMember] || { rps: true, g2048: true, farm: true };
        currentPerms[gameType] = allow;
        await setDoc(docRef, currentPerms, { merge: true });
        await logAction('權限管理', `更新成員 ${selectedMember} 的遊戲 [${gameType}] 權限為：${allow ? '允許' : '禁止'}`);
    } catch (error) {
        alert("更新權限失敗，請檢查網路。");
    }
}

// ==========================================
// 人員管理與系統 Logs 邏輯
// ==========================================
async function loadUsersFromFirebase() {
    const version = ++memberListVersion;
    try {
        const users = await loadGameGroupMembers(groupId, currentUser.accountId, { includeDocumentIds: true });
        if (version !== memberListVersion) return;
        allUsers = users;
        const filterSelect = document.getElementById('userFilter');
        const selected = filterSelect.value;
        filterSelect.innerHTML = '<option value="all">全部人員</option>';
        allUsers.forEach(user => {
            const opt = document.createElement('option'); opt.value = user.name; opt.textContent = user.name;
            filterSelect.appendChild(opt);
        });
        if (allUsers.some(user => user.name === selected)) filterSelect.value = selected;
        renderUserList();
    } catch (error) {
        if (version !== memberListVersion) return;
        allUsers = [];
        console.error('載入成員失敗：', error);
        document.getElementById('userListContainer').textContent = '載入成員失敗，請確認目前群組或稍後重試。';
    }
}

async function readManagedGroup(transaction) {
    const ref = doc(db, 'groups', groupId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists() || !(snapshot.data().members || []).includes(currentUser.accountId)) throw new Error('你已不在目前群組。');
    return { ref, members: snapshot.data().members || [] };
}

function renderUserList() {
    const container = document.getElementById('userListContainer');
    container.innerHTML = '';

    if (allUsers.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#888;">無成員資料</div>';
        return;
    }

    allUsers.forEach(user => {
        let roleDisplay = '一般成員';
        if (user.role === 'admin') roleDisplay = '系統管理者';
        if (user.role === 'parent') roleDisplay = '家長管理員';
        
        const idDisplay = user.accountId ? `帳號: ${user.accountId}` : '<span style="color:#e53935;">(無帳號)</span>';
        
        const userMenus = user.menus || systemMenuOptions.filter(m => m.isDefault).map(m => m.id);
        const menuLabels = systemMenuOptions.filter(m => userMenus.includes(m.id)).map(m => m.label).join('、');

        const div = document.createElement('div');
        div.className = 'user-reset-item';
        div.dataset.accountId = user.accountId;
        div.innerHTML = `
            <div class="user-info">
                <img class="user-avatar" src="${user.avatar || 'homebase_icon.jpg'}" onerror="this.src='https://ui-avatars.com/api/?name=${user.name}'">
                <div>
                    <div class="user-name">${user.name} <span style="font-size:calc(12px * var(--n-font-scale, 1)); color:var(--primary-color); font-weight:normal;">(${roleDisplay})</span></div>
                    <div class="user-subtext">${idDisplay}</div>
                    <div class="user-features">✓ 開放權限: ${menuLabels || '無'}</div>
                </div>
            </div>
            <div class="action-buttons">
                <button class="btn-edit">編輯</button>
                <button class="btn-remove">退出</button>
            </div>
        `;
        div.querySelector('.btn-edit').onclick = () => window.openEditModal(user.docId);
        div.querySelector('.btn-remove').onclick = () => window.removeUser(user.docId, user.name);
        container.appendChild(div);
    });
}

async function addNewUser() {
    const idInput = normalizeAccountId(document.getElementById('newUserId').value);
    const nameInput = document.getElementById('newUserName').value.trim();
    const pinInput = document.getElementById('newUserPin').value.trim();
    const emailInput = document.getElementById('newUserEmail').value.trim();
    const roleInput = document.getElementById('newUserRole').value;
    const selectedMenus = getCheckedMenus('newMenusContainer');

    if (!idInput) return alert("請設定帳號 ID！");
    if (!/^[a-zA-Z0-9_]+$/.test(idInput)) return alert("帳號 ID 只能包含英文、數字與底線！");
    if (!nameInput) return alert("請輸入成員稱呼！");
    if (!/^\d{4}$/.test(pinInput)) return alert("密碼格式錯誤，必須為 4 位數字！");
    if (emailInput && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput)) return alert("電子郵件格式不正確！");
    
    if (allUsers.some(u => normalizeAccountId(u.accountId) === idInput)) return alert("此「帳號 ID」已存在，請更換一個！");
    if (allUsers.some(u => u.name === nameInput)) return alert("家族內「稱呼」不可重複，請更換一個！");

    try {
        document.getElementById('btnAddUser').disabled = true;
        document.getElementById('btnAddUser').innerText = "處理中...";

        const newUser = {
            groupId: groupId,
            accountId: idInput,
            name: nameInput,
            pin: pinInput,
            email: emailInput || null,
            role: roleInput,
            menus: selectedMenus,
            avatar: `https://ui-avatars.com/api/?name=${nameInput}&background=random`
        };

        if ((await findAccountsById(db, idInput)).length) throw new Error(ACCOUNT_ID_TAKEN);
        const userRef = newAccountRef(db, idInput);
        await runTransaction(db, async transaction => {
            const group = await readManagedGroup(transaction);
            await assertAccountAvailable(transaction, userRef);
            transaction.set(userRef, newUser);
            transaction.update(group.ref, { members: [...new Set([...group.members, idInput])] });
        });
        await logAction('系統操作', `新增了成員：${nameInput} (${idInput})`);
        
        alert(`成功新增成員：${nameInput}！`);
        
        document.getElementById('newUserId').value = '';
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserPin').value = '';
        document.getElementById('newUserEmail').value = '';
        renderMenuCheckboxes('newMenusContainer', false); 
        
        document.getElementById('addUserForm').style.display = 'none';
        document.getElementById('toggleIconAdd').innerText = '▼';

        await loadUsersFromFirebase();
    } catch (error) {
        alert("新增成員失敗：" + error.message);
    } finally {
        document.getElementById('btnAddUser').disabled = false;
        document.getElementById('btnAddUser').innerText = "確認新增成員";
    }
}

window.openEditModal = function(docId) {
    const user = allUsers.find(u => u.docId === docId);
    if (!user) return;

    document.getElementById('editDocId').value = user.docId;
    document.getElementById('editName').value = user.name;
    document.getElementById('editPin').value = user.pin || user.password || '';
    document.getElementById('editEmail').value = user.email || '';
    document.getElementById('editRole').value = user.role;
    
    const accountIdInput = document.getElementById('editAccountId');
    accountIdInput.value = user.accountId || '';
    
    if (user.accountId) {
        accountIdInput.readOnly = true;
        accountIdInput.title = "帳號 ID 設定後不可更改";
    } else {
        accountIdInput.readOnly = false;
    }

    const menusToSet = user.menus || systemMenuOptions.filter(m => m.isDefault).map(m => m.id);
    const checkboxes = document.getElementById('editMenusContainer').querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = menusToSet.includes(cb.value));

    document.getElementById('editModal').style.display = 'flex';
};

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

async function saveEditUser() {
    const docId = document.getElementById('editDocId').value;
    const idInput = document.getElementById('editAccountId').value.trim();
    const nameInput = document.getElementById('editName').value.trim();
    const pinInput = document.getElementById('editPin').value.trim();
    const emailInput = document.getElementById('editEmail').value.trim();
    const roleInput = document.getElementById('editRole').value;
    const selectedMenus = getCheckedMenus('editMenusContainer');

    const targetUser = allUsers.find(user => user.docId === docId);
    if (!targetUser) return alert('成員名單已變更，請重新開啟編輯。');
    if (targetUser.accountId && idInput !== targetUser.accountId) return alert('帳號 ID 設定後不可更改。');
    const originalPin = targetUser.pin || targetUser.password || '';
    if (!idInput || !nameInput || (!/^\d{4}$/.test(pinInput) && pinInput !== originalPin)) return alert("欄位或密碼格式錯誤！");
    
    if (allUsers.some(u => normalizeAccountId(u.accountId) === normalizeAccountId(idInput) && u.docId !== docId)) return alert("此「帳號 ID」已與其他成員重複！");
    if (nameInput !== targetUser.name && allUsers.some(u => u.name === nameInput && u.docId !== docId)) return alert("家族內「稱呼」不可重複！");

    try {
        await runTransaction(db, async transaction => {
            const group = await readManagedGroup(transaction);
            if (!group.members.includes(targetUser.accountId)) throw new Error('此成員已離開目前群組。');
            transaction.update(doc(db, 'users', docId), {
                accountId: idInput, name: nameInput, pin: pinInput,
                email: emailInput || null, role: roleInput, menus: selectedMenus
            });
        });

        if (currentUser && currentUser.accountId === targetUser.accountId) {
            currentUser.accountId = idInput; currentUser.name = nameInput;
            currentUser.pin = pinInput; currentUser.role = roleInput;
            currentUser.menus = selectedMenus;
            sessionStorage.setItem('familyCheckInUser', JSON.stringify(currentUser));
            if (localStorage.getItem('familyCheckInUser')) localStorage.setItem('familyCheckInUser', JSON.stringify(currentUser));
        }

        await logAction('系統操作', `更新了成員資訊：${nameInput}`);
        alert("儲存成功！");
        closeEditModal();
        await loadUsersFromFirebase();

    } catch (error) {
        alert("更新失敗，請檢視網路。");
    }
}

window.removeUser = async function(docId, targetName) {
    const user = allUsers.find(member => member.docId === docId);
    if (!user) return alert('成員名單已變更，請重新載入。');
    if (user.accountId === currentUser.accountId) return alert('為保護系統安全，您無法將自己退出群組！');
    if (!confirm(`確定要將成員【${user.name}】退出目前群組嗎？\n個人帳號、其他群組資格與歷史紀錄會保留。`)) return;
    try {
        await runTransaction(db, async transaction => {
            const group = await readManagedGroup(transaction);
            transaction.update(group.ref, { members: group.members.filter(id => id !== user.accountId) });
        });
        await logAction('系統操作', `已將成員退出群組：${user.name}`);
        alert(`已成功將【${user.name}】退出群組。`);
        await loadUsersFromFirebase();
    } catch (error) { alert('退出成員失敗：' + error.message); }
};

async function logAction(actionType, details) {
    const now = new Date();
    const datetimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
    
    await addDoc(collection(db, "logs"), {
        groupId: groupId,
        datetime: datetimeStr,
        operator: currentUser.name,
        actionType: actionType,
        details: details,
        timestamp: serverTimestamp()
    });
}

async function fetchLogsByDate() {
    const selectedDate = document.getElementById('logDateFilter').value;
    if (!selectedDate) {
        alert("請先選擇查詢日期！");
        return;
    }

    const container = document.getElementById('logContainer');
    container.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">資料載入中...</div>';

    try {
        const q = query(
            collection(db, "logs"), 
            where("datetime", ">=", `${selectedDate} 00:00:00`),
            where("datetime", "<=", `${selectedDate} 23:59:59`),
            orderBy("datetime", "desc")
        );

        const snapshot = await getDocs(q);
        allLogs = [];
        
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.groupId === groupId) allLogs.push(data);
        });

        renderLogs();
    } catch (error) {
        console.error("讀取操作紀錄失敗:", error);
        container.innerHTML = '<div style="text-align:center; color:#e53935; padding: 20px;">載入紀錄失敗，請檢查網路或索引設定</div>';
    }
}

function renderLogs() {
    const container = document.getElementById('logContainer');
    const filterName = document.getElementById('userFilter').value;
    container.innerHTML = '';

    const filteredLogs = allLogs.filter(log => filterName === 'all' || log.operator === filterName);

    if (filteredLogs.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">所選日期無任何操作紀錄。</div>';
        return;
    }

    filteredLogs.forEach(log => {
        const div = document.createElement('div');
        div.className = 'user-reset-item';
        div.style.alignItems = 'flex-start';
        div.innerHTML = `
            <div class="user-info">
                <div class="user-avatar" style="border:none; font-size:calc(24px * var(--n-font-scale, 1)); background:transparent;">📝</div>
                <div style="flex:1;">
                    <div class="user-name" style="color:var(--primary-color);">${log.actionType || '系統操作'}</div>
                    <div class="user-subtext"><b>操作人員:</b> ${log.operator || '未知'}</div>
                    <div class="user-subtext" style="color:#444;">${log.details || ''}</div>
                    <div class="user-features" style="color:#888; margin-top:6px;">🕒 ${log.datetime || ''}</div>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

document.getElementById('userFilter').addEventListener('change', renderLogs);
document.getElementById('btnBack').addEventListener('click', () => { window.location.href = 'index.html'; });