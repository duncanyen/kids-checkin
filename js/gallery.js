import {
    collection, addDoc, query, orderBy, onSnapshot, where, getDocs, limit, startAfter, endAt,
    serverTimestamp, doc, setDoc, updateDoc, arrayUnion, arrayRemove, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { db } from './firebase-config.js';
// Viewing the feed needs only Firestore. Auth/Functions/Storage load when an
// upload or storage-backed delete actually needs them; native ESM shares the load.
async function uploadPhotoPost(options) {
    return (await import('./gallery-storage.js')).uploadPhotoPost(options);
}
async function removePhotoFiles(paths, ...args) {
    if (!paths?.length) return [];
    return (await import('./gallery-storage.js')).removePhotoFiles(paths, ...args);
}

const savedUserStr = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
let currentUser = savedUserStr ? JSON.parse(savedUserStr) : null;
 
// 🚨 取得目前所在的群組 ID
const currentGroupId = localStorage.getItem('lastGroupId');

if (!currentUser || !currentGroupId) { 
    alert('找不到登入狀態或群組資訊，請重新登入！'); 
    window.location.href = 'index.html'; 
}

let uploadInProgress = false;
let pendingUploadBase64Array = []; 
let allPhotosData = [];
let currentSort = 'latest';
 
window.viewerQueue = []; 
let currentViewerIndex = 0; 
let isZoomed = false;       
window.replyState = {};

const feedContainer = document.getElementById('feedContainer');
const unreadBadge = document.getElementById('unreadBadge');

async function recordLog(actionType, detailsText) {
    try {
        const now = new Date();
        const datetimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        await addDoc(collection(db, "logs"), { 
            groupId: currentGroupId,
            datetime: datetimeStr, 
            operator: currentUser.name, 
            actionType, 
            details: detailsText, 
            timestamp: serverTimestamp() 
        });
    } catch (e) {}
}

window.onload = async function() {
    await recordLog('功能瀏覽', '進入「Photo Dump」相簿專區');
    localStorage.setItem('homebase_photodump_last_read', Date.now().toString());
};

// Fixed cursor ranges keep realtime updates without a listener per document.
const PAGE_SIZE = 15;
const posts = new Map(), cards = new Map();
let ranges = [], subscriptions = [], cursor = null, loading = false, exhausted = false;
let generation = 0, observer = null, active = false, liveRetry = false;
const paging = document.createElement('div');
paging.className = 'gallery-paging';
const pagingButton = document.createElement('button');
pagingButton.type = 'button';
pagingButton.addEventListener('click', () => {
    if (liveRetry) { liveRetry = false; pauseGallery(); resumeGallery(); }
    else loadNextPage();
});
paging.append(pagingButton);
feedContainer.after(paging);
function baseQuery(...constraints) {
    return query(collection(db, 'photos'), where('groupId', '==', currentGroupId),
        orderBy('timestamp', 'desc'), ...constraints);
}
function pagingState(message) {
    pagingButton.textContent = message || (exhausted ? '已載入所有貼文' : '載入更多');
    pagingButton.disabled = loading || exhausted;
}
function subscribeRange(range, token) {
    const constraints = range.after ? [startAfter(range.after)] : [];
    if (range.end) constraints.push(endAt(range.end));
    const stop = onSnapshot(baseQuery(...constraints), snapshot => {
        if (!active || token !== generation) return;
        const next = new Set();
        snapshot.forEach(d => { next.add(d.id); posts.set(d.id, {id:d.id, ...d.data()}); });
        const previousIds = range.ids;
        // A cache-only snapshot can be incomplete after restore. Keep visible
        // records until a server snapshot confirms their removal.
        range.ids = snapshot.metadata?.fromCache ? new Set([...previousIds, ...next]) : next;
        for (const id of previousIds) if (!snapshot.metadata?.fromCache && !next.has(id) && !ranges.some(r=>r.ids.has(id))) posts.delete(id);
        syncFeed();
    }, error => {
        if (!active || token !== generation) return;
        console.error('相簿即時更新失敗', error);
        pagingButton.disabled = false;
        pagingButton.textContent = '即時更新中斷，點此重新連線';
        liveRetry = true;
    });
    subscriptions.push(stop);
}
async function loadNextPage() {
    if (!active || loading || exhausted) return;
    loading = true; pagingState('載入中…');
    const token = generation, after = cursor;
    let notice = '';
    try {
        const snapshot = await getDocs(baseQuery(...(after ? [startAfter(after)] : []), limit(PAGE_SIZE)));
        if (!active || token !== generation) return;
        const docs = snapshot.docs;
        // An empty initial group still needs a live head. A nonempty tail is
        // bounded by the last fetched document, including equal timestamps by ID.
        if (docs.length || !ranges.length) {
            const range = {after, end:docs.at(-1) || null, ids:new Set(docs.map(d=>d.id))};
            ranges.push(range);
            docs.forEach(d => posts.set(d.id, {id:d.id, ...d.data()}));
            if (docs.length) cursor = docs.at(-1);
            subscribeRange(range, token);
        }
        exhausted = !snapshot.metadata?.fromCache && docs.length < PAGE_SIZE;
        if (snapshot.metadata?.fromCache) notice = '目前顯示快取資料，點此重試載入更多';
        syncFeed();
    } catch (error) {
        if (active && token === generation) {
            console.error('載入相簿失敗：', error);
            if (!posts.size) feedContainer.textContent = '載入失敗，請檢查網路連線並點下方重試。';
            pagingState('載入失敗，點此重試');
        }
    } finally {
        if (token === generation) {
            loading = false;
            if (!liveRetry && !pagingButton.textContent.includes('失敗')) pagingState(notice);
            else pagingButton.disabled = false;
        }
    }
}
function pauseGallery() {
    active = false; generation++; loading = false;
    subscriptions.splice(0).forEach(stop=>stop());
    observer?.disconnect(); observer = null;
}
function resumeGallery() {
    if (active || !currentUser || !currentGroupId) return;
    // A restored document must never resume the previous group's subscriptions.
    const saved = sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser');
    if (localStorage.getItem('lastGroupId') !== currentGroupId || JSON.parse(saved || 'null')?.accountId !== currentUser.accountId) {
        window.location.replace('index.html'); return;
    }
    active = true; const token = ++generation;
    ranges.forEach(range=>subscribeRange(range, token));
    if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(entries=>{
            if (entries.some(e=>e.isIntersecting)) loadNextPage();
        }, {rootMargin:'400px'});
        observer.observe(paging);
    }
    if (!ranges.length) loadNextPage();
    else pagingState();
}
window.addEventListener('pagehide', pauseGallery);
window.addEventListener('pageshow', event=>{if(event.persisted) resumeGallery();});
function listenToGallery() { resumeGallery(); }

