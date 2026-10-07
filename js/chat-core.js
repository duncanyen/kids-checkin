// 1. 改為從 firebase-config.js 引入 db (請確保 firebase-config.js 有匯出 db)
import { db } from './firebase-config.js'; 
import { 
    collection, addDoc, getDocs, query, where, orderBy, limit, // 新增 limit
    onSnapshot, serverTimestamp, doc, updateDoc, increment 
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// --- 共用全域變數 ---
export const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
export const currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;
if (!currentUser) { alert('請先登入！'); window.location.href = 'index.html'; }

export const currentGroupId = localStorage.getItem('lastGroupId') || 'default_family';
export let allUsers = [];

export const chatState = {
    activeRoomId: null,
    activeRoomData: null,
    currentMessagesList: [],
    entryReadTimestamp: 0
};

let roomsUnsubscribe = null;
let messagesUnsubscribe = null;
let singleRoomUnsubscribe = null; 
let pendingReplyMsgId = null;
let pendingReplyData = null;
let selectedMsgForAction = null; 
let isFirstLoad = true; 
window._isChatJustLoaded = false; 

// --- 初始化執行 ---
fetchFamilyUsers();
listenToRooms();

// --- 讀取量優化：users 清單快取（原本每次進來聊天室都整包重讀一次）---
const USERS_CACHE_KEY = 'nexus_users_cache_v1';
const USERS_CACHE_TTL = 10 * 60 * 1000; // 10 分鐘內沿用快取

async function fetchFamilyUsers() {
    try {
        const cached = JSON.parse(sessionStorage.getItem(USERS_CACHE_KEY) || 'null');
        if (cached && Array.isArray(cached.users) && cached.users.length > 0 && (Date.now() - cached.ts) < USERS_CACHE_TTL) {
            allUsers = cached.users;
            return;
        }
    } catch (e) { /* 快取壞掉就忽略，直接讀取 */ }

    try {
        const querySnapshot = await getDocs(collection(db, "users"));
        allUsers = [];
        querySnapshot.forEach(docSnap => {
            const uData = docSnap.data();
            // 只保留畫面需要的欄位（name / avatar），密碼等資料不進快取
            if (uData.name !== currentUser.name) allUsers.push({ name: uData.name, avatar: uData.avatar });
        });
        sessionStorage.setItem(USERS_CACHE_KEY, JSON.stringify({ ts: Date.now(), users: allUsers }));
    } catch (error) {
        console.error("讀取使用者失敗:", error);
    }
}

function listenToRooms() {
    const roomsRef = collection(db, "rooms");
    const q = query(
        roomsRef, 
        where("groupId", "==", currentGroupId), 
        where("participants", "array-contains", currentUser.name), 
        orderBy("lastMessageTime", "desc")
    );

    // 加入錯誤處理，萬一缺少複合索引，可以在 Console 看到點擊連結
    roomsUnsubscribe = onSnapshot(q, (snapshot) => {
        const container = document.getElementById('roomListContainer');
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-sub); font-weight:600;">此群組尚未有聊天室，點擊上方建立一個吧！</div>';
            return;
        }
        snapshot.forEach(docSnap => {
            const room = docSnap.data();
            const roomId = docSnap.id;
            
            if (!room.participants) room.participants = [currentUser.name];

            let timeStr = "";
            if (room.lastMessageTime && room.lastMessageTime.toDate) {
                const dateObj = room.lastMessageTime.toDate();
                timeStr = `${String(dateObj.getMonth()+1).padStart(2,'0')}/${String(dateObj.getDate()).padStart(2,'0')} ${String(dateObj.getHours()).padStart(2,'0')}:${String(dateObj.getMinutes()).padStart(2,'0')}`;
            }

            const displayAvatar = room.avatar || `https://ui-avatars.com/api/?name=${room.name}&background=ecfdf5&color=059669`;
            const displayLastMsg = room.lastMessage || "尚未有訊息";
            
            let myUnreadCount = (room.unreadCount && room.unreadCount[currentUser.name]) || 0;
            let unreadBadgeHtml = myUnreadCount > 0 ? `<span class="unread-badge">${myUnreadCount > 99 ? '99+' : myUnreadCount}</span>` : '';

            const div = document.createElement('div');
            div.className = 'room-item';
            div.onclick = () => enterRoom(roomId, room);
            div.innerHTML = `
                <img src="${displayAvatar}" class="room-avatar">
                <div class="room-info">
                    <div class="room-title-row">
                        <span class="room-name">${room.name}</span>
                        <span class="room-time">${timeStr}</span>
                    </div>
                    <div class="room-last-msg">
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px;">${displayLastMsg}</span>
                        ${unreadBadgeHtml}
                    </div>
                </div>
            `;
            container.appendChild(div);
        });
    }, (error) => {
        console.error("【索引錯誤】讀取群組清單失敗！請點擊下方程式碼產生的連結，在 Firebase 自動建立索引:", error.message);
    });
}

