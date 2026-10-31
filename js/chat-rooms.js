import { mutateRoomIdentity, legacyRoomsForAdmin } from './chat-membership.js';
import { roomIdentity, creatorId, displayName, senderId } from './chat-identity-core.js';
import { collection, addDoc, serverTimestamp, doc, updateDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from "./firebase-config.js";
import { currentUser, currentGroupId, refreshChatGroupMembers, chatState, allProfiles, chatContext } from "./chat-core.js";

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

function resolveSelectedIds(ids, users) {
    const profiles = new Map(users.map(user => [user.accountId,user]));
    if(ids.some(id=>!profiles.has(id)))throw new Error('部分成員已離開目前群組，請重新選擇。');
    return [...new Set(ids)];
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
        const participantIds = [currentUser.accountId, ...resolveSelectedIds(ids, users)];
        await addDoc(collection(db, "rooms"), {
            groupId: currentGroupId,
            name,
            avatar: uploadedAvatarBase64_Create || '',
            participantIds,
            creatorAccountId: currentUser.accountId,
            creator: currentUser.name,
            lastSenderAccountId: currentUser.accountId,
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
    const container=document.getElementById('viewMemberList');container.replaceChildren();
    const members=roomIdentity(chatState.activeRoomData,allProfiles).ids;
    const admin=['admin','parent'].includes(currentUser.role)||creatorId(chatState.activeRoomData,allProfiles)===currentUser.accountId;
    for(const id of members){
        const row=document.createElement('div');row.className='member-item';
        const label=document.createElement('span');label.textContent=displayName(id,allProfiles)+'（'+id+'）';row.append(label);
        if(admin&&id!==currentUser.accountId){
            const button=document.createElement('button');button.className='btn-kick-member';button.textContent='移除';button.addEventListener('click',()=>kickMember(id));row.append(button);
        }
        container.append(row);
    }
    openSubModal('viewMembersModal');
}

// 實際剔除成員的函式
async function kickMember(targetMember) {
    const name=displayName(targetMember,allProfiles);
    if (!confirm(`確定要將 ${name} 移出聊天室嗎？`)) return;
    
    try {
        chatState.activeRoomData=await mutateRoomIdentity(chatContext,chatState.activeRoomId,{remove:[targetMember]});

        const systemMsgText = `${name} 已退出聊天室`;
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
        alert(`已將 ${name} 移出聊天室`);
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
        const currentMembers = roomIdentity(chatState.activeRoomData,allProfiles).ids;
        const candidates = users.filter(user => !currentMembers.includes(user.accountId));
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
        const newMembers = resolveSelectedIds(ids, users).filter(id => !roomIdentity(chatState.activeRoomData,allProfiles).ids.includes(id));
        if (!newMembers.length) return backToSettings('inviteMembersModal');
        chatState.activeRoomData=await mutateRoomIdentity(chatContext,roomId,{add:newMembers});
        for (const member of newMembers) {
            await addDoc(collection(db, "messages"), {
                groupId: currentGroupId, roomId, sender: '系統', isSystem: true,
                text: `${displayName(member,allProfiles)} 加入聊天室`, timestamp: serverTimestamp()
            });
        }
        await updateDoc(doc(db, "rooms", roomId), {
            lastMessage: `${newMembers.map(id=>displayName(id,allProfiles)).join(', ')} 加入聊天室`, lastMessageTime: serverTimestamp()
        });
        backToSettings('inviteMembersModal');
    } catch (error) { alert('邀請成員失敗：' + error.message); }
    finally { savingMembers = false; button.disabled = false; }
});

async function leaveGroup() {
    if (!confirm(`確定要退出「${chatState.activeRoomData.name}」群組嗎？`)) return;
    const roomId=chatState.activeRoomId;
    try {
        await mutateRoomIdentity(chatContext,roomId,{remove:[currentUser.accountId]});

        const systemMsgText = `${currentUser.name} 已退出聊天室`;
        await addDoc(collection(db, "messages"), { 
            groupId: currentGroupId, 
            roomId,
            sender: "系統", 
            isSystem: true,
            text: systemMsgText, 
            timestamp: serverTimestamp() 
        });

        await updateDoc(doc(db, "rooms", roomId), {
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
            textOutput += `[${timeStr}] ${displayName(senderId(msg,chatState.activeRoomData,allProfiles),allProfiles,msg.sender)}: ${content}\n`;
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

// Older name-only rooms with missing/ambiguous names need explicit administrator
// confirmation. Never guess a renamed account or grant every group member access.
const repairDialog=document.getElementById('chatIdentityRepair');
document.getElementById('btnCloseChatRepair').addEventListener('click',()=>repairDialog.close());
document.getElementById('btnRepairChatMembers').addEventListener('click',async()=>{
    const list=document.getElementById('chatRepairRooms');list.textContent='載入舊聊天室中…';repairDialog.showModal();
    try {
        const {rooms,profiles}=await legacyRoomsForAdmin(chatContext);list.replaceChildren();
        if(!rooms.length){list.textContent='所有聊天室都已使用固定帳號。';return;}
        for(const room of rooms){
            const section=document.createElement('section');section.className='chat-repair-room';section.dataset.roomId=room.id;
            const title=document.createElement('h4');title.textContent=room.name||'未命名聊天室';section.append(title);
            const fields=[];
            for(const name of [...new Set(room.participants||[])]){
                const label=document.createElement('label');label.textContent='舊名稱：'+name;
                const select=document.createElement('select');select.setAttribute('aria-label','舊名稱「'+name+'」對應帳號');
                const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='請確認對應帳號';select.append(placeholder);
                for(const profile of profiles){const option=document.createElement('option');option.value=profile.accountId;option.textContent=profile.name+'（'+profile.accountId+'）';select.append(option);}
                const removed=document.createElement('option');removed.value='__removed__';removed.textContent='已離開群組，不加入聊天室';select.append(removed);
                select.value=room.identity.bindings[name]||'';label.append(select);section.append(label);fields.push({name,select});
            }
            const status=document.createElement('p');status.setAttribute('role','status');
            const save=document.createElement('button');save.textContent='確認成員帳號';save.type='button';
            save.addEventListener('click',async()=>{
                if(!fields.length||fields.some(field=>!field.select.value)){status.textContent='請確認每個舊名稱的對應帳號。';return;}
                if(!confirm('請確認成員帳號正確；此操作會設定聊天室的進入資格。'))return;
                save.disabled=true;
                try{
                    await mutateRoomIdentity({...chatContext,profiles},room.id,{bindings:Object.fromEntries(fields.map(({name,select})=>[name,select.value==='__removed__'?null:select.value]))});
                    status.textContent='已改用固定帳號，成員可重新整理聊天室。';fields.forEach(({select})=>select.disabled=true);
                }catch(error){status.textContent=error.message;save.disabled=false;}
            });
            section.append(save,status);list.append(section);
        }
    }catch(error){list.textContent=error.message;}
});
