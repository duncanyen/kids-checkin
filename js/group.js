import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

let hasGroupSelection = false;
let groupMutationBusy = false;

window.showActionSection = function() {
    window.stopDashboardListeners?.();
    document.getElementById('backToGroupSelection').hidden = !hasGroupSelection;
    window.hideAllSections();
    document.getElementById('actionSection').classList.add('active');
    window.goToActionStep('obStepAction');
};

window.goToActionStep = function(stepId) {
    document.getElementById('actionSection').querySelectorAll('.auth-form-container').forEach(el => el.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
};

window.returnToGroupSelection = async function() {
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || 'null');
    if (!user?.accountId) { window.showAuthSection(); return; }
    await window.evaluateUserGroups(user, { forceSelection: true });
};

window.selectPresetIcon = function(el, iconChar) {
    document.querySelectorAll('.preset-icon').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    window.selectedPresetIcon = iconChar;
};

window.processCreateGroup = async function() {
    if (groupMutationBusy) return;
    const groupName = document.getElementById('obGroupName').value.trim();
    if (!groupName) { alert("請為群組取個名稱！"); return; }
    
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || 'null');
    if (!user?.accountId || !user.docId) { alert('請重新登入後再操作。'); return; }
    groupMutationBusy = true;
    document.getElementById('loadingView').style.display = 'flex';
    
    try {
        await updateDoc(doc(db, "users", user.docId), { role: 'admin' });
        user.role = 'admin';
        sessionStorage.setItem('familyCheckInUser', JSON.stringify(user));

        // 【修改處 1】建立群組時，members 陣列改用 user.accountId 替代 user.name
        const newGroupData = {
            name: groupName,
            icon: window.selectedPresetIcon,
            members: [user.accountId],
            inviteCode: window.generateInviteCode(),
            createdAt: serverTimestamp()
        };
        
        const groupRef = await addDoc(collection(db, "groups"), newGroupData);
        const newGroup = { id: groupRef.id, ...newGroupData };
        
        document.getElementById('loadingView').style.display = 'none';
        await window.enterGroup(newGroup);
    } catch(e) {
        console.error("群組建立失敗", e);
        alert("群組建立失敗，請稍後再試。");
        document.getElementById('loadingView').style.display = 'none';
    } finally {
        groupMutationBusy = false;
    }
};

window.processJoinGroup = async function() {
    if (groupMutationBusy) return;
    const code = document.getElementById('obInviteCode').value.trim().toUpperCase();
    if (!code) { alert("請輸入邀請碼！"); return; }
    
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || 'null');
    if (!user?.accountId || !user.docId) { alert('請重新登入後再操作。'); return; }
    groupMutationBusy = true;
    document.getElementById('loadingView').style.display = 'flex';
    
    try {
        const q = query(collection(db, "groups"), where("inviteCode", "==", code));
        const snap = await getDocs(q);
        
        if (snap.empty) {
            alert("找不到此邀請碼對應的群組，請確認是否輸入正確。");
            document.getElementById('loadingView').style.display = 'none';
            return;
        }
        
        const groupDoc = snap.docs[0];
        const groupData = groupDoc.data();
        let members = groupData.members || [];
        
        // 【修改處 2】加入群組時，檢查與寫入的是 user.accountId 而非 user.name
        if (!members.includes(user.accountId)) {
            members.push(user.accountId);
            await updateDoc(doc(db, "groups", groupDoc.id), { members: members });
        }
        
        alert(`成功加入群組「${groupData.name}」！`);
        localStorage.removeItem('pendingInviteCode');
        
        const joinedGroup = { id: groupDoc.id, ...groupData, members };
        document.getElementById('loadingView').style.display = 'none';
        await window.enterGroup(joinedGroup);
        
    } catch(e) {
        alert("加入群組失敗，請檢查網路。");
        document.getElementById('loadingView').style.display = 'none';
    } finally {
        groupMutationBusy = false;
    }
};

window.generateInviteCode = function() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
};

window.showGroupSelectionList = function(userGroups) {
    hasGroupSelection = true;
    window.stopDashboardListeners?.();
    document.getElementById('returnToCurrentGroup').hidden = !userGroups.some(group => group.id === window.currentGroup?.id);
    window.hideAllSections();
    const container = document.getElementById('groupListContainer');
    container.innerHTML = '';
    
    userGroups.forEach(g => {
        const card = document.createElement('div'); 
        card.className = 'group-card';
        card.onclick = () => window.enterGroup(g);
        
        const icon = document.createElement(g.icon?.startsWith('data:image') ? 'img' : 'div');
        icon.className = icon.tagName === 'IMG' ? 'group-icon-img' : 'group-icon';
        if (icon.tagName === 'IMG') { icon.src = g.icon; icon.alt = ''; }
        else icon.textContent = g.icon || '🏠';
        const name = document.createElement('div');
        name.className = 'group-name';
        name.textContent = g.name;
        card.append(icon, name);
        container.appendChild(card);
    });
    document.getElementById('groupSelectionSection').classList.add('active');
};

window.enterGroup = async function(groupObj) {
    window.currentGroup = groupObj;
    localStorage.setItem('lastGroupId', groupObj.id);
    sessionStorage.setItem('nexus_active_group_id', groupObj.id);
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    
    await window.recordLog(user.name, '系統操作', `進入了群組: ${groupObj.name}`);
    await window.showDashboard();
};

window.openInviteModal = async function() {
    if (!window.currentGroup) { alert("無法取得群組資訊！"); return; }
    document.getElementById('sidebar').classList.remove('active');
    document.getElementById('sidebarOverlay').classList.remove('active');
    let code = window.currentGroup.inviteCode;
    if (!code) {
        code = window.generateInviteCode();
        window.currentGroup.inviteCode = code;
        await updateDoc(doc(db, "groups", window.currentGroup.id), { inviteCode: code });
    }
    document.getElementById('displayInviteCode').innerText = code;
    document.getElementById('inviteModal').style.display = 'flex';
};

window.shareToLine = function() {
    const code = window.currentGroup.inviteCode;
    const link = `${window.location.origin}${window.location.pathname}?code=${code}`;
    const text = `一起用Nexus連結彼此的日常，讓我們更靠近!\n點連結加入同一個家，可以免費開始使用。\n\n邀請碼：${code}\n連結：${link}`;
    window.open(`https://line.me/R/msg/text/?${encodeURIComponent(text)}`, '_blank');
};
