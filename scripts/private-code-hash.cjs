/** 綁定隔離報告與將要切換的程式；只忽略兩個已分別測試的 rollout 布林值。 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function privateCodeHash(root=path.resolve(__dirname,'..')){
 const files=[];
 function scan(dir){for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const name=path.posix.join(dir,entry.name);if(entry.isDirectory()){if(!['node_modules','game','.git'].includes(entry.name))scan(name);}else if(/\.(js|cjs|mjs|json|rules|css)$/.test(entry.name)&&!entry.name.startsWith('.env'))files.push(name);}}
 for(const dir of ['functions','game-admin/functions','js','scripts','rules'])scan(dir);
 for(const file of fs.readdirSync(root))if(file.endsWith('.html')||file==='firebase.private-farm-review.json')files.push(file);
 const hash=crypto.createHash('sha256');for(const file of files.sort()){let source=fs.readFileSync(path.join(root,file),'utf8');if(file==='js/identity-config.js')source=source.replace(/(PRIVATE_IDENTITY_ENABLED\s*=\s*)(true|false)/,'$1<ROLLOUT>');if(file==='js/farm/backend-client.js')source=source.replace(/(FARM_BACKEND_ENABLED\s*=\s*)(true|false)/,'$1<ROLLOUT>');hash.update(file+'\0'+source+'\0');}return hash.digest('hex');
};
