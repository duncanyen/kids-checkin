import { doc, collection, query, where, getDocs, runTransaction, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export const MEALS = ['早餐', '午餐', '晚餐', '宵夜'];
export function foodDocumentId(groupId, date, meal) {
    if (!groupId || groupId.includes('/') || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !MEALS.includes(meal)) throw new Error('請選擇群組、日期與餐別');
    return `${groupId}_${date}_${meal}`;
}

export function createFoodStore(db, context) {
    const reference = selection => doc(db, 'food_votes', foodDocumentId(context.groupId, selection.date, selection.meal));
    async function change(selection, modify) {
        return runTransaction(db, async transaction => {
            const group = await transaction.get(doc(db, 'groups', context.groupId));
            if (!group.exists() || !(group.data().members || []).includes(context.accountId)) throw new Error('你已不在此群組，請重新選擇群組');
            const ref = reference(selection);
            const snapshot = await transaction.get(ref);
            const data = snapshot.exists() ? snapshot.data() : {};
            const patch = modify(data);
            transaction.set(ref, { ...data, ...patch, groupId: context.groupId, date: selection.date, meal: selection.meal, updatedAt: new Date().toISOString() });
        });
    }
    return {
        async changeRestaurant(id, payload) {
            return runTransaction(db, async transaction => {
                const group = await transaction.get(doc(db, 'groups', context.groupId));
                if (!group.exists() || !(group.data().members || []).includes(context.accountId)) throw new Error('你已不在此群組，請重新選擇群組');
                const ref = doc(db, 'food_restaurants', id);
                const restaurant = await transaction.get(ref);
                if (!restaurant.exists() || restaurant.data().groupId !== context.groupId) throw new Error('餐廳已刪除或不屬於目前群組，請重新整理');
                if (payload === null) transaction.delete(ref);
                else transaction.update(ref, { ...payload, groupId: context.groupId, updatedByAccountId: context.accountId, updatedAt: new Date().toISOString() });
            });
        },
        async watch(selection, receive, fail) {
            // Old versions used addDoc rather than the intended fixed document ID.
            // Import those votes once; canonical votes always take precedence.
            const legacy = await getDocs(query(collection(db, 'food_votes'), where('groupId', '==', context.groupId), where('date', '==', selection.date), where('meal', '==', selection.meal)));
            const imported = {};
            legacy.docs.filter(s => s.id !== reference(selection).id).sort((a, b) => a.id.localeCompare(b.id)).forEach(s => {
                Object.entries(s.data().votes || {}).forEach(([id, vote]) => {
                    if (!imported[id] || (vote.time || '') > (imported[id].time || '')) imported[id] = vote;
                });
            });
            if (Object.keys(imported).length) await change(selection, data => data.legacyImported ? {} : { votes: { ...imported, ...data.votes }, legacyImported: true });
            return onSnapshot(reference(selection), snapshot => receive(snapshot.exists() ? snapshot.data() : {}), fail);
        },
        vote(selection, restaurant, user, source) {
            return change(selection, data => ({ votes: { ...data.votes, [context.accountId]: { accountId: context.accountId, name: user.name, avatar: user.avatar || user.photoURL || user.avatarUrl || null, choice: restaurant.name, restaurantId: restaurant.id, source, time: new Date().toISOString() } }, decision: null }));
        },
        decide(selection, choice) {
            return change(selection, data => {
                if (!Object.values(data.votes || {}).some(v => v.choice === choice)) throw new Error('投票結果已變更，請重新確認');
                return { decision: { choice, accountId: context.accountId, time: new Date().toISOString() } };
            });
        }
    };
}
