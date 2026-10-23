import { getSelectedGameGroupId } from './game-context.js';
import { loadGameGroupMembers } from './game-members.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { 
    getFirestore, collection, getDocs, doc, getDoc, setDoc, updateDoc, addDoc, 
    query, where, orderBy, serverTimestamp, onSnapshot 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

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

let systemMenuOptions = [];
let allLogs = [];
let allUsers = [];
let pendingRequests = [];

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
    initAdminPage();
}

async function loadSystemMenus() {
    try {
        const q = query(collection(db, "system_menus"), orderBy("order", "asc"));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            console.log("資料庫無功能卡設定，自動初始化預設清單...");
            const defaultMenus = [
                { id: 'chat', label: '💬 聊天室', isDefault: true, group: 'all', order: 1 },
                { id: 'calendar', label: '📅 行事曆', isDefault: true, group: 'all', order: 2 },
                { id: 'finance', label: '💰 記帳本', isDefault: true, group: 'all', order: 3 },
                { id: 'todo', label: '📝 待辦事項', isDefault: true, group: 'all', order: 4 },
                { id: 'photodump', label: '📸 Photo Dump', isDefault: true, group: 'all', order: 5 },
                { id: 'gamezone', label: '🎮 遊戲區', isDefault: true, group: 'all', order: 6 },
                { id: 'checkin', label: '📍 到家打卡', isDefault: false, group: 'family', order: 7 }, 
                { id: 'wishlist', label: '⭐ 許願牆', isDefault: false, group: 'family', order: 8 }
            ];

            for (const menu of defaultMenus) {
                await setDoc(doc(db, "system_menus", menu.id), menu);
            }
            systemMenuOptions = defaultMenus;
        } else {
            systemMenuOptions = [];
            snapshot.forEach(docSnap => {
                systemMenuOptions.push(docSnap.data());
            });
        }
    } catch (error) {
        console.error("無法讀取選單設定，請檢查索引或連線:", error);
    }
}

async function initAdminPage() {
    await loadSystemMenus();

    renderMenuCheckboxes('newMenusContainer', false); 
    renderMenuCheckboxes('editMenusContainer', true); 
    
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
    setupToggle('btnToggleUserList', 'userListContainer', 'toggleIconUserList');
    setupToggle('btnToggleLogs', 'logsSection', 'toggleIconLogs');
    
    await loadGroupSettings();
    await loadUsersFromFirebase();

    // 綁定按鈕點擊事件
    document.getElementById('btnAddUser').addEventListener('click', addNewUser);
    document.getElementById('btnSaveGroupName').addEventListener('click', saveGroupName);
    document.getElementById('btnQueryLogs').addEventListener('click', fetchLogsByDate);
    document.getElementById('btnRefreshRequests').addEventListener('click', fetchPendingRequests);
    document.getElementById('targetGameChatRoomSelect').addEventListener('change', (e) => saveTargetGameRoom(e.target.value));
    
    // 遊戲權限微調按鈕
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
    document.getElementById(btnId).addEventListener('click', () => {
        const el = document.getElementById(targetId);
        const icon = document.getElementById(iconId);
        if (el.style.display === 'none' || el.style.display === '') {
            el.style.display = (targetId === 'addUserForm' || targetId === 'groupSettingsForm') ? 'flex' : 'block';
            icon.innerText = '▲';
            if (onOpenCallback) onOpenCallback();
        } else {
            el.style.display = 'none';
            icon.innerText = '▼';
        }
    });
}

function renderMenuCheckboxes(containerId, isEdit) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    if (systemMenuOptions.length === 0) {
        container.innerHTML = '<div style="color:#e53935; font-size:12px; grid-column: 1 / -1;">無法載入選單，請重新整理網頁。</div>';
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
                    <div class="user-name">${req.userName} <span style="font-size:12px; color:var(--warning-color); font-weight:normal;">(${typeLabel})</span></div>
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
        await updateDoc(doc(db, "group_requests", reqId), {
            status: actionStatus,
            processedTime: serverTimestamp()
        });

        if (actionStatus === 'approved') {
            const defaultMenus = systemMenuOptions.filter(m => m.isDefault).map(m => m.id);
            const newUserObj = {
                groupId: groupId,
                accountId: targetUserId,
                name: targetUserName,
                role: 'member',
                menus: defaultMenus,
                avatar: `https://ui-avatars.com/api/?name=${targetUserName}&background=random`
            };
            await addDoc(collection(db, "users"), newUserObj);
            await logAction('系統操作', `審核通過：同意成員 ${targetUserName} 加入群組`);
        } else {
            await logAction('系統操作', `審核駁回：婉拒成員 ${targetUserName} 的入群申請`);
        }

        alert(`已成功${actionText}該申請！`);
        fetchPendingRequests();
        loadUsersFromFirebase();
    } catch (error) {
        console.error("審核處理失敗:", error);
        alert("處理失敗，請檢查網路連線。");
    }
};

