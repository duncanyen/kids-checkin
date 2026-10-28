import { normalizeAccountId, findAccountsById, newAccountRef, assertAccountAvailable, ACCOUNT_ID_TAKEN } from './account-identity.js';
import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, addDoc, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

window.navTo = function(url, moduleName) {
    const user = JSON.parse(sessionStorage.getItem('familyCheckInUser'));
    if (user) {
        let gId = window.currentGroup ? window.currentGroup.id : localStorage.getItem('lastGroupId');
        let pendingLogs = JSON.parse(localStorage.getItem('nexus_pending_logs') || '[]');
        pendingLogs.push({
            operator: user.name,
            actionType: '系統操作', 
            details: `進入了 ${moduleName} 模組`,
            groupId: gId,
            timestamp: Date.now()
        });
        localStorage.setItem('nexus_pending_logs', JSON.stringify(pendingLogs));
    }
    window.location.href = url;
};

window.processPendingLogs = async function() {
    let pending = JSON.parse(localStorage.getItem('nexus_pending_logs') || '[]');
    if (pending.length === 0) return;
    localStorage.removeItem('nexus_pending_logs');
    for (let log of pending) {
        try {
            const d = new Date(log.timestamp);
            const datetimeStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
            await addDoc(collection(db, "logs"), {
                groupId: log.groupId || null,
                datetime: datetimeStr,
                operator: log.operator,
                actionType: log.actionType,
                details: log.details,
                timestamp: serverTimestamp()
            });
        } catch(e) { console.error("背景補送足跡失敗:", e); }
    }
};

window.recordLog = async function(operatorName, actionType, detailsText) {
    try {
        const now = new Date();
        const datetimeStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        let gId = window.currentGroup ? window.currentGroup.id : localStorage.getItem('lastGroupId');
        await addDoc(collection(db, "logs"), { 
            groupId: gId || null,
            datetime: datetimeStr, 
            operator: operatorName, 
            actionType: actionType, 
            details: detailsText, 
            timestamp: serverTimestamp() 
        });
    } catch (e) { console.warn("記錄足跡例外:", e); }
};

window.hideAllSections = function() {
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.getElementById('dashboardView').style.display = 'none';
};

window.showAuthSection = function() {
    window.stopDashboardListeners?.();
    document.getElementById('loadingView').style.display = 'none';
    window.hideAllSections();
    document.getElementById('authSection').classList.add('active');
    
    const savedLoginId = localStorage.getItem('savedLoginId');
    if (savedLoginId) {
        document.getElementById('loginId').value = savedLoginId;
        document.getElementById('rememberMe').checked = true; 
    }

    if (localStorage.getItem('pendingInviteCode')) {
        window.toggleAuth('register');
        alert("您有受邀加入群組的邀請，請先登入或註冊帳號！");
    } else {
        window.toggleAuth('login');
    }
};

window.toggleAuth = function(type) {
    document.querySelectorAll('.auth-form-container').forEach(el => el.classList.remove('active'));
    if(type === 'login') {
        document.getElementById('loginFormContainer').classList.add('active');
    } else {
        document.getElementById('registerFormContainer').classList.add('active');
    }
};

window.evaluateUserGroups = async function(userObj, { forceSelection = false } = {}) {
    document.getElementById('loadingView').style.display = 'flex';
    try {
        // 【核心修改】：改以 userObj.accountId 查詢群組 members 陣列
        const searchKey = userObj.accountId || userObj.name;
        const q = query(collection(db, "groups"), where("members", "array-contains", searchKey));
        const snap = await getDocs(q);
        let userGroups = [];
        snap.forEach(docSnap => userGroups.push({ id: docSnap.id, ...docSnap.data() }));
        document.getElementById('loadingView').style.display = 'none';
        
        const pendingCode = localStorage.getItem('pendingInviteCode');
        if (pendingCode && !forceSelection) {
            window.showActionSection();
            window.goToActionStep('obStepJoin');
            document.getElementById('obInviteCode').value = pendingCode;
            return;
        }

        if (forceSelection) {
            window.showGroupSelectionList(userGroups);
        } else if (userGroups.length === 0) {
            window.showActionSection();
        } else if (userGroups.length === 1) {
            window.enterGroup(userGroups[0]);
        } else {
            window.showGroupSelectionList(userGroups);
        }
    } catch(e) {
        console.error(e);
        document.getElementById('loadingView').style.display = 'none';
        if (forceSelection) alert("無法載入群組，請檢查網路後重試。");
    }
};

