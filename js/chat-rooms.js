import { collection, addDoc, serverTimestamp, doc, updateDoc, arrayRemove } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
// 1. 直接從 firebase-config.js 引入 db
import { db } from "./firebase-config.js";
// 2. 從 chat-core.js 引入共用狀態 (把 db 拿掉)
import { currentUser, currentGroupId, allUsers, chatState } from "./chat-core.js";

let uploadedAvatarBase64_Create = null; 
let uploadedAvatarBase64_Edit = null; 

function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openSubModal(id) { document.getElementById('roomSettingsMenu').style.display = 'none'; document.getElementById(id).style.display = 'flex'; }
function backToSettings(id) { document.getElementById(id).style.display = 'none'; document.getElementById('roomSettingsMenu').style.display = 'flex'; }

// 取得屬於當前主群組成員的列表（排除自身或包含自身，依介面需求）
function getGroupMembers() {
    return allUsers.filter(u => {
        // 判斷使用者是否屬於當前群組 (相容 groupIds 陣列、groups 陣列或主群組紀錄)
        if (u.groupIds && Array.isArray(u.groupIds)) return u.groupIds.includes(currentGroupId);
        if (u.groups && Array.isArray(u.groups)) {
            return u.groups.some(g => (typeof g === 'object' ? g.id : g) === currentGroupId);
        }
        if (u.groupId) return u.groupId === currentGroupId;
        return true; // 若無特別區分群組欄位則預設保留
    });
}

function getCheckboxesHtml(containerId, selected = []) {
    let html = '';
    const groupUsers = getGroupMembers();
    
    groupUsers.forEach(u => {
        // 新增群組時排除自己，因為創建者預設會自動加入
        if (u.name !== currentUser.name) {
            html += `<label class="member-item"><input type="checkbox" value="${u.name}" ${selected.includes(u.name) ? 'checked' : ''}> <span>${u.name}</span></label>`;
        }
    });

    if (!html) {
        html = '<div style="color:var(--text-sub); font-size:14px; text-align:center; padding:10px 0;">群組內無其他成員可邀請</div>';
    }

    document.getElementById(containerId).innerHTML = html;
}

document.getElementById('btnOpenCreateModal').addEventListener('click', () => {
    document.getElementById('createGroupName').value = ''; uploadedAvatarBase64_Create = null;
    document.getElementById('createAvatarPreview').src = 'https://ui-avatars.com/api/?name=G&background=10b981&color=fff';
    getCheckboxesHtml('createMemberList', []);
    document.getElementById('createGroupModal').style.display = 'flex';
});

document.getElementById('btnConfirmCreate').addEventListener('click', async () => {
    const name = document.getElementById('createGroupName').value.trim(); if (!name) return alert('請輸入群組名稱！');
    const checkboxes = document.querySelectorAll('#createMemberList input[type="checkbox"]:checked');
    const participants = [currentUser.name, ...Array.from(checkboxes).map(cb => cb.value)];
    try {
        await addDoc(collection(db, "rooms"), { 
            groupId: currentGroupId, 
            name, 
            avatar: uploadedAvatarBase64_Create || '', 
            participants, 
            creator: currentUser.name, 
            lastMessage: `${currentUser.name} 建立了群組`, 
            lastMessageTime: serverTimestamp() 
        });
        closeModal('createGroupModal');
    } catch (e) { alert("建立失敗！"); }
});

document.getElementById('btnOpenSettingsMenu').addEventListener('click', () => {
    document.getElementById('editGroupName').value = chatState.activeRoomData.name;
    uploadedAvatarBase64_Edit = chatState.activeRoomData.avatar || null;
    document.getElementById('editAvatarPreview').src = uploadedAvatarBase64_Edit || `https://ui-avatars.com/api/?name=${chatState.activeRoomData.name}&background=ecfdf5&color=059669`;
    
    document.getElementById('roomSettingsMenu').style.display = 'flex';
});

function openViewMembers() {
    let html = '';
    const members = chatState.activeRoomData.participants || [];
    members.forEach(p => {
        html += `<div class="member-item" style="cursor:default; padding: 4px 0;"><span>👤 ${p}</span></div>`;
    });
    document.getElementById('viewMemberList').innerHTML = html;
    openSubModal('viewMembersModal');
}

