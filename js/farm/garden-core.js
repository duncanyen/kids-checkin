// One mutually exclusive result per search: 3/150 earthworms, 5/150 worms.
export const GARDEN_ROLL_SIZE = 150;
export function gardenFindForRoll(roll) {
    if (!Number.isInteger(roll) || roll < 1 || roll > GARDEN_ROLL_SIZE) return null;
    if (roll <= 3) return 'earthworms';
    if (roll <= 8) return 'worms';
    return null;
}
