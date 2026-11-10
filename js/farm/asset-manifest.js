// Public file descriptions; safe to inspect without Phaser or Firebase.
export const ASSET_MANIFEST = {
    giant: {type:'atlas',image:'giant-sheet.png',json:'giant-sheet.json'},
    ancient_stone: {type:'image',image:'giant-sheet.png',crop:[1552,665,222,222]},
    mole: {type:'atlas',image:'mole-sheet.png',json:'mole-sheet.json'},
    sweet_potato: {type:'image',image:'mole-sheet.png',crop:[0,940,314,314]},
    ironhammer: {type:'image',image:'mole-sheet.png',crop:[314,940,313,314]},
    halloween_2026: {type:'atlas',image:'halloween-2026.png',json:'halloween-2026.json'},
    guard_dog: {type:'atlas',image:'guard-dog-sheet.png',json:'guard-dog-sheet.json'},
    guard_beagle: {type:'atlas',image:'guard-beagle-sheet.png',json:'guard-beagle-sheet.json'},
    guard_collie: {type:'atlas',image:'guard-collie-sheet.png',json:'guard-collie-sheet.json'},
    guard_corgi: {type:'atlas',image:'guard-corgi-sheet.png',json:'guard-corgi-sheet.json'},
    ...Object.fromEntries(['hen','silkie','bresse','onagadori','eagle','gorilla','tiger','wolf','cobra'].map(key => [key,{type:'atlas',image:`${key}-sheet.png`,json:`${key}-sheet.json`}])),
    cobra_fang: {type:'image',image:'cobra-fang.png'},
    dragon: {type:'sheet',image:'dragon-sheet.webp'},
    ...Object.fromEntries(Object.entries({egg:'egg.png',silkie_egg:'silkie-egg.png',bresse_egg:'bresse-egg.png',coin:'coin.png',worm:'worm.png',earthworm:'earthworm.png',fang:'wolf-fang.png',tiger_pelt:'tiger-pelt.png'}).map(([key,image]) => [key,{type:'image',image}])),
    ...Object.fromEntries(Object.entries({farm_background:'background.webp',farm_map:'farm-map.jpg',farm_panorama:'farm-panorama.webp',ui_wood:'ui-wood.webp',ui_wood_selected:'ui-wood-selected.webp',ui_parchment:'ui-parchment.webp',ui_page:'ui-page.webp',shortbow:'shortbow.png',huntingbow:'huntingbow.png',paladinbow:'paladinbow.png','eagle-feather':'eagle-feather.png',arrow:'arrow.png',mace:'mace.png',battleaxe:'battleaxe.png',coop:'coop.webp',dragon_scale:'dragon-scale.webp',gorilla_fang:'gorilla-fang.png',signboard:'signboard.webp'}).map(([key,image]) => [key,{type:'image',image}]))
};
// Both map orientations remain ready for immediate mobile/tablet resizing.
export const CORE_ASSETS = ['hen','farm_map','farm_panorama','ui_parchment','signboard','egg','coin','worm','earthworm'];
// Seasonal art is demand-loaded only while its explicitly dated event is active.
export const ALL_ASSETS = Object.keys(ASSET_MANIFEST).filter(key => key !== 'halloween_2026');
