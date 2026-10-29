// Public file descriptions; safe to inspect without Phaser or Firebase.
export const ASSET_MANIFEST = {
    ...Object.fromEntries(['hen','silkie','bresse','eagle','gorilla','tiger'].map(key => [key,{type:'atlas',image:`${key}-sheet.png`,json:`${key}-sheet.json`}])),
    ...Object.fromEntries(['wolf','dragon'].map(key => [key,{type:'sheet',image:`${key}-sheet.webp`}])),
    ...Object.fromEntries(Object.entries({farm_background:'background.webp',farm_map:'farm-map.jpg',farm_panorama:'farm-panorama.webp',ui_wood:'ui-wood.webp',ui_wood_selected:'ui-wood-selected.webp',ui_parchment:'ui-parchment.webp',ui_page:'ui-page.webp',shortbow:'shortbow.png',huntingbow:'huntingbow.png','eagle-feather':'eagle-feather.png',arrow:'arrow.png',mace:'mace.png',battleaxe:'battleaxe.png',coop:'coop.webp',dragon_scale:'dragon-scale.webp',gorilla_fang:'gorilla-fang.png',signboard:'signboard.webp'}).map(([key,image]) => [key,{type:'image',image}]))
};
// Both map orientations remain ready for immediate mobile/tablet resizing.
export const CORE_ASSETS = ['hen','farm_map','farm_panorama','ui_parchment','signboard'];
export const ALL_ASSETS = Object.keys(ASSET_MANIFEST);
