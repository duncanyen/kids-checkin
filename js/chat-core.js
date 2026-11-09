/**
 * 聊天室頁面狀態、訊息訂閱與分頁入口，依賴群組成員識別及 live-reads 適配層。
 * 房間成員優先使用 accountId；歷史訊息以 ChatHistory 合併，不以一天作為保留期限。
 * @module
 */
import { ChatHistory, MESSAGE_PAGE_SIZE } from './chat-history.js';
import * as messageStore from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { loadChatProfiles, watchMemberRooms, mutateRoomIdentity } from './chat-membership.js';
import { roomIdentity, roomHasMember, displayName, senderId, unreadFor, readFor } from './chat-identity-core.js';
import { watchRoom, watchMessages } from './live-reads.js';
import { getSelectedGameGroupId, watchGameContext } from './game-context.js';
import { db } from './firebase-config.js'; 
import { 
    collection, addDoc, query, where, orderBy, limit,
    serverTimestamp, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// --- 共用全域變數 ---
export const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
export const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;


export const currentGroupId = getSelectedGameGroupId(currentUser);
if (!currentUser?.accountId || !currentGroupId) {
    alert('請先登入並選擇群組，再進入聊天室。');
    window.location.replace('index.html');
    throw new Error('缺少聊天室帳號或群組');
}
watchGameContext({ accountId: currentUser.accountId, groupId: currentGroupId });
export let allUsers = [];
export let allProfiles = [];
export const chatContext = { groupId: currentGroupId, accountId: currentUser.accountId, get profiles(){return allProfiles;} };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isMyMessage = message => senderId(message, chatState.activeRoomData, allProfiles) === currentUser.accountId;

export const chatState = {
    activeRoomId: null,
    activeRoomData: null,
    currentMessagesList: [],
    entryReadTimestamp: 0
};

let roomsUnsubscribe = null;
let messagesUnsubscribe = null;
let messageHistory = null;
let singleRoomUnsubscribe = null; 
let pendingReplyMsgId = null;
let pendingReplyData = null;
let selectedMsgForAction = null; 
let isFirstLoad = true; 
window._isChatJustLoaded = false; 

// 以 groups.members 為成員依據，不重用過去的全域 users 快取。
export async function refreshChatGroupMembers() {
    const members = await loadChatProfiles(currentGroupId, currentUser.accountId);
    let latestUser;
    try { latestUser = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null'); } catch {}
    if (getSelectedGameGroupId(latestUser) !== currentGroupId || latestUser?.accountId !== currentUser.accountId) {
        throw new Error('帳號或群組已切換，請重新進入聊天室。');
    }
    if (!members.some(member => member.accountId === currentUser.accountId)) throw new Error('找不到有效的群組成員資料，請重新登入。');
    allProfiles = members;
    const own = members.find(member => member.accountId === currentUser.accountId);
    Object.assign(currentUser, { name: own.name, role: own.role, nameHistory: own.nameHistory || [] });
    document.getElementById('btnRepairChatMembers').hidden=!['admin','parent'].includes(currentUser.role);
    allUsers = members.filter(member => member.accountId !== currentUser.accountId);
    if (!roomsUnsubscribe) listenToRooms();
    return allUsers;
}

function listenToRooms() {
    roomsUnsubscribe = watchMemberRooms(currentGroupId, currentUser.accountId, allProfiles, (snapshot) => {
        const container = document.getElementById('roomListContainer');
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:600;">此群組尚未有聊天室，點擊上方建立一個吧！</div>';
            return;
        }
        snapshot.forEach(docSnap => {
            const room = docSnap.data();
            const roomId = docSnap.id;
            


            let timeStr = "";
            if (room.lastMessageTime && room.lastMessageTime.toDate) {
                const dateObj = room.lastMessageTime.toDate();
                timeStr = `${String(dateObj.getMonth()+1).padStart(2,'0')}/${String(dateObj.getDate()).padStart(2,'0')} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;
            }

            const displayAvatar = room.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(room.name || '')}&background=ecfdf5&color=059669`;
            const displayLastMsg = room.lastMessage || "尚未有訊息";
            
            let myUnreadCount = unreadFor(room, currentUser.accountId, allProfiles);
            let unreadBadgeHtml = myUnreadCount > 0 ? `<span class="unread-badge">${myUnreadCount > 99 ? '99+' : myUnreadCount}</span>` : '';

            const div = document.createElement('div');
            div.className = 'room-item';
            div.dataset.roomId=roomId;
            div.onclick = () => enterRoom(roomId, room);
            div.innerHTML = `
                <img src="${escapeHtml(displayAvatar)}" class="room-avatar">
                <div class="room-info">
                    <div class="room-title-row">
                        <span class="room-name">${escapeHtml(room.name)}</span>
                        <span class="room-time">${timeStr}</span>
                    </div>
                    <div class="room-last-msg">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;">${escapeHtml(displayLastMsg)}</span>
                        ${unreadBadgeHtml}
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    }, (error) => {
        console.error("【索引錯誤】讀取群組清單失敗！", error.message);
        document.getElementById('roomListContainer').textContent = '聊天室載入失敗，請檢查網路後重新整理。';
    });
}

async function enterRoom(roomId, roomData) {
    if (roomData.groupId !== currentGroupId || !roomHasMember(roomData,currentUser.accountId,allProfiles)) return;

    chatState.activeRoomId = roomId;
    chatState.activeRoomData = roomData;


    chatState.currentMessagesList = [];
    messageHistory = null;
    isFirstLoad = true; 
    
    chatState.entryReadTimestamp = readFor(roomData,currentUser.accountId,allProfiles);
    
    document.getElementById('mainTopNav').style.display = 'none';
    document.getElementById('viewRoomList').style.display = 'none';
    document.getElementById('viewChatRoom').style.display = 'flex';
    
    document.getElementById('activeRoomName').innerText = roomData.name;
    document.getElementById('activeRoomAvatar').src = roomData.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(roomData.name || '')}&background=ecfdf5&color=059669`;
    
    markRoomRead(roomId, true);
    listenToMessages(roomId);
    listenToActiveRoom(roomId); 
}

function listenToActiveRoom(roomId) {
    if (singleRoomUnsubscribe) singleRoomUnsubscribe(); 
    singleRoomUnsubscribe = watchRoom(doc(db, "rooms", roomId), currentGroupId, roomId, (docSnap) => {
        if (docSnap.exists()) {
            const room=docSnap.data();
            if(room.groupId!==currentGroupId||!roomHasMember(room,currentUser.accountId,allProfiles)) {
                document.getElementById('btnBackToList').click();
                alert('你已不在此聊天室內。');return;
            }
            chatState.activeRoomData = room;
            renderAllMessages();             
        }
    });
}

const READ_MARK_THROTTLE_MS = 45000;
const READ_MARK_FRESH_MS = 5 * 60 * 1000;
let lastReadMarkAt = 0;

async function markRoomRead(roomId, force = false) {
    if (!roomId || document.visibilityState !== 'visible') return;

    const me = currentUser.accountId;
    const room = chatState.activeRoomData || {};
    const unread = unreadFor(room,me,allProfiles);
    const lastRead = readFor(room,me,allProfiles);
    const now = Date.now();

    if (unread === 0 && lastRead > 0 && (now - lastRead) < READ_MARK_FRESH_MS) return;
    if (!force && (now - lastReadMarkAt) < READ_MARK_THROTTLE_MS) return;

    lastReadMarkAt = now;
    if(!roomHasMember(room,me,allProfiles))return;
    try {
        await mutateRoomIdentity(chatContext,roomId,{readAt:now});
    } catch (error) { console.warn('聊天室已讀狀態未儲存',error.message); }

}

document.getElementById('btnBackToList').addEventListener('click', () => {
    markRoomRead(chatState.activeRoomId, true);
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (singleRoomUnsubscribe) singleRoomUnsubscribe(); 
    
    messageHistory = null;
    chatState.activeRoomId = null; chatState.activeRoomData = null; chatState.currentMessagesList = [];
    document.getElementById('chatMessages').replaceChildren();
    document.getElementById('mainTopNav').style.display = 'flex';
    document.getElementById('viewChatRoom').style.display = 'none';
    document.getElementById('viewRoomList').style.display = 'flex';
});

/**
 * 建立單一房間的訊息游標查詢；每頁 30 筆，以 timestamp 倒序取得。
 * @param {string} roomId - 已確認可進入的房間 ID。
 * @param {Object} [cursor] - 原始 Firestore 文件快照，保留同時間文件的排序精度。
 * @returns {Object} Firestore Query；此查詢本身僅篩 roomId，資格由房間流程及 Rules 負責。
 */
function messageQuery(roomId, cursor) {
    return query(collection(db, "messages"), where("roomId", "==", roomId),
        orderBy("timestamp", "desc"), ...(cursor ? [messageStore.startAfter(cursor)] : []), limit(MESSAGE_PAGE_SIZE));
}

/**
 * 取代目前訊息監聽，合併即時最新頁與手動載入的歷史頁。
 * @param {string} roomId - 目前房間 ID。
 * @returns {void} 停止函式保存在 messagesUnsubscribe，切換房間時先解除。
 * @description RTDB 顯示資料不可直接當 Firestore 游標，需回讀錨點文件。
 */
function listenToMessages(roomId) {
    messagesUnsubscribe?.();
    const history = messageHistory = new ChatHistory(roomId, async (cursor, oldest) => {
        // RTDB 時間值不是 Firestore 文件游標；回讀最舊可見文件作錨點，保留奈秒精度及同時間的文件鍵次序。
        if (!cursor && oldest) {
            const anchor = await messageStore.getDoc(doc(db, "messages", oldest.id));
            if (anchor.exists()) {
                const data=anchor.data();
                if (data.roomId !== roomId || (data.groupId && data.groupId !== currentGroupId)) throw Error('無法讀取此聊天室記錄');
                cursor=anchor;
            }
        }
        const snapshot=await messageStore.getDocs(messageQuery(roomId,cursor));
        const rows=snapshot.docs;
        return { messages:rows.map(row=>({ ...row.data(), id:row.id })),
            cursor:rows.at(-1), hasMore:rows.length === MESSAGE_PAGE_SIZE };
    });
    messagesUnsubscribe = watchMessages(messageQuery(roomId), currentGroupId, roomId, MESSAGE_PAGE_SIZE, snapshot => {
        if (messageHistory !== history) return;
        const rows=[];
        snapshot.forEach(row=>rows.push({ ...row.data(), id:row.id }));
        chatState.currentMessagesList=history.merge(rows);
        if (!history.cursor && history.messages.size === 0) history.hasMore=false;
        else if (!history.cursor) history.hasMore=true;
        renderAllMessages();
        markRoomRead(roomId);
    }, error => {
        if (messageHistory !== history) return;
        console.error('讀取聊天訊息失敗',error.message);
        history.error=true;
        renderAllMessages();
    });
}

async function loadOlderMessages() {
    const history=messageHistory;
    if (!history || history.loading || !history.hasMore) return;
    const container=document.getElementById('chatMessages');
    const pending=history.loadOlder();
    updateHistoryControl();
    try {
        await pending;
        if (messageHistory !== history) return;
        const oldTop=container.scrollTop, oldHeight=container.scrollHeight;
        chatState.currentMessagesList=history.list;
        renderAllMessages(true);
        // 載入歷史時保留使用者目前閱讀位置上方的訊息。
        container.scrollTop=oldTop+container.scrollHeight-oldHeight;
    } catch(error) {
        if (messageHistory !== history) return;
        console.warn('歷史訊息載入失敗',error);
        updateHistoryControl();
    }
}

function updateHistoryControl() {
    const button=document.getElementById('loadOlderMessages');
    if (!button || !messageHistory) return;
    button.disabled=messageHistory.loading || !messageHistory.hasMore;
    button.textContent=messageHistory.loading ? '載入中…' : messageHistory.error ? '載入失敗，點此重試' : messageHistory.hasMore ? '載入更早訊息' : '已載入全部記錄';
}

function lockScrollPosition() {
    const msgContainer = document.getElementById('chatMessages');
    if (!msgContainer) return;
    const divider = document.getElementById('unread-divider-line');
    if (divider) msgContainer.scrollTop = Math.max(0, divider.offsetTop - 80);
    else msgContainer.scrollTop = msgContainer.scrollHeight;
}

function renderAllMessages(preserveScroll = false) {
    const msgContainer = document.getElementById('chatMessages');
    const prevScrollTop = msgContainer.scrollTop;
    const prevScrollHeight = msgContainer.scrollHeight;
    const isAtBottom = (prevScrollHeight - prevScrollTop) <= (msgContainer.clientHeight + 150);
    
    msgContainer.innerHTML = '';
    const historyControl=document.createElement('button');
    historyControl.id='loadOlderMessages';historyControl.type='button';historyControl.className='chat-history-control';
    historyControl.addEventListener('click',loadOlderMessages);
    msgContainer.appendChild(historyControl);
    updateHistoryControl();
    let unreadDividerAdded = false;
    let lastDateStr = ""; // 紀錄上一則訊息的日期

    if (chatState.currentMessagesList.length === 0) {
        msgContainer.insertAdjacentHTML('beforeend', '<div style="text-align:center; color:var(--text-sub); font-size:calc(13px * var(--n-font-scale, 1)); margin-top:20px; font-weight:600;">發個訊息打招呼吧！</div>');
    }

    chatState.currentMessagesList.forEach(msg => {
        let msgTimestampMs = Date.now();
        if (msg.timestamp && msg.timestamp.toDate) msgTimestampMs = msg.timestamp.toDate().getTime();

        // --- LINE風格 日期分隔線判斷 ---
        const d = new Date(msgTimestampMs);
        const currentDateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        if (currentDateStr !== lastDateStr) {
            const dateDivider = document.createElement('div');
            dateDivider.className = "date-divider";
            dateDivider.innerHTML = `<span class="date-badge">${currentDateStr}</span>`;
            msgContainer.appendChild(dateDivider);
            lastDateStr = currentDateStr;
        }

        // --- 未讀新訊息分隔線 ---
        if (!unreadDividerAdded && chatState.entryReadTimestamp > 0 && msgTimestampMs > chatState.entryReadTimestamp && !isMyMessage(msg) && !msg.isSystem) {
            const divider = document.createElement('div');
            divider.id = "unread-divider-line";
            divider.className = "unread-divider";
            divider.innerHTML = `<hr style="margin-right:10px;"> <span>⬇ 以下為尚未閱讀的新訊息</span> <hr style="margin-left:10px;">`;
            msgContainer.appendChild(divider);
            unreadDividerAdded = true;
        }

        appendMessageUI(msg.id, msg, msgTimestampMs);
    });

    if (isFirstLoad) {
        isFirstLoad = false;
        window._isChatJustLoaded = true; 
        requestAnimationFrame(() => lockScrollPosition());
        setTimeout(() => { window._isChatJustLoaded = false; }, 1000);
    } else {
        if (!preserveScroll && isAtBottom) setTimeout(() => msgContainer.scrollTo({ top: msgContainer.scrollHeight, behavior: 'smooth' }), 50);
        else msgContainer.scrollTop = prevScrollTop;
    }
}

function appendMessageUI(msgId, msg, msgTimestampMs) {
    const wrapper = document.createElement('div');
    
    // 如果是系統退出訊息，特殊渲染置中顯示
    if (msg.isSystem) {
        wrapper.className = 'system-msg-wrapper';
        wrapper.innerHTML = `<span class="system-msg">${escapeHtml(msg.text)}</span>`;
        document.getElementById('chatMessages').appendChild(wrapper);
        return;
    }

    const isMine = isMyMessage(msg);
    const senderName = displayName(senderId(msg,chatState.activeRoomData,allProfiles),allProfiles,msg.sender);
    wrapper.className = `chat-msg-wrapper ${isMine ? 'msg-mine-wrapper' : 'msg-other-wrapper'}`;
    
    let timeStr = "剛才";
    if (msg.timestamp && msg.timestamp.toDate) {
        const d = msg.timestamp.toDate();
        timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    let readCount = 0;
    if (isMine && chatState.activeRoomData) {
        roomIdentity(chatState.activeRoomData,allProfiles).ids.forEach(id=>{
            if(id!==currentUser.accountId&&readFor(chatState.activeRoomData,id,allProfiles)>=msgTimestampMs)readCount++;
        });
    }
    let readHtml = readCount > 0 ? `<span class="msg-read">已讀${readCount > 1 ? ' '+readCount : ''}</span>` : '';

    if (msg.isRetracted) {
        wrapper.innerHTML = `<div class="chat-msg msg-retracted">您收回了一則訊息</div>`;
        document.getElementById('chatMessages').appendChild(wrapper);
        return;
    }

    let displayText = msg.text || '';
    displayText = displayText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    const allNames = [currentUser.name, ...allUsers.map(u => u.name)].map(escapeHtml);
    allNames.forEach(pName => {
        displayText = displayText.split(`@${pName}`).join(`<span class="mention-highlight">@${pName}</span>`);
    });
    // 將換行符號轉為 <br> 讓畫面能正確換行顯示
    displayText = displayText.replace(/\n/g, '<br>');

    let contentHtml = msg.imageUrl 
        ? `<img src="${msg.imageUrl}" class="chat-photo" onclick="event.stopPropagation(); window.chatCore.openPhotoViewer(this.src);" onload="if(window._isChatJustLoaded) window.chatCore.lockScrollPosition();">` 
        : `<div>${displayText}</div>`;
    
    let replyHtml = '';
    if (msg.replyTo) {
        const replyText = msg.replyTo.text ? msg.replyTo.text : '傳送了圖片';
        replyHtml = `<div class="reply-quote"><strong>${escapeHtml(displayName(msg.replyTo.senderAccountId,allProfiles,msg.replyTo.sender))}</strong>: ${escapeHtml(replyText)}</div>`;
    }

    wrapper.innerHTML = `
        ${!isMine ? `<div class="msg-sender">${escapeHtml(senderName)}</div>` : ''}
        <div class="chat-msg ${isMine ? 'msg-mine' : 'msg-other'}">
            ${replyHtml} ${contentHtml}
        </div>
        <div class="msg-status-row">${isMine ? readHtml : ''}<span class="msg-time">${timeStr}</span></div>
    `;
    wrapper.querySelector('.chat-msg')?.addEventListener('click',()=>openMsgAction(msgId,isMine,msgTimestampMs,senderName,msg.imageUrl?'[圖片]':msg.text||''));
    document.getElementById('chatMessages').appendChild(wrapper);
}

// --- 傳送訊息與回覆 / @ 標註功能 ---
const chatInput = document.getElementById('chatInput');
const mentionDropdown = document.getElementById('mentionDropdown');

// textarea 自動長高與標記監聽
chatInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';

    const val = this.value;
    const cursorPos = this.selectionStart;
    const textBeforeCursor = val.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1 && (atIndex === 0 || textBeforeCursor[atIndex - 1] === ' ' || textBeforeCursor[atIndex - 1] === '\n')) {
        const queryStr = textBeforeCursor.substring(atIndex + 1);
        const members = roomIdentity(chatState.activeRoomData,allProfiles).ids.filter(id=>id!==currentUser.accountId).map(id=>displayName(id,allProfiles));
        const matched = members.filter(m => m !== currentUser.name && m.toLowerCase().includes(queryStr.toLowerCase()));

        if (matched.length > 0) {
            let html = '';
            matched.forEach(m => {
                html += `<div class="mention-item" data-mention="${escapeHtml(m)}">@${escapeHtml(m)}</div>`;
            });
            mentionDropdown.innerHTML = html;
            mentionDropdown.querySelectorAll('[data-mention]').forEach(item=>item.addEventListener('click',()=>insertMention(item.dataset.mention)));
            mentionDropdown.style.display = 'block';
            return;
        }
    }
    mentionDropdown.style.display = 'none';
});

// Enter（含手機換行）只換行；送出需使用明確的快捷操作。
chatInput.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault(); 
        document.getElementById('btnSend').click(); 
    } 
});

document.getElementById('btnSend').addEventListener('click', async () => {
    const text = chatInput.value.trim();
    if (!text || !chatState.activeRoomId || document.getElementById('btnSend').disabled) return;
    const roomId=chatState.activeRoomId;
    
    // 送出後重置狀態與高度
    chatInput.value = ''; 
    chatInput.style.height = 'auto';
    document.getElementById('btnSend').disabled = true;
    document.getElementById('btnTriggerPhoto').disabled = true;
    mentionDropdown.style.display = 'none';

    try {
        await mutateRoomIdentity(chatContext,roomId);
        const msgData = { 
            groupId: currentGroupId, 
            roomId,
            senderAccountId: currentUser.accountId,
            sender: currentUser.name, 
            text: text, 
            timestamp: serverTimestamp() 
        };
        if (pendingReplyMsgId) { msgData.replyTo = pendingReplyData; cancelReply(); }
        await addDoc(collection(db, "messages"), msgData);

        await mutateRoomIdentity(chatContext,roomId,{activity:{lastMessage:`${currentUser.name}: ${text}`,lastMessageTime:serverTimestamp()}});
        setTimeout(() => document.getElementById('chatMessages').scrollTo({ top: 99999, behavior: 'smooth' }), 50);
    } catch (error) {
        if(chatState.activeRoomId===roomId&&!chatInput.value)chatInput.value=text;
        alert(error.message || '傳送失敗，請稍後重試。');
    }
    finally { document.getElementById('btnSend').disabled = false; document.getElementById('btnTriggerPhoto').disabled = false; chatInput.focus(); }
});

const chatPhotoInput = document.getElementById('chatPhotoInput');
document.getElementById('btnTriggerPhoto').addEventListener('click', () => chatPhotoInput.click());

let photoBatch = null, sendingPhotos = false;
const photoStatus = document.getElementById('chatPhotoStatus');
const photoRetry = document.getElementById('chatPhotoRetry');
const photoCancel = document.getElementById('chatPhotoCancel');
function compressChatPhoto(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('無法讀取照片'));
        reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error('無法辨識照片格式'));
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ratio = Math.min(1, 800 / Math.max(image.width, image.height));
                    canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio));
                    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                    const data = canvas.toDataURL('image/jpeg', 0.8);
                    if (data.length > 900 * 1024) throw new Error('照片壓縮後仍過大，請選擇較小的照片');
                    resolve(data);
                } catch (error) { reject(error); }
            };
            image.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}