async function enterRoom(roomId, roomData) {
    chatState.activeRoomId = roomId;
    chatState.activeRoomData = roomData;
    if (!chatState.activeRoomData.participants) chatState.activeRoomData.participants = [currentUser.name];

    chatState.currentMessagesList = [];
    isFirstLoad = true; 
    
    chatState.entryReadTimestamp = (roomData.readTimestamps && roomData.readTimestamps[currentUser.name]) ? roomData.readTimestamps[currentUser.name] : 0;
    
    document.getElementById('mainTopNav').style.display = 'none';
    document.getElementById('viewRoomList').style.display = 'none';
    document.getElementById('viewChatRoom').style.display = 'flex';
    
    document.getElementById('activeRoomName').innerText = roomData.name;
    document.getElementById('activeRoomAvatar').src = roomData.avatar || `https://ui-avatars.com/api/?name=${roomData.name}&background=ecfdf5&color=059669`;
    
    markRoomRead(roomId, true);
    listenToMessages(roomId);
    listenToActiveRoom(roomId); 
}

function listenToActiveRoom(roomId) {
    if (singleRoomUnsubscribe) singleRoomUnsubscribe(); 
    singleRoomUnsubscribe = onSnapshot(doc(db, "rooms", roomId), (docSnap) => {
        if (docSnap.exists()) {
            chatState.activeRoomData = docSnap.data(); 
            if (!chatState.activeRoomData.participants) chatState.activeRoomData.participants = [currentUser.name];
            renderAllMessages();             
        }
    });
}

// =================【讀取量優化：已讀時間寫入】=================
// 舊版：每一次收到訊息快照就寫一次 rooms 文件（readTimestamps + unreadCount）。
// 每寫一次，所有在線裝置的 rooms 清單 / 未讀 listener 都要重新讀取一次，
// 4 個人聊天時一則訊息就被放大成數十次讀取。
// 新版：只有真的需要（有未讀、頁面可見）才寫，且同一頁面每 45 秒最多一次。
const READ_MARK_THROTTLE_MS = 45000;
const READ_MARK_FRESH_MS = 5 * 60 * 1000;
let lastReadMarkAt = 0;

async function markRoomRead(roomId, force = false) {
    if (!roomId || document.visibilityState !== 'visible') return;

    const me = currentUser.name;
    const room = chatState.activeRoomData || {};
    const unread = (room.unreadCount && room.unreadCount[me]) || 0;
    const lastRead = (room.readTimestamps && room.readTimestamps[me]) || 0;
    const now = Date.now();

    // 沒有未讀、而且不久前才標記過 → 這次不需要寫入
    if (unread === 0 && lastRead > 0 && (now - lastRead) < READ_MARK_FRESH_MS) return;
    // 節流：非強制寫入時，45 秒內最多寫一次
    if (!force && (now - lastReadMarkAt) < READ_MARK_THROTTLE_MS) return;

    lastReadMarkAt = now;
    // 先更新本地狀態，避免同一時間重複送出寫入
    room.unreadCount = { ...(room.unreadCount || {}), [me]: 0 };
    room.readTimestamps = { ...(room.readTimestamps || {}), [me]: now };

    try {
        await updateDoc(doc(db, "rooms", roomId), {
            [`readTimestamps.${me}`]: now,
            [`unreadCount.${me}`]: 0
        });
    } catch (e) {}
}

