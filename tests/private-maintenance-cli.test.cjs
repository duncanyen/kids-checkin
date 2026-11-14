const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('maintenance SDK resolves installed Admin package exports without connecting',()=>{
 const sdk=require('../scripts/firebase-admin-sdk.cjs');
 for(const name of ['app','firestore','database'])assert.ok(sdk.resolve('firebase-admin/'+name));
});
test('real review CLIs load the SDK and only read collections without revealing passwords',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-cli-review-')),preload=path.join(dir,'preload.cjs');
 try{
  // 只有讀取介面；任何正式資料寫入或額外 SDK 使用都無法通過此替身。
  fs.writeFileSync(preload,`
   const Module=require('node:module'),load=Module._load;
   const rows={users:[{id:'profile-a',data:()=>({accountId:'alice',name:'Alice',password:'test-only-secret',role:'member'})}],groups:[{id:'group-a',data:()=>({members:['alice']})}]};
   Module._load=function(name,...rest){
    if(name==='firebase-admin/app')return{applicationDefault:()=>({}),initializeApp:options=>{if(options.projectId!=='demo-cli-review')throw Error('wrong project');return{};}};
    if(name==='firebase-admin/firestore')return{getFirestore:()=>({collection:name=>({get:async()=>({docs:rows[name]||[]})})})};
    return load.call(this,name,...rest);
   };
  `);
  for(const [script,args] of [['identity-migration.cjs',[]],['private-cutover.cjs',['--phase','review']]]){
   const result=spawnSync(process.execPath,['--require',preload,path.join(root,'scripts',script),'--project','demo-cli-review',...args],{encoding:'utf8',timeout:10000});
   assert.equal(result.status,0,result.stderr);assert.ok(!result.stdout.includes('test-only-secret'));
   const output=JSON.parse(result.stdout);
   if(script==='identity-migration.cjs'){assert.equal(output.total,1);assert.deepEqual(output.issues,[]);}
   else assert.equal(output.groups[0].roles.alice,'REVIEW_REQUIRED');
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