function photoSessionMatches() {
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
    return user?.accountId === currentUser.accountId && getSelectedGameGroupId(user) === currentGroupId;
}
async function sendPhotoBatch() {
    if (!photoBatch || sendingPhotos || document.getElementById('btnSend').disabled) return;
    const batch = photoBatch;
    sendingPhotos = true; photoRetry.hidden = photoCancel.hidden = true;
    document.getElementById('btnSend').disabled = true; document.getElementById('btnTriggerPhoto').disabled = true;
    let activityFailed = false;
    try {
        while (batch.files.length) {
            if (!photoSessionMatches() || chatState.activeRoomId !== batch.roomId) throw new Error('請回到原聊天室後重試尚未傳送的照片');
            photoStatus.textContent = `照片傳送中 ${batch.sent + 1}/${batch.total}…`;
            const imageUrl = await compressChatPhoto(batch.files[0]);
            await mutateRoomIdentity(chatContext, batch.roomId);
            if (!photoSessionMatches() || chatState.activeRoomId !== batch.roomId) throw new Error('已切換聊天室，尚未傳送的照片已保留');
            const message = { groupId: currentGroupId, roomId: batch.roomId, senderAccountId: currentUser.accountId, sender: currentUser.name, text: '傳送了圖片', imageUrl, timestamp: serverTimestamp() };
            if (!batch.sent && batch.replyData) message.replyTo = batch.replyData;
            await addDoc(collection(db, 'messages'), message);
            // 訊息提交成功後才清除暫存；房間摘要屬於後續的獨立操作。
            batch.files.shift(); batch.sent++;
            if (batch.sent === 1 && batch.replyId && pendingReplyMsgId === batch.replyId) cancelReply();
            try {
                await mutateRoomIdentity(chatContext, batch.roomId, { activity: { lastMessage: `${currentUser.name}: 傳送了圖片`, lastMessageTime: serverTimestamp() } });
            } catch (error) { activityFailed = true; console.error('照片已送出，聊天室摘要更新失敗', error); }
        }
        photoStatus.textContent = `已傳送 ${batch.sent} 張照片${activityFailed ? '（部分聊天室摘要未更新）' : ''}`;
        photoBatch = null;
        if (chatState.activeRoomId === batch.roomId) document.getElementById('chatMessages').scrollTo({ top: 99999, behavior: 'smooth' });
    } catch (error) {
        photoStatus.textContent = `已傳送 ${batch.sent}/${batch.total} 張，剩餘 ${batch.files.length} 張保留於「${batch.roomName}」。${error.message || '請重試。'}`;
        photoRetry.hidden = photoCancel.hidden = false;
    } finally {
        sendingPhotos = false;
        document.getElementById('btnSend').disabled = false; document.getElementById('btnTriggerPhoto').disabled = false;
    }
}
photoRetry.addEventListener('click', sendPhotoBatch);
photoCancel.addEventListener('click', () => {
    if (sendingPhotos) return;
    photoBatch = null; photoStatus.textContent = '已取消尚未傳送的照片'; photoRetry.hidden = photoCancel.hidden = true;
});
chatPhotoInput.addEventListener('change', async event => {
    const files = [...event.target.files]; event.target.value = '';
    if (!files.length || !chatState.activeRoomId) return;
    if (photoBatch || document.getElementById('btnSend').disabled) { photoStatus.textContent = '請先完成、重試或取消目前的傳送'; return; }
    if (files.length > 5 || files.some(file => !file.type.startsWith('image/') || file.size > 20 * 1024 * 1024)) {
        photoStatus.textContent = '一次最多選擇 5 張照片，每張原始檔需不超過 20 MB。'; return;
    }
    photoBatch = { roomId: chatState.activeRoomId, roomName: chatState.activeRoomData?.name || '原聊天室', files, total: files.length, sent: 0, replyId: pendingReplyMsgId, replyData: pendingReplyData };
    await sendPhotoBatch();
});