document.getElementById('btnBackToList').addEventListener('click', () => {
    markRoomRead(chatState.activeRoomId, true);
    if (messagesUnsubscribe) messagesUnsubscribe();
    if (singleRoomUnsubscribe) singleRoomUnsubscribe(); 
    
    chatState.activeRoomId = null; chatState.activeRoomData = null; chatState.currentMessagesList = [];
    document.getElementById('mainTopNav').style.display = 'flex';
    document.getElementById('viewChatRoom').style.display = 'none';
    document.getElementById('viewRoomList').style.display = 'flex';
});

// =================【讀取優化核心修改區】=================
// 每次進入聊天室只讀最新 30 筆（單次進房的初始讀取量）。
// 註：訊息文件裡的圖片是 base64（單張可能數百 KB），降低這個數字同時省下大量流量。
const MESSAGE_PAGE_SIZE = 30;

function listenToMessages(roomId) {
    const q = query(
        collection(db, "messages"), 
        // 1. 移除 redundant 的 groupId 查詢，避免 Firebase 需要更複雜的三層複合索引
        where("roomId", "==", roomId), 
        // 2. 改為 desc，從最新訊息開始抓
        orderBy("timestamp", "desc"), 
        // 3. 只讀取最新的 MESSAGE_PAGE_SIZE 筆訊息，節省龐大讀取量
        limit(MESSAGE_PAGE_SIZE)
    );
    
    messagesUnsubscribe = onSnapshot(q, (snapshot) => {
        let tempMsgs = []; 
        if (!snapshot.empty) {
            snapshot.forEach((docSnap) => tempMsgs.push({ id: docSnap.id, ...docSnap.data() }));
        }
        // 4. 因為是從新到舊抓取，為了 UI 呈現正序，必須反轉陣列
        chatState.currentMessagesList = tempMsgs.reverse(); 
        
        renderAllMessages(); 
        markRoomRead(roomId);
    }, (error) => {
        // 若因 where + orderBy 依然缺少索引，這裡會印出點擊連結
        console.error("【索引錯誤】讀取聊天訊息失敗！請點擊下方連結建立索引:", error.message);
    });
}
// =========================================================

function lockScrollPosition() {
    const msgContainer = document.getElementById('chatMessages');
    if (!msgContainer) return;
    const divider = document.getElementById('unread-divider-line');
    if (divider) msgContainer.scrollTop = Math.max(0, divider.offsetTop - 80);
    else msgContainer.scrollTop = msgContainer.scrollHeight;
}