// ==========================================
// 🌟 遊戲進入權限管理邏輯 (整合成員 management)
// ==========================================
let groupMembers = [];
let kidsPermissions = {};
let selectedMember = null;

async function initAdminGameManagement() {
    await loadGameChatRoomsForSelect();
    await loadParentAdminData();
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
    
    chipsContainer.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--text-sub);">載入「目前群組」成員中...</div>';

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
        chipsContainer.innerHTML = '<div style="color:red; font-size:12px;">載入成員失敗</div>';
    }
}

function renderMemberChips() {
    const chipsContainer = document.getElementById('memberChipsList');
    if (!chipsContainer) return;
    
    chipsContainer.innerHTML = '';
    if (groupMembers.length === 0) {
        chipsContainer.innerHTML = '<div style="font-size:12px; color:var(--text-sub);">尚無成員資料</div>';
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
    try {
        const q = query(collection(db, "users"), where("groupId", "==", groupId));
        const querySnapshot = await getDocs(q);
        
        allUsers = [];
        const filterSelect = document.getElementById('userFilter');
        filterSelect.innerHTML = '<option value="all">全部人員</option>';

        querySnapshot.forEach(docSnap => {
            const uData = docSnap.data();
            if(uData.role !== 'removed') {
                allUsers.push({ docId: docSnap.id, ...uData });
                const opt = document.createElement('option');
                opt.value = uData.name;
                opt.innerText = uData.name;
                filterSelect.appendChild(opt);
            }
        });

        renderUserList();
    } catch (error) {
        console.error("載入成員失敗：", error);
        document.getElementById('userListContainer').innerHTML = '<div style="text-align:center; color:#e53935;">載入成員失敗</div>';
    }
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
        div.innerHTML = `
            <div class="user-info">
                <img class="user-avatar" src="${user.avatar || 'homebase_icon.jpg'}" onerror="this.src='https://ui-avatars.com/api/?name=${user.name}'">
                <div>
                    <div class="user-name">${user.name} <span style="font-size:12px; color:var(--primary-color); font-weight:normal;">(${roleDisplay})</span></div>
                    <div class="user-subtext">${idDisplay}</div>
                    <div class="user-features">✓ 開放權限: ${menuLabels || '無'}</div>
                </div>
            </div>
            <div class="action-buttons">
                <button class="btn-edit" onclick="openEditModal('${user.docId}')">編輯</button>
                <button class="btn-remove" onclick="removeUser('${user.docId}', '${user.name}')">退出</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function addNewUser() {
    const idInput = document.getElementById('newUserId').value.trim();
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
    
    if (allUsers.some(u => u.accountId === idInput)) return alert("此「帳號 ID」已存在，請更換一個！");
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

        await addDoc(collection(db, "users"), newUser);
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
        alert("新增成員失敗，請檢視連線。");
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
    document.getElementById('editPin').value = user.pin;
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

    if (!idInput || !nameInput || !/^\d{4}$/.test(pinInput)) return alert("欄位或密碼格式錯誤！");
    
    if (allUsers.some(u => u.accountId === idInput && u.docId !== docId)) return alert("此「帳號 ID」已與其他成員重複！");
    if (allUsers.some(u => u.name === nameInput && u.docId !== docId)) return alert("家族內「稱呼」不可重複！");

    try {
        await updateDoc(doc(db, "users", docId), {
            accountId: idInput, name: nameInput, pin: pinInput,
            email: emailInput || null, role: roleInput, menus: selectedMenus
        });

        if (currentUser && currentUser.name === allUsers.find(u => u.docId === docId)?.name) {
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
    if (targetName === currentUser.name) {
        return alert("為保護系統安全，您無法將自己退出群組！");
    }

    const confirmMsg = `⚠️ 確定要將成員【${targetName}】退出群組嗎？\n\n(註：該人員資料與歷史紀錄仍會保留，但無法再存取本群組)`;
    if (confirm(confirmMsg)) {
        try {
            await updateDoc(doc(db, "users", docId), { 
                groupId: null,
                role: 'removed' 
            });
            
            await logAction('系統操作', `已將成員退出群組：${targetName}`);
            alert(`已成功將【${targetName}】退出群組。`);
            await loadUsersFromFirebase(); 
        } catch (error) {
            alert("退出成員失敗，請檢視連線。");
        }
    }
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
                <div class="user-avatar" style="border:none; font-size:24px; background:transparent;">📝</div>
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