window.processLogin = async function() {
    const loginId = document.getElementById('loginId').value.trim();
    const loginPwd = document.getElementById('loginPassword').value.trim();
    const rememberMe = document.getElementById('rememberMe').checked; 
    if(!loginId || !loginPwd) { alert('請輸入帳號與密碼！'); return; }
    document.getElementById('loadingView').style.display = 'flex';
    try {
        const matches = await findAccountsById(db, loginId);
        if (matches.length > 1) {
            alert('此帳號存在大小寫重複資料，請聯絡管理員確認。');
            document.getElementById('loadingView').style.display = 'none';
            return;
        }
        let userDoc = matches[0];
        if (!userDoc) {
            const snap = await getDocs(query(collection(db, "users"), where("name", "==", loginId)));
            userDoc = snap.docs[0];
        }
        if (!userDoc) {
            alert('找不到此帳號，請確認輸入正確。');
            document.getElementById('loadingView').style.display = 'none';
            return;
        }
        const userData = userDoc.data();
        if (userData.password !== loginPwd && userData.pin !== loginPwd) {
            alert('密碼錯誤，請重新輸入！');
            document.getElementById('loadingView').style.display = 'none';
            return;
        }
        if (rememberMe) localStorage.setItem('savedLoginId', loginId); else localStorage.removeItem('savedLoginId');
        const loggedUser = { docId: userDoc.id, ...userData };
        sessionStorage.setItem('familyCheckInUser', JSON.stringify(loggedUser));
        await window.evaluateUserGroups(loggedUser);
    } catch (e) {
        alert("登入失敗，請檢查網路連系統。");
        document.getElementById('loadingView').style.display = 'none';
    }
};

window.processRegistration = async function() {
    const regId = normalizeAccountId(document.getElementById('regId').value);
    const regEmail = document.getElementById('regEmail').value.trim();
    const regName = document.getElementById('regName').value.trim();
    const pwd = document.getElementById('regPassword').value.trim();
    const pwdConfirm = document.getElementById('regConfirmPassword').value.trim();
    if(!regId || !regEmail || !regName || !pwd) { alert('請填寫完整註冊資訊！'); return; }
    if (!/^[a-z0-9_]+$/.test(regId)) { alert('帳號 ID 只能包含英文、數字與底線！'); return; }
    if(pwd.length < 6) { alert('密碼長度必須至少 6 碼！'); return; }
    if(pwd !== pwdConfirm) { alert('兩次輸入的密碼不一致！'); return; }
    document.getElementById('loadingView').style.display = 'flex';
    try {
        if ((await findAccountsById(db, regId)).length) throw new Error(ACCOUNT_ID_TAKEN);
        let qName = query(collection(db, "users"), where("name", "==", regName));
        if (!(await getDocs(qName)).empty) { alert('此群組暱稱已被使用，請換一個！'); document.getElementById('loadingView').style.display = 'none'; return; }
        
        const avatar = `https://ui-avatars.com/api/?name=${regName}&background=10b981&color=fff`;
        const userRef = newAccountRef(db, regId);
        await runTransaction(db, async transaction => {
            await assertAccountAvailable(transaction, userRef);
            transaction.set(userRef, { accountId: regId, email: regEmail, name: regName, password: pwd, pin: pwd, avatar, role: "member", createdAt: serverTimestamp() });
        });
        const loggedUser = { docId: userRef.id, accountId: regId, email: regEmail, name: regName, password: pwd, avatar, role: "member" };
        sessionStorage.setItem('familyCheckInUser', JSON.stringify(loggedUser));
        await window.evaluateUserGroups(loggedUser);
    } catch (e) {
        alert(e.message === ACCOUNT_ID_TAKEN ? ACCOUNT_ID_TAKEN : "註冊失敗，請檢查網路。");
        document.getElementById('loadingView').style.display = 'none';
    }
};