function openInviteMembers() {
    let html = '';
    let hasCandidates = false;
    const currentMembers = chatState.activeRoomData.participants || [];
    const groupUsers = getGroupMembers();
    
    groupUsers.forEach(u => {
        // 只列出属于当前主群组，且尚未加入该聊天室的成員
        if (!currentMembers.includes(u.name)) {
            hasCandidates = true;
            html += `<label class="member-item"><input type="checkbox" value="${u.name}"> <span>${u.name}</span></label>`;
        }
    });

    if (!hasCandidates) {
        html = '<div style="color:var(--text-sub); font-size:14px; text-align:center; padding:20px 0;">所有群組成員都已經在聊天室內囉！</div>';
        document.getElementById('btnSaveInvite').style.display = 'none';
    } else {
        document.getElementById('btnSaveInvite').style.display = 'block';
    }

    document.getElementById('inviteMemberList').innerHTML = html;
    openSubModal('inviteMembersModal');
}

document.getElementById('btnSaveGroupEdit').addEventListener('click', async () => {
    const name = document.getElementById('editGroupName').value.trim(); if (!name) return alert('請輸入名稱！');
    try {
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { name, avatar: uploadedAvatarBase64_Edit || '' });
        document.getElementById('activeRoomName').innerText = name;
        document.getElementById('activeRoomAvatar').src = uploadedAvatarBase64_Edit || `https://ui-avatars.com/api/?name=${name}&background=ecfdf5&color=059669`;
        backToSettings('editGroupModal');
    } catch (e) { alert("儲存失敗"); }
});

document.getElementById('btnSaveInvite').addEventListener('click', async () => {
    const checkboxes = document.querySelectorAll('#inviteMemberList input[type="checkbox"]:checked');
    const newMembers = Array.from(checkboxes).map(cb => cb.value);
    
    if (newMembers.length === 0) return alert('請先勾選要邀請的成員！');
    
    const participants = [...(chatState.activeRoomData.participants || []), ...newMembers];
    try {
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { participants });
        backToSettings('inviteMembersModal');
    } catch (e) { alert("邀請成員失敗"); }
});

async function leaveGroup() {
    if (!confirm(`確定要退出「${chatState.activeRoomData.name}」群組嗎？`)) return;
    try {
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { participants: arrayRemove(currentUser.name) });
        closeModal('roomSettingsMenu');
        document.getElementById('btnBackToList').click();
    } catch (e) { alert("退出失敗"); }
}

function exportChatHistory() {
    if (chatState.currentMessagesList.length === 0) return alert("目前沒有聊天記錄");
    let textOutput = `=== 【${chatState.activeRoomData.name}】聊天記錄 ===\n匯出時間：${new Date().toLocaleString()}\n\n`;
    
    chatState.currentMessagesList.forEach(msg => {
        let timeStr = "";
        if (msg.timestamp && msg.timestamp.toDate) {
            const d = msg.timestamp.toDate();
            timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
        }
        const content = msg.isRetracted ? "(收回了訊息)" : (msg.imageUrl ? "[傳送了圖片]" : msg.text);
        textOutput += `[${timeStr}] ${msg.sender}: ${content}\n`;
    });

    const blob = new Blob([textOutput], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${chatState.activeRoomData.name}_聊天記錄.txt`;
    a.click();
    URL.revokeObjectURL(url);
}

function openPhotoGallery() {
    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '';
    const photos = chatState.currentMessagesList.filter(m => m.imageUrl && !m.isRetracted);
    
    if (photos.length === 0) {
        grid.innerHTML = '<div style="grid-column: span 3; text-align:center; padding:30px; color:var(--text-sub);">群組內還沒有照片喔！</div>';
    } else {
        photos.forEach(m => {
            const img = document.createElement('img');
            img.src = m.imageUrl; img.className = 'gallery-item';
            img.onclick = (e) => {
                e.stopPropagation();
                window.chatCore.openPhotoViewer(m.imageUrl);
            };
            grid.appendChild(img);
        });
    }
    openSubModal('photoGalleryModal');
}

function handleAvatarUpload(inputId, previewId, isCreate) {
    document.getElementById(inputId).addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(evt) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
                const maxSize = 200; let width = img.width, height = img.height;
                if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
                canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
                const b64 = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById(previewId).src = b64;
                if (isCreate) uploadedAvatarBase64_Create = b64; else uploadedAvatarBase64_Edit = b64;
            }; img.src = evt.target.result;
        }; reader.readAsDataURL(file);
    });
}
handleAvatarUpload('createAvatarInput', 'createAvatarPreview', true);
handleAvatarUpload('editAvatarInput', 'editAvatarPreview', false);

// 將需要被 HTML 觸發的函數掛載到 window
window.chatRooms = {
    closeModal, openSubModal, backToSettings, openViewMembers, openInviteMembers,
    leaveGroup, exportChatHistory, openPhotoGallery
};
