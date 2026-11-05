// Package the exact, existing legacy calculation; never re-award historical work.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),target=path.join(root,'functions/game');
fs.mkdirSync(target,{recursive:true});
fs.copyFileSync(path.join(root,'js/wishwall-core.js'),path.join(target,'wishwall-core.mjs'));
