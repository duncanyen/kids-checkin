// All game pages resolve the selected group the same way as group.js.
// A profile's groupId can be stale after joining or switching groups.
export function getSelectedGameGroupId(user) {
    return localStorage.getItem('lastGroupId') || user?.groupId || null;
}

export function readGameContext() {
    let user;
    try {
        user = JSON.parse(sessionStorage.getItem('familyCheckInUser') || localStorage.getItem('familyCheckInUser') || 'null');
    } catch { user = null; }
    const groupId = getSelectedGameGroupId(user);
    if (!user?.accountId || !groupId) {
        alert(!user?.accountId ? '請先登入帳號，再進入遊戲區！' : '請先選擇群組，再進入遊戲區！');
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
    // Other tabs and browser Back can restore a page holding the previous farm.
    window.addEventListener('storage', event => {
        if (event.key === null || ['lastGroupId', 'familyCheckInUser'].includes(event.key)) check();
    });
    window.addEventListener('pageshow', check);
    window.addEventListener('focus', check);
}