function renderAllMessages() {
    const msgContainer = document.getElementById('chatMessages');
    const prevScrollTop = msgContainer.scrollTop;
    const prevScrollHeight = msgContainer.scrollHeight;
    const isAtBottom = (prevScrollHeight - prevScrollTop) <= (msgContainer.clientHeight + 150);
    
    msgContainer.innerHTML = '';
    let unreadDividerAdded = false;

    if (chatState.currentMessagesList.length === 0) {
        msgContainer.innerHTML = '<div style="text-align:center; color:var(--text-sub); font-size:13px; margin-top:20px; font-weight:600;">發個訊息打招呼吧！</div>';
    }

    chatState.currentMessagesList.forEach(msg => {
        let msgTimestampMs = Date.now();
        if (msg.timestamp && msg.timestamp.toDate) msgTimestampMs = msg.timestamp.toDate().getTime();

        if (!unreadDividerAdded && chatState.entryReadTimestamp > 0 && msgTimestampMs > chatState.entryReadTimestamp && msg.sender !== currentUser.name) {
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
        if (isAtBottom) setTimeout(() => msgContainer.scrollTo({ top: msgContainer.scrollHeight, behavior: 'smooth' }), 50);
        else msgContainer.scrollTop = prevScrollTop;
    }
}

function appendMessageUI(msgId, msg, msgTimestampMs) {
    const isMine = (msg.sender === currentUser.name);
    const wrapper = document.createElement('div');
    wrapper.className = `chat-msg-wrapper ${isMine ? 'msg-mine-wrapper' : 'msg-other-wrapper'}`;
    
    let timeStr = "剛才";
    if (msg.timestamp && msg.timestamp.toDate) {
        const d = msg.timestamp.toDate();
        timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    let readCount = 0;
    if (isMine && chatState.activeRoomData && chatState.activeRoomData.readTimestamps) {
        Object.keys(chatState.activeRoomData.readTimestamps).forEach(pName => {
            if (pName !== currentUser.name && chatState.activeRoomData.readTimestamps[pName] >= msgTimestampMs) readCount++;
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
    
    const allNames = [currentUser.name, ...allUsers.map(u => u.name)];
    allNames.forEach(pName => {
        displayText = displayText.split(`@${pName}`).join(`<span class="mention-highlight">@${pName}</span>`);
    });

    let contentHtml = msg.imageUrl 
        ? `<img src="${msg.imageUrl}" class="chat-photo" onclick="event.stopPropagation(); window.chatCore.openPhotoViewer(this.src);" onload="if(window._isChatJustLoaded) window.chatCore.lockScrollPosition();">` 
        : `<div>${displayText}</div>`;
    
    let replyHtml = '';
    if (msg.replyTo) {
        const replyText = msg.replyTo.text ? msg.replyTo.text : '傳送了圖片';
        replyHtml = `<div class="reply-quote"><strong>${msg.replyTo.sender}</strong>: ${replyText}</div>`;
    }
    const safeText = (msg.text || '').replace(/'/g, "\\'").replace(/"/g, '&quot;');

    wrapper.innerHTML = `
        ${!isMine ? `<div class="msg-sender">${msg.sender}</div>` : ''}
        <div class="chat-msg ${isMine ? 'msg-mine' : 'msg-other'}" onclick="window.chatCore.openMsgAction('${msgId}', ${isMine}, ${msgTimestampMs}, '${msg.sender}', '${msg.imageUrl ? '[圖片]' : safeText}')">
            ${replyHtml} ${contentHtml}
        </div>
        <div class="msg-status-row">${isMine ? readHtml : ''}<span class="msg-time">${timeStr}</span></div>
    `;
    document.getElementById('chatMessages').appendChild(wrapper);
}

// --- 傳送訊息與回覆 / @ 標註功能 ---
const chatInput = document.getElementById('chatInput');
const mentionDropdown = document.getElementById('mentionDropdown');

chatInput.addEventListener('input', (e) => {
    const val = chatInput.value;
    const cursorPos = chatInput.selectionStart;
    const textBeforeCursor = val.substring(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex !== -1 && (atIndex === 0 || textBeforeCursor[atIndex - 1] === ' ' || textBeforeCursor[atIndex - 1] === '\n')) {
        const queryStr = textBeforeCursor.substring(atIndex + 1);
        const members = chatState.activeRoomData && chatState.activeRoomData.participants ? chatState.activeRoomData.participants : [];
        const matched = members.filter(m => m !== currentUser.name && m.toLowerCase().includes(queryStr.toLowerCase()));

        if (matched.length > 0) {
            let html = '';
            matched.forEach(m => {
                html += `<div class="mention-item" onclick="window.chatCore.insertMention('${m}')">👤 @${m}</div>`;
            });
            mentionDropdown.innerHTML = html;
            mentionDropdown.style.display = 'block';
            return;
        }
    }
    mentionDropdown.style.display = 'none';
});

document.getElementById('btnSend').addEventListener('click', async () => {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = ''; document.getElementById('btnSend').disabled = true;
    mentionDropdown.style.display = 'none';

    try {
        const msgData = { 
            groupId: currentGroupId, 
            roomId: chatState.activeRoomId, 
            sender: currentUser.name, 
            text: text, 
            timestamp: serverTimestamp() 
        };
        if (pendingReplyMsgId) { msgData.replyTo = pendingReplyData; cancelReply(); }
        await addDoc(collection(db, "messages"), msgData);

        let updatePayload = { lastMessage: `${currentUser.name}: ${text}`, lastMessageTime: serverTimestamp() };
        if(chatState.activeRoomData && chatState.activeRoomData.participants) {
            chatState.activeRoomData.participants.forEach(p => {
                if (p !== currentUser.name) updatePayload[`unreadCount.${p}`] = increment(1);
            });
        }
        await updateDoc(doc(db, "rooms", chatState.activeRoomId), updatePayload);
        setTimeout(() => document.getElementById('chatMessages').scrollTo({ top: 99999, behavior: 'smooth' }), 50);
    } catch (e) {} 
    finally { document.getElementById('btnSend').disabled = false; chatInput.focus(); }
});
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('btnSend').click(); });

const chatPhotoInput = document.getElementById('chatPhotoInput');
document.getElementById('btnTriggerPhoto').addEventListener('click', () => chatPhotoInput.click());

chatPhotoInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file || !chatState.activeRoomId) return;
    document.getElementById('btnSend').disabled = true; document.getElementById('btnTriggerPhoto').disabled = true;
    const reader = new FileReader();
    reader.onload = function(evt) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
            const maxSize = 800; let width = img.width, height = img.height;
            if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } } else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
            canvas.width = width; canvas.height = height; ctx.drawImage(img, 0, 0, width, height);
            const base64Img = canvas.toDataURL('image/jpeg', 0.8); 

            try {
                const msgData = { 
                    groupId: currentGroupId, 
                    roomId: chatState.activeRoomId, 
                    sender: currentUser.name, 
                    text: "傳送了圖片", 
                    imageUrl: base64Img, 
                    timestamp: serverTimestamp() 
                };
                if (pendingReplyMsgId) { msgData.replyTo = pendingReplyData; cancelReply(); }
                await addDoc(collection(db, "messages"), msgData);

                let updatePayload = { lastMessage: `${currentUser.name}: 傳送了圖片 📷`, lastMessageTime: serverTimestamp() };
                if(chatState.activeRoomData && chatState.activeRoomData.participants) {
                    chatState.activeRoomData.participants.forEach(p => {
                        if (p !== currentUser.name) updatePayload[`unreadCount.${p}`] = increment(1);
                    });
                }
                await updateDoc(doc(db, "rooms", chatState.activeRoomId), updatePayload);
                setTimeout(() => document.getElementById('chatMessages').scrollTo({ top: 99999, behavior: 'smooth' }), 100);
            } catch (error) {} 
            finally { document.getElementById('btnSend').disabled = false; document.getElementById('btnTriggerPhoto').disabled = false; chatPhotoInput.value = ''; }
        }; img.src = evt.target.result;
    }; reader.readAsDataURL(file);
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
    pendingReplyMsgId = selectedMsgForAction.id; pendingReplyData = { sender: selectedMsgForAction.sender, text: selectedMsgForAction.text };
    document.getElementById('replyPreviewSender').innerText = selectedMsgForAction.sender;
    document.getElementById('replyPreviewText').innerText = selectedMsgForAction.text;
    document.getElementById('replyPreviewArea').style.display = 'flex';
    document.getElementById('msgActionModal').style.display = 'none'; chatInput.focus();
}
function cancelReply() { pendingReplyMsgId = null; pendingReplyData = null; document.getElementById('replyPreviewArea').style.display = 'none'; }

async function triggerRetract() {
    if (!confirm("確定要收回此訊息嗎？")) return;
    try {
        await updateDoc(doc(db, "messages", selectedMsgForAction.id), { isRetracted: true, text: "", imageUrl: null });
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
