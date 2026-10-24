import { collection, addDoc, serverTimestamp, doc, updateDoc, arrayRemove, arrayUnion } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { currentUser, currentGroupId, refreshChatGroupMembers, chatState } from "./chat-core.js";

let uploadedAvatarBase64_Create = null; 
let uploadedAvatarBase64_Edit = null;
let savingMembers = false;

function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function openSubModal(id) { document.getElementById('roomSettingsMenu').style.display = 'none'; document.getElementById(id).style.display = 'flex'; }
function backToSettings(id) { document.getElementById(id).style.display = 'none'; document.getElementById('roomSettingsMenu').style.display = 'flex'; }

function renderMemberChoices(containerId, users, emptyMessage) {
    const container = document.getElementById(containerId);
    container.replaceChildren();
    for (const user of users) {
        const label = document.createElement('label'); label.className = 'member-item';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = user.accountId;
        const name = document.createElement('span'); name.textContent = user.name;
        label.append(input, name); container.appendChild(label);
    }
    if (!users.length) container.textContent = emptyMessage;
}

function resolveSelectedNames(ids, users) {
    const profiles = new Map(users.map(user => [user.accountId, user]));
    if (ids.some(id => !profiles.has(id))) throw new Error('部分成員已離開目前群組，請重新選擇。');
    // Keep the existing room participant name format for chat/read/unread compatibility.
    return [...new Set(ids)].map(id => profiles.get(id).name);
}

document.getElementById('btnOpenCreateModal').addEventListener('click', async () => {
    document.getElementById('createGroupName').value = ''; uploadedAvatarBase64_Create = null;
    document.getElementById('createAvatarPreview').src = 'https://ui-avatars.com/api/?name=G&background=10b981&color=fff';
    const button = document.getElementById('btnConfirmCreate'); button.disabled = true;
    const container = document.getElementById('createMemberList'); container.textContent = '載入目前群組成員中…';
    document.getElementById('createGroupModal').style.display = 'flex';
    try {
        const users = await refreshChatGroupMembers();
        renderMemberChoices('createMemberList', users, '群組內無其他成員可邀請');
        button.disabled = false;
    } catch (error) { container.textContent = '無法載入成員：' + error.message; }
});

document.getElementById('btnConfirmCreate').addEventListener('click', async () => {
    if (savingMembers) return;
    const name = document.getElementById('createGroupName').value.trim(); if (!name) return alert('請輸入群組名稱！');
    const ids = Array.from(document.querySelectorAll('#createMemberList input:checked')).map(cb => cb.value);
    const button = document.getElementById('btnConfirmCreate');
    savingMembers = true; button.disabled = true;
    try {
        const users = await refreshChatGroupMembers();
        const participants = [currentUser.name, ...resolveSelectedNames(ids, users)];
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
    } catch (error) { alert('建立失敗：' + error.message); }
    finally { savingMembers = false; button.disabled = false; }
});

document.getElementById('btnOpenSettingsMenu').addEventListener('click', () => {
    document.getElementById('editGroupName').value = chatState.activeRoomData.name;
    uploadedAvatarBase64_Edit = chatState.activeRoomData.avatar || null;
    document.getElementById('editAvatarPreview').src = uploadedAvatarBase64_Edit || `https://ui-avatars.com/api/?name=${chatState.activeRoomData.name}&background=ecfdf5&color=059669`;
    
    document.getElementById('roomSettingsMenu').style.display = 'flex';
});

// =================【新增踢人功能】=================
// 管理員 (admin/parent) 或是該群組的創立者 (creator) 才有權限踢人
function openViewMembers() {
    let html = '';
    const members = chatState.activeRoomData.participants || [];
    const isRoomAdmin = (currentUser.role === 'admin' || currentUser.role === 'parent' || chatState.activeRoomData.creator === currentUser.name);

    members.forEach(p => {
        let kickBtn = '';
        // 不要讓自己踢自己
        if (isRoomAdmin && p !== currentUser.name) {
            kickBtn = `<button class="btn-kick-member" onclick="window.chatRooms.kickMember('${p}')">移除</button>`;
        }
        
        html += `<div class="member-item" style="cursor:default; padding: 6px 0; display:flex; align-items:center;">
                    <span>👤 ${p}</span>
                    ${kickBtn}
                 </div>`;
    });
    document.getElementById('viewMemberList').innerHTML = html;
    openSubModal('viewMembersModal');
}