function updateUnreadBadge(photos) {
    const lastReadTime = parseInt(localStorage.getItem('homebase_photodump_last_read') || '0', 10);
    let unreadCount = 0;
    photos.forEach(photo => {
        const photoTime = photo.timestamp?.toDate?.()?.getTime() || 0;
        if (photoTime > lastReadTime && photo.uploader !== currentUser.name) {
            unreadCount++;
        }
    });
    if (unreadCount > 0) {
        unreadBadge.style.display = 'inline-block';
        unreadBadge.innerText = `+${unreadCount}`;
    } else {
        unreadBadge.style.display = 'none';
    }
}

window.changeSortMethod = function(method) { currentSort = method; renderFeed(); };

function syncFeed() {
    allPhotosData = [...posts.values()];
    renderFeed(); updateUnreadBadge(allPhotosData);
}
function renderFeed() {
    window.viewerQueue = [];
    let globalImageIndex = 0;
    const sortedList = [...allPhotosData];
    sortedList.sort((a,b)=>{
        const score = currentSort === 'likes' ? (b.likes?.length||0)-(a.likes?.length||0)
            : currentSort === 'comments' ? (b.comments?.length||0)-(a.comments?.length||0) : 0;
        return score || (b.timestamp?.toMillis?.() || b.timestamp?.toDate?.()?.getTime() || 0)
            -(a.timestamp?.toMillis?.() || a.timestamp?.toDate?.()?.getTime() || 0) || b.id.localeCompare(a.id);
    });
    if (!cards.size) feedContainer.replaceChildren();
    for (const [id, entry] of cards) if (!posts.has(id)) { entry.card.remove(); cards.delete(id); delete window.replyState[id]; }
    let previous = null;
    const viewedUrl = photoViewerModal?.style.display === 'flex' ? viewerImage.getAttribute('src') : null;
    for (const photo of sortedList) {
        const signature = JSON.stringify(photo);
        let entry = cards.get(photo.id);
        if (!entry) {
            const card = renderPhotoCard(photo.id, photo, globalImageIndex);
            entry = {card, signature}; cards.set(photo.id, entry);
        } else if (signature !== entry.signature) {
            // Patch only changed regions; image nodes, draft inputs and carousel
            // scroll positions survive likes/comments and unrelated updates.
            const imagesChanged = JSON.stringify(entry.images) !== JSON.stringify(photo.imageUrls || (photo.imageUrl ? [photo.imageUrl] : []));
            const fresh = renderPhotoCard(photo.id, photo, globalImageIndex, !imagesChanged);
            for (const selector of ['.card-caption','.interaction-bar']) {
                const old = entry.card.querySelector(selector), next = fresh.querySelector(selector);
                if (old?.outerHTML === next?.outerHTML) continue;
                if (old && next) old.replaceWith(next);
                else if (old) old.remove();
                else if (next) entry.card.querySelector('.interaction-bar').before(next);
            }
            const oldComments = entry.card.querySelector('.comments-list'), newComments = fresh.querySelector('.comments-list');
            // Compare comments individually so appending a reply preserves existing nodes.
            Array.from(newComments.children).forEach((node,index)=>{
                const existing = oldComments.children[index];
                if (!existing) oldComments.append(node.cloneNode(true));
                else if (existing.outerHTML !== node.outerHTML) existing.replaceWith(node.cloneNode(true));
            });
            while (oldComments.children.length > newComments.children.length) oldComments.lastElementChild.remove();
            if (imagesChanged)
                entry.card.querySelector('.photo-carousel').replaceWith(fresh.querySelector('.photo-carousel'));
            const name = entry.card.querySelector('.uploader-name'), time = entry.card.querySelector('.upload-time');
            name.textContent = photo.uploader;
            time.textContent = fresh.querySelector('.upload-time').textContent;
            const avatar = entry.card.querySelector('.uploader-avatar');
            const avatarUrl = photo.uploader === currentUser.name && currentUser.avatar ? currentUser.avatar
                : photo.uploaderAvatar || `https://ui-avatars.com/api/?name=${photo.uploader}&background=10b981&color=fff`;
            if (avatar.getAttribute('src') !== avatarUrl) avatar.src = avatarUrl;
            entry.signature = signature;
        }
        entry.images = photo.imageUrls || (photo.imageUrl ? [photo.imageUrl] : []);
        entry.card.querySelectorAll('.card-image').forEach((img,i)=>img.onclick=()=>window.openPhotoViewer(globalIndex+i));
        const globalIndex = globalImageIndex;
        const expected = previous ? previous.nextSibling : feedContainer.firstChild;
        if (expected !== entry.card) feedContainer.insertBefore(entry.card, expected);
        previous = entry.card;
        entry.images.forEach(img=>{window.viewerQueue.push(img); globalImageIndex++;});
    }
    if (viewedUrl && window.viewerQueue.includes(viewedUrl)) currentViewerIndex = window.viewerQueue.indexOf(viewedUrl);
    if (!sortedList.length) feedContainer.textContent = '相簿空空的，趕快點擊右下角發佈第一張照片吧！';
}
feedContainer.addEventListener('keypress', event=>{
    if (event.key === 'Enter' && event.target.matches('.comment-input')) window.submitComment(event.target.id.slice(6));
});

