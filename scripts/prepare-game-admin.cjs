// Package the existing pure game model for the independent Functions codebase.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'game-admin/functions/game');
fs.mkdirSync(out,{recursive:true});
for(const file of ['poultry.js','inventory-core.js','combat-rules.js','guard-dog-core.js'])fs.copyFileSync(path.join(root,'js/farm',file),path.join(out,file));
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({type:'module'}));
