export const PLANT_TYPES=['sunflower','tulip','sakura'];
export const art={background:'assets/growth-forest/forest.svg',plants:Object.fromEntries(PLANT_TYPES.map(type=>[type,Array.from({length:5},(_,i)=>`assets/growth-forest/${type}-${i+1}.svg`)]))};
export const STAGE_NAMES=['種子','發芽','幼苗','成長','成熟'];