function renderPhotoCard(photoId, data, startGlobalIndex, skipMedia = false) {
    let timeStr = "剛才";
    if (data.timestamp?.toDate) {
        const d = data.timestamp.toDate();
        timeStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    const isMine = ((data.uploaderAccountId ? data.uploaderAccountId === currentUser.accountId : data.uploader === currentUser.name) || currentUser.role === 'admin' || currentUser.role === 'parent');
    const delBtnHtml = isMine ? `<button class="btn-delete" onclick="window.deletePhoto('${photoId}')" title="刪除貼文">🗑️</button>` : '';

    const likesArray = Array.isArray(data.likes) ? data.likes : [];
    const hasLiked = likesArray.includes(currentUser.name);
    const likesCount = likesArray.length;

    const images = data.imageUrls || (data.imageUrl ? [data.imageUrl] : []);
    let imagesHtml = `<div class="photo-carousel">`;
    (skipMedia ? [] : images).forEach((imgUrl, i) => {
        const currentImgIndex = startGlobalIndex + i;
        const counterHtml = images.length > 1 ? `<div class="img-counter">${i + 1} / ${images.length}</div>` : '';
        imagesHtml += `<div class="carousel-item-wrapper"><img src="${imgUrl}" loading="lazy" decoding="async" class="card-image" onclick="window.openPhotoViewer(${currentImgIndex})">${counterHtml}</div>`;
    });
    imagesHtml += `</div>`;

    let commentsHtml = '';
    if (data.comments && data.comments.length > 0) {
        data.comments.forEach((c, cIndex) => {
            const cTime = new Date(c.timestamp);
            const cTimeStr = `${String(cTime.getMonth()+1).padStart(2,'0')}/${String(cTime.getDate()).padStart(2,'0')} ${String(cTime.getHours()).padStart(2,'0')}:${String(cTime.getMinutes()).padStart(2,'0')}`;
            const canDeleteComment = (c.sender === currentUser.name || currentUser.role === 'admin' || currentUser.role === 'parent');
            const delCommentBtn = canDeleteComment ? `<button class="btn-action-sm btn-del-comment" onclick="window.deleteComment('${photoId}', ${cIndex})">刪除</button>` : '';
            const replyBtn = `<button class="btn-action-sm btn-reply" onclick="window.setupReply('${photoId}', '${c.sender}')">回覆</button>`;
            const replyTagHtml = c.replyTo ? `<span class="reply-tag">回覆 @${c.replyTo}</span>` : '';

            commentsHtml += `
                <div class="comment-item">
                    <div class="comment-header-row">
                        <span class="comment-sender">${c.sender}</span><span class="comment-time">${cTimeStr}</span>
                    </div>
                    <div class="comment-content-row">
                        <div class="comment-content">${replyTagHtml}${c.text}</div>
                        <div class="comment-actions">${replyBtn}${delCommentBtn}</div>
                    </div>
                </div>`;
        });
    } else {
        commentsHtml = '<div style="color:var(--text-sub); font-size:13px; text-align:center; font-weight:600;">成為第一個留言的人吧！</div>';
    }

    // 🚀 修正頭像顯示：判斷發文者如果是自己，且 localStorage 中有最新頭像，則優先載入最新的頭像
    let displayAvatar = data.uploaderAvatar;
    if (data.uploader === currentUser.name && currentUser.avatar) {
        displayAvatar = currentUser.avatar; // 強制套用自己最新的頭像
    }
    // 如果還是沒有頭像，則套用預設的 UI Avatars
    if (!displayAvatar) {
        displayAvatar = `https://ui-avatars.com/api/?name=${data.uploader}&background=10b981&color=fff`;
    }

    const card = document.createElement('div');
    card.className = 'photo-card';
    card.innerHTML = `
        <div class="card-header">
            <img ${skipMedia ? '' : `src="${displayAvatar}"`} loading="lazy" decoding="async" width="40" height="40" class="uploader-avatar">
            <div class="uploader-info"><div class="uploader-name">${data.uploader}</div><div class="upload-time">${timeStr}</div></div>
            ${delBtnHtml}
        </div>
        ${imagesHtml}
        ${data.caption ? `<div class="card-caption">${data.caption}</div>` : ''}
        <div class="interaction-bar">
            <button class="btn-like ${hasLiked ? 'liked' : ''}" onclick="window.toggleLike('${photoId}', ${hasLiked})">
                ${hasLiked ? '❤️' : '🤍'} <span class="likes-count">${likesCount > 0 ? likesCount : '按讚'}</span>
            </button>
        </div>
        <div class="comments-section">
            <div class="comments-list">${commentsHtml}</div>
            <div class="reply-indicator" id="reply-indicator-${photoId}">
                <span>回覆給 <span style="color:var(--primary); font-weight:800;">@<span id="reply-target-${photoId}"></span></span></span>
                <button class="btn-cancel-reply" onclick="window.cancelReply('${photoId}')">✖</button>
            </div>
            <div class="comment-input-area">
                <input type="text" id="input-${photoId}" class="comment-input" placeholder="留個言吧..." autocomplete="off">
                <button class="btn-comment" onclick="window.submitComment('${photoId}')">留言</button>
            </div>
        </div>`;
    return card;
}

window.setupReply = function(photoId, targetName) {
    window.replyState[photoId] = targetName;
    document.getElementById(`reply-target-${photoId}`).innerText = targetName;
    document.getElementById(`reply-indicator-${photoId}`).style.display = 'flex';
    document.getElementById(`input-${photoId}`).focus();
};

window.cancelReply = function(photoId) { window.replyState[photoId] = null; document.getElementById(`reply-indicator-${photoId}`).style.display = 'none'; };

window.toggleLike = async function(photoId, hasLiked) {
    if (posts.get(photoId)?.groupId !== currentGroupId) return;
    const photoRef = doc(db, "photos", photoId);
    hasLiked ? await updateDoc(photoRef, { likes: arrayRemove(currentUser.name) }) : await updateDoc(photoRef, { likes: arrayUnion(currentUser.name) });
};

window.submitComment = async function(photoId) {
    if (posts.get(photoId)?.groupId !== currentGroupId) return;
    const inputField = document.getElementById(`input-${photoId}`);
    const text = inputField.value.trim();
    if (!text) return;
    const replyTarget = window.replyState[photoId] || null;
    inputField.value = '';
    try {
        await updateDoc(doc(db, "photos", photoId), { comments: arrayUnion({ sender: currentUser.name, text: text, replyTo: replyTarget, timestamp: Date.now() }) });
        window.cancelReply(photoId);
    } catch (e) { alert("留言失敗！"); inputField.value = text; }
};

window.deleteComment = async function(photoId, commentIndex) {
    if (!confirm("確定要刪除這則留言嗎？")) return;
    const targetPhoto = allPhotosData.find(p => p.id === photoId);
    if (targetPhoto && targetPhoto.comments) {
        const comment = targetPhoto.comments[commentIndex];
        if (comment) await updateDoc(doc(db, "photos", photoId), { comments: arrayRemove(comment) });
    }
};

window.deletePhoto = async function(photoId) {
    if (confirm("確定要刪除這張內容嗎？")) {
        try {
            const photo = allPhotosData.find(item => item.id === photoId);
            if (!photo || photo.groupId !== currentGroupId) return;
            // Confirm the lazy cleanup code is available before deleting metadata.
            if (photo.storagePaths?.length) await import('./gallery-storage.js');
            await deleteDoc(doc(db, "photos", photoId));
            try {
                const results = await removePhotoFiles(photo.storagePaths, currentUser, currentGroupId);
                if (results.some(result => result.status === 'rejected')) throw new Error('清理未完成');
            } catch {
                alert('貼文已刪除，但部分照片檔案清理失敗，請聯絡管理者處理。');
            }
        } catch (e) { alert("刪除失敗，請再試一次。"); }
    }
};

// ================= 檔案與塗鴉牆入口 =================
const btnToggleFab = document.getElementById('btnToggleFab');
const fabMenu = document.getElementById('fabMenu');
 
btnToggleFab.addEventListener('click', () => {
    fabMenu.style.display = fabMenu.style.display === 'flex' ? 'none' : 'flex';
    btnToggleFab.style.transform = fabMenu.style.display === 'flex' ? 'rotate(45deg)' : 'rotate(0deg)';
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.fab-container')) { fabMenu.style.display = 'none'; btnToggleFab.style.transform = 'rotate(0deg)'; }
});
window.triggerFileInput = function() { fabMenu.style.display = 'none'; btnToggleFab.style.transform = 'rotate(0deg)'; document.getElementById('fileInput').click(); };

document.getElementById('fileInput').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    if (files.length > 5) { alert('一次最多只能上傳 5 張照片！'); e.target.value = ''; return; }

    pendingUploadBase64Array = [];
    const previewContainer = document.getElementById('uploadPreviewContainer');
    previewContainer.innerHTML = '<div style="color:var(--text-sub); padding:20px;">圖片處理中...</div>';
    document.getElementById('uploadModal').style.display = 'flex';

    for (const file of files) {
        try { pendingUploadBase64Array.push(await processImageFile(file)); } 
        catch (err) { console.error("圖片處理失敗", err); }
    }

    previewContainer.innerHTML = '';
    pendingUploadBase64Array.forEach(base64 => {
        const img = document.createElement('img'); img.src = base64; img.className = 'preview-item'; previewContainer.appendChild(img);
    });
    document.getElementById('uploadCaption').value = '';
});

function processImageFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(evt) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
                const maxSize = 1200; let width = img.width, height = img.height;
                if (width > height) { if (width > maxSize) { height *= maxSize / width; width = maxSize; } }
                else { if (height > maxSize) { width *= maxSize / height; height = maxSize; } }
                canvas.width = width; canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject; img.src = evt.target.result;
        };
        reader.onerror = reject; reader.readAsDataURL(file);
    });
}

document.getElementById('btnCancelUpload').addEventListener('click', () => { if (uploadInProgress) return; document.getElementById('uploadModal').style.display = 'none'; document.getElementById('fileInput').value = ''; pendingUploadBase64Array = []; });

// 上傳 Firebase Storage，成功後儲存貼文。
document.getElementById('btnConfirmUpload').addEventListener('click', async () => {
    if (uploadInProgress || pendingUploadBase64Array.length === 0) return;
    uploadInProgress = true;
    
    const caption = document.getElementById('uploadCaption').value.trim();
    const btnConfirm = document.getElementById('btnConfirmUpload');

    btnConfirm.disabled = true;
    btnConfirm.innerText = '準備上傳...';

    try {
        const photoRef = doc(collection(db, "photos"));
        await uploadPhotoPost({
            images: [...pendingUploadBase64Array], user: currentUser, groupId: currentGroupId, postId: photoRef.id,
            progress: (index, total) => { btnConfirm.innerText = `上傳圖片 (${index}/${total})...`; },
            save: async uploaded => {
                btnConfirm.innerText = '儲存資料中...';
                await setDoc(photoRef, {
                    ...uploaded,
                    groupId: currentGroupId,
                    caption,
                    uploader: currentUser.name,
                    uploaderAvatar: currentUser.avatar || null,
                    timestamp: serverTimestamp(),
                    comments: [], likes: []
                });
            }
        });

        document.getElementById('uploadModal').style.display = 'none';
        document.getElementById('fileInput').value = '';
        pendingUploadBase64Array = [];
        localStorage.setItem('homebase_photodump_last_read', Date.now().toString());
    } catch (e) {
        console.error("發佈失敗：", e);
        const denied = /unauthenticated|permission-denied|unauthorized/.test(e.code || '');
        alert(denied ? '上傳權限驗證失敗，請重新登入並確認目前群組。' : '照片上傳失敗，請稍後重試；若持續失敗，請管理者確認 Firebase Storage 與照片上傳服務已部署。');
    } finally {
        uploadInProgress = false;
        btnConfirm.disabled = false;
        btnConfirm.innerText = '發佈';
    }
});

