// 所有遊戲頁沿用 group.js 的選擇順序；加入或切群組後 user.groupId 可能過期。
export function getSelectedGameGroupId(user) {
    return localStorage.getItem('lastGroupId') || user?.groupId || null;
}

/**
 * 取得目前帳號及所選群組；lastGroupId 優先於可能過期的 user.groupId。
 * @returns {{user: Object, groupId: string, accountId: string}} 頁面使用的識別上下文。
 * @throws {Error} 缺少識別時先導回首頁並停止載入；本機資料不是可信任授權。
 */
export function readGameContext() {
    let user;
    try {
        user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
    } catch { user = null; }
    const groupId = getSelectedGameGroupId(user);
    if (!user?.accountId || !groupId) {
        alert(!user?.accountId ? '請先登入帳號，再進入遊戲大廳！' : '請先選擇群組，再進入遊戲大廳！');
        window.location.replace('index.html');
        throw new Error('缺少遊戲帳號或目前群組，停止載入');
    }
    return { user, groupId, accountId: user.accountId };
}

export function watchGameContext(context) {
    const check = () => {
        let user;
        try { user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null'); } catch {}
        if (getSelectedGameGroupId(user) !== context.groupId || user?.accountId !== context.accountId) window.location.reload();
    };
    // 跨分頁操作與返回可能恢復持有前一個農場的舊頁面。
    window.addEventListener('storage', event => {
        if (event.key === null || ['lastGroupId', 'familyCheckInUser'].includes(event.key)) check();
    });
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
}