document.getElementById('btnBackToDashboard').addEventListener('click', () => { window.location.href = 'index.html'; });

// --- 匯出給 HTML 使用的 UI 互動函數 ---
function openPhotoViewer(src) { document.getElementById('viewerImage').src = src; document.getElementById('photoViewerModal').style.display = 'flex'; }
function closePhotoViewer() { document.getElementById('photoViewerModal').style.display = 'none'; document.getElementById('viewerImage').src = ''; }

function insertMention(name) {
    const val = chatInput.value;
    const cursorPos = chatInput.selectionStart;
    const textBeforeCursor = val.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = val.substring(cursorPos);

    chatInput.value = textBeforeCursor.substring(0, atIndex) + `@${name} ` + textAfterCursor;
    mentionDropdown.style.display = 'none';
    chatInput.focus();
}

function openMsgAction(msgId, isMine, timestampMs, sender, text) {
    selectedMsgForAction = { id: msgId, sender, text, isMine, timestampMs };
    const hoursPassed = (Date.now() - timestampMs) / (1000 * 60 * 60);
    document.getElementById('btnActionRetract').style.display = (isMine && hoursPassed < 24) ? 'block' : 'none';
    document.getElementById('msgActionModal').style.display = 'flex';
}
function closeMsgActionModal(e) { if (e.target.id === 'msgActionModal' || e.target.tagName === 'BUTTON') document.getElementById('msgActionModal').style.display = 'none'; }

