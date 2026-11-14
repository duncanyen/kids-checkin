// Package the existing pure game model for the independent Functions codebase.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'game-admin/functions/game');
fs.mkdirSync(out,{recursive:true});
for(const file of ['poultry.js','reporting-config.js','inventory-core.js','combat-rules.js','guard-dog-core.js','poultry-housing.js','gorilla-rules.js','giant-rules.js','cobra-rules.js','mole-rules.js','combat-progress.js','garden-core.js','ranking-core.js','save-core.js'])fs.copyFileSync(path.join(root,'js/farm',file),path.join(out,file));
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({type:'module'}));

for(const file of ['identity-domain.cjs','identity-access.cjs'])fs.copyFileSync(path.join(root,'functions',file),path.join(root,'game-admin/functions',file));
