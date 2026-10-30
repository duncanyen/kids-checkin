import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { isPublicVillage, listPublicVillages } from './villages.js';
import { FARM_RANKINGS, rankFarmPlayers } from './ranking-core.js';
export { FARM_RANKINGS } from './ranking-core.js';

export async function loadFarmRanking({ groupId, accountId }, ranking = 'stolenEggs') {
    const config = FARM_RANKINGS[ranking];
    if (!config) throw new Error('排行榜不存在');
    const own = await getDoc(doc(db, 'groups', groupId));
    if (!own.exists() || !own.data().members?.includes(accountId)) throw new Error('你已不在此村落，請重新登入。');
    if (!isPublicVillage(own.data())) throw new Error('請先將村落設為公開，再查看公開村落排行榜。');
    const groups = await listPublicVillages();
    const entries = [];
    // Bound concurrent reads and include only current members with active profiles.
    for (let offset = 0; offset < groups.length; offset += 4) {
        const batches = await Promise.all(groups.slice(offset, offset + 4).map(async group => {
            const ids = [...new Set(group.members || [])].filter(id => typeof id === 'string' && id);
            const rows = [];
            for (let start = 0; start < ids.length; start += 10) {
                const batch = ids.slice(start, start + 10);
                const profiles = await getDocs(query(collection(db, 'users'), where('accountId', 'in', batch)));
                const active = new Map();
                profiles.forEach(profile => {
                    const data = profile.data();
                    if (batch.includes(data.accountId) && data.role !== 'removed') active.set(data.accountId, data);
                });
                rows.push(...await Promise.all([...active.values()].map(async profile => {
                    const snapshot = await getDoc(doc(db, 'groups', group.id, 'users', profile.accountId));
                    return { accountId: profile.accountId, name: profile.name, farm: snapshot.data()?.farm, village: group.name || '未命名村落' };
                })));
            }
            const latest = await getDoc(doc(db, 'groups', group.id));
            if (!latest.exists() || !isPublicVillage(latest.data())) return [];
            return rows.filter(row => latest.data().members?.includes(row.accountId));
        }));
        entries.push(...batches.flat());
    }
    return rankFarmPlayers(entries, config.field);
}
