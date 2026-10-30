// Add future rankings here without changing the launcher or dialog.
export const FARM_RANKINGS = Object.freeze({
    stolenEggs: { label: '偷蛋王', field: 'stolenEggsTotal', unit: '顆',
        note: '成功偷到的雞蛋才計入；自排行榜推出後累計。同一玩家在各公開村落的數量合併，顯示前 10 名。' },
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

