/** 進場確認與戰鬥期間只允許戰鬥操作，不能藉場景物件送出其他經濟交易。 */
export function farmActionsBlocked(scene, pendingBattle = false) {
    return pendingBattle || scene.entryChecked === false || scene.checkingEntry || scene.resumingPendingBattle ||
        scene.preparingEncounter || scene.preparingGiant || scene.preparingCobra || scene.preparingMole ||
        ['hornetEncounter','giantEncounter','moleEncounter','cobraEncounter','eagleEncounter','dragonEncounter','gorillaEncounter'].some(key => scene[key] && !scene[key].destroyed && !scene[key].settled) ||
        ['wolf','tiger'].some(key => scene[key]?.active && !scene[key].getData('resolved'));
}