// 實際剔除成員的函式
async function kickMember(targetMember) {
    if (!confirm(`確定要將 ${targetMember} 移出聊天室嗎？`)) return;
    
    try {
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { participants: arrayRemove(targetMember) });

        const systemMsgText = `${targetMember} 已退出聊天室`;
        await addDoc(collection(db, "messages"), { 
            groupId: currentGroupId, 
            roomId: chatState.activeRoomId, 
            sender: "系統", 
            isSystem: true,
            text: systemMsgText, 
            timestamp: serverTimestamp() 
        });

        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { 
            lastMessage: systemMsgText, 
            lastMessageTime: serverTimestamp() 
        });

        // 刷新列表顯示
        openViewMembers(); 
        alert(`已將 ${targetMember} 移出聊天室`);
    } catch (e) { alert("移除成員失敗"); }
}

async function openInviteMembers() {
    const roomId = chatState.activeRoomId;
    const container = document.getElementById('inviteMemberList');
    const button = document.getElementById('btnSaveInvite'); button.disabled = true; button.style.display = 'block';
    container.textContent = '載入目前群組成員中…';
    openSubModal('inviteMembersModal');
    try {
        const users = await refreshChatGroupMembers();
        if (roomId !== chatState.activeRoomId) return;
        const currentMembers = chatState.activeRoomData.participants || [];
        const candidates = users.filter(user => !currentMembers.includes(user.name));
        renderMemberChoices('inviteMemberList', candidates, '所有群組成員都已經在聊天室內囉！');
        button.style.display = candidates.length ? 'block' : 'none'; button.disabled = false;
    } catch (error) { container.textContent = '無法載入成員：' + error.message; }
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

// =================【新增邀請提示功能】=================
document.getElementById('btnSaveInvite').addEventListener('click', async () => {
    if (savingMembers) return;
    const ids = Array.from(document.querySelectorAll('#inviteMemberList input:checked')).map(cb => cb.value);
    if (!ids.length) return alert('請先勾選要邀請的成員！');
    const roomId = chatState.activeRoomId;
    const button = document.getElementById('btnSaveInvite');
    savingMembers = true; button.disabled = true;
    try {
        const users = await refreshChatGroupMembers();
        if (!roomId || roomId !== chatState.activeRoomId || chatState.activeRoomData?.groupId !== currentGroupId) throw new Error('聊天室已變更，請重新開啟邀請。');
        const newMembers = resolveSelectedNames(ids, users).filter(name => !(chatState.activeRoomData.participants || []).includes(name));
        if (!newMembers.length) return backToSettings('inviteMembersModal');
        await updateDoc(doc(db, "rooms", roomId), { participants: arrayUnion(...newMembers) });
        for (const member of newMembers) {
            await addDoc(collection(db, "messages"), {
                groupId: currentGroupId, roomId, sender: '系統', isSystem: true,
                text: `${member} 加入聊天室`, timestamp: serverTimestamp()
            });
        }
        await updateDoc(doc(db, "rooms", roomId), {
            lastMessage: `${newMembers.join(', ')} 加入聊天室`, lastMessageTime: serverTimestamp()
        });
        backToSettings('inviteMembersModal');
    } catch (error) { alert('邀請成員失敗：' + error.message); }
    finally { savingMembers = false; button.disabled = false; }
});

async function leaveGroup() {
    if (!confirm(`確定要退出「${chatState.activeRoomData.name}」群組嗎？`)) return;
    try {
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { participants: arrayRemove(currentUser.name) });

        const systemMsgText = `${currentUser.name} 已退出聊天室`;
        await addDoc(collection(db, "messages"), { 
            groupId: currentGroupId, 
            roomId: chatState.activeRoomId, 
            sender: "系統", 
            isSystem: true,
            text: systemMsgText, 
            timestamp: serverTimestamp() 
        });

        await updateDoc(doc(db, "rooms", chatState.activeRoomId), { 
            lastMessage: systemMsgText, 
            lastMessageTime: serverTimestamp() 
        });

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
        if (msg.isSystem) {
            textOutput += `[${timeStr}] 系統: ${msg.text}\n`;
        } else {
            const content = msg.isRetracted ? "(收回了訊息)" : (msg.imageUrl ? "[傳送了圖片]" : msg.text);
            textOutput += `[${timeStr}] ${msg.sender}: ${content}\n`;
        }
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

// 將 kickMember 暴露給 HTML onClick 調用
window.chatRooms = {
    closeModal, openSubModal, backToSettings, openViewMembers, openInviteMembers,
    leaveGroup, exportChatHistory, openPhotoGallery, kickMember
};
