/**
 * 以固定帳號取得行程建立者的最新群組個人資料。
 * @param {Object} event - accountId 為身分，operator 僅為建立時名稱。
 * @param {Array<Object>} profiles - 目前群組成員，含相容舊資料的 docId／nameHistory。
 * @returns {Object} 唯一對應的個人資料；無法確認時保留原標籤，不猜測同名帳號。
 */
export function calendarPerson(event, profiles = []) {
    const available = profiles.filter(profile => profile.role !== 'removed');
    const name = event.operator || event.accountId || '未知使用者';
    if (event.accountId) {
        const accounts = available.filter(profile => profile.accountId === event.accountId);
        if (accounts.length === 1) return accounts[0];
        // 部分舊行程曾將文件識別寫入 accountId；只接受群組內唯一對應。
        if (!accounts.length) {
            const documents = available.filter(profile => profile.docId === event.accountId);
            if (documents.length === 1) return documents[0];
        }
        return { accountId: event.accountId, name };
    }
    const matches = available.filter(profile => [profile.name, ...(Array.isArray(profile.nameHistory) ? profile.nameHistory : [])].includes(event.operator));
    return matches.length === 1 ? matches[0] : { name };
}
