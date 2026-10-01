import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, updateDoc, doc, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// 引入其他模組確保他們的功能綁定在 window 上
import "./auth.js";
import "./group.js";
import "./dashboard.js";

// 定義全域狀態變數
window.currentGroup = null; 
window.selectedPresetIcon = '🏠';
window.userAvatarMap = {};
window.groupMembers = []; 

// 側邊選單控制
window.toggleSidebar = function() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('sidebarOverlay').classList.toggle('active');
};

// 頭像上傳相關
window.triggerAvatarUpload = function() { document.getElementById('avatarUploadInput').click(); };
document.getElementById('avatarUploadInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('loadingView').style.display = 'flex';
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = async function() {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 300; 
            let width = img.width, height = img.height;
            if (width > height) { if (width > MAX_SIZE) { height *= MAX_SIZE / width; width = MAX_SIZE; } } 
            else { if (height > MAX_SIZE) { width *= MAX_SIZE / height; height = MAX_SIZE; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            try {
                const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
                if (user.docId) {
                    await updateDoc(doc(db, "users", user.docId), { avatar: dataUrl });
                    user.avatar = dataUrl;
                    sessionStorage.setItem('familyCheckInUser', JSON.stringify(user));
                    document.getElementById('dashUserAvatar').src = user.avatar;
                    document.getElementById('sideAvatar').src = user.avatar;
                    alert("頭像更新成功！");
                }
            } catch (err) {}
            document.getElementById('loadingView').style.display = 'none';
            document.getElementById('avatarUploadInput').value = '';
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

window.fetchAndRenderGroupMembers = async function() {
    try {
        if (!window.currentGroup || !window.currentGroup.members || window.currentGroup.members.length === 0) return;
        const memberNames = window.currentGroup.members;
        window.groupMembers = [];
        for (let i = 0; i < memberNames.length; i += 10) {
            const chunk = memberNames.slice(i, i + 10);
            const q = query(collection(db, "users"), where("name", "in", chunk));
            const snap = await getDocs(q);
            snap.forEach(docSnap => {
                let u = docSnap.data();
                window.userAvatarMap[u.name] = u.avatar;
                window.groupMembers.push(u);
            });
        }
        document.getElementById('sideMembersList').innerHTML = window.groupMembers.map(u => `
            <div class="member-avatar-container">
                <img class="member-avatar" src="${u.avatar}" onerror="this.src='https://ui-avatars.com/api/?name=${u.name}&background=10b981&color=fff'">
                <div class="member-name">${u.name}</div>
            </div>
        `).join('');
    } catch (e) { console.error("抓取群組成員失敗: ", e); }
};

// 聯絡表單
window.openContactModal = function() { window.toggleSidebar(); document.getElementById('contactModal').style.display = 'flex'; };
window.closeContactModal = function() { document.getElementById('contactModal').style.display = 'none'; };
window.submitContact = async function() {
    const type = document.getElementById('contactType').value;
    const email = document.getElementById('contactEmail').value.trim();
    const content = document.getElementById('contactContent').value.trim();
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    if (!email || !content) { alert("請完整填寫資訊！"); return; }
    document.getElementById('loadingView').style.display = 'flex';
    try {
        await addDoc(collection(db, "feedbacks"), { userName: user.name, type: type, email: email, content: content, timestamp: serverTimestamp() });
        alert("感謝您的回饋！"); window.closeContactModal();
    } catch (e) { alert("送出失敗。"); }
    document.getElementById('loadingView').style.display = 'none';
};

window.rateApp = function() { window.toggleSidebar(); alert("感謝您的支持！"); };
window.shareApp = async function() {
    window.toggleSidebar();
    try {
        if (navigator.share) await navigator.share({ title: 'Nexus', url: window.location.href });
        else { await navigator.clipboard.writeText(window.location.href); alert("已複製連結！"); }
    } catch (err) {}
};

// 初始化主流程
async function initializeAppFlow() {
    window.processPendingLogs();
    
    const urlParams = new URLSearchParams(window.location.search);
    const inviteCode = urlParams.get('code');
    if (inviteCode) {
        localStorage.setItem('pendingInviteCode', inviteCode);
        window.history.replaceState({}, document.title, window.location.pathname);
    }
    const savedUserStr = sessionStorage.getItem('familyCheckInUser');
    if (savedUserStr) {
        document.getElementById('loadingView').style.display = 'flex';
        try {
            const savedUser = JSON.parse(savedUserStr);
            const q = query(collection(db, "users"), where("name", "==", savedUser.name));
            const snap = await getDocs(q);
            
            if (snap.empty) {
                alert("此帳號已失效或被刪除，請重新登入。");
                sessionStorage.removeItem('familyCheckInUser');
                window.showAuthSection();
            } else {
                const latestUser = snap.docs[0].data();
                latestUser.docId = snap.docs[0].id;
                sessionStorage.setItem('familyCheckInUser', JSON.stringify(latestUser));
                await window.evaluateUserGroups(latestUser); 
            }
        } catch (e) { window.showAuthSection(); }
    } else { window.showAuthSection(); }
}

if (document.readyState === 'loading') { 
    document.addEventListener('DOMContentLoaded', initializeAppFlow); 
} else { 
    initializeAppFlow(); 
}