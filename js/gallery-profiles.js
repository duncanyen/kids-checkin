import {collection,doc,getDoc,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
// Read only the selected group's accounts. Each query also reacts to renames
// while the feed is open; historical posts/comments themselves remain untouched.
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
