const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');

test('dragon module does not read uninitialized imported config or sale price during evaluation',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../js/farm/dragon.js'),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
 const context={};
 // 模擬 Safari 回報的 TDZ：外部常數直到 module body 完成後才初始化。
 vm.runInNewContext(source+`\nconst DRAGON_CONFIG=Object.freeze({health:600,flightMs:10000,durationMs:60000,encounterOdds:30,homeEncounterOdds:20,coinPenalty:100});const DRAGON_SCALE_PRICE=200;globalThis.spec=dragonSpec();globalThis.config=DRAGON_CONFIG;`,context);
 assert.strictEqual(context.spec.config,context.config);
 assert.equal(context.spec.salePrice,200);assert.equal(context.spec.key,'dragon');assert.equal(context.spec.size,176);
 assert.equal(context.spec.settle.name,'settleDragonEncounter');
});
