const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),hash=require('../../scripts/private-code-hash.cjs');
test('release evidence tolerates only rollout flag changes and detects changed transaction code',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-code-proof-'));
 try{
  for(const dir of ['functions','game-admin/functions','js/farm','scripts','rules'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  fs.writeFileSync(path.join(root,'js/identity-config.js'),'export const PRIVATE_IDENTITY_ENABLED = false;');fs.writeFileSync(path.join(root,'js/farm/backend-client.js'),'export const FARM_BACKEND_ENABLED = false;');fs.writeFileSync(path.join(root,'game-admin/functions/transaction.cjs'),'const amount=100;');
  const before=hash(root);fs.writeFileSync(path.join(root,'js/identity-config.js'),'export const PRIVATE_IDENTITY_ENABLED = true;');fs.writeFileSync(path.join(root,'js/farm/backend-client.js'),'export const FARM_BACKEND_ENABLED = true;');assert.equal(hash(root),before);
  fs.writeFileSync(path.join(root,'game-admin/functions/transaction.cjs'),'const amount=200;');assert.notEqual(hash(root),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
