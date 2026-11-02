export const THEFT_RANKING_START = Date.parse('2026-11-02T00:00:00+08:00');
export const THEFT_RANKING_END = Date.parse('2026-11-09T01:00:00+08:00');
export const THEFT_RANKING_FIELD = 'stolenEggs20261102';
export function theftRankingPatch(farm, { now = Date.now(), publicVillage = false } = {}) {
    if (!publicVillage || now < THEFT_RANKING_START || now >= THEFT_RANKING_END || !Number.isFinite(now)) return {};
    const count = Math.max(0, Math.floor(Number(farm?.[THEFT_RANKING_FIELD]) || 0));
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(count + 1)) throw new Error('偷蛋計數資料無效');
    return { [`farm.${THEFT_RANKING_FIELD}`]: count + 1 };
}
export function theftRankingStatus(now = Date.now()) {
    return now < THEFT_RANKING_START ? '尚未開始' : now >= THEFT_RANKING_END ? '已截止' : '記錄中';
}
// Add future rankings here without changing the launcher or dialog.
export const FARM_RANKINGS = Object.freeze({
    stolenEggs: { label: '偷蛋王', field: THEFT_RANKING_FIELD, unit: '顆',
        period: '記錄期間：2026/11/2 00:00:00～2026/11/9 01:00:00（台灣時間）',
        note: '截止後依排名發放獎勵，這次除金幣外還會有額外驚喜獎品，請大家繼續努力偷蛋，爭取好成績' },
});

export function rankFarmPlayers(entries, field) {
    const players = new Map();
    for (const entry of entries) {
        if (!entry.groupId || !entry.accountId) continue;
        const score = Math.max(0, Math.floor(Number(entry.farm?.[field]) || 0));
        if (!Number.isSafeInteger(score) || !score) continue;
        // Each farm already stores its own count; never merge another group's farm.
        const key = JSON.stringify([entry.groupId, entry.accountId]);
        players.set(key, { groupId: entry.groupId, groupName: entry.groupName || '未命名群組', accountId: entry.accountId, name: entry.name || entry.accountId, score });
    }
    return [...players.values()].sort((a, b) => b.score - a.score || a.accountId.localeCompare(b.accountId) || a.groupId.localeCompare(b.groupId)).slice(0, 10);
}