function triggerReply() {
    pendingReplyMsgId = selectedMsgForAction.id; pendingReplyData = { sender: selectedMsgForAction.sender, senderAccountId: senderId(chatState.currentMessagesList.find(message=>message.id===selectedMsgForAction.id)||{},chatState.activeRoomData,allProfiles), text: selectedMsgForAction.text };
    document.getElementById('replyPreviewSender').innerText = selectedMsgForAction.sender;
    document.getElementById('replyPreviewText').innerText = selectedMsgForAction.text;
    document.getElementById('replyPreviewArea').style.display = 'flex';
    document.getElementById('msgActionModal').style.display = 'none'; chatInput.focus();
}
function cancelReply() { pendingReplyMsgId = null; pendingReplyData = null; document.getElementById('replyPreviewArea').style.display = 'none'; }

async function triggerRetract() {
    const message=chatState.currentMessagesList.find(message=>message.id===selectedMsgForAction?.id);
    if(!message||!isMyMessage(message))return;

    if (!confirm("確定要收回此訊息嗎？")) return;
    const history=messageHistory;
    const messageId=message.id;
    try {
        await updateDoc(doc(db, "messages", messageId), { isRetracted: true, text: "", imageUrl: null });
        if (messageHistory !== history) return;
        chatState.currentMessagesList=history.merge([{...message,isRetracted:true,text:"",imageUrl:null}]);
        renderAllMessages();
        if (chatState.currentMessagesList.length > 0 && chatState.currentMessagesList[chatState.currentMessagesList.length - 1].id === selectedMsgForAction.id) {
            await updateDoc(doc(db, "rooms", chatState.activeRoomId), { lastMessage: `${currentUser.name} 收回了一則訊息` });
        }
    } catch(e) {}
    document.getElementById('msgActionModal').style.display = 'none';
}

window.chatCore = {
    openPhotoViewer, closePhotoViewer, lockScrollPosition, insertMention, 
    openMsgAction, closeMsgActionModal, triggerReply, cancelReply, triggerRetract
};

refreshChatGroupMembers().catch(error => {
    console.error('載入目前群組成員失敗', error);
    document.getElementById('roomListContainer').textContent = '無法載入目前群組，請返回首頁確認群組或稍後重試。';
});
