export const KILL_TYPES = ['wolf', 'tiger', 'eagle'];
export const killTotal = farm => KILL_TYPES.reduce((sum, kind) => sum + Math.max(0, Math.trunc(farm?.combatKills?.[kind] || 0)), 0);
export function killProgressPatch(farm, kind, encounterId) {
    if (!KILL_TYPES.includes(kind) || !encounterId) throw new Error('無效的擊殺紀錄');
    const receipts = farm.combatKillReceipts || [];
    if (receipts.includes(encounterId)) return {};
    return {
        'farm.combatKills': Object.fromEntries(KILL_TYPES.map(key => [key, Math.max(0, Math.trunc(farm.combatKills?.[key] || 0)) + (key === kind ? 1 : 0)])),
        'farm.combatKillReceipts': [...receipts.slice(-127), encounterId]
    };
}
