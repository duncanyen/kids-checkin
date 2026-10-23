export const DEFAULT_SETTINGS = {
    examRules: [{ id: 'ex1', type: '小考', minScore: 100, reqCount: 3, points: 1 }, { id: 'ex2', type: '大考', minScore: 100, reqCount: 1, points: 3 }],
    choreRules: [{ id: 'ch1', name: '幫忙洗碗', points: 1 }],
    gifts: [{ id: 'gf1', icon: '🎁', name: '課外讀物乙本', points: 3 }],
};
export const isAdminRole = profile => ['admin', 'parent'].includes(profile?.role);
export const belongsToGroup = (record, groupId) => !record.groupId || record.groupId === groupId;
export const ownerId = record => typeof record.accountId === 'string' && record.accountId ? record.accountId : null;
export const normalizeSettings = value => Object.fromEntries(['examRules', 'choreRules', 'gifts'].map(key => [key, (Array.isArray(value?.[key]) ? value[key] : []).map(item => ({ ...item }))]));
const money = value => Math.round(value * 100) / 100;
const amount = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? money(Number(value)) : 0;
const stamp = record => typeof record.timestamp === 'number' ? record.timestamp : record.timestamp?.toMillis?.() ?? (record.timestamp?.seconds ? record.timestamp.seconds * 1000 : Date.parse(record.date || '') || 0);
export const sortRecords = records => [...records].sort((a, b) => stamp(a) - stamp(b) || String(a.id).localeCompare(String(b.id)));

// Names are display labels only. Missing owner IDs are deliberately not inferred.
export function calculatePoints(scores, redeems, settings, groupId) {
    const balances = new Map(), earned = new Map(), progress = new Map();
    const add = (id, value) => balances.set(id, money((balances.get(id) || 0) + value));
    for (const score of sortRecords(scores)) {
        const id = ownerId(score);
        if (!id || !belongsToGroup(score, groupId)) continue;
        let points = 0;
        if (score.category === 'exam') {
            const rule = settings.examRules.filter(rule => rule.type === score.examType && Number.isFinite(Number(score.score)) && score.score >= 0 && score.score <= 100 && score.score >= rule.minScore)
                .sort((a, b) => b.minScore - a.minScore)[0];
            if (rule) {
                const key = JSON.stringify([id, rule.id]);
                const count = (progress.get(key) || 0) + 1;
                const required = Math.max(1, Math.trunc(Number(rule.reqCount) || 1));
                points = count >= required ? amount(rule.points) : 0;
                progress.set(key, count >= required ? 0 : count);
            }
        } else points = amount(score.points);
        earned.set(score.id, points); add(id, points);
    }
    for (const redeem of redeems) {
        const id = ownerId(redeem);
        if (id && belongsToGroup(redeem, groupId) && !['已取消', '已駁回'].includes(redeem.status)) add(id, -amount(redeem.cost));
    }
    return { balances, earned };
}

export function validateSetting(type, input) {
    const points = Number(input.points);
    if (!Number.isFinite(points) || points < 0 || Math.abs(points * 100 - Math.round(points * 100)) > 0.000001) throw new Error('積分請輸入非負數，最多兩位小數。');
    if (type === 'examRules') {
        const minScore = Number(input.minScore), reqCount = Number(input.reqCount);
        if (!String(input.type || '').trim() || !Number.isInteger(minScore) || minScore < 0 || minScore > 100 || !Number.isInteger(reqCount) || reqCount < 1) throw new Error('請輸入 0–100 分及至少 1 次的累積次數。');
        return { type: String(input.type).trim(), minScore, reqCount, points };
    }
    if (!['choreRules', 'gifts'].includes(type) || !String(input.name || '').trim() || (type === 'gifts' && points <= 0)) throw new Error('請輸入名稱，獎品花費需大於 0。');
    return { name: String(input.name).trim(), points, ...(type === 'gifts' ? { icon: '🎁' } : {}) };
}

export function canChangeRedeem(record, status, actorId, admin) {
    const previous = record.status || '申請中';
    if (previous === status) return false;
    const allowed = previous === '申請中' ? ['執行中', '已完成', '已取消', '已駁回'] : previous === '執行中' ? ['已完成', '已駁回'] : [];
    if (!allowed.includes(status) || (!admin && !(ownerId(record) === actorId && status === '已取消' && previous === '申請中'))) throw new Error('你無法進行這項狀態變更。');
    return true;
}
