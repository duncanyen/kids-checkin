import {collection,doc,getDoc,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
// 只訂閱所選群組帳號；改名即更新顯示，不改寫歷史貼文或留言。
/**
 * 取得群組名單後，按 accountId 分批訂閱最新名稱與頭像，不改寫歷史貼文。
 * @param {Object} db - Firestore 實例。
 * @param {string} groupId - 群組 ID。
 * @param {string} accountId - 必須在該群組中的目前帳號。
 * @param {Function} next - 全部分批首次就緒後接收合併成員。
 * @param {Function} [error] - 查詢與監聽錯誤處理。
 * @returns {Function} 立即可呼叫的停止函式，也會阻止延遲查詢建立新監聽。
 */
export function watchPhotoProfiles(db, groupId, accountId, next, error = () => {}) {
    let stopped = false;
    const stops = [];
    getDoc(doc(db, 'groups', groupId)).then(snapshot => {
        if (stopped) return;
        if (!snapshot.exists() || !snapshot.data().members?.includes(accountId)) throw Error('無法確認目前群組成員');
        const ids = [...new Set(snapshot.data().members)].filter(id => typeof id === 'string' && id);
        const batches = [];for (let offset = 0; offset < ids.length; offset += 10) batches.push(ids.slice(offset, offset + 10));
        const profiles = new Map();
        batches.forEach((batch, index) => {
            const stop = onSnapshot(query(collection(db, 'users'), where('accountId', 'in', batch)), result => {
                if (stopped) return;
                profiles.set(index, result.docs.map(row => row.data()).filter(p => batch.includes(p.accountId) && p.role !== 'removed'));
                if (profiles.size === batches.length) next([...profiles.values()].flat());
            }, reason => { if (!stopped) error(reason); });
            stops.push(stop);
        });
    }).catch(reason => { if (!stopped) error(reason); });
    return () => { stopped = true;stops.splice(0).forEach(stop => stop()); };
}
