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
        note: '記錄期間：2026/11/2 00:00:00～2026/11/9 01:00:00（台灣時間）。僅計入公開村落的成功偷蛋；同一 accountId 跨公開村落合併，顯示 Top 10；同分依帳號排序。截止後保留成績，不發放獎勵。' },
});

export function rankFarmPlayers(entries, field) {
    const players = new Map();
    for (const entry of entries) {
        const score = Math.max(0, Math.floor(Number(entry.farm?.[field]) || 0));
        if (!Number.isSafeInteger(score) || !score) continue;
        const player = players.get(entry.accountId) || { accountId: entry.accountId, name: entry.name || entry.accountId, score: 0, villages: [] };
        player.score += score;
        if (!player.villages.includes(entry.village)) player.villages.push(entry.village);
        players.set(entry.accountId, player);
    }
    return [...players.values()].sort((a, b) => b.score - a.score || a.accountId.localeCompare(b.accountId)).slice(0, 10);
}

