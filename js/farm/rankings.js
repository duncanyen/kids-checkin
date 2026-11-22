import { PRIVATE_IDENTITY_ENABLED } from '../identity-config.js';
import { createGameOperationsClient } from './operations-client.js';
import { db } from '../firebase-config.js';
import { doc, getDoc, getDocs, collection, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { isPublicVillage, listPublicVillages } from './villages.js';
import { FARM_RANKINGS, rankFarmPlayers } from './ranking-core.js';
export { FARM_RANKINGS } from './ranking-core.js';
let rankingClient,rankingContext;

export async function loadFarmRanking({ groupId, accountId }, ranking = 'stolenEggs') {
    const config = FARM_RANKINGS[ranking];
    if (!config) throw new Error('排行榜不存在');
    if(PRIVATE_IDENTITY_ENABLED){
        const identity=JSON.stringify([groupId,accountId]);
        if(!rankingClient||rankingContext!==identity){rankingClient=createGameOperationsClient({groupId,accountId});rankingContext=identity;}
        let result;try{result=await rankingClient.farmRanking(ranking);}catch(error){if(error.code==='functions/unauthenticated')rankingClient=null;throw error;}
        if(result.ranking===ranking&&Array.isArray(result.rows)){
            if(result.scoreField!==config.field)throw new Error('排行榜活動已更新，服務正在同步，請稍後重新整理。');
            return result.rows;
        }
        // Older backend or an index still building: preserve the old working path.
        // Auth/network failures throw above; they never trigger an unbounded retry.
    }
    const own = await getDoc(doc(db, 'groups', groupId));
    if (!own.exists() || !own.data().members?.includes(accountId)) throw new Error('你已不在此村落，請重新登入。');
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
                    return { groupId: group.id, accountId: profile.accountId, name: profile.name, farm: snapshot.data()?.farm };
                })));
            }
            const latest = await getDoc(doc(db, 'groups', group.id));
            if (!latest.exists() || !isPublicVillage(latest.data())) return [];
            return rows.filter(row => latest.data().members?.includes(row.accountId)).map(row => ({ ...row, groupName: latest.data().name || '未命名群組' }));
        }));
        entries.push(...batches.flat());
    }
    return rankFarmPlayers(entries, config.field);
}