// 塗鴉牆與全螢幕檢視器
const drawModal = document.getElementById('drawingBoardModal');
const drawCanvas = document.getElementById('drawCanvas');
const ctx = drawCanvas.getContext('2d', { willReadFrequently: true });
const stickerLayer = document.getElementById('stickerLayer');
const stickerControllers = new Set();
function clearStickers() { stickerControllers.forEach(controller=>controller.abort()); stickerControllers.clear(); stickerLayer.replaceChildren(); }
let isDrawing = false, drawColor = '#000000', drawSize = 8, activeTool = 'pen', undoStack = [];

window.openDrawingBoard = function() {
    fabMenu.style.display = 'none'; btnToggleFab.style.transform = 'rotate(0deg)'; drawModal.style.display = 'flex';
    const container = document.getElementById('canvasContainer'); drawCanvas.width = container.offsetWidth; drawCanvas.height = container.offsetHeight;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height);
    clearStickers(); undoStack = []; saveCanvasState();
};
window.closeDrawingBoard = function() { if(confirm("確定要取消塗鴉嗎？未儲存的內容將會遺失。")) drawModal.style.display = 'none'; };
window.setColor = function(color, btnElem) { drawColor = color; activeTool = 'pen'; document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active')); btnElem.classList.add('active'); };
window.setSize = function(size, btnElem) { drawSize = size; document.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active')); btnElem.classList.add('active'); };
window.setTool = function(tool) { activeTool = tool; };
 
function getPointerPos(e) { const rect = drawCanvas.getBoundingClientRect(); return { x: (e.touches ? e.touches[0].clientX : e.clientX) - rect.left, y: (e.touches ? e.touches[0].clientY : e.clientY) - rect.top }; }
function startDrawing(e) { isDrawing = true; const pos = getPointerPos(e); ctx.beginPath(); ctx.moveTo(pos.x, pos.y); e.preventDefault(); }
function draw(e) { if (!isDrawing) return; const pos = getPointerPos(e); ctx.lineTo(pos.x, pos.y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = drawSize; ctx.strokeStyle = activeTool === 'eraser' ? '#ffffff' : drawColor; ctx.stroke(); e.preventDefault(); }
function stopDrawing() { if (isDrawing) { isDrawing = false; ctx.closePath(); saveCanvasState(); } }
 
drawCanvas.addEventListener('mousedown', startDrawing); drawCanvas.addEventListener('mousemove', draw); window.addEventListener('mouseup', stopDrawing);
drawCanvas.addEventListener('touchstart', startDrawing, {passive: false}); drawCanvas.addEventListener('touchmove', draw, {passive: false}); window.addEventListener('touchend', stopDrawing);
 
function saveCanvasState() { if (undoStack.length >= 20) undoStack.shift(); undoStack.push(drawCanvas.toDataURL()); }
window.undoDraw = function() { if (undoStack.length > 1) { undoStack.pop(); const img = new Image(); img.onload = () => { ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height); ctx.drawImage(img, 0, 0); }; img.src = undoStack[undoStack.length - 1]; } else if (undoStack.length === 1) window.clearDraw(); };
window.clearDraw = function() { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, drawCanvas.width, drawCanvas.height); clearStickers(); undoStack = []; saveCanvasState(); };
window.addSticker = function(emoji) {
    const wrapper = document.createElement('div'); wrapper.className = 'sticker-item'; wrapper.style.left = '50%'; wrapper.style.top = '50%'; wrapper.style.transform = 'translate(-50%, -50%)';
    wrapper.innerHTML = `<span>${emoji}</span>`; stickerLayer.appendChild(wrapper);
    const controller = new AbortController(); stickerControllers.add(controller);
    const signal = controller.signal;
    let isDraggingSticker = false, startX, startY, initialLeft, initialTop, lastTapTime = 0; 
    function onDragStart(e) { if (Date.now() - lastTapTime < 300) { controller.abort(); stickerControllers.delete(controller); return wrapper.remove(); } lastTapTime = Date.now(); isDraggingSticker = true; startX = e.touches ? e.touches[0].clientX : e.clientX; startY = e.touches ? e.touches[0].clientY : e.clientY; initialLeft = wrapper.offsetLeft; initialTop = wrapper.offsetTop; wrapper.style.zIndex = 1000; if(e.cancelable) e.preventDefault(); }
    function onDragMove(e) { if(!isDraggingSticker) return; wrapper.style.left = `${initialLeft + ((e.touches ? e.touches[0].clientX : e.clientX) - startX)}px`; wrapper.style.top = `${initialTop + ((e.touches ? e.touches[0].clientY : e.clientY) - startY)}px`; if(e.cancelable) e.preventDefault(); }
    function onDragEnd() { isDraggingSticker = false; wrapper.style.zIndex = ''; }
    wrapper.addEventListener('touchstart', onDragStart, {passive: false, signal}); window.addEventListener('touchmove', onDragMove, {passive: false, signal}); window.addEventListener('touchend', onDragEnd, {signal});
    wrapper.addEventListener('mousedown', onDragStart, {signal}); window.addEventListener('mousemove', onDragMove, {signal}); window.addEventListener('mouseup', onDragEnd, {signal});
};
window.saveDraw = function() {
    const tCanvas = document.createElement('canvas'); tCanvas.width = drawCanvas.width; tCanvas.height = drawCanvas.height; const tCtx = tCanvas.getContext('2d');
    tCtx.drawImage(drawCanvas, 0, 0);
    const layerRect = stickerLayer.getBoundingClientRect();
    stickerLayer.querySelectorAll('.sticker-item').forEach(st => {
        const span = st.querySelector('span'); const stRect = span.getBoundingClientRect();
        tCtx.font = '45px sans-serif'; tCtx.textAlign = 'center'; tCtx.textBaseline = 'middle';
        tCtx.fillText(span.innerText, stRect.left - layerRect.left + (stRect.width / 2), stRect.top - layerRect.top + (stRect.height / 2));
    });
    pendingUploadBase64Array = [tCanvas.toDataURL('image/jpeg', 0.9)];
    document.getElementById('uploadPreviewContainer').innerHTML = `<img src="${pendingUploadBase64Array[0]}" class="preview-item">`;
    document.getElementById('uploadCaption').value = ''; drawModal.style.display = 'none'; document.getElementById('uploadModal').style.display = 'flex';
};

const photoViewerModal = document.getElementById('photoViewerModal'); const viewerImage = document.getElementById('viewerImage'); const viewerCounter = document.getElementById('viewerCounter');
window.openPhotoViewer = function(idx) { currentViewerIndex = idx; isZoomed = false; viewerImage.style.transform = 'scale(1)'; updateViewerContent(); photoViewerModal.style.display = 'flex'; };
window.closePhotoViewer = function() { photoViewerModal.style.display = 'none'; viewerImage.src = ''; isZoomed = false; viewerImage.style.transform = 'scale(1)'; };
function updateViewerContent() { if (window.viewerQueue.length === 0) return; if (currentViewerIndex < 0) currentViewerIndex = window.viewerQueue.length - 1; if (currentViewerIndex >= window.viewerQueue.length) currentViewerIndex = 0; viewerImage.decoding = 'async'; viewerImage.src = window.viewerQueue[currentViewerIndex]; viewerCounter.innerText = `${currentViewerIndex + 1} / ${window.viewerQueue.length}`; }
window.prevPhoto = function(e) { e.stopPropagation(); isZoomed = false; viewerImage.style.transform = 'scale(1)'; currentViewerIndex--; updateViewerContent(); };
window.nextPhoto = function(e) { e.stopPropagation(); isZoomed = false; viewerImage.style.transform = 'scale(1)'; currentViewerIndex++; updateViewerContent(); };
let lastViewerTapTime = 0; viewerImage.addEventListener('click', (e) => { e.stopPropagation(); if (new Date().getTime() - lastViewerTapTime < 300) { isZoomed = !isZoomed; viewerImage.style.transform = isZoomed ? 'scale(2.5)' : 'scale(1)'; } lastViewerTapTime = new Date().getTime(); });
let touchStartX = 0, touchStartY = 0, touchEndX = 0, touchEndY = 0;
photoViewerModal.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; } }, {passive: true});
photoViewerModal.addEventListener('touchend', (e) => { if (isZoomed) return; touchEndX = e.changedTouches[0].clientX; touchEndY = e.changedTouches[0].clientY; const diffX = touchEndX - touchStartX; const diffY = touchEndY - touchStartY; if (Math.abs(diffX) > Math.abs(diffY)) { if (diffX > 50) { currentViewerIndex--; updateViewerContent(); } else if (diffX < -50) { currentViewerIndex++; updateViewerContent(); } } else { if (diffY > 100) closePhotoViewer(); } }, {passive: true});

listenToGallery();