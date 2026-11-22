import test from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS_CONFIG as W,weaponDamage,hitsToDefeat,equippedWeapon,equippedBow} from '../js/farm/combat-rules.js';
import {getUsedSpace,INVENTORY_KEYS} from '../js/farm/inventory-core.js';
import {isFarmSave} from '../js/farm/save-core.js';
import {ASSET_MANIFEST,ALL_ASSETS} from '../js/farm/asset-manifest.js';
import {itemCategory} from '../js/farm/item-categories.js';
test('katana has exact requested ground-enemy hit counts, original health, unreleased 500000 list price and 30000 sell',()=>{
 const sword=W.katana;assert.equal(sword.name,'武士刀');assert.equal(sword.buyPrice,500000);assert.equal(sword.sellPrice,30000);assert.equal(sword.purchasable,false);assert.ok(!sword.ranged);
 for(const [enemy,hits]of Object.entries({wolf:1,tiger:1,mole:50,cobra:40,gorilla:10,giant:50}))assert.equal(hitsToDefeat(sword,enemy),hits,enemy);
 for(const enemy of ['dragon','eagle']){assert.equal(weaponDamage(sword,enemy),0);assert.equal(hitsToDefeat(sword,enemy),Infinity);}
});
test('katana uses existing warehouse/equipment/save/asset paths without requiring a migration',()=>{
 assert.equal(itemCategory('katana'),'weapons');assert.ok(INVENTORY_KEYS.includes('katana'));assert.equal(getUsedSpace({katana:2,worms:3}),5);
 assert.equal(equippedWeapon({katana:1,equippedWeapon:'katana'}),W.katana);assert.equal(equippedWeapon({katana:0,equippedWeapon:'katana'}),W.club);assert.equal(equippedBow({katana:1,equippedBow:'katana'}),null);
 const farm={coins:0,hens:1};assert.equal(isFarmSave(farm),true);assert.equal(isFarmSave({...farm,katana:1}),true);for(const value of [-1,NaN,Infinity])assert.equal(isFarmSave({...farm,katana:value}),false);
 assert.equal(ASSET_MANIFEST.katana.image,'katana.png');assert.ok(ALL_ASSETS.includes('katana'));
});